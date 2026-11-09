#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v7.0 · FASE H2 — BATERÍA DE PRUEBAS
   (HUB 2.0: portal de catálogo propio — el «tiktik.pro» de AniMax)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-H2-v4.js          (auto-arranca 2 servidores)
         node test-H2-v4.js 3204     (contra un servidor ya arrancado; el
                                      servidor con API key se auto-arranca
                                      en 3205 de todos modos)

   [A] PORTAL /hub: estrenos de temporada, tendencias, teatros (Anime ·
       Películas · Series · Doramas), top-10 y géneros — datos del
       MISMO filmCenter que la app (ctx.hubPortal) + badge FASE H2.
   [B] FICHA DE CATÁLOGO /hub/detail?filmId|t: banner, sinopsis, géneros,
       score, similares, «Buscar dónde ver» + honesta si no resuelve.
   [C] FICHA EXTERNA /hub/detail?u: episodios resueltos en el server,
       fuentes por idioma, «Ver ahora» → /hub/watch (nunca lanza).
   [D] WATCH v2 + TEATRO: selector de CALIDAD (chips #quality), contrato
       quan COMPLETO (6 acciones), grid de episodios; /hub/theater con
       orden + género + paginación del filmCenter.
   [E] GATE HONESTO (server :3205 con ANIMAX_API_KEY): sin clave →
       portada «dentro de AniMax» (HTML 200, jamás 401 JSON); con ?key=
       o X-Api-Key → contenido; /api/ping sin clave → 401 (API intacta).
   [F] HUBURL EN BÚSQUEDA + QA ESTÁTICA: fillHubUrls llena /hub/detail
       (catálogo ?t= · web ?u=) y activa watchFlag/clearFlag solo cuando
       hay página propia; node --check real de los 4 JS; balance Kotlin
       de los archivos tocados (NavGraph/SearchApiV4/HubContracts).
   ═════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXTERNAL_PORT = Number(process.argv[2] || 0);
const PORT = EXTERNAL_PORT || 3204;
const PORT_GATE = 3205;
const BASE = 'http://localhost:' + PORT;
const BASE_GATE = 'http://localhost:' + PORT_GATE;
const GATE_KEY = 'clave-h2-test';
const ROOT = path.join(__dirname, '..', '..');
const KOTLIN = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'animax', 'app');

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + String(extra).slice(0, 160) : '')); }
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
function postJson(base, urlPath, body) {
  return getJson(base, urlPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/* QA estática Kotlin: balance de delimitadores fuera de strings/comentarios. */
function balanceOf(src) {
  let state = 'code';
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i++; continue; }
      if (c === '/' && n === '*') { state = 'block'; i++; continue; }
      if (c === '"' || c === "'") { state = c; continue; }
      if (c === '{' || c === '(' || c === '[') stack.push(c);
      else if (c === '}' || c === ')' || c === ']') {
        const open = stack.pop();
        if ((c === '}' && open !== '{') || (c === ')' && open !== '(') || (c === ']' && open !== '[')) return 'desbalance: ' + c + ' sin ' + open;
      }
    } else if (state === 'line') { if (c === '\n') state = 'code'; }
    else if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i++; } }
    else { // string
      if (c === '\\') i++;
      else if (c === state) state = 'code';
    }
  }
  return stack.length === 0 ? null : 'sin cerrar: ' + stack.join('');
}

function nodeCheck(file) {
  try { require('child_process').execSync('node --check "' + file + '"', { stdio: 'pipe' }); return ''; }
  catch (e) { return String(e.message || e); }
}

async function spawnServer(port, extraEnv) {
  const child = spawn('node', [path.join(__dirname, 'index.js')], {
    env: { ...process.env, PORT: String(port), ...(extraEnv || {}) },
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 2500));
  return child;
}

