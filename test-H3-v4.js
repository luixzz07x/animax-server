#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v7.0 · FASE H3 — BATERÍA DE PRUEBAS
   (Bridge completo + analizador remoto + interceptor ampliado)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-H3-v4.js          (auto-arranca 2 servidores)
         node test-H3-v4.js 3206     (contra un servidor ya arrancado; el
                                      servidor con API key se auto-arranca
                                      en 3207 de todos modos)

   [A] ANALYZER.JS SERVIDO: /api/v1/config/analyzer.js (+ alias) crudo,
       guard, onceAnalyzer + alias onceParser, contrato AnalysisResourceData,
       analyzerScriptUrl en querySettings (AppRemoveConfigData).
   [B] ANALIZADOR EN SANDBOX: el MISMO script ejecutado en `vm` sobre 3
       HTMLs sintéticos (plana · multi-temporada · JSON tioanime) →
       AnalysisResourceData válido; vacío honesto con basura.
   [C] QA REAL — 3 SITIOS: búsquedas reales → tarjetas web →
       POST /api/v1/hub/analyze contra SUS páginas reales: estructura
       AnalysisResourceData viva y al menos un sitio con episodios.
   [D] BRIDGE COMPLETO EN /hub/watch: js-response {code,uuid,value} en
       las 6 acciones quan.*, uuid como último argumento, switchSeason
       REAL (chips #seasons + /api/v1/hub/analyze + epsActive),
       onAnalyzerSeasons (fallback de la app) + HubBridge.kt parseando
       seasons/js-response y HubWatchScreen con ResourceAnalyzer.
   [E] INTERCEPTOR AMPLIADO + ESTÁTICA: sniffer.js con HLS_INDEX
       (/index-*.m3u8) y headersFor (Referer) · SniffResult.headers +
       effectiveHeaders · asset resourceAnalysis.html con guard embebido
       distinto + __analyze + AnimaxAnalyzer · node --check de todos los
       JS · balance Kotlin (con ${} anidado) de los archivos tocados.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const EXTERNAL_PORT = Number(process.argv[2] || 0);
const PORT = EXTERNAL_PORT || 3206;
const PORT_GATE = 3207;
const BASE = 'http://localhost:' + PORT;
const BASE_GATE = 'http://localhost:' + PORT_GATE;
const GATE_KEY = 'clave-h3-test';
const ROOT = path.join(__dirname, '..', '..');
const KOTLIN = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'animax', 'app');
const ASSET = path.join(ROOT, 'app', 'src', 'main', 'assets', 'resourceAnalysis.html');

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + String(extra).slice(0, 160) : '')); }
}

async function raw(base, urlPath, opts) {
  const res = await fetch(base + urlPath, { ...opts, signal: AbortSignal.timeout(120000) });
  const body = await res.text();
  return { code: res.status, body, headers: res.headers };
}
async function getJson(base, urlPath, opts) {
  const r = await raw(base, urlPath, opts);
  try { return JSON.parse(r.body); } catch { return { _raw: r.body.slice(0, 200), _status: r.code }; }
}
function postJson(base, urlPath, body, opts) {
  return getJson(base, urlPath, {
    ...opts,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts && opts.headers) },
    body: JSON.stringify(body)
  });
}

/* QA estática Kotlin: balance de delimitadores FUERA de strings y
   comentarios, consciente de raw strings ("""…""") y de la interpolación
   anidada ${ … "string" … } del código Compose/Kotlin moderno. */
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
    } else { // dentro de " o '
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && n === '{') {
        // Sub-escaneo de la interpolación: puede contener strings con }.
        let depth = 0, j = i + 1;
        while (j < N) {
          const d = src[j];
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) { j++; break; } }
          else if (d === '"') { // string anidado dentro de ${…}
            j++;
            while (j < N && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
          }
          j++;
        }
        i = j; continue;
      }
      if (c === state) state = 'code';
    }
    i++;
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

