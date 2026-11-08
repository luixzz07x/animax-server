#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · ARNÉS DE PRUEBAS — FASE 1
   ═════════════════════════════════════════════════════════════════════
   Prueba TODOS los endpoints de la capa espejo de la API de Seekee
   contra un servidor arrancado en local (por defecto puerto 3001).

   Uso:  node test-v4-api.js [puerto]
   Salida: ✔/✘ por endpoint + resumen. Código de salida 0 si todo OK.
   ═════════════════════════════════════════════════════════════════════ */

const PORT = Number(process.argv[2] || process.env.ANIMAX_PORT || 3001);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; failures.push(name + (detail ? ' → ' + detail : '')); console.log('  ✘ ' + name + (detail ? ' → ' + detail : '')); }
}

function get(p) {
  return new Promise((resolve) => {
    const req = require('http').get(BASE + p, { timeout: 25000 }, (res) => {
      let b = '';
      res.on('data', c => { if (b.length < 3000000) b += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch {}
        resolve({ status: res.status || res.statusCode, json: j, text: b, headers: res.headers });
      });
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, json: null, text: "" }); });
    req.on('error', (e) => resolve({ status: 0, json: null, text: '', err: String(e) }));
  });
}

function post(p, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {});
    const req = require('http').request(BASE + p, {
      method: 'POST', timeout: 25000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let b = '';
      res.on('data', c => { if (b.length < 3000000) b += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch {}
        resolve({ status: res.status || res.statusCode, json: j, text: b });
      });
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, json: null, text: "" }); });
    req.on('error', (e) => resolve({ status: 0, json: null, text: '', err: String(e) }));
    req.end(payload);
  });
}

