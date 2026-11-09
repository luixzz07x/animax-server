#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v7.0 · FASE H5 — BATERÍA DE PRUEBAS
   (Home de plataforma + búsqueda que «siempre encuentra»)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-H5-v4.js          (auto-arranca el servidor :3209)
         node test-H5-v4.js 3209     (contra un servidor ya arrancado)

   [A] EN VIVO (server :3209): secciones nuevas del home con `_meta` y
       `localFeed` (CONTINUE/MY_LIST 100% offline · SEASON_NOW /
       TRENDING_NOW / GENRE_ROW / RANK_LIST con red), navigationBar y
       config/sections reflejando las nuevas (con POST operable por el
       dueño + restauración exacta), tarjeta del HUB AL FRENTE en la
       búsqueda (`clearFlag:true` + `siteName:"AniMax Hub"` +
       /hub/detail?t= que ABRE de verdad), `hub=0` para desactivarla y
       sourceList intacto y ordenado latino→castellano→sub.
   [B] UNIT de normalización reforzada y ranking (v4Route._h5, offline):
       artículos, años, (Sub)/(Lat)/(Dub), acentos, puntuación; ranking
       exacto > empieza > contiene > nada; desempate por idioma
       latino→castellano→sub; contrato completo de la tarjeta Hub y
       honestidad de hubFrontCard (sin host / hub=0 → sin tarjeta).
   [C] QA DURA · 30 TÍTULOS DIFÍCILES (los de PLAN-FASES-3.0.0 + nuevos
       de película): cada uno debe normalizar a su forma canónica Y el
       endpoint responder ok sin lanzar aunque la red falle.
   [D] ESTÁTICA: node --check de cada JS tocado + balance Kotlin ${}-
       aware de cada .kt tocado + verificación por grep de los puntos
       clave (secciones nuevas, tarjeta Hub, localFeed, badge Hub) y
       PROHIBICIÓN de `!!` en el Kotlin tocado.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* El require('./watchdog') de ESTE proceso usa su PROPIO fichero de
   estado (no pisa el del server). Debe fijarse ANTES de los requires. */
const TEST_STATE_FILE = path.join(os.tmpdir(), 'animax-test-h5-state.json');
try { fs.unlinkSync(TEST_STATE_FILE); } catch { /* sin estado previo */ }
process.env.ANIMAX_DOMAINS_FILE = TEST_STATE_FILE;

const EXTERNAL_PORT = Number(process.argv[2] || 0);
const PORT = EXTERNAL_PORT || 3209;
const BASE = 'http://localhost:' + PORT;
const ROOT = path.join(__dirname, '..', '..');
const KOTLIN = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'animax', 'app');
const SECTIONS_FILE = path.join(__dirname, 'sections-config.json');

let passed = 0, failed = 0, skipped = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
}
function skip(name, why) {
  skipped++; console.log('  ⏭️  ' + name + ' (omitido: ' + why + ')');
}

async function raw(base, urlPath, opts) {
  const res = await fetch(base + urlPath, { ...opts, signal: AbortSignal.timeout(90000) });
  const body = await res.text();
  return { code: res.status, body, headers: res.headers };
}
async function getJson(base, urlPath, opts) {
  const r = await raw(base, urlPath, opts);
  try { return JSON.parse(r.body); } catch { return { _raw: r.body.slice(0, 200), _status: r.code }; }
}
async function postJson(base, urlPath, body, opts) {
  const r = await raw(base, urlPath, {
    ...opts, method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts && opts.headers) },
    body: JSON.stringify(body)
  });
  try { return JSON.parse(r.body); } catch { return { _raw: r.body.slice(0, 200), _status: r.code }; }
}

