#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v7.0 · FASE H1 — BATERÍA DE PRUEBAS
   (Contratos de plataforma: beans espejo Loklok con nombres AniMax)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-H1-v4.js          (auto-arranca el servidor :3202)
         node test-H1-v4.js 3202     (contra un servidor ya arrancado)

   [A] WHITELIST (/api/v1/app/content/website/queryFreshDomainList):
       contrato WhiteListConfig COMPLETO — url https + freshEnable +
       webFreshEnable + desktop (nuevo H1) + _meta de rotación.
   [B] BÚSQUEDA (/api/v1/app/search/search): contrato SearchResultData
       ESPEJO en TODAS las tarjetas (title/url/cover/siteName/resourceId/
       integrationId/episodeList/watchFlag/clearFlag/websiteId/
       websiteLabelList/sourceList/hubUrl) + sourceList bien formada.
   [C] SEMÁNTICA HONESTA: hubUrl vacío hasta H2 (nada finge), watchFlag/
       clearFlag false, desktop booleano en todas las entradas.
   [D] QA ESTÁTICA KOTLIN: HubContracts.kt (balance de llaves/paréntesis +
       las 6 clases de contrato presentes) + SearchApiV4 parsea los 3
       campos nuevos + v4-api.js emite desktop/hubUrl.
   [E] CONTRATOS VIVOS RELACIONADOS intactos: relatedQueries + search/hot.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXTERNAL_PORT = Number(process.argv[2] || 0);
const PORT = EXTERNAL_PORT || 3202;
const BASE = 'http://localhost:' + PORT;
const ROOT = path.join(__dirname, '..', '..');
const KOTLIN = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'animax', 'app');

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

async function getJson(urlPath, opts) {
  const res = await fetch(BASE + urlPath, { ...opts, signal: AbortSignal.timeout(90000) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 200), _status: res.status }; }
}