async function main() {
  let childA = null, childB = null;
  if (!EXTERNAL_PORT) childA = await spawnServer(PORT);
  try {
    childB = await spawnServer(PORT_GATE, { ANIMAX_API_KEY: GATE_KEY });

    /* ══ [A] PORTAL /hub ════════════════════════════════════════════ */
    console.log('\n[A] Portal propio (/hub) — el «tiktik.pro» de AniMax');
    let r = await raw(BASE, '/hub');
    check('GET /hub → 200 HTML', r.code === 200 && /text\/html/.test(r.headers.get('content-type') || ''));
    check('marca AniMax Hub + badge FASE H2',
      r.body.includes('AniMax Hub') && r.body.includes('FASE H2'), 'badge=' + r.body.includes('FASE H2'));
    check('buscador propio (form → /hub)', r.body.includes('action="/hub"'));
    check('teatros: Anime · Películas · Series · Doramas',
      r.body.includes('stream=comic') && r.body.includes('stream=movie') &&
      r.body.includes('stream=drama') && r.body.includes('stream=short'));
    const sections = ['Estrenos de temporada', 'Tendencias', 'Top 10', 'Géneros populares'];
    check('secciones del portal (estrenos/tendencias/top10/géneros)',
      sections.every(s => r.body.includes(s)), sections.filter(s => !r.body.includes(s)).join(','));
    check('tarjetas del catálogo → fichas propias (/hub/detail?filmId=)',
      (r.body.match(/\/hub\/detail\?filmId=/g) || []).length >= 5,
      'links=' + (r.body.match(/\/hub\/detail\?filmId=/g) || []).length);
    check('géneros → teatro con filtro (/hub/theater?stream=comic&genre=)',
      r.body.includes('/hub/theater?stream=comic&genre='));
    check('hero de estreno destacado (banner o póster)', r.body.includes('Estreno destacado'));
    // v7.0 (H3): el hub evolucionó a /3 (FASE H3) — bridge completo + analyzer.
    check('HUB_VERSION vigente en la página', /animax-hub\/3 \(FASE H3\)/.test(r.body));

    /* ══ [B] FICHA DE CATÁLOGO /hub/detail ══════════════════════════ */
    console.log('\n[B] Ficha de catálogo (/hub/detail?t= | filmId=)');
    r = await raw(BASE, '/hub/detail?t=' + encodeURIComponent('one piece'));
    check('ficha catálogo → 200 HTML', r.code === 200 && /text\/html/.test(r.headers.get('content-type') || ''));
    check('sinopsis + botón «Buscar dónde ver»',
      r.body.includes('syn') && r.body.includes('Buscar d\u00f3nde ver'));
    check('similares del mismo género → /hub/detail?filmId=',
      r.body.includes('Similares') && r.body.includes('/hub/detail?filmId='));
    r = await raw(BASE, '/hub/detail?t=' + encodeURIComponent('zzqqxy-no-existe-9182'));
    check('obra inexistente → página HONESTA (no 404 pelado, con buscador)',
      r.code === 200 && r.body.includes('No encontramos') && r.body.includes('action="/hub"'));

    /* ══ [C] FICHA EXTERNA /hub/detail?u ════════════════════════════ */
    console.log('\n[C] Ficha externa (/hub/detail?u=) — episodios en el server');
    const sr = await postJson(BASE, '/api/v1/app/search/search', { keyWord: 'one piece', page: 1, pageSize: 12 });
    const webCard = (sr.content || []).find(c => c.type === 'web' && c.url && /^https?:/.test(c.url));
    check('búsqueda entrega tarjeta web con URL', !!webCard);
    if (webCard) {
      r = await raw(BASE, '/hub/detail?u=' + encodeURIComponent(webCard.url) +
        '&t=' + encodeURIComponent(webCard.title) + '&src=' + encodeURIComponent((webCard.hubUrl || '').split('src=')[1] || ''));
      check('ficha externa → 200 HTML', r.code === 200);
      check('«Ver ahora en AniMax» → /hub/watch (nunca la página externa)',
        r.body.includes('Ver ahora en AniMax') && r.body.includes('/hub/watch?u='));
      check('host real expuesto con badge «fuente externa»',
        r.body.includes('fuente externa') && r.body.includes('Página propia'));
      // Honestidad: resuelve o dice POR QUÉ no (jamás página vacía)
      check('episodios resueltos O mensaje honesto (nunca vacío)',
        r.body.includes('episodios') || r.body.includes('err') || r.body.includes('intentar reproducir'));
    }

    /* ══ [D] WATCH v2 + TEATRO ══════════════════════════════════════ */
    console.log('\n[D] /hub/watch v2 (selector de calidad + quan completo) y /hub/theater');
    if (webCard) {
      r = await raw(BASE, '/hub/watch?u=' + encodeURIComponent(webCard.url) + '&t=' + encodeURIComponent(webCard.title));
      check('watch → 200 HTML', r.code === 200);
      check('selector de CALIDAD presente (#quality + renderQuality + switchQuality)',
        r.body.includes('id="quality"') && r.body.includes('function renderQuality') && r.body.includes('function switchQuality'));
      check('CONTRATO quan COMPLETO (6 acciones H1)',
        ['switchEpisode', 'switchSeason', 'switchQuality', 'switchSource', 'switchSubtitle', 'pauseVideo']
          .every(a => r.body.includes(a)));
      check('puente AnimaxHub + contrato jsonBody', r.body.includes('AnimaxHub') && r.body.includes('jsonBody'));
      check('grid de episodios (bloques de 50)', r.body.includes('id="eps"') && r.body.includes('id="blocks"'));
    }
    r = await raw(BASE, '/hub/theater?stream=movie');
    check('teatro películas → 200 HTML', r.code === 200);
    check('grid con fichas propias + orden (Tendencia)',
      r.body.includes('/hub/detail?filmId=') && r.body.includes('Tendencia'));
    check('chips de género (Acción) + paginación',
      r.body.includes('genre=') && r.body.includes('Acci\u00f3n') &&
      (r.body.includes('Siguiente') || r.body.includes('pager')));
    r = await raw(BASE, '/hub/theater?stream=movie&order=popularity&genre=Action&page=2');
    check('teatro con filtros combinados (orden+género+página) → 200', r.code === 200);

    /* ══ [E] GATE HONESTO (server con ANIMAX_API_KEY) ═══════════════ */
    console.log('\n[E] Gate honesto «solo AniMax» (:3205 con ANIMAX_API_KEY)');
    r = await raw(BASE_GATE, '/hub');
    check('sin clave → 200 HTML HONESTO (no 401 JSON)',
      r.code === 200 && /text\/html/.test(r.headers.get('content-type') || '') &&
      r.body.includes('dentro de AniMax'));
    check('la portada honesta explica c\u00f3mo entrar (Ajustes → Servidor)',
      r.body.includes('Ajustes') && r.body.includes('X-Api-Key'));
    r = await raw(BASE_GATE, '/hub?key=' + encodeURIComponent(GATE_KEY));
    check('con ?key= → portal completo (200, FASE H2)',
      r.code === 200 && r.body.includes('FASE H2') && !r.body.includes('dentro de AniMax'));
    r = await raw(BASE_GATE, '/hub', { headers: { 'X-Api-Key': GATE_KEY } });
    check('con header X-Api-Key → portal completo', r.code === 200 && r.body.includes('AniMax Hub'));
    r = await raw(BASE_GATE, '/hub/watch?u=https%3A%2F%2Fexample.com%2Fver%2Ftest');
    check('watch sin clave → portada honesta (no contenido, no 401)',
      r.code === 200 && r.body.includes('dentro de AniMax'));
    r = await raw(BASE_GATE, '/hub/detail?t=test');
    check('detail sin clave → portada honesta', r.code === 200 && r.body.includes('dentro de AniMax'));
    const ping = await getJson(BASE_GATE, '/api/ping');
    check('API JSON sin clave → 401 (gate global intacto)',
      ping._status === 401 || ping.error === 'api-key-required');
    const ping2 = await getJson(BASE_GATE, '/api/ping', { headers: { 'X-Api-Key': GATE_KEY } });
    check('API JSON con clave → ok (ping)', ping2.ok === true);
    const ver = await getJson(BASE_GATE, '/hub/version');
    // v7.0 (H3): versión vigente /3 (bridge completo + analyzer).
    check('/hub/version abierta (JSON de versión, sin contenido)', ver.ok === true && /FASE H3/.test(ver.hub || ''));
    r = await raw(BASE_GATE, '/hub?key=' + encodeURIComponent('clave-INCORRECTA'));
    check('clave incorrecta → portada honesta (no bypass)', r.code === 200 && r.body.includes('dentro de AniMax'));

    /* ══ [F] HUBURL EN BÚSQUEDA + QA ESTÁTICA ═══════════════════════ */
    console.log('\n[F] hubUrl en búsqueda + QA estática');
    const sr2 = await postJson(BASE, '/api/v1/app/search/search', { keyWord: 'naruto', page: 1, pageSize: 12 });
    const content2 = Array.isArray(sr2.content) ? sr2.content : [];
    check('búsqueda con resultados para hubUrl', content2.length > 0);
    const catCards = content2.filter(c => c.type === 'filmCenter');
    check('fillHubUrls: catálogo → /hub/detail?t=',
      catCards.length > 0 && catCards.every(c => c.hubUrl.includes('/hub/detail?t=')));
    const webCards2 = content2.filter(c => c.type === 'web' && c.url);
    check('fillHubUrls: web → /hub/detail?u= (con fuentes en src=)',
      webCards2.length > 0 && webCards2.every(c => c.hubUrl.includes('/hub/detail?u=')));
    check('hubUrl construida sobre el host que pide (localhost:' + PORT + ')',
      content2.filter(c => c.hubUrl).every(c => c.hubUrl.includes('localhost:' + PORT)));
    check('watchFlag/clearFlag true SOLO con página propia',
      content2.every(c => c.hubUrl.startsWith('http')
        ? (c.watchFlag === true && c.clearFlag === true)
        : (!c.watchFlag && !c.clearFlag)));
    // La ficha del hubUrl de la tarjeta web DEBE abrir de verdad (200)
    if (webCards2.length) {
      const hub = new URL(webCards2[0].hubUrl);
      r = await raw(BASE, hub.pathname + hub.search);
      check('el hubUrl de la tarjeta ABRE de verdad (ficha 200)', r.code === 200);
    }

    console.log('  — QA estática —');
    const jsDir = __dirname;
    for (const f of ['hub.js', 'v4-api.js', 'index.js', 'test-H2-v4.js']) {
      const err = nodeCheck(path.join(jsDir, f));
      check('node --check ' + f, err === '', err);
    }
    for (const k of ['ui/navigation/NavGraph.kt', 'data/remote/SearchApiV4.kt', 'domain/model/HubContracts.kt']) {
      const src = fs.readFileSync(path.join(KOTLIN, ...k.split('/')), 'utf8');
      const bal = balanceOf(src);
      check('balance Kotlin ' + k, bal === null, bal || '');
    }
    const hubSrc = fs.readFileSync(path.join(jsDir, 'hub.js'), 'utf8');
    check('hub.js: rutas nuevas (detail/theater) + gate + portal',
      hubSrc.includes("path === '/hub/detail'") && hubSrc.includes("path === '/hub/theater'") &&
      hubSrc.includes('gateAllowed') && hubSrc.includes('renderPortal'));
    const apiSrc = fs.readFileSync(path.join(jsDir, 'v4-api.js'), 'utf8');
    check('v4-api.js: ctx.hubPortal + fillHubUrls',
      apiSrc.includes('ctx.hubPortal') && apiSrc.includes('fillHubUrls'));
    const navSrc = fs.readFileSync(path.join(KOTLIN, 'ui', 'navigation', 'NavGraph.kt'), 'utf8');
    check('NavGraph prefiere item.hubUrl (hasHubPage) con fallback',
      navSrc.includes('item.hasHubPage') && navSrc.includes('item.hubUrl'));
  } catch (e) {
    check('batería sin excepción', false, String(e));
  } finally {
    if (childA) childA.kill();
    if (childB) childB.kill();
  }

  console.log('\n════════════════════════════════════════════════');
  console.log('FASE H2 · ' + passed + ' pasan · ' + failed + ' fallan');
  if (failures.length) console.log('FALLOS:\n - ' + failures.join('\n - '));
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
