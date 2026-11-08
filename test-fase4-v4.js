#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · FASE 4 — ARNÉS DE PRUEBAS DEL FILMCENTER
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-fase4-v4.js [puerto]     (defecto 3001; el servidor debe
                                          estar corriendo en ese puerto)

   [A] UNITARIO (sin red) — enrich.js puro:
       mapeo TMDB → forma alMap, ids tmdb-*, géneros TMDB por tipo.
   [B] EN VIVO — contrato del filmCenter completo:
       stream/types con portadas, página de teatro (héroe + grid infinito),
       subPage con TODOS los filtros (género/orden/año/región) y sin
       duplicados entre páginas, página de género (héroe + 3 filas),
       ficha film/detail (sinopsis, similares, Jikan best-effort),
       homepage, géneros populares con portada, orderTypes, screening.
   [C] INTEGRIDAD DEL CATÁLOGO — el entregable de la fase: cada teatro
       se recorre página a página verificando portadas, títulos y CERO
       duplicados (ataca de raíz "deja de cargar a mitad").
   ═════════════════════════════════════════════════════════════════════ */

const PORT = Number(process.argv[2] || process.env.PORT || 3001);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0, skipped = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); }
}
function skip(name, why) {
  skipped++; console.log(`  ○ ${name} — OMITIDO (${why})`);
}
function section(t) { console.log('\n' + t); }

async function j(path, opts) {
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _parseError: text.slice(0, 120) }; }
}

/* ═══════════════════ [A] UNITARIO — enrich.js ═══════════════════ */
async function unitTests() {
  section('[A] UNITARIO · enrich.js (Jikan/TMDB) — sin tocar la red');
  const enrich = require('./enrich');

  // A1: TMDB desactivado sin key → catálogo 100 % AniList (nada se rompe)
  const hadKey = process.env.ANIMAX_TMDB_KEY;
  delete process.env.ANIMAX_TMDB_KEY;
  check('A1 sin ANIMAX_TMDB_KEY → tmdbEnabled()=false', enrich.tmdbEnabled() === false);
  const empty = await enrich.tmdbDiscover('movie', { page: 1, perPage: 10 });
  check('A2 discover sin key → lista vacía (cae a AniList)', empty.list.length === 0 && empty.total === 0);

  // A3/A4: con key FALSA no explota — falla limpio y el catálogo sigue
  process.env.ANIMAX_TMDB_KEY = 'key-invalida-de-prueba';
  const bad = await enrich.tmdbDiscover('movie', { page: 1, perPage: 10 });
  check('A3 key inválida → lista vacía, sin excepción', Array.isArray(bad.list) && bad.list.length === 0);
  const badDetail = await enrich.tmdbDetail('movie', 1);
  check('A4 key inválida → detail null, sin excepción', badDetail === null);
  if (hadKey) process.env.ANIMAX_TMDB_KEY = hadKey; else delete process.env.ANIMAX_TMDB_KEY;

  // A5: la puerta HTTP propia nunca lanza (host inexistente)
  const dead = await enrich._httpJson('https://no-existe-animax.invalid/x', 1500);
  check('A5 host muerto → null (best-effort, nunca cuelga el catálogo)', dead === null);

  // A6: Jikan con título absurdo no lanza y devuelve null (caché negativa)
  const jk = await enrich.jikanByTitle('');
  check('A6 jikanByTitle("") → null sin lanzar', jk === null);
}