function postJson(urlPath, body) {
  return getJson(urlPath, {
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

async function main() {
  let child = null;
  if (!EXTERNAL_PORT) {
    console.log('[test] arrancando servidor en :' + PORT + '…');
    child = spawn('node', [path.join(__dirname, 'index.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'ignore'
    });
    await new Promise(r => setTimeout(r, 2500));
  }

  try {
    /* ── [A] WHITELIST — contrato WhiteListConfig completo ──────────── */
    console.log('\n[A] queryFreshDomainList — WhiteListConfig espejo Loklok');
    const wl = await getJson('/api/v1/app/content/website/queryFreshDomainList');
    check('endpoint ok', wl.ok === true);
    const list = Array.isArray(wl.data) ? wl.data : [];
    check('data es lista con sitios (≥10)', list.length >= 10, 'hay ' + list.length);
    check('todas las url son https://', list.every(e => typeof e.url === 'string' && e.url.startsWith('https://')));
    check('freshEnable booleano en todas', list.every(e => typeof e.freshEnable === 'boolean'));
    check('webFreshEnable booleano en todas', list.every(e => typeof e.webFreshEnable === 'boolean'));
    check('desktop booleano en todas (H1)', list.every(e => typeof e.desktop === 'boolean'));
    check('contrato completo en TODAS (url+3 flags)',
      list.every(e => 'url' in e && 'freshEnable' in e && 'webFreshEnable' in e && 'desktop' in e));
    check('_meta con rotación (discoverySource)',
      list.every(e => e._meta && typeof e._meta.discoverySource === 'string'));

    /* ── [B] BÚSQUEDA — contrato SearchResultData espejo ────────────── */
    console.log('\n[B] /app/search/search — SearchResultData espejo');
    const sr = await postJson('/api/v1/app/search/search', { keyWord: 'one piece', page: 1, pageSize: 12 });
    check('búsqueda ok', sr.ok === true);
    const content = Array.isArray(sr.content) ? sr.content : [];
    check('content con resultados', content.length > 0, 'vacío');

    const REQUIRED = ['title', 'url', 'cover', 'description', 'icon', 'siteName', 'type',
      'resourceId', 'integrationId', 'episodeList', 'watchFlag', 'clearFlag',
      'websiteId', 'websiteLabelList', 'sourceList', 'hubUrl'];
    const missing = content.filter(c => REQUIRED.some(k => !(k in c)));
    check('TODAS las tarjetas traen los 16 campos del contrato', missing.length === 0,
      missing.length ? 'faltan en ' + missing.length + ' tarjeta(s)' : '');

    const catalog = content.filter(c => c.type === 'filmCenter');
    check('tarjeta de catálogo presente', catalog.length > 0);
    if (catalog.length) {
      check('catálogo: siteName "AniMax"', catalog[0].siteName === 'AniMax');
      check('catálogo: episodeList es lista', Array.isArray(catalog[0].episodeList));
      check('catálogo: websiteLabelList con idiomas', Array.isArray(catalog[0].websiteLabelList) && catalog[0].websiteLabelList.length > 0);
    }
    const web = content.filter(c => c.type === 'web');
    check('tarjetas web presentes', web.length > 0);
    if (web.length) {
      const withSources = web.filter(c => Array.isArray(c.sourceList) && c.sourceList.length > 0);
      check('web: sourceList con fuentes reales', withSources.length > 0);
      const s = withSources.length ? withSources[0].sourceList[0] : null;
      check('web: fuente bien formada {url,siteName,lang,label,penalty}',
        !!s && 'url' in s && 'siteName' in s && 'lang' in s && 'label' in s && 'penalty' in s);
    }

    /* ── [C] SEMÁNTICA HONESTA (H1 definía el campo vacío; desde H2 el
          portal existe y el server LLENA hubUrl por petición — la
          honestidad ahora exige: hubUrl real ⇔ watchFlag/clearFlag true) */
    console.log('\n[C] Semántica honesta (hubUrl real desde el portal H2)');
    const withHub = content.filter(c => typeof c.hubUrl === 'string' && c.hubUrl.startsWith('http'));
    check('catálogo: hubUrl → ficha propia /hub/detail?t=',
      content.filter(c => c.type === 'filmCenter').every(c => c.hubUrl.includes('/hub/detail?t=')),
      JSON.stringify(content.filter(c => c.type === 'filmCenter').map(c => c.hubUrl)));
    check('web: hubUrl → ficha propia /hub/detail?u=',
      web.filter(c => c.url).every(c => c.hubUrl.includes('/hub/detail?u=')));
    check('hubUrl ⇔ clearFlag/watchFlag (página propia ⇔ clear play)',
      content.every(c => c.hubUrl.startsWith('http')
        ? (c.watchFlag === true && c.clearFlag === true)
        : (c.watchFlag === false && c.clearFlag === false)));
    check('hubUrl construida sobre el host que pide (http/https)',
      withHub.every(c => /^https?:\/\//.test(c.hubUrl)));

    /* ── [D] QA ESTÁTICA KOTLIN ──────────────────────────────────────── */
    console.log('\n[D] QA estática Kotlin — contratos en el dominio');
    const hubFile = path.join(KOTLIN, 'domain', 'model', 'HubContracts.kt');
    check('HubContracts.kt existe', fs.existsSync(hubFile));
    if (fs.existsSync(hubFile)) {
      const src = fs.readFileSync(hubFile, 'utf8');
      const bal = balanceOf(src);
      check('HubContracts.kt balance llaves/paréntesis/corchetes', bal === null, bal || '');
      for (const cls of ['data class WhiteListConfig', 'data class JsResponseData',
        'data class PageBaseInfo', 'data class EpisodeWebData', 'data class SeasonWebData',
        'data class AnalysisResourceData', 'data class VideoPlayerBean', 'object HubBridge']) {
        check('declara: ' + cls, src.includes(cls));
      }
      check('VideoPlayerBean con mediaRequestHeader + updateMediaUrlTime',
        src.includes('mediaRequestHeader') && src.includes('updateMediaUrlTime'));
      check('HubBridge con las 6 acciones quan.*',
        ['switchEpisode', 'switchSeason', 'switchQuality', 'switchSource', 'switchSubtitle', 'pauseVideo']
          .every(a => src.includes(a)));
    }
    const searchFile = path.join(KOTLIN, 'data', 'remote', 'SearchApiV4.kt');
    const ssrc = fs.readFileSync(searchFile, 'utf8');
    check('SearchApiV4 parsea watchFlag/clearFlag/hubUrl',
      ssrc.includes('val watchFlag') && ssrc.includes('val clearFlag') && ssrc.includes('val hubUrl') &&
      ssrc.includes('c.optBoolean("watchFlag"') && ssrc.includes('c.optString("hubUrl"'));
    const balSearch = balanceOf(ssrc);
    check('SearchApiV4.kt balance intacto', balSearch === null, balSearch || '');
    const apiSrc = fs.readFileSync(path.join(__dirname, 'v4-api.js'), 'utf8');
    check('v4-api.js emite desktop + hubUrl',
      apiSrc.includes('desktop: s.desktop === true') && (apiSrc.match(/hubUrl: ''/g) || []).length >= 4);
    /* v7.0 (H1): sintaxis JS real con node --check (los regex-literales
       con comillas despistan a un escáner manual — el compilador no). */
    let jsSyntax = '';
    try { require('child_process').execSync('node --check "' + path.join(__dirname, 'v4-api.js') + '"', { stdio: 'pipe' }); }
    catch (e) { jsSyntax = String(e.message || e); }
    check('v4-api.js sintaxis válida (node --check)', jsSyntax === '', jsSyntax || '');

    /* ── [E] CONTRATOS VIVOS RELACIONADOS intactos ───────────────────── */
    console.log('\n[E] Contratos vivos relacionados');
    const rq = await getJson('/api/v1/search/relatedQueries?keyWord=' + encodeURIComponent('one piece'));
    check('relatedQueries ok (data lista)', rq.ok === true && Array.isArray(rq.data));
    const hot = await getJson('/api/v1/api/home/search/hot');
    check('search/hot ok (ranking con calor)', hot.ok === true && Array.isArray(hot.data));
    if (Array.isArray(hot.data) && hot.data.length) {
      check('hot con heatScore', typeof hot.data[0].heatScore === 'number');
    }
  } catch (e) {
    check('batería sin excepción', false, String(e));
  } finally {
    if (child) child.kill();
  }

  console.log('\n════════════════════════════════════════════════');
  console.log('FASE H1 · ' + passed + ' pasan · ' + failed + ' fallan');
  if (failures.length) console.log('FALLOS:\n - ' + failures.join('\n - '));
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