/* QA estática Kotlin ${}-aware (idéntica a test-H4). */
function balanceKt(src) {
  let state = 'code';
  const stack = [];
  let i = 0;
  const N = src.length;
  while (i < N) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === '"' && src.substr(i, 3) === '"""') { state = 'raw'; i += 3; continue; }
      if (c === '"' || c === "'") { state = c; i++; continue; }
      if (c === '{' || c === '(' || c === '[') stack.push(c);
      else if (c === '}' || c === ')' || c === ']') {
        const open = stack.pop();
        if ((c === '}' && open !== '{') || (c === ')' && open !== '(') || (c === ']' && open !== '[')) {
          return 'desbalance: ' + c + ' sin ' + open;
        }
      }
    } else if (state === 'line') { if (c === '\n') state = 'code'; }
    else if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i += 2; continue; } }
    else if (state === 'raw') {
      if (src.substr(i, 3) === '"""') { state = 'code'; i += 3; continue; }
    } else { // " o '
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && n === '{') {
        // Sub-escaneo de la interpolación: puede contener strings con }.
        let depth = 0, j = i + 1;
        while (j < N) {
          const d = src[j];
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) { j++; break; } }
          else if (d === '"') {
            j++;
            while (j < N && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
          }
          j++;
        }
        if (depth !== 0) return 'interpolación sin cerrar';
        i = j; continue;
      }
      if (c === state) state = 'code';
    }
    i++;
  }
  return stack.length ? 'sin cerrar: ' + stack.join('') : null;
}

function nodeCheck(file) {
  try { execSync('node --check "' + file + '"', { stdio: 'pipe' }); return ''; }
  catch (e) { return String(e.message || e); }
}

async function spawnServer(port, extraEnv) {
  const child = spawn('node', [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env, PORT: String(port),
      /* estado del watchdog del server SEPARADO del de las pruebas unitarias */
      ANIMAX_DOMAINS_FILE: path.join(os.tmpdir(), 'animax-test-h5-server-state.json'),
      ...(extraEnv || {})
    },
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 2500));
  return child;
}

/** ¿Hay internet real para AniList? (las pruebas con fuente externa se
    omiten honestamente si el entorno está aislado; las ≥8 de [A] y las
    de [B]/[D] funcionan 100% offline). */
async function probeNetwork() {
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: '{ Media(id: 1) { id } }' }),
      signal: AbortSignal.timeout(8000)
    });
    return res.ok;
  } catch { return false; }
}

/* Los 30 títulos difíciles (PLAN-FASES-3.0.0 + películas nuevas) con su
   forma canónica esperada tras la normalización reforzada. */
const TITULOS_DIFICILES = [
  ['One Piece', 'one piece'],
  ['One Piece (Latino)', 'one piece'],
  ['One Piece (Sub)', 'one piece'],
  ['One Piece Film: Red (Sub)', 'one piece film red'],
  ['Naruto Shippuuden (Lat)', 'naruto shippuuden'],
  ['Dragon Ball (2024)', 'dragon ball'],
  ['Dragon Ball Super: Broly (Latino)', 'dragon ball super broly'],
  ['Jujutsu Kaisen', 'jujutsu kaisen'],
  ['jujutsu kaisenn', 'jujutsu kaisenn'],                      // typo leve: normaliza igual, nunca lanza
  ['one peice', 'one peice'],                                  // typo leve (ordenado, sin error)
  ['Rent-a-Girlfriend', 'rent a girlfriend'],
  ['Kanojo, Okarishimasu', 'kanojo okarishimasu'],
  ['Black Clover (Dub)', 'black clover'],
  ['Bleach: Thousand-Year Blood War', 'bleach thousand year blood war'],
  ['Your Name (2016)', 'your name'],
  ['Kimi no Na wa (2016) (Lat)', 'kimi no na wa'],
  ['Spirited Away (2001)', 'spirited away'],
  ['El viaje de Chihiro', 'viaje de chihiro'],                 // artículo inicial fuera
  ['The Eminence in Shadow', 'eminence in shadow'],
  ['Attack on Titan (Sub)', 'attack on titan'],
  ['Shingeki no Kyojin (Latino)', 'shingeki no kyojin'],
  ['Demon Slayer: Kimetsu no Yaiba', 'demon slayer kimetsu no yaiba'],
  ['Kimetsu no Yaiba (2024) (Sub)', 'kimetsu no yaiba'],
  ['Pokémon (Lat)', 'pokemon'],
  ['Boku no Hero Academia', 'boku no hero academia'],
  ['My Hero Academia (Sub)', 'my hero academia'],
  ['Sword Art Online (2019)', 'sword art online'],
  ['Re:Zero kara Hajimeru Isekai Seikatsu', 're zero kara hajimeru isekai seikatsu'],
  ["JoJo's Bizarre Adventure (Lat)", 'jojo s bizarre adventure'],
  ['Detective Conan (2023) (Latino)', 'detective conan']
];