/* ═══════════════════ [B] EN VIVO — filmCenter completo ═══════════════════ */
async function liveTests() {
  section('[B] EN VIVO · filmCenter — contrato completo');

  // B1: stream/types con portadas de teatro
  const st = await j('/api/v1/content/filmCenter/stream/types');
  const types = st.data || [];
  check('B1 stream/types → 4 teatros', st.ok === true && types.length === 4);
  check('B2 cada teatro con streamCode + streamName',
    ['movie', 'drama', 'comic', 'short'].every(c => types.some(t => t.streamCode === c)));
  const withCover = types.filter(t => String(t.cover).startsWith('http')).length;
  check('B3 los 4 teatros con PORTADA (cover http)', withCover === 4,
    `${withCover}/4 con cover`);
  check('B4 compat Fase 1: names = [Películas, Series, Anime, Minidramas]',
    Array.isArray(st.names) && st.names.length === 4 && st.names.includes('Anime'));
  check('B5 totalFilms > 0 en cada teatro', types.every(t => Number(t.totalFilms) > 0));

  // B6: página de teatro espejo
  const tp = await j('/api/v1/content/filmCenter/theater/page?stream=comic&pageSize=6');
  check('B6 theater/page → ok + streamName "Anime"', tp.ok === true && tp.streamName === 'Anime');
  check('B7 cabecera: cover grande + descripción + heroTitle',
    String(tp.cover).startsWith('http') && tp.description.length > 20 && !!tp.heroTitle);
  check('B8 grid página 1 incluido (filmCardList ≥ 6)',
    Array.isArray(tp.filmCardList) && tp.filmCardList.length >= 6);
  check('B9 barras de filtro: orderTypeList (4) + genreList (≥ 12)',
    Array.isArray(tp.orderTypeList) && tp.orderTypeList.length === 4 &&
    Array.isArray(tp.genreList) && tp.genreList.length >= 12);
  check('B10 paginación: page=1, isLast=false, totalFilms > 0',
    tp.page === 1 && tp.isLast === false && tp.totalFilms > 0);
  const card = tp.filmCardList[0] || {};
  check('B11 tarjeta TheaterCover completa (filmId, title, cover, genre, year)',
    !!card.filmId && !!card.title && String(card.cover).startsWith('http') &&
    card.genre !== undefined && card.year !== undefined);

  // B12: subPage con filtros — género
  const sg = await j('/api/v1/content/filmCenter/film/subPage?stream=comic&genre=Action&orderType=rating&pageSize=10');
  check('B12 subPage género=Action + orden=rating → 10 resultados',
    sg.ok === true && sg.content.length === 10);
  check('B13 el filtro de género se refleja en la tarjeta ("Acción…")',
    sg.content.every(c => String(c.genre).includes('Acción')),
    sg.content.slice(0, 2).map(c => c.genre).join(' | '));

  // B14: filtro año
  const sy = await j('/api/v1/content/filmCenter/film/subPage?stream=comic&year=2024&orderType=newest&pageSize=10');
  check('B14 subPage año=2024 → todos del año (o vacío si el servidor no alcanza AniList)',
    sy.ok === true && (sy.content.length === 0 || sy.content.every(c => String(c.year) === '2024')),
    [...new Set(sy.content.map(c => c.year))].join(','));

  // B15: orderTypes + géneros + popular
  const ot = await j('/api/v1/config/filmCenter/orderTypes');
  check('B15 orderTypes → 4 (trending, newest, rating, popularity)',
    ['trending', 'newest', 'rating', 'popularity'].every(o =>
      (ot.data || []).some(x => x.orderType === o)));
  const gs = await j('/api/v1/config/filmCenter/genres');
  check('B16 géneros → ≥ 12 con genreCode + genreName ES',
    (gs.data || []).length >= 12 && gs.data.every(g => g.genreCode && g.genreName));
  const pg = await j('/api/v1/config/filmCenter/genres/popular');
  check('B17 géneros populares → 12 con PORTADA',
    (pg.data || []).length === 12 && pg.data.every(g => g.name && String(g.cover).startsWith('http')));

  // B18: página de género espejo
  const gf = await j('/api/v1/content/filmCenter/genres/films?genre=Romance');
  check('B18 genres/films → nombre + héroe con sinopsis',
    gf.ok === true && gf.name === 'Romance' && !!gf.hero && gf.hero.synopsis.length > 0);
  check('B19 3 filas: topMovies + topTvShows + topAnimes (10 c/u)',
    gf.topMovies.filmCardList.length === 10 && gf.topTvShows.filmCardList.length === 10 &&
    gf.topAnimes.filmCardList.length === 10);
  check('B20 portada grande del género + descripción',
    String(gf.cover).startsWith('http') && gf.description.length > 20);

  // B21: ficha film/detail por filmId (AniList id 21 = One Piece)
  const d1 = await j('/api/v1/content/filmCenter/film/detail?filmId=21');
  const dd = d1.data || {};
  check('B21 film/detail por id → título, géneros ES, sinopsis',
    d1.ok === true && !!dd.title && Array.isArray(dd.genres) && dd.genres.length > 0 &&
    dd.synopsis.length > 50, dd.title);
  check('B22 similares (misma saga de géneros) → hasta 8 tarjetas',
    Array.isArray(dd.similar) && dd.similar.length > 0 && dd.similar.length <= 8);
  // B23: ficha por título (respaldo)
  const d2 = await j('/api/v1/content/filmCenter/film/detail?title=frieren&stream=comic');
  check('B23 film/detail por título → encuentra la obra',
    d2.ok === true && /frieren/i.test(d2.data.title), d2.data && d2.data.title);
  // B24: jikan best-effort (en Render llega; en sandbox se omite si no hay red)
  if (d1.data && d1.data.jikan) {
    check('B24 Jikan en vivo: tráiler/estudios/MAL score',
      !!d1.data.jikan.trailer || (d1.data.jikan.studios || []).length > 0 || !!d1.data.jikan.malScore);
  } else {
    skip('B24 Jikan (tráiler/estudios)', 'api.jikan.moe no alcanzable desde este host — en Render sí');
  }
  // B25: inexistente → ok:false limpio
  const d3 = await j('/api/v1/content/filmCenter/film/detail?filmId=zzzz-no-existe');
  check('B25 detail inexistente → ok:false sin caerse', d3.ok === false);

  // B26: homepage (regresión Fase 1 con la nueva fuente)
  const hp = await j('/api/v1/content/filmCenter/homepage');
  const secs = hp.data || [];
  check('B26 homepage → categorías populares + 4 teatros',
    Array.isArray(secs) && secs.some(s => s.modularType === 'GENRE') &&
    ['movie', 'drama', 'comic', 'short'].every(c => secs.some(s => s.resourceType === c)));

  // B27: home server-driven sigue vivo (regresión)
  const hs = await j('/api/v1/app/content/home/getSectionContentByPage?labelCode=comic&page=1&pageSize=6');
  check('B27 home secciones (regresión Fase 1)',
    hs.ok === true && hs.content.length >= 2 && hs.content[0].singleAlbumList.length > 0);

  // B28: screening sigue con años/región (lo usa subPage ahora)
  const sc = await j('/api/v1/app/search/screening/list');
  check('B28 screening: Género + Año + Región + Tipo',
    (sc.data || []).length === 4);
}