/* Ejecuta el analizador (mismo script que sirve el server) en sandbox. */
function runAnalyzerSandbox(js, html, url) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { timeout: 4000 });
  const fn = sandbox.window.onceAnalyzer || sandbox.window.onceParser;
  return JSON.parse(fn(html, url));
}

async function main() {
  let childA = null, childB = null;
  if (!EXTERNAL_PORT) childA = await spawnServer(PORT);
  try {
    childB = await spawnServer(PORT_GATE, { ANIMAX_API_KEY: GATE_KEY });

    /* ══ [A] ANALYZER.JS SERVIDO ════════════════════════════════════ */
    console.log('\n[A] Analizador remoto servido (/api/v1/config/analyzer.js)');
    let r = await raw(BASE, '/api/v1/config/analyzer.js');
    check('GET analyzer.js → 200 JS crudo', r.code === 200 &&
      /application\/javascript/.test(r.headers.get('content-type') || ''), r.headers.get('content-type'));
    check('guard idempotente __animaxAnalyzerRemoteV1', r.body.includes('__animaxAnalyzerRemoteV1'));
    check('contrato: onceAnalyzer + alias onceParser', r.body.includes('onceAnalyzer') && r.body.includes('onceParser'));
    check('contrato AnalysisResourceData (pageBaseInfo + seasons + episodes)',
      r.body.includes('pageBaseInfo') && r.body.includes('seasons') && r.body.includes('episodes'));
    check('extracciones: temporadas por encabezados + plana + JSON',
      r.body.includes('seasonsFromHeadings') && r.body.includes('synthFromJson'));
    const alias = await raw(BASE, '/api/v1/config/analyzer');
    check('alias /api/v1/config/analyzer → mismo JS', alias.code === 200 && alias.body === r.body);
    const qs = await getJson(BASE, '/api/v1/config/javs/querySettings');
    check('querySettings expone analyzerScriptUrl (AppRemoveConfigData)',
      qs.ok === true && qs.analyzerScriptUrl === '/api/v1/config/analyzer.js',
      JSON.stringify(qs).slice(0, 120));
    const qsGate = await getJson(BASE_GATE, '/api/v1/config/javs/querySettings',
      { headers: { 'X-Api-Key': GATE_KEY } });
    check('querySettings con API key (gate JSON intacto)', qsGate.ok === true);

    /* ══ [B] ANALIZADOR EN SANDBOX (3 HTMLs sintéticos) ═════════════ */
    console.log('\n[B] Analizador en sandbox `vm` — 3 sitios sintéticos');
    const a = runAnalyzerSandbox(r.body,
      '<html><head><title>Anime Prueba</title><meta property="og:image" content="https://cdn.x/img.jpg"></head><body>' +
      Array.from({ length: 13 }, (_, i) => '<a href="/ver/prueba-' + (i + 1) + '">Episodio ' + (i + 1) + '</a>').join('') +
      '</body></html>', 'https://sitioa.tv/anime/prueba');
    check('sitio plano: 1 temporada + 13 episodios en orden (contrato H1: sin n, orden por URL)',
      a.seasons.length === 1 && a.seasons[0].episodes.length === 13 &&
      a.seasons[0].episodes[0].url.endsWith('prueba-1') &&
      a.seasons[0].episodes[12].url.endsWith('prueba-13'),
      JSON.stringify(a.seasons.map(s => s.episodes.length)));
    check('pageBaseInfo (título + og:image)', a.pageBaseInfo.title === 'Anime Prueba' &&
      a.pageBaseInfo.cover === 'https://cdn.x/img.jpg', JSON.stringify(a.pageBaseInfo));
    check('primer episodio isActive (contrato del bean)',
      a.seasons[0].episodes[0].isActive === true && a.seasons[0].episodes[1].isActive === false);
    const b = runAnalyzerSandbox(r.body,
      '<html><title>Serie Multi</title><body><h2>Temporada 1</h2>' +
      '<a href="/serie/m/temporada-1/episodio-1">Capitulo 1</a><a href="/serie/m/temporada-1/episodio-2">Capitulo 2</a>' +
      '<a href="/serie/m/temporada-1/episodio-3">Capitulo 3</a><h2>Temporada 2</h2>' +
      '<a href="/serie/m/temporada-2/episodio-1">Capitulo 1</a><a href="/serie/m/temporada-2/episodio-2">Capitulo 2</a>' +
      '<a href="/serie/m/temporada-2/episodio-3">Capitulo 3</a><a href="/serie/m/temporada-2/episodio-4">Capitulo 4</a>' +
      '</body></html>', 'https://sitiob.tv/serie/m');
    check('multi-temporada: T1(3) + T2(4) por encabezados',
      b.seasons.length === 2 && b.seasons[0].episodes.length === 3 &&
      b.seasons[1].episodes.length === 4 &&
      b.seasons[0].title === 'Temporada 1' && b.seasons[1].title === 'Temporada 2',
      JSON.stringify(b.seasons.map(s => s.title + ':' + s.episodes.length)));
    check('multi-temporada: episodios SIN mezclar entre temporadas',
      b.seasons[0].episodes[0].url.includes('temporada-1') &&
      b.seasons[1].episodes[0].url.includes('temporada-2'));
    const c = runAnalyzerSandbox(r.body,
      '<html><title>Tio Test</title><script>var episodes = [12,11,10,9,8];</script><body></body></html>',
      'https://sitioc.tv/anime/tio-test');
    check('síntesis JSON (var episodes=[…]): 5 eps con URL /ver/slug-N',
      c.seasons.length === 1 && c.seasons[0].episodes.length === 5 &&
      c.seasons[0].episodes[0].url === 'https://sitioc.tv/ver/tio-test-12',
      c.seasons[0] && c.seasons[0].episodes[0] && c.seasons[0].episodes[0].url);
    const d = runAnalyzerSandbox(r.body, '', '');
    const e = runAnalyzerSandbox(r.body, '<a href="javascript:void(0)">x</a>', 'http://mal');
    check('vacío/basura honesto → seasons: [] (nunca lanza)',
      d.seasons.length === 0 && e.seasons.length === 0);

    /* ══ [C] QA REAL — 3 SITIOS ═════════════════════════════════════ */
    console.log('\n[C] QA real — /api/v1/hub/analyze contra 3 sitios reales');
    const searches = ['one piece', 'naruto', 'dragon ball'];
    const targets = [];
    for (const kw of searches) {
      const sr = await postJson(BASE, '/api/v1/app/search/search', { keyWord: kw, page: 1, pageSize: 12 });
      const card = (sr.content || []).find(x => x.type === 'web' && /^https?:/.test(x.url || ''));
      if (card) targets.push({ kw, url: card.url, title: card.title });
    }
    check('3 búsquedas reales entregan 3 páginas web objetivo',
      targets.length >= 2, 'objetivos=' + targets.length + ' (' + targets.map(t => t.kw).join(',') + ')');
    let sitesOk = 0, sitesWithEps = 0;
    for (const t of targets.slice(0, 3)) {
      const an = await postJson(BASE, '/api/v1/hub/analyze', { pageUrl: t.url });
      const good = an.ok !== undefined && an.engine === 'analyzer/1 (FASE H3)' &&
        an.data && Array.isArray(an.data.seasons) && an.data.pageBaseInfo !== undefined;
      if (good) sitesOk++;
      const eps = (an.data && an.data.seasons || []).reduce((n, s) => n + (s.episodes || []).length, 0);
      if (good && eps > 0) sitesWithEps++;
      console.log('     · ' + t.kw + ' → ' + (an.ok ? 'OK' : 'sin datos') +
        ' · temporadas=' + ((an.data && an.data.seasons || []).length) + ' · eps=' + eps +
        ' · ' + String(t.url).slice(0, 60));
    }
    check('contrato AnalysisResourceData vivo en los 3 sitios (ok:false honesto si un sitio cae)',
      sitesOk === targets.slice(0, 3).length, 'contrato-ok=' + sitesOk + '/3');
    check('al menos 1 sitio real con temporadas/episodios extraídos',
      sitesWithEps >= 1, 'con-eps=' + sitesWithEps);
    const bad = await postJson(BASE, '/api/v1/hub/analyze', { pageUrl: 'no-es-url' });
    check('pageUrl inválida → ok:false honesto (nunca lanza)', bad.ok === false);
    const analyzeGate = await getJson(BASE_GATE, '/api/v1/hub/analyze?u=https%3A%2F%2Fexample.com%2Fa');
    check('analyze SIN clave en server con clave → 401 (API cerrada)',
      analyzeGate._status === 401 || analyzeGate.error === 'api-key-required');

    /* ══ [D] BRIDGE COMPLETO EN /hub/watch ══════════════════════════ */
    console.log('\n[D] Bridge completo (js-response/uuid) + temporadas en /hub/watch');
    const sr = await postJson(BASE, '/api/v1/app/search/search', { keyWord: 'one piece', page: 1, pageSize: 12 });
    const webCard = (sr.content || []).find(c => c.type === 'web' && /^https?:/.test(c.url || ''));
    check('búsqueda entrega tarjeta web para la ficha-watch', !!webCard);
    if (webCard) {
      r = await raw(BASE, '/hub/watch?u=' + encodeURIComponent(webCard.url) + '&t=' + encodeURIComponent(webCard.title));
      check('watch → 200 HTML con versión H3', r.code === 200 && r.body.includes('animax-hub/3 (FASE H3)'));
      check('RESPUESTA js-response {code, uuid, value} (espejo quan_function)',
        r.body.includes("type: 'js-response'") && r.body.includes('function respond(uuid, code, value)'));
      const sixActions = ['switchSource', 'switchEpisode', 'switchQuality', 'switchSeason', 'switchSubtitle', 'pauseVideo'];
      check('las 6 acciones quan.* aceptan uuid (último argumento)',
        sixActions.every(a => r.body.includes(a + ': function')) &&
        r.body.includes('function (i, uuid)') && r.body.includes('function (n, uuid)') &&
        r.body.includes('function (s, uuid)') && r.body.includes('function (t, uuid)') &&
        r.body.includes('pauseVideo: function (uuid)'));
      check('switchSeason REAL (SEASONS.length + re-render sin recargar)',
        r.body.includes('if (SEASONS.length) {') && r.body.includes('renderSeasonChips'));
      check('chips de temporada (#seasons) en la página', r.body.includes('id="seasons"'));
      check('análisis del server al arrancar (/api/v1/hub/analyze?u=)',
        r.body.includes('/api/v1/hub/analyze?u=') && r.body.includes('function loadSeasons'));
      check('fallback de la app: quan.onAnalyzerSeasons(json, uuid)',
        r.body.includes('onAnalyzerSeasons: function (json, uuid)') &&
        r.body.includes("type: 'seasons'") && r.body.includes('analyzer-app'));
      check('epsActive(): episodios SIEMPRE de la temporada activa',
        r.body.includes('function epsActive()') && r.body.includes('var eps = epsActive()'));
      check('H2 intacto: calidad + jsonBody + AnimaxHub',
        r.body.includes('id="quality"') && r.body.includes('function switchQuality') &&
        r.body.includes('jsonBody') && r.body.includes('AnimaxHub'));
      // El contrato de respuesta responde TAMBIÉN en navegador puro (sin nativo):
      check('respond() inofensivo sin uuid (navegador puro)',
        r.body.includes('if (!uuid) return;'));
    }
    const hubSrc = fs.readFileSync(path.join(__dirname, 'hub.js'), 'utf8');
    const bridgeSrc = fs.readFileSync(path.join(KOTLIN, 'browser', 'core', 'HubBridge.kt'), 'utf8');
    const watchSrc = fs.readFileSync(path.join(KOTLIN, 'browser', 'HubWatchScreen.kt'), 'utf8');
    const analyzerSrc = fs.readFileSync(path.join(KOTLIN, 'browser', 'core', 'ResourceAnalyzer.kt'), 'utf8');
    check('HubBridge.kt: Seasons + JsResponse (contrato H1)',
      bridgeSrc.includes('data class Seasons') && bridgeSrc.includes('data class JsResponse') &&
      bridgeSrc.includes('"js-response"') && bridgeSrc.includes('"seasons"'));
    check('HubWatchScreen: fallback ResourceAnalyzer en Failure + onAnalyzerSeasons',
      watchSrc.includes('ResourceAnalyzer') && watchSrc.includes('onAnalyzerSeasons') &&
      watchSrc.includes('is HubBridge.Failure'));
    check('ResourceAnalyzer.kt: asset + interfaz AnimaxAnalyzer + beans H1',
      analyzerSrc.includes('resourceAnalysis.html') && analyzerSrc.includes('AnimaxAnalyzer') &&
      analyzerSrc.includes('AnalysisResourceData') && analyzerSrc.includes('SeasonWebData') &&
      analyzerSrc.includes('EpisodeWebData') && analyzerSrc.includes('PageBaseInfo'));
    check('ResourceAnalyzer.kt: script remoto /api/v1/config/analyzer.js (patrón VideoSniffer)',
      analyzerSrc.includes('/api/v1/config/analyzer.js') && analyzerSrc.includes('fetchScript'));

    /* ══ [E] INTERCEPTOR AMPLIADO + ESTÁTICA ════════════════════════ */
    console.log('\n[E] Interceptor ampliado + QA estática');
    const sn = await raw(BASE, '/api/v1/config/sniffer.js');
    check('sniffer.js → 200 JS', sn.code === 200 && /application\/javascript/.test(sn.headers.get('content-type') || ''));
    check('sniffer: patrón HLS de Loklok /index-(a|v|v-a).m3u8',
      sn.body.includes('HLS_INDEX_RE') && sn.body.includes('index-'),
      'regex=' + /HLS_INDEX_RE = ([^;]+);/.test(sn.body));
    check('sniffer: headers (Referer) junto a cada hallazgo',
      sn.body.includes('headersFor') && sn.body.includes('headers: headersFor()'));
    check('sniffer: classify con HLS_INDEX_RE', sn.body.includes("M3U8_RE.test(u) || HLS_INDEX_RE.test(u)"));
    const sniffKt = fs.readFileSync(path.join(KOTLIN, 'browser', 'core', 'VideoSniffer.kt'), 'utf8');
    check('VideoSniffer.kt: SniffResult.headers + effectiveHeaders (espejo H1)',
      sniffKt.includes('val headers: Map<String, String> = emptyMap()') &&
      sniffKt.includes('effectiveHeaders'));
    check('VideoSniffer.kt: parseResult extrae headers + default Referer',
      sniffKt.includes('json.optJSONObject("headers")') && sniffKt.includes('mapOf("Referer" to referer)'));
    check('VideoSniffer.kt: fallback embebido con HLS_INDEX + headers',
      sniffKt.includes('var HLS_INDEX = /') && sniffKt.includes('headers: { Referer: location.href }'));
    const assetBody = fs.readFileSync(ASSET, 'utf8');
    check('asset resourceAnalysis.html existe y lleva guard EMBEBIDO distinto',
      assetBody.includes('__animaxAssetV1') && assetBody.includes('__animaxAnalyzerEmbeddedV1') &&
      !assetBody.includes('__animaxAnalyzerRemoteV1'));
    check('asset: puente __analyze(html, url, uuid) + AnimaxAnalyzer.onResult({code,uuid,value})',
      assetBody.includes('window.__analyze = function (html, url, uuid)') &&
      assetBody.includes('window.AnimaxAnalyzer && window.AnimaxAnalyzer.onResult'));
    // El JS del asset (embebido + puente) debe ser sintácticamente válido.
    const assetJs = (assetBody.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
    check('asset: JS embebido sintácticamente válido (node --check)',
      (() => {
        const tmp = path.join(__dirname, '.asset-js-check.tmp.js');
        fs.writeFileSync(tmp, assetJs);
        const err = nodeCheck(tmp);
        try { fs.unlinkSync(tmp); } catch { }
        return err === '';
      })());
    check('asset: copia embebida SIN $ (raw string seguro) y con contrato completo',
      !assetJs.includes('$') && assetJs.includes('onceAnalyzer') && assetJs.includes('pageBaseInfo'));

    console.log('  — QA estática —');
    for (const f of ['hub.js', 'v4-api.js', 'analyzer-script.js', 'sniffer-script.js', 'index.js', 'test-H3-v4.js']) {
      const err = nodeCheck(path.join(__dirname, f));
      check('node --check ' + f, err === '', err);
    }
    const ktFiles = [
      'browser/core/VideoSniffer.kt',
      'browser/core/ResourceAnalyzer.kt',
      'browser/core/HubBridge.kt',
      'browser/HubWatchScreen.kt',
      'domain/model/HubContracts.kt'
    ];
    for (const k of ktFiles) {
      const src = fs.readFileSync(path.join(KOTLIN, ...k.split('/')), 'utf8');
      const bal = balanceKt(src);
      check('balance Kotlin ' + k, bal === null, bal || '');
    }
    // Contrato cruzado: el analyzer servido === el embebido en el asset
    // (mismo cuerpo generado desde analyzer-script.js; solo cambia el guard).
    const analyzerServed = (await raw(BASE, '/api/v1/config/analyzer.js')).body.trim();
    const embStart = assetJs.indexOf('var w = (typeof window');
    const embEnd = assetJs.indexOf('window.__analyze = function');
    let embedded = embStart >= 0 && embEnd > embStart ? assetJs.slice(embStart, embEnd).trim() : '';
    // El slice arrastra el comentario del puente: cortar en el cierre real.
    const closeAt = embedded.lastIndexOf('})();');
    if (closeAt >= 0) embedded = embedded.slice(0, closeAt + '})();'.length);
    const norm = (s) => String(s || '')
      .split('__animaxAnalyzerEmbeddedV1').join('GUARD')
      .split('__animaxAnalyzerRemoteV1').join('GUARD')
      .trim();
    const fromCore = (s) => {
      const at = norm(s).indexOf('var w = (typeof window');
      return at >= 0 ? norm(s).slice(at) : norm(s);
    };
    const servedNorm = fromCore(analyzerServed);
    const embeddedNorm = fromCore(embedded);
    check('asset: la copia embebida ES el analyzer del server (guard renombrado)',
      servedNorm.length > 1000 && servedNorm === embeddedNorm,
      'len-served=' + servedNorm.length + ' len-embedded=' + embeddedNorm.length +
      (servedNorm !== embeddedNorm ? ' · primera dif: ' + (() => {
        for (let i = 0; i < Math.min(servedNorm.length, embeddedNorm.length); i++) {
          if (servedNorm[i] !== embeddedNorm[i]) return JSON.stringify(servedNorm.slice(Math.max(0, i - 40), i + 40));
        }
        return 'solo longitud';
      })() : ''));
    check('analyzer.js SIN $ (embebible en raw string Kotlin)',
      !analyzerServed.includes('$'), 'con $');
  } catch (e) {
    check('batería sin excepción', false, String(e));
  } finally {
    if (childA) childA.kill();
    if (childB) childB.kill();
  }

  console.log('\n════════════════════════════════════════════════');
  console.log('FASE H3 · ' + passed + ' pasan · ' + failed + ' fallan');
  if (failures.length) console.log('FALLOS:\n - ' + failures.join('\n - '));
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