async function main() {
  console.log(`\nARNÉS FASE 1 · capa espejo Seekee contra ${BASE}\n`);

  /* ── 0. Arranque ─────────────────────────────────────────────────── */
  console.log('[0] Salud y versión');
  const ping = await get('/api/ping');
  check('GET /api/ping responde 200', ping.status === 200, 'status=' + ping.status);
  check('versión 4.0.x', /^4\.0\./.test((ping.json && ping.json.version) || ''), ping.json && ping.json.version);
  check('sniffer embebido con sintaxis válida', (() => {
    try { new Function(require('./v4-api').SNIFFER_JS); return true; } catch { return false; }
  })());

  /* ── 1. HOME server-driven ───────────────────────────────────────── */
  console.log('\n[1] Home server-driven (contrato /quan/app/content/home/*)');
  const nav = await get('/api/v1/app/content/home/navigationBar');
  check('navigationBar → 200 + tabs', nav.status === 200 && Array.isArray(nav.json && nav.json.data) && nav.json.data.length >= 4);
  check('navigationBar TabData {labelName, labelCode}',
    !!(nav.json && nav.json.data && nav.json.data.every(t => t.labelName && t.labelCode)));

  const sec = await post('/api/v1/app/content/home/getSectionContentByPage',
    { labelCode: 'comic', page: 1, pageSize: 20 });
  check('getSectionContentByPage (POST JSON) → 200', sec.status === 200 && sec.json && sec.json.ok);
  check('TabPageData {content, isLast, page, pageSize, totalElements}',
    sec.json && Array.isArray(sec.json.content) && typeof sec.json.isLast === 'boolean' &&
    typeof sec.json.page === 'number' && typeof sec.json.pageSize === 'number' &&
    typeof sec.json.totalElements === 'number');
  check('PageContent {sectionId, sectionName, sectionStyle, singleAlbumList}',
    sec.json.content.length > 0 && sec.json.content.every(s =>
      typeof s.sectionId === 'number' && s.sectionName && s.sectionStyle === 'SINGLE_ALBUM' &&
      Array.isArray(s.singleAlbumList)));
  check('AlbumData con portada y campos Seekee',
    sec.json.content[0].singleAlbumList.length > 0 && sec.json.content[0].singleAlbumList.every(a =>
      a.title && a.cover && a.type && typeof a.integrationId === 'number'));

  const secGet = await get('/api/v1/app/content/home/getSectionContentByPage?labelCode=movie&page=1&pageSize=6');
  check('getSectionContentByPage (GET query) también funciona', secGet.status === 200 && secGet.json.ok && secGet.json.content.length > 0);
  check('tab Películas usa type movie',
    secGet.json.content[0].singleAlbumList.every(a => a.type === 'movie'));

  const album = await post('/api/v1/app/content/home/getSingleAlbumDetail',
    { titles: ['One Piece', 'Naruto'], type: 'comic' });
  check('getSingleAlbumDetail → AlbumData[]', album.status === 200 &&
    Array.isArray(album.json && album.json.data) && album.json.data.length >= 1 &&
    album.json.data.every(a => a.title && a.cover));
  const multi = await post('/api/v1/app/content/home/getMultipleAlbumDetail',
    { titles: ['Jujutsu Kaisen'], type: 'comic' });
  check('getMultipleAlbumDetail → 200', multi.status === 200 && Array.isArray(multi.json && multi.json.data));
  const guide = await get('/api/v1/app/content/home/getGuideImgList');
  check('getGuideImgList → []', guide.status === 200 && Array.isArray(guide.json && guide.json.data));

  /* ── 2. Catálogo de sitios + dominios vigentes ───────────────────── */
  console.log('\n[2] Catálogo de sitios y dominios vigentes');
  const nlist = await get('/api/v1/app/content/website/navigationList');
  check('navigationList → NavigationGroup[]', nlist.status === 200 &&
    Array.isArray(nlist.json && nlist.json.data) && nlist.json.data.length >= 3);
  check('NavigationGroup {title, pickCover, unPickCover, sites[{url, cover}]}',
    nlist.json.data.every(g => g.title && Array.isArray(g.sites) &&
      g.sites.every(s => s.url && s.cover !== undefined)));
  check('los 24 sitios del catálogo están presentes',
    nlist.json.data.reduce((n, g) => n + g.sites.length, 0) >= 20);

  const fresh = await get('/api/v1/app/content/website/queryFreshDomainList');
  check('queryFreshDomainList → WhiteListConfig[]', fresh.status === 200 &&
    Array.isArray(fresh.json && fresh.json.data) && fresh.json.data.length >= 20);
  check('WhiteListConfig {url, freshEnable, webFreshEnable}',
    fresh.json.data.every(w => w.url && typeof w.freshEnable === 'boolean' &&
      typeof w.webFreshEnable === 'boolean'));

  /* ── 3. FilmCenter ───────────────────────────────────────────────── */
  console.log('\n[3] FilmCenter (contrato /buscari/content/filmCenter/*)');
  const types = await get('/api/v1/content/filmCenter/stream/types?defaultData=true');
  check('stream/types → [Películas, Series, Anime, Minidramas]', types.status === 200 &&
    Array.isArray(types.json && types.json.data) && types.json.data.length === 4);

  const films = await get('/api/v1/content/filmCenter/stream/films?stream=Películas&defaultData=true');
  check('stream/films → TheaterCover[]', films.status === 200 &&
    Array.isArray(films.json && films.json.data) && films.json.data.length >= 6);
  check('TheaterCover {filmId, title, cover, genre, rating, year, languageCode, languageNames, type}',
    films.json.data.every(t => t.filmId && t.title && t.cover && t.languageCode &&
      t.languageNames && t.type));
  const filmsCode = await get('/api/v1/content/filmCenter/stream/films?stream=comic');
  check('stream/films acepta también el código (comic)', filmsCode.status === 200 &&
    Array.isArray(filmsCode.json && films.json.data) && filmsCode.json.data.length >= 6);

  const home = await get('/api/v1/content/filmCenter/homepage');
  check('filmCenter/homepage → DiscoveryModularizedData[]', home.status === 200 &&
    Array.isArray(home.json && home.json.data) && home.json.data.length >= 4);
  check('sección GENRE con collectList de GenreCover {name, label, cover}',
    home.json.data.some(d => d.modularType === 'GENRE' && Array.isArray(d.collectList) &&
      d.collectList.every(g => g.name && g.label !== undefined)));
  check('secciones THEATER con filmCardList',
    home.json.data.filter(d => d.modularType === 'THEATER').length >= 3 &&
    home.json.data.filter(d => d.modularType === 'THEATER').every(d =>
      d.title && d.resourceType && Array.isArray(d.filmCardList)));

  const genres = await get('/api/v1/config/filmCenter/genres');
  check('config/filmCenter/genres → FilterItem[] {genreCode, genreName}',
    genres.status === 200 && Array.isArray(genres.json && genres.json.data) &&
    genres.json.data.length >= 12 && genres.json.data.every(g => g.genreCode && g.genreName));

  const pop = await get('/api/v1/config/filmCenter/genres/popular?defaultData=true');
  check('genres/popular → GenreCover[] con portadas', pop.status === 200 &&
    Array.isArray(pop.json && pop.json.data) && pop.json.data.length >= 8 &&
    pop.json.data.filter(g => g.cover).length >= 6);

  const gf = await get('/api/v1/content/filmCenter/genres/films?genre=Action&defaultData=true');
  check('genres/films → GenreDetailPageData {collectId, cover, name, topMovies, topTvShows}',
    gf.status === 200 && gf.json && gf.json.name && gf.json.topMovies && gf.json.topTvShows &&
    Array.isArray(gf.json.topMovies.filmCardList));

  const orders = await get('/api/v1/config/filmCenter/orderTypes');
  check('orderTypes → SortItem[] {orderType, orderTypeName}', orders.status === 200 &&
    Array.isArray(orders.json && orders.json.data) && orders.json.data.length >= 3 &&
    orders.json.data.every(o => o.orderType && o.orderTypeName));

  const sub = await post('/api/v1/content/filmCenter/film/subPage',
    { stream: 'Películas', genre: 'Action', orderType: 'rating', page: 1, pageSize: 12 });
  check('film/subPage → DiscoveryDetailPageData {content, isLast, page, pageSize}',
    sub.status === 200 && sub.json && Array.isArray(sub.json.content) &&
    typeof sub.json.isLast === 'boolean' && sub.json.content.length >= 6);

  /* ── 4. Búsqueda estilo Seekee ───────────────────────────────────── */
  console.log('\n[4] Búsqueda (contrato /buscari/app/search/*)');
  const s = await post('/api/v1/app/search/search', { keyWord: 'one piece', page: 1, pageSize: 20 });
  check('app/search/search → SearchResultPageData', s.status === 200 && s.json && s.json.ok);
  check('{content, hotSearchContent, isLast, page, pageSize, totalElements}',
    Array.isArray(s.json.content) && s.json.hotSearchContent &&
    typeof s.json.isLast === 'boolean' && typeof s.json.page === 'number');
  check('SearchResultData con url + siteName + labelList de idioma',
    s.json.content.filter(r => r.type === 'web').length >= 1 &&
    s.json.content.filter(r => r.type === 'web').every(r =>
      r.url && r.siteName && Array.isArray(r.labelList) && r.labelList[0] && r.labelList[0].labelName));
  check('resultados de catálogo (filmCenter) con portada',
    s.json.content.filter(r => r.type === 'filmCenter' && r.cover).length >= 1);
  check('hotSearchContent {hotShow, list[{cover,title}], screening}',
    s.json.hotSearchContent.hotShow === true && Array.isArray(s.json.hotSearchContent.list) &&
    s.json.hotSearchContent.list.length >= 3 && s.json.hotSearchContent.screening);

  const rel = await get('/api/v1/search/relatedQueries?keyWord=frieren');
  check('relatedQueries → sugerencias', rel.status === 200 &&
    Array.isArray(rel.json && rel.json.data) && rel.json.data.length >= 1);

  const hot = await post('/api/v1/api/home/search/hot', { type: 'anime' });
  check('api/home/search/hot → HotRecommendData[]', hot.status === 200 &&
    Array.isArray(hot.json && hot.json.data) && hot.json.data.length >= 3 &&
    hot.json.data.every(h => h.resourceName && h.resourceType && h.resourceTypeName));

  const scr = await get('/api/v1/app/search/screening/list');
  check('screening/list → 4 filtros (género/año/región/tipo)', scr.status === 200 &&
    Array.isArray(scr.json && scr.json.data) && scr.json.data.length === 4 &&
    scr.json.data.every(x => x.name && Array.isArray(x.screeningItems) && x.screeningItems.length > 0));

  const cat = await post('/api/v1/app/search/category/list',
    { genre: 'Romance', year: 2024, area: 'JP', type: 'comic', page: 1, pageSize: 12 });
  check('category/list → ScreeningTheaterResp {dataList}',
    cat.status === 200 && cat.json && Array.isArray(cat.json.dataList) &&
    cat.json.dataList.length >= 1 && cat.json.dataList.every(d => d.title && d.cover));

  /* ── 5. Reproductor / subtítulos ─────────────────────────────────── */
  console.log('\n[5] Reproductor y subtítulos');
  const subs = await get('/api/v1/tv/configuration/subtitles');
  check('tv/configuration/subtitles → DomainSubtitlesBean', subs.status === 200 && subs.json &&
    subs.json.subtitles && Array.isArray(subs.json.subtitles.domainList) &&
    Array.isArray(subs.json.subtitles.vttList) &&
    typeof subs.json.subtitles.interfaceSwitch === 'boolean' &&
    typeof subs.json.autoTranslation === 'boolean');
  check('domainList de granjas de players (filemoon/streamtape/…)',
    subs.json.subtitles.domainList.includes('filemoon.sx'));

  /* ── 6. Anti-anuncios ────────────────────────────────────────────── */
  console.log('\n[6] Anti-anuncios (contrato /buscari/api/config/*)');
  const rule = await get('/api/v1/api/config/getAdBlockRule');
  check('getAdBlockRule → AdBlockSubscription + domainList', rule.status === 200 &&
    rule.json && rule.json.subscription && rule.json.subscription.url &&
    Array.isArray(rule.json.domainList) && rule.json.domainList.length >= 100);
  const dom = await get('/api/v1/api/config/v2/getAdBlockDomain');
  check('getAdBlockDomain → {domainList[]}', dom.status === 200 &&
    Array.isArray(dom.json && dom.json.domainList) && dom.json.domainList.length >= 100);

  /* ── 7. Config remota + update + sniffer ─────────────────────────── */
  console.log('\n[7] Config remota, update in-app y script sniffer');
  const qs = await get('/api/v1/config/javs/querySettings');
  check('querySettings → AppRemoveConfigData {detailJsScriptUrl, javasUrl}',
    qs.status === 200 && qs.json && qs.json.detailJsScriptUrl && 'javasUrl' in qs.json);
  const snif = await get('/api/v1/config/sniffer.js');
  check('sniffer.js → JavaScript servido', snif.status === 200 &&
    /javascript/.test(snif.headers && snif.headers['content-type'] || '') &&
    snif.text.includes('resourceAnalysisCallback'));
  const upd = await get('/api/v1/config/appUpdate/check');
  check('appUpdate/check → UpgradeInfo (sin update por defecto)', upd.status === 200 &&
    upd.json && typeof upd.json.status === 'number' && typeof upd.json.show === 'number');
  const rec = await get('/api/v1/api/content/recommend/list');
  check('recommend/list → {title, list[{cover,title}]}', rec.status === 200 &&
    rec.json && rec.json.title && Array.isArray(rec.json.list) &&
    rec.json.list.every(x => x.cover && x.title));

  /* ── 8. Reportes de fuentes (re-priorización) ────────────────────── */
  console.log('\n[8] Reportes de fuentes');
  const rep1 = await post('/api/report/web', { url: 'https://sitio-falso-test.xyz/ver/x', ok: false, reason: 'no-carga' });
  check('POST /api/report/web registra el fallo', rep1.status === 200 && rep1.json.ok && rep1.json.host === 'sitio-falso-test.xyz');
  const rep2 = await post('/api/report/web', { url: 'https://sitio-falso-test.xyz/ver/y', ok: false });
  const rep3 = await get('/api/report/web');
  check('GET /api/report/web → resumen con penalización', rep3.status === 200 &&
    Array.isArray(rep3.json.summary) &&
    rep3.json.summary.some(x => x.host === 'sitio-falso-test.xyz' && x.reports && x.reports.fails >= 2));
  check('penalización en [0,1]', rep3.json.summary.every(x => !x.reports || (x.reports.penalty >= 0 && x.reports.penalty <= 1)));

  /* ── 9. Compatibilidad: rutas clásicas siguen vivas ──────────────── */
  console.log('\n[9] Compatibilidad con AniMax 3.x (rutas clásicas)');
  const legacy = await get('/api/domains');
  check('GET /api/domains sigue respondiendo', legacy.status === 200 && legacy.json.ok);
  const v404 = await get('/api/v1/no-existe');
  check('ruta v1 desconocida → 404 limpio', v404.status === 404 && v404.json && v404.json.ok === false);

  /* ── Resumen ─────────────────────────────────────────────────────── */
  console.log('\n' + '═'.repeat(60));
  console.log(`RESULTADO: ${pass} ✔ · ${fail} ✘`);
  if (fail) {
    console.log('FALLAS:');
    for (const f of failures) console.log('  ✘ ' + f);
    process.exit(1);
  }
  console.log('FASE 1 · capa espejo de la API de Seekee: TODO OK ✦');
}

main().catch(e => { console.error('arnés roto:', e); process.exit(2); });