/* ═══════════════════ [C] INTEGRIDAD DEL CATÁLOGO ═══════════════════ */
async function integrityTests() {
  section('[C] INTEGRIDAD · catálogo paginado completo (cero duplicados, todo con portada)');

  for (const code of ['comic', 'movie', 'drama']) {
    const seen = new Set();
    let dupes = 0, noCover = 0, total = 0, isLast = false, pages = 0;
    for (let p = 1; p <= 3 && !isLast; p++) {
      const r = await j(`/api/v1/content/filmCenter/film/subPage?stream=${code}&page=${p}&pageSize=20`);
      if (!r.ok) { check(`C-${code} página ${p} ok`, false, 'server error'); break; }
      pages++; total += r.content.length;
      for (const c of r.content) {
        if (seen.has(c.filmId)) dupes++;
        seen.add(c.filmId);
        if (!String(c.cover).startsWith('http')) noCover++;
        if (!c.title) noCover += 0;   // título vacío contaría como fallo abajo
      }
      if (r.content.some(c => !c.title)) noCover++;
      isLast = r.isLast;
    }
    check(`C1 ${code}: 3 páginas recorridas (${total} obras, ${pages} páginas)`, total >= 40,
      `${total} obras`);
    check(`C2 ${code}: CERO duplicados entre páginas`, dupes === 0, `${dupes} duplicados`);
    check(`C3 ${code}: TODAS las tarjetas con portada y título`, noCover === 0, `${noCover} mal`);
  }

  // C4: la paginación respeta el orden — página 2 ≠ página 1
  const p1 = await j('/api/v1/content/filmCenter/film/subPage?stream=comic&page=1&pageSize=20');
  const p2 = await j('/api/v1/content/filmCenter/film/subPage?stream=comic&page=2&pageSize=20');
  check('C4 página 2 trae obras DISTINTAS de la página 1',
    p1.content[0].filmId !== p2.content[0].filmId);

  // C5: mismo orden en dos llamadas (estable — sin saltos al girar pantalla)
  const p1b = await j('/api/v1/content/filmCenter/film/subPage?stream=comic&page=1&pageSize=20');
  check('C5 orden estable entre llamadas (misma página = mismas obras)',
    p1.content[0].filmId === p1b.content[0].filmId);

  // C6: isLast llega de verdad al final (título raro con pocos resultados)
  const rare = await j('/api/v1/content/filmCenter/film/subPage?stream=comic&genre=Sports&year=1995&page=1&pageSize=40');
  check('C6 filtro combinado estrecho → isLast coherente (true o con resultados)',
    rare.ok === true && (rare.isLast === true || rare.content.length >= 40),
    `isLast=${rare.isLast}, n=${rare.content.length}`);

  // C7: TMDB opcional — informar el modo
  const st = await j('/api/v1/content/filmCenter/stream/types');
  const mode = (st.data || []).find(t => t.streamCode === 'movie');
  console.log(`  ℹ  Modo Películas/Series: ${process.env.ANIMAX_TMDB_KEY ? 'TMDB (cine real)' : 'AniList (sin ANIMAX_TMDB_KEY — opcional)'}`);
  check('C7 contrato stream/types íntegro en modo sin TMDB',
    !!mode && !!mode.streamName && typeof mode.totalFilms === 'number');
}

/* ═══════════════════ RESUMEN ═══════════════════ */
(async () => {
  console.log('══════════════════════════════════════════════════════════');
  console.log(' AniMax v4.0 · ARNÉS FASE 4 — FilmCenter (catálogo completo)');
  console.log(` Servidor: ${BASE}  (node index.js en otro terminal)`);
  console.log('══════════════════════════════════════════════════════════');
  try {
    await unitTests();
    await liveTests();
    await integrityTests();
  } catch (e) {
    failed++;
    console.log(`  ✘ EXCEPCIÓN: ${e.message}`);
  }
  console.log('\n─────────────────────────────────────────────');
  console.log(` RESULTADO: ${passed} ✔ · ${failed} ✘ · ${skipped} omitidos`);
  console.log('─────────────────────────────────────────────');
  process.exit(failed ? 1 : 0);
})();