/* Campos del contrato SearchResultData (H1) que TODA tarjeta debe llevar. */
const REQUIRED = ['title', 'url', 'cover', 'description', 'icon', 'siteName', 'type',
  'resourceId', 'integrationId', 'episodeList', 'watchFlag', 'clearFlag',
  'websiteId', 'websiteLabelList', 'sourceList', 'hubUrl'];

const LANG_PRIO = { latino: 0, castellano: 1, sub: 2 };

async function main() {
  let childA = null;
  if (!EXTERNAL_PORT) childA = await spawnServer(PORT);
  const NET = await probeNetwork();
  console.log('Red externa (AniList): ' + (NET ? 'DISPONIBLE' : 'NO disponible (pruebas de fuente externa se omiten honestamente)'));
  try {
    /* ══ [A] HOME DE PLATAFORMA + BÚSQUEDA CON HUB AL FRENTE ═══════ */
    console.log('\n[A] en vivo :' + PORT + ' — secciones nuevas + búsqueda v2');

    const nav = await getJson(BASE, '/api/v1/app/content/home/navigationBar');
    check('navigationBar ok con 4 pestañas', nav.ok === true && Array.isArray(nav.data) && nav.data.length === 4);

    const cfg = await getJson(BASE, '/api/v1/config/sections');
    check('config/sections ok', cfg.ok === true && !!cfg.data && !!cfg.data.tabs);
    const comic = (cfg.data && cfg.data.tabs && cfg.data.tabs.comic) || [];
    const stylesComic = comic.map(s => s.style);
    check('config/sections refleja SEASON_NOW + TRENDING_NOW + GENRE_ROW',
      stylesComic.includes('SEASON_NOW') && stylesComic.includes('TRENDING_NOW') && stylesComic.includes('GENRE_ROW'),
      stylesComic.join(','));
    check('config/sections refleja MY_LIST + localFeed:true (y CONTINUE)',
      comic.some(s => s.style === 'MY_LIST' && s.localFeed === true) &&
      comic.some(s => s.style === 'CONTINUE' && s.localFeed === true));
    check('config/sections: GENRE_ROW paramétrica con género (Action)',
      comic.some(s => s.style === 'GENRE_ROW' && s.genre === 'Action'));
    check('config/sections: estilos nuevos declarados en _meta',
      Array.isArray(cfg._meta && cfg._meta.estilos) &&
      cfg._meta.estilos.includes('SEASON_NOW') && cfg._meta.estilos.includes('MY_LIST'));
    check('REGRESIÓN: estilos clásicos siguen en config (BANNER/RANK_LIST/MULTIPLE_ALBUM)',
      stylesComic.includes('BANNER') && stylesComic.includes('RANK_LIST') && stylesComic.includes('MULTIPLE_ALBUM'));

    /* El dueño opera el home SIN reiniciar: POST → GET refleja (y restauración exacta). */
    const original = fs.readFileSync(SECTIONS_FILE);
    try {
      const po = await postJson(BASE, '/api/v1/config/sections', { tabs: { comic: [
        { id: 1, name: 'Continuar viendo', style: 'CONTINUE' },
        { id: 2, name: 'Estrenos de temporada', style: 'SEASON_NOW' },
        { id: 3, name: 'Por género: Terror', style: 'GENRE_ROW', genre: 'Horror' },
        { id: 4, name: 'Mi lista', style: 'MY_LIST' },
        { id: 5, name: 'Top 10', style: 'RANK_LIST', sort: 'rating' }
      ] } });
      check('POST /config/sections acepta estilos nuevos H5 (operable por el dueño)', po.ok === true, JSON.stringify(po));
      const cfg2 = await getJson(BASE, '/api/v1/config/sections');
      const c2 = (cfg2.data && cfg2.data.tabs && cfg2.data.tabs.comic) || [];
      check('mtime-cache: el home del dueño cambia SIN reiniciar (GET refleja el POST)',
        c2.some(s => s.style === 'GENRE_ROW' && s.genre === 'Horror') &&
        c2.some(s => s.style === 'SEASON_NOW') && c2.length === 5,
        JSON.stringify(c2.map(s => s.style)));
    } finally {
      fs.writeFileSync(SECTIONS_FILE, original);   // restauración EXACTA byte a byte
    }
    const cfg3 = await getJson(BASE, '/api/v1/config/sections');
    check('restauración exacta del JSON del dueño (mtime-cache la recarga)',
      ((cfg3.data && cfg3.data.tabs && cfg3.data.tabs.comic) || []).some(s => s.style === 'SEASON_NOW') &&
      ((cfg3.data && cfg3.data.tabs && cfg3.data.tabs.comic) || []).length === 10);

    const home = await getJson(BASE, '/api/v1/app/content/home/getSectionContentByPage?labelCode=comic&page=1&pageSize=12');
    check('getSectionContentByPage ok (nunca lanza)', home.ok === true && Array.isArray(home.content));
    const secs = home.content || [];
    check('feeds LOCALES declarados por el server: CONTINUE + MY_LIST con localFeed:true',
      secs.some(s => s.sectionStyle === 'CONTINUE' && s.localFeed === true) &&
      secs.some(s => s.sectionStyle === 'MY_LIST' && s.localFeed === true),
      secs.map(s => s.sectionStyle).join(','));
    check('_meta del home: config + temporada + feedsLocales',
      !!home._meta && home._meta.config === 'sections-config.json' &&
      typeof home._meta.temporada === 'string' && home._meta.feedsLocales.includes('MY_LIST'));
    check('honesto: toda sección de fuente externa tiene items o se omite (sin filas vacías)',
      secs.every(s => s.localFeed === true || (s.singleAlbumList || []).length + (s.multipleAlbumList || []).length > 0));
    check('toda tarjeta lleva _meta.source (anilist|tmdb|jikan|local)',
      secs.every(s => [...(s.singleAlbumList || []), ...(s.multipleAlbumList || [])]
        .every(a => a._meta && ['anilist', 'tmdb', 'jikan', 'local'].includes(a._meta.source))));
    check('secciones con _meta de fuente', secs.every(s => s._meta && typeof s._meta.source === 'string'));

    if (NET) {
      const sn = secs.find(s => s.sectionStyle === 'SEASON_NOW');
      check('SEASON_NOW «Estrenos de temporada» presente con items AniList',
        !!sn && sn.singleAlbumList.length > 0 && sn._meta.source === 'anilist',
        sn ? 'items=' + sn.singleAlbumList.length : 'AUSENTE');
      const tr = secs.find(s => s.sectionStyle === 'TRENDING_NOW');
      check('TRENDING_NOW «Tendencias ahora» presente (AniList + catálogo fusionados)',
        !!tr && tr.singleAlbumList.length > 0);
      const gr = secs.find(s => s.sectionStyle === 'GENRE_ROW');
      check('GENRE_ROW «Por género» presente y paramétrica (Acción)',
        !!gr && gr.singleAlbumList.length > 0 && gr._meta.genre === 'Action');
      const rk = secs.find(s => s.sectionStyle === 'RANK_LIST');
      check('REGRESIÓN G8: RANK_LIST sigue con rankList + viewCount',
        !!rk && rk.rankList.length > 0 && rk.rankList.every(r => r.rank > 0 && r.album && typeof r.viewCount === 'number'));
    } else {
      skip('SEASON_NOW/TRENDING_NOW/GENRE_ROW/RANK_LIST con red', 'sin red externa');
    }

    /* Búsqueda v2: tarjeta del HUB al frente + hub=0 + sourceList. */
    const sr = await getJson(BASE, '/api/v1/app/search/search?keyWord=' + encodeURIComponent('one piece') + '&page=1&pageSize=12');
    check('búsqueda ok (responde aunque la red falle)', sr.ok === true && Array.isArray(sr.content));
    const content = sr.content || [];
    check('TODAS las tarjetas traen los 16 campos del contrato (incluida la del Hub)',
      content.length > 0 && content.every(c => REQUIRED.every(k => k in c)),
      content.length ? 'ok' : 'vacío');
    const hub0 = content[0];
    if (NET) {
      check('TARJETA DEL HUB AL FRENTE (posición 0)',
        hub0 && hub0.siteName === 'AniMax Hub' && hub0.type === 'hub',
        hub0 ? hub0.siteName + '/' + hub0.type : 'sin tarjetas');
      check('tarjeta Hub con clearFlag:true + watchFlag:true (clear play propio)',
        hub0 && hub0.clearFlag === true && hub0.watchFlag === true);
      check('tarjeta Hub → /hub/detail?t= (formato real de hub.js para catálogo)',
        hub0 && hub0.url.includes('/hub/detail?t=') && hub0.hubUrl === hub0.url);
      check('tarjeta Hub hereda el mejor idioma (latino primero, luego sub)',
        hub0 && Array.isArray(hub0.websiteLabelList) && hub0.websiteLabelList.length >= 2 &&
        hub0.websiteLabelList[0].labelCode === 'latino' &&
        hub0.websiteLabelList[1].labelCode === 'sub',
        JSON.stringify(hub0 && hub0.websiteLabelList));
      const ficha = await raw(BASE, '/hub/detail?t=' + encodeURIComponent('One Piece'));
      check('la URL de la tarjeta Hub ABRE de verdad (ficha 200 HTML)', ficha.code === 200 &&
        /text\/html/.test(ficha.headers.get('content-type') || ''));
      check('coexiste: filmCenter + web siguen presentes tras la tarjeta Hub',
        content.some(c => c.type === 'filmCenter') && content.some(c => c.type === 'web'));
      const webConFuentes = content.filter(c => c.type === 'web' && (c.sourceList || []).length >= 2);
      check('REGRESIÓN G2G3: sourceList intacto y ordenado latino→castellano→sub',
        webConFuentes.length > 0 && webConFuentes.every(c => {
          let last = -1;
          return c.sourceList.every(s => {
            const p = LANG_PRIO[s.lang] === undefined ? 3 : LANG_PRIO[s.lang];
            const okOrder = p >= last; last = p; return okOrder;
          });
        }),
        'con-fuentes=' + webConFuentes.length);
      check('_engine sigue reportando el motor', !!sr._engine && typeof sr._engine.cards === 'number');
    } else {
      skip('tarjeta Hub al frente + apertura de ficha + sourceList ordenado', 'sin red externa');
    }

    const srOff = await getJson(BASE, '/api/v1/app/search/search?keyWord=' + encodeURIComponent('one piece') + '&page=1&pageSize=12&hub=0');
    check('parámetro honesto hub=0: SIN tarjeta "AniMax Hub" en los resultados',
      srOff.ok === true && (srOff.content || []).every(c => c.siteName !== 'AniMax Hub'));
    check('hub=0 no filtra nada más (mismo resto de tarjetas)',
      (srOff.content || []).length === (NET ? content.length - 1 : content.length),
      (srOff.content || []).length + ' vs ' + content.length);
    check('hub=0 no filtra nada más (mismo resto de tarjetas) — sin fuga de _hubCard',
      srOff._hubCard === undefined && sr._hubCard === undefined);

    /* ══ [B] UNIT: NORMALIZACIÓN REFORZADA + RANKING ═══════════════ */
    console.log('\n[B] unit — normalizeTitleV2 / titleRankV2 / tarjeta Hub');
    const createV4Api = require('./v4-api');
    const stubCtx = {
      json() {}, readBody: async () => ({}), cacheGet: () => null, cacheSet: () => {}, TTL: {},
      allSitesConfig: () => [], siteHealth: new Map(), siteIsUsable: () => true, hostOf: u => String(u),
      hotTab: async () => [], buildOptions: async () => ({ options: [] }), metaSearch: async () => [],
      metaMatch: () => null, anilistQuery: async () => null, buildAdblockList: async () => '',
      buildAdblockHideList: async () => '', VERSION: 'test', request: async () => ({ ok: false }),
      absolutize: (b, u) => u, stripTags: s => s, RE: { EP_NUM: /(cap[ií]tulo|episodio|\bep?\d+)\s*\d+/gi },
      normalizeTitle: t => String(t || '').toLowerCase(), titleRank: () => 2, heatFor: () => 0, watchdog: null
    };
    const h5 = createV4Api(stubCtx)._h5;
    const N = t => h5.normalizeTitleV2(t);

    check('artículos: «The One Piece» ≡ «one piece» (en) y «El Detective Conan» ≡ «detective conan» (es)',
      N('The One Piece') === 'one piece' && N('El Detective Conan') === 'detective conan',
      N('The One Piece') + ' | ' + N('El Detective Conan'));
    check('años fuera: «Spirited Away (2001)» ≡ «spirited away»', N('Spirited Away (2001)') === 'spirited away');
    check('sufijos de idioma: (Sub)/(Lat)/(Dub)/(Castellano) fuera',
      N('One Piece (Sub)') === 'one piece' && N('One Piece (Lat)') === 'one piece' &&
      N('Black Clover (Dub)') === 'black clover' && N('Naruto (Castellano)') === 'naruto');
    check('acentos y mayúsculas: «Pokémon» ≡ «pokemon»', N('Pokémon') === 'pokemon' && N('SHINGEKI NO KYOJIN') === 'shingeki no kyojin');
    check('puntuación suelta: «Re:Zero…» ≡ «re zero…» y «Rent-a-Girlfriend» ≡ «rent a girlfriend»',
      N('Re:Zero kara Hajimeru Isekai Seikatsu') === 're zero kara hajimeru isekai seikatsu' &&
      N('Rent-a-Girlfriend') === 'rent a girlfriend');
    check('rank EXACTO=0 · EMPIEZA=1 · CONTIENE=2 · NADA=3',
      h5.titleRankV2(N('One Piece'), N('one piece')) === 0 &&
      h5.titleRankV2(N('One Piece Stampede'), N('one piece')) === 1 &&
      h5.titleRankV2(N('Todo sobre One Piece'), N('one piece')) === 2 &&
      h5.titleRankV2(N('Naruto'), N('one piece')) === 3);
    check('rank: query corto dentro del título también ES empieza-por (1)',
      h5.titleRankV2(N('One Piece'), N('one piece film')) === 1);
    check('desempate por IDIOMA: latino(0) < castellano(1) < sub(2)',
      h5.LANG_PRIORITY.latino < h5.LANG_PRIORITY.castellano &&
      h5.LANG_PRIORITY.castellano < h5.LANG_PRIORITY.sub);
    check('tarjeta Hub: 16 campos del contrato + siteName/clearFlag/watchFlag',
      (() => { const c = h5.buildHubCard({ title: 'One Piece', image: 'http://x/y.jpg', synopsis: 's', score: 8.7, year: 1999 }, 'one piece');
        return REQUIRED.every(k => k in c) && c.siteName === 'AniMax Hub' && c.type === 'hub' &&
          c.clearFlag === true && c.watchFlag === true && c.url === '' && c.hubUrl === ''; })());
    check('tarjeta Hub: idiomas ordenados latino→sub (mejor conocido primero)',
      (() => { const c = h5.buildHubCard({ title: 'X' }, 'x');
        return c.websiteLabelList[0].labelCode === 'latino' && c.websiteLabelList[1].labelCode === 'sub'; })());
    check('hubFrontCard: pone la tarjeta AL FRENTE con la URL del host que pide',
      (() => { const data = { content: [{ title: 'Otra' }], _hubCard: h5.buildHubCard({ title: 'One Piece' }, 'one piece') };
        const out = h5.hubFrontCard(data, { headers: { host: 'localhost:' + PORT } }, true);
        return out.content.length === 2 && out.content[0].siteName === 'AniMax Hub' &&
          out.content[0].url === 'http://localhost:' + PORT + '/hub/detail?t=' + encodeURIComponent('One Piece') &&
          out._hubCard === undefined; })());
    check('hubFrontCard honesto: hub=0 → sin tarjeta y SIN mutar el caché',
      (() => { const data = { content: [{ title: 'Otra' }], _hubCard: h5.buildHubCard({ title: 'X' }, 'x') };
        const out = h5.hubFrontCard(data, { headers: { host: 'localhost:' + PORT } }, false);
        return out.content.length === 1 && out._hubCard === undefined &&
          !!data._hubCard && data.content.length === 1; })());
    check('hubFrontCard honesto: sin host → sin tarjeta (no inventa URLs)',
      (() => { const data = { content: [{ title: 'Otra' }], _hubCard: h5.buildHubCard({ title: 'X' }, 'x') };
        const out = h5.hubFrontCard(data, { headers: {} }, true);
        return out.content.length === 1; })());

    /* ══ [C] QA DURA · 30 TÍTULOS DIFÍCILES ════════════════════════ */
    console.log('\n[C] QA dura — 30 títulos difíciles (normalización + búsqueda sin lanzar)');
    let idx = 0;
    for (const [titulo, esperado] of TITULOS_DIFICILES) {
      idx++;
      const n = N(titulo);
      const okNorm = n === esperado;
      let okSearch = false, detalle = '';
      try {
        const r = await getJson(BASE, '/api/v1/app/search/search?keyWord=' + encodeURIComponent(titulo) + '&page=1&pageSize=6');
        const c = r.content || [];
        okSearch = r.ok === true && Array.isArray(c) &&
          c.every(x => REQUIRED.every(k => k in x)) &&
          (c.length === 0 || c[0].siteName !== 'AniMax Hub' || (c[0].clearFlag === true && c[0].hubUrl.startsWith('http')));
        detalle = r.ok === true ? c.length + ' tarjetas' : String(r._raw || r.error || 'sin ok');
      } catch (e) { detalle = String(e).slice(0, 120); }
      check(String(idx).padStart(2, '0') + ' «' + titulo + '» normaliza y busca sin lanzar',
        okNorm && okSearch, (okNorm ? '' : 'norm="' + n + '" ≠ "' + esperado + '" · ') + detalle);
    }

    /* ══ [D] ESTÁTICA + APP ════════════════════════════════════════ */
    console.log('\n[D] estática: node --check + balance Kotlin + grep de puntos clave');
    for (const f of ['v4-api.js', 'index.js', 'test-H5-v4.js']) {
      const err = nodeCheck(path.join(__dirname, f));
      check('node --check ' + f, err === '', err);
    }
    check('sections-config.json del dueño es JSON válido', (() => {
      try { const j = JSON.parse(fs.readFileSync(SECTIONS_FILE, 'utf8')); return !!j.tabs && j.tabs.comic.length === 10; }
      catch (e) { return false; }
    })());

    const ktFiles = ['ui/home/HomeScreen.kt', 'ui/search/SearchScreen.kt'];
    for (const k of ktFiles) {
      const src = fs.readFileSync(path.join(KOTLIN, ...k.split('/')), 'utf8');
      const bal = balanceKt(src);
      check('balance Kotlin ' + k, bal === null, bal || '');
    }
    check('Kotlin sin `!!` (prohibición del plan) en los archivos tocados',
      ktFiles.every(k => !/!\!/.test(fs.readFileSync(path.join(KOTLIN, ...k.split('/')), 'utf8'))));

    const v4 = fs.readFileSync(path.join(__dirname, 'v4-api.js'), 'utf8');
    check('server: secciones nuevas en v4-api.js (SEASON_NOW/TRENDING_NOW/GENRE_ROW/MY_LIST + localFeed)',
      v4.includes("'SEASON_NOW'") && v4.includes("'TRENDING_NOW'") && v4.includes("'GENRE_ROW'") &&
      v4.includes("'MY_LIST'") && v4.includes('LOCAL_FEED_STYLES'));
    check('server: AniList SeasonNow con caché 45 min y Jikan opcional sin keys',
      v4.includes('alSeasonNow') && v4.includes('SEASON_TTL') && v4.includes('enrichWithJikan') &&
      !/ANIMAX_.*KEY\s*=\s*['"]/.test(v4));
    check('server: tarjeta Hub en la búsqueda (buildHubCard + hubFrontCard + hub=0)',
      v4.includes('buildHubCard') && v4.includes('hubFrontCard') && v4.includes("siteName: 'AniMax Hub'") &&
      v4.includes("String(f.hub === undefined ? '1' : f.hub) !== '0'"));
    check('server: normalización reforzada + ranking (normalizeTitleV2/titleRankV2)',
      v4.includes('function normalizeTitleV2') && v4.includes('function titleRankV2'));

    const scfg = fs.readFileSync(SECTIONS_FILE, 'utf8');
    check('server: sections-config.json con las 4 secciones nuevas y género paramétrico',
      scfg.includes('SEASON_NOW') && scfg.includes('TRENDING_NOW') &&
      scfg.includes('GENRE_ROW') && scfg.includes('"genre": "Action"') && scfg.includes('MY_LIST'));

    const homeKt = fs.readFileSync(path.join(KOTLIN, 'ui/home/HomeScreen.kt'), 'utf8');
    check('app: Home renderiza las secciones nuevas (SEASON_NOW/TRENDING_NOW/GENRE_ROW)',
      homeKt.includes('"SEASON_NOW", "TRENDING_NOW", "GENRE_ROW"'));
    check('app: MY_LIST lee el store local (ServiceLocator.favorites, localFeed)',
      homeKt.includes('MyListRow') && homeKt.includes('ServiceLocator.favorites') &&
      homeKt.includes('FavoriteEntity'));
    check('app: estilo desconocido se IGNORA sin crashear (honesto)',
      homeKt.includes('ignorado a propósito'));

    const srchKt = fs.readFileSync(path.join(KOTLIN, 'ui/search/SearchScreen.kt'), 'utf8');
    check('app: badge Hub en la búsqueda (clearFlag + siteName "AniMax Hub")',
      srchKt.includes('AniMax Hub') && srchKt.includes('"HUB"') && srchKt.includes('hubCard()'));
    check('app: sección «Página propia · AniMax Hub» al frente de resultados',
      srchKt.includes('Página propia · AniMax Hub'));
    check('app: apertura por el flujo HubPages existente (onOpenHub, sin reinventar)',
      srchKt.includes('onOpenHub(item)') && srchKt.includes('HubResultCard'));
  } catch (e) {
    check('batería sin excepción', false, String(e));
  } finally {
    if (childA) childA.kill();
    try { fs.rmSync(path.join(os.tmpdir(), 'animax-test-h5-server-state.json'), { force: true }); } catch { /* tmp */ }
    try { fs.unlinkSync(TEST_STATE_FILE); } catch { /* tmp */ }
  }

  console.log('\n════════════════════════════════════════════════');
  console.log('FASE H5 · ' + passed + ' pasan · ' + failed + ' fallan' +
    (skipped ? ' · ' + skipped + ' omitidas (sin red externa)' : ''));
  if (failures.length) console.log('FALLOS:\n - ' + failures.join('\n - '));
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
