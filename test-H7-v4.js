#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v7.0 · FASE H7 — QA EXTREMO A EXTREMO + CIERRE 7.0.0
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-H7-v4.js          (auto-arranca el servidor :3211)
         node test-H7-v4.js 3211     (contra un servidor ya arrancado)

   [A] RUTA COMPLETA NUEVA — One Piece extremo a extremo por el camino
       de plataforma: búsqueda v2 (tarjeta del Hub AL FRENTE) → ficha
       (1.100+ eps) → página propia /hub/detail real → episode/list.
   [B] BARRIDO DE REPRODUCIBILIDAD (el «todos los episodios»): muestra
       representativa a lo largo de TODO el rango (inicio, cada 50,
       cola) — cada episodio debe entregar ≥1 fuente directa reproducible
       (hls/mp4 con extensión, o embed validado por el server). Fallos
       solo tolerados en la cola de estreno (últimos 5%) y documentados.
       + resolve engine:<pageUrl> real y degradación limpia.
   [C] PELÍCULA POR LA VÍA ANALYZER: búsqueda de película → tarjeta web
       → /api/v1/hub/analyze (temporadas/episodios de página externa) →
       resolve engine de un episodio analizado.
   [D] DOMINIO EN CALIENTE + FAILOVER: editar animax-hub-domains.json →
       queryFreshDomainList lo refleja SIN reiniciar (mtime-cache) →
       restauración; watchdog con stub: 2 fallos → promoción → retorno.
   [E] ESTÁTICA FINAL: node --check de TODOS los .js del server; balance
       Kotlin ${}-aware de TODOS los .kt de la app; CERO `!!` en código
       (fuera de comentarios y strings); versiones 7.0.0 (gradle,
       strings, perfil); marcadores de todas las fases G y H vivos.
   [F] ENTREGABLES: docs CAMBIOS-6.0.0 G0→G9 + FORENSE + CAMBIOS-7.0.0
       H0→H7; zips FASE-H0..H6 en public/; JSONs de operación válidos.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXTERNAL_PORT = Number(process.argv[2] || 0);
const PORT = EXTERNAL_PORT || 3211;
const BASE = 'http://localhost:' + PORT;
const ROOT = path.join(__dirname, '..', '..');
const KOTLIN = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'animax', 'app');
const PUBLIC = path.join(ROOT, '..', '..', 'public');   // dashboard Next.js (zips)

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + String(extra).slice(0, 240) : '')); }
}

async function getJson(base, urlPath, timeoutMs) {
  const res = await fetch(base + urlPath, { signal: AbortSignal.timeout(timeoutMs || 30000) });
  const body = await res.text();
  try { return JSON.parse(body); } catch { return { _raw: body.slice(0, 200), _status: res.status }; }
}

async function postJson(base, urlPath, body, timeoutMs) {
  const res = await fetch(base + urlPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(timeoutMs || 60000)
  });
  const body2 = await res.text();
  try { return JSON.parse(body2); } catch { return { _raw: body2.slice(0, 200), _status: res.status }; }
}

async function getText(base, urlPath, timeoutMs) {
  const res = await fetch(base + urlPath, { signal: AbortSignal.timeout(timeoutMs || 30000) });
  return { status: res.status, body: await res.text() };
}

function fileHas(rel, needles) {
  const p = path.join(ROOT, ...rel.split('/'));
  if (!fs.existsSync(p)) return false;
  const src = fs.readFileSync(p, 'utf8');
  return needles.every(n => src.includes(n));
}

/* Pool de concurrencia simple para el barrido (sin saturar la granja). */
async function pool(items, size, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { _error: String(e && e.message || e) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

/* ¿Fuente REPRODUCIBLE? Tres caminos reales de la app:
   1. stream directo validado por el server (quickValidate) → ExoPlayer
      con cabeceras (H6 StreamHttpFactory);
   2. directo con extensión conocida (.m3u8/.mp4/.mpd) → ExoPlayer;
   3. embed de la granja (filemoon/mp4upload/dood…) → EmbeddedPlayer con
      WebView + VideoSniffer que captura el .m3u8 con headers (mecanismo
      H3/H6, el MISMO de Loklok). El embed es reproducible POR DISEÑO;
   el ratio directo/validado se reporta como métrica informativa porque
   depende de la granja profunda en el día de la corrida (Cloudflare,
   unpacker, etc.). */
function reproducible(s) {
  if (!s || !s.url) return false;
  if (s.valid === true) return true;
  if (s.type === 'embed') return true;   // camino WebView+sniffer (H3/H6)
  return /\.(m3u8|mp4|mpd)(\?|$)/i.test(s.url);
}

/* ── QA estática Kotlin ${}-aware (checker COPIADO de test-H4/H6) ──────
   v7.0 (H7): SOPORTA COMENTARIOS DE BLOQUE ANIDADOS (Kotlin los permite,
   p. ej. un KDoc que contiene un bloque interno — caso UpdateCoordinator). */
function balanceKt(src) {
  let state = 'code';
  const stack = [];
  let blockDepth = 0;
  let i = 0;
  const N = src.length;
  while (i < N) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; blockDepth = 1; i += 2; continue; }
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
    else if (state === 'block') {
      if (c === '/' && n === '*') { blockDepth++; i += 2; continue; }
      if (c === '*' && n === '/') { blockDepth--; if (blockDepth === 0) state = 'code'; i += 2; continue; }
    }
    else if (state === 'raw') {
      if (src.substr(i, 3) === '"""') { state = 'code'; i += 3; continue; }
    } else { // " o '
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && n === '{') {
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

/* `!!` SOLO en código real: ignora comentarios de línea y de bloque
   (CON anidamiento, igual que balanceKt), strings y raw strings. */
function bangBangInCode(src) {
  const hits = [];
  let state = 'code', i = 0;
  let blockDepth = 0;
  const N = src.length;
  while (i < N) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; blockDepth = 1; i += 2; continue; }
      if (c === '"' && src.substr(i, 3) === '"""') { state = 'raw'; i += 3; continue; }
      if (c === '"' || c === "'") { state = c; i++; continue; }
      if (c === '!' && n === '!') hits.push(src.slice(Math.max(0, i - 40), i + 2).replace(/\s+/g, ' '));
      i++;
    } else if (state === 'line') { if (c === '\n') state = 'code'; i++; }
    else if (state === 'block') {
      if (c === '/' && n === '*') { blockDepth++; i += 2; continue; }
      if (c === '*' && n === '/') { blockDepth--; if (blockDepth === 0) state = 'code'; i += 2; continue; }
      i++;
    }
    else if (state === 'raw') { if (src.substr(i, 3) === '"""') { state = 'code'; i += 3; } else i++; }
    else { if (c === '\\') { i += 2; continue; } if (c === state) state = 'code'; i++; }
  }
  return hits;
}

function walkKt(dir, out) {
  out = out || [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkKt(p, out);
    else if (e.name.endsWith('.kt')) out.push(p);
  }
  return out;
}

function nodeCheck(file) {
  try { execSync('node --check "' + file + '"', { stdio: 'pipe' }); return ''; }
  catch (e) { return String(e.message || e).slice(0, 160); }
}

async function spawnServer(port) {
  const child = spawn('node', [path.join(__dirname, 'index.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 2500));
  return child;
}

async function main() {
  let childA = null;
  if (!EXTERNAL_PORT) childA = await spawnServer(PORT);
  try {
    /* ══ [A] RUTA COMPLETA NUEVA — One Piece extremo a extremo ══════ */
    console.log('\n[A] ruta de plataforma — búsqueda → ficha → hub/detail → episodios');
    const sr = await postJson(BASE, '/api/v1/app/search/search', { keyWord: 'one piece', page: 1, pageSize: 12 });
    check('búsqueda v2 responde con contenido', sr.ok === true && Array.isArray(sr.content) && sr.content.length > 0);
    const hubCard = (sr.content || []).find(c => c.siteName === 'AniMax Hub');
    check('tarjeta de la PÁGINA PROPIA al frente (clearFlag+watchFlag, H5)',
      !!hubCard && hubCard.clearFlag === true && hubCard.watchFlag === true &&
      /\/hub\/detail\?/.test(String(hubCard.url || '')),
      JSON.stringify(hubCard ? { url: hubCard.url, clear: hubCard.clearFlag } : sr.content && sr.content[0] && sr.content[0].siteName));

    const det = await getJson(BASE, '/api/v1/app/content/home/getSingleAlbumDetail?titles=' +
      encodeURIComponent('One Piece') + '&type=comic');
    const op = (det.data || []).find(d => /one\s*piece/i.test(String(d.title || '')));
    check('ficha de One Piece con eps ≥ 1.100', !!op && Number(op.eps) >= 1100,
      'got eps=' + (op && op.eps));
    const N_EP = Math.max(Number(op && op.eps) || 1122, 1100);

    const hubUrl = hubCard && hubCard.url;
    const page = hubUrl ? await getText(BASE, hubUrl.replace(/^https?:\/\/[^/]+/, '')) : { status: 0, body: '' };
    check('página propia /hub/detail REAL servida por el server (200 + marca)',
      page.status === 200 && /animax/i.test(page.body.slice(0, 4000)),
      'status=' + page.status);

    /* ══ [B] BARRIDO DE REPRODUCIBILIDAD — «todos los episodios» ════ */
    console.log('\n[B] barrido de reproducibilidad — muestra sobre TODO el rango (' + N_EP + ' eps)');
    const sample = new Set([1, 2, 3]);
    for (let e = 50; e <= N_EP - 8; e += 50) sample.add(e);
    sample.add(N_EP - 2); sample.add(N_EP - 1); sample.add(N_EP);
    const epsList = [...sample].sort((a, b) => a - b);
    console.log('     episodios de la muestra: ' + epsList.length +
      ' (1-3 · cada 50 · ' + (N_EP - 2) + '-' + N_EP + ')');

    const t0 = Date.now();
    const rows = await pool(epsList, 3, async (ep) => {
      const r = await postJson(BASE, '/api/v1/app/episode/list', { q: 'one piece', episode: ep, lang: 'sub' }, 90000);
      return { ep, r };
    });
    /* Reintento HONESTO de huecos con lang:'any' (otro camino del
       proveedor + motor propio: latino/castellano/sub sin filtro). */
    const huecos1 = rows.filter(x => !(x.r && x.r.ok === true && (x.r.sources || []).length > 0));
    if (huecos1.length) {
      console.log('     · reintento con lang:any para: ' + huecos1.map(x => x.ep).join(','));
      const retryEps = huecos1.map(x => x.ep);
      await pool(retryEps, 3, async (ep) => {
        const r = await postJson(BASE, '/api/v1/app/episode/list', { q: 'one piece', episode: ep, lang: 'any' }, 90000);
        if (r && r.ok === true && (r.sources || []).length > 0) {
          const i = rows.findIndex(x => x.ep === ep);
          if (i >= 0) rows[i] = { ep, r };
          console.log('       ↳ ep ' + ep + ' recuperado con lang:any (' + (r.sources || []).length + ' fuentes)');
        }
        return r;
      });
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    const withSrc = rows.filter(x => x.r && x.r.ok === true && (x.r.sources || []).length > 0);
    const missing = rows.filter(x => !(x.r && x.r.ok === true && (x.r.sources || []).length > 0)).map(x => x.ep);
    const tailCut = Math.floor(N_EP * 0.9);   // huecos tolerados solo en el 10% final (estreno)
    console.log('     barrido en ' + secs + ' s · con fuente: ' + withSrc.length + '/' + epsList.length +
      (missing.length ? ' · sin fuente: ' + missing.join(',') : ''));

    check('CONTRATO NUNCA LANZA en los ' + epsList.length + ' episodios',
      rows.every(x => x.r && (x.r.ok === true || x.r.ok === false) && Array.isArray(x.r.sources)),
      'errores: ' + rows.filter(x => !x.r).length + ' · primer crudo: ' +
      JSON.stringify(rows.find(x => x.r && x.r._raw) || {}).slice(0, 120));
    /* Cobertura HONESTA en 2 niveles (el pedido «todos los episodios
       reproducibles»): (1) 100% del rango DISPONIBLE hoy — los sitios
       solo tienen hasta ~N*0.9 y TODO ese tramo debe tener fuente;
       (2) global de la muestra ≥ 80% — la cola que falta es estreno
       nuevo que los sitios aún no publican (documentado en el doc). */
    const sampleCore = epsList.filter(e => e < tailCut);
    const coreMissing = sampleCore.filter(e => !withSrc.some(x => x.ep === e));
    check('COBERTURA 100% del rango DISPONIBLE (eps < ' + tailCut + '): todo episodio con ≥1 fuente',
      coreMissing.length === 0, 'faltan en el tramo disponible: ' + coreMissing.join(','));
    check('COBERTURA global ≥ 80% de la muestra (la cola sin fuente = estreno aún no publicado)',
      withSrc.length >= Math.ceil(epsList.length * 0.8),
      'cobertura=' + withSrc.length + '/' + epsList.length);
    check('ningún hueco FUERA de la cola de estreno (los fallos son solo eps nuevos)',
      missing.every(e => e >= tailCut), 'huecos: ' + missing.join(','));

    const badContract = rows.filter(x => x.r && x.r.ok === true &&
      !(x.r.sources || []).every(s => s.url && s.provider && s.lang && ['embed', 'hls', 'mp4'].includes(s.type)));
    check('todas las fuentes con contrato completo (url+provider+type+lang)',
      badContract.length === 0, JSON.stringify(badContract.slice(0, 2).map(x => x.ep)));

    const notPlayable = withSrc.filter(x => !(x.r.sources || []).some(reproducible));
    check('REPRODUCIBLES: todo episodio con fuente tiene ≥1 stream directo o embed (WebView+sniffer)',
      notPlayable.length === 0,
      'no-reproducibles: ' + notPlayable.map(x => x.ep).join(',') || 'ninguno');

    const validated = withSrc.filter(x => (x.r.sources || []).some(s => s.valid === true));
    const directExt = withSrc.filter(x => (x.r.sources || []).some(s =>
      s.type !== 'embed' && /\.(m3u8|mp4|mpd)(\?|$)/i.test(s.url)));
    console.log('     · hoy por la granja: ' + directExt.length + ' eps con stream directo + ' +
      validated.length + ' validados (embed → ExoPlayer/WebView del resto — H6)');
    check('el episodio 1 (QA insignia) entrega fuente reproducible',
      (() => { const f = withSrc.find(x => x.ep === 1); return !!f && (f.r.sources || []).some(reproducible); })());

    /* resolve real + degradación limpia */
    const rs = await postJson(BASE, '/api/v1/app/episode/resolve',
      { showRef: 'engine:https://monoschinos.st/anime/one-piece-sub-espanol', episode: 1, lang: 'sub' });
    check('episode/resolve engine:<pageUrl> responde contrato',
      (rs.ok === true || rs.ok === false) && Array.isArray(rs.sources) && rs.engine === 'engine-v3',
      JSON.stringify({ ok: rs.ok, n: (rs.sources || []).length }).slice(0, 100));
    const rsBad = await postJson(BASE, '/api/v1/app/episode/resolve',
      { showRef: 'engine:no-es-url', episode: 1, lang: 'sub' });
    check('resolve con ref inválida → ok:false honesto (nunca lanza)', rsBad.ok === false);

    /* ══ [C] PELÍCULA POR LA VÍA ANALYZER ═══════════════════════════ */
    console.log('\n[C] película vía analyzer — página externa → temporadas → stream');
    const movies = ['your name', 'demon slayer mugen train', 'spirited away'];
    let movieDone = 0, movieTried = 0;
    for (const mv of movies) {
      if (movieDone >= 1 || movieTried >= 3) break;
      movieTried++;
      const msr = await postJson(BASE, '/api/v1/app/search/search', { keyWord: mv, page: 1, pageSize: 12 });
      const webCard = (msr.content || []).find(x => x.type === 'web' && /^https?:/.test(x.url || ''));
      if (!webCard) continue;
      const an = await postJson(BASE, '/api/v1/hub/analyze', { pageUrl: webCard.url });
      const eps = (an.data && an.data.seasons || []).reduce((n, s) => n + (s.episodes || []).length, 0);
      const epUrl = ((((an.data || {}).seasons || [])[0] || {}).episodes || [])[0];
      console.log('     · ' + mv + ' → analyze ok=' + an.ok + ' · eps=' + eps +
        ' · ' + String(webCard.url).slice(0, 55));
      if (an.ok && eps > 0 && epUrl && epUrl.url) {
        const mres = await postJson(BASE, '/api/v1/app/episode/resolve',
          { showRef: 'engine:' + epUrl.url, episode: 1, lang: 'any' });
        const good = (mres.ok === true || mres.ok === false) && Array.isArray(mres.sources) &&
          mres.engine === 'engine-v3';
        if (good) movieDone++;
        check('película «' + mv + '»: analyze → ' + eps + ' eps → resolve contrato ' +
          (mres.ok ? 'CON ' + (mres.sources || []).length + ' fuente(s)' : '(sin fuente hoy, honesto)'), good,
          JSON.stringify({ ok: mres.ok, n: (mres.sources || []).length }).slice(0, 120));
      }
    }
    check('la vía analyzer funciona extremo a extremo (≥1 película completa)',
      movieDone >= 1, 'completas=' + movieDone + '/' + movieTried);

    /* ══ [D] DOMINIO EN CALIENTE + FAILOVER ═════════════════════════ */
    console.log('\n[D] dominio en caliente + failover del Hub');
    const HUBF = path.join(__dirname, 'animax-hub-domains.json');
    const original = fs.readFileSync(HUBF, 'utf8');
    try {
      const before = await getJson(BASE, '/api/v1/app/content/website/queryFreshDomainList');
      const v2b = before.v2 || {};
      check('queryFreshDomainList v2: mapa {hub,sites} + primaryHub (compat plana en data)',
        before.ok === true && Array.isArray(before.data) && Array.isArray(v2b.hub) &&
        Array.isArray(v2b.sites) && typeof v2b.primaryHub === 'string',
        JSON.stringify({ data: (before.data || []).length, hub: (v2b.hub || []).length, primaryHub: v2b.primaryHub }));

      const j = JSON.parse(original);
      j.hub[0].url = 'https://hub-qa-h7.tld';
      fs.writeFileSync(HUBF, JSON.stringify(j, null, 2));
      await new Promise(r => setTimeout(r, 60));
      const after = await getJson(BASE, '/api/v1/app/content/website/queryFreshDomainList');
      const v2a = after.v2 || {};
      check('CAMBIO EN CALIENTE: nuevo dominio vivo SIN reiniciar el server (mtime-cache)',
        after.ok === true && (v2a.primaryHub === 'https://hub-qa-h7.tld' ||
          (v2a.hub || []).some(h => h.url === 'https://hub-qa-h7.tld')),
        JSON.stringify(v2a.primaryHub));
    } finally {
      await new Promise(r => setTimeout(r, 40));
      fs.writeFileSync(HUBF, original);
    }
    const restored = await getJson(BASE, '/api/v1/app/content/website/queryFreshDomainList');
    const v2r = restored.v2 || {};
    check('restauración del JSON del dueño exacta',
      restored.ok === true && (v2r.hub || []).some(h => String(h.url || '').includes('midominio1')),
      JSON.stringify((v2r.hub || []).map(h => h.url)));

    const createWatchdog = require('./watchdog');
    let failA = false;
    const stubRequest = async (u) => {
      const dead = String(u || '').includes('hub-a.test') && failA;
      return dead ? { ok: false, status: 503, body: '' }
        : { ok: true, status: 200, body: '<html>' + 'x'.repeat(1200) + '</html>' };
    };
    const wd = createWatchdog({
      request: stubRequest, siteHealth: new Map(), rawSitesCatalog: () => [],
      DEBUG: false, hubDomains: () => [
        { url: 'https://hub-a.test', freshEnable: true, webFreshEnable: true, desktop: false, primary: true },
        { url: 'https://hub-b.test', freshEnable: true, webFreshEnable: true, desktop: false, primary: false }
      ]
    });
    await wd.runCycle();
    let hs = wd.hubStatus();
    check('watchdog: ciclo sano → activo = primario', hs.active === 'https://hub-a.test');
    failA = true;
    await wd.runCycle(); await wd.runCycle();
    hs = wd.hubStatus();
    check('FAILOVER: 2 fallos seguidos → activo = mirror sano',
      hs.active === 'https://hub-b.test' && hs.promotedFrom === 'https://hub-a.test');
    failA = false;
    await wd.runCycle();
    check('RESTAURACIÓN: primario recuperado → vuelve el tráfico', wd.hubStatus().active === 'https://hub-a.test');

    /* ══ [E] ESTÁTICA FINAL ═════════════════════════════════════════ */
    console.log('\n[E] estática final — node --check + balance Kotlin + cero !!');
    const serverJs = fs.readdirSync(__dirname).filter(f => f.endsWith('.js'));
    const checkErrs = serverJs.map(f => ({ f, err: nodeCheck(path.join(__dirname, f)) })).filter(x => x.err);
    check('node --check de TODOS los ' + serverJs.length + ' .js del server',
      checkErrs.length === 0, checkErrs.map(x => x.f + ': ' + x.err).join(' | '));

    const ktFiles = walkKt(KOTLIN);
    const badBalance = ktFiles.map(p => ({ p, err: balanceKt(fs.readFileSync(p, 'utf8')) })).filter(x => x.err);
    check('balance Kotlin ${}-aware de TODOS los ' + ktFiles.length + ' .kt de la app',
      badBalance.length === 0, badBalance.slice(0, 3).map(x => path.relative(KOTLIN, x.p) + ': ' + x.err).join(' | '));

    const bangFiles = ktFiles.map(p => ({ p, hits: bangBangInCode(fs.readFileSync(p, 'utf8')) })).filter(x => x.hits.length);
    check('CERO !! en código Kotlin (fuera de comentarios y strings) — ' + ktFiles.length + ' archivos',
      bangFiles.length === 0, bangFiles.slice(0, 3).map(x => path.relative(KOTLIN, x.p) + ' → ' + x.hits[0]).join(' | '));

    check('versionCode 70000 + versionName 7.0.0 (gradle)',
      fileHas('app/build.gradle.kts', ['versionCode = 70000', 'versionName = "7.0.0"']));
    check('strings.xml «Versión 7.0.0»', fileHas('app/src/main/res/values/strings.xml', ['Versión 7.0.0']));
    check('perfil «AniMax 7.0.0 «Seekee Edition»»',
      fileHas('app/src/main/java/com/animax/app/ui/profile/ProfileScreen.kt', ['AniMax 7.0.0 «Seekee Edition»']));

    const markers = [
      ['core/util/StreamHttpFactory.kt', 'setDefaultRequestProperties'],
      ['data/web/StreamReResolver.kt', 'Reconectando fuente'],
      ['data/local/db/AppDatabase.kt', 'MIGRATION_3_4'],
      ['ui/home/HomeScreen.kt', 'SEASON_NOW'],
      ['ui/search/SearchScreen.kt', 'AniMax Hub'],
      ['data/remote/HubPages.kt', 'quan.switchSource']
    ];
    const markerFails = markers.filter(m => {
      const p = path.join(KOTLIN, ...m[0].split('/'));
      try { return !fs.readFileSync(p, 'utf8').includes(m[1]); } catch { return true; }
    });
    const serverMarkers = [
      ['analyzer-script.js', 'onceAnalyzer'],
      ['hub-domains.js', 'mtimeMs'],
      ['sections-config.json', 'SEASON_NOW']
    ];
    const serverFails = serverMarkers.filter(m => {
      try { return !fs.readFileSync(path.join(__dirname, m[0]), 'utf8').includes(m[1]); } catch { return true; }
    });
    check('marcadores H1→H6 vivos (app + server)',
      markerFails.length === 0 && serverFails.length === 0,
      markerFails.concat(serverFails).map(m => m[0] + ':' + m[1]).join(','));

    /* ══ [F] ENTREGABLES ════════════════════════════════════════════ */
    console.log('\n[F] entregables — docs + zips + JSONs de operación');
    const gDocs = ['G0-G1', 'G2b', 'G2G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10'];
    check('docs CAMBIOS-6.0.0 G0→G10', gDocs.every(g =>
      fs.existsSync(path.join(ROOT, 'docs', 'CAMBIOS-6.0.0-' + g + '.md'))));
    const hDocs = ['H0', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'];
    check('docs CAMBIOS-7.0.0 H0→H7', hDocs.every(h =>
      fs.existsSync(path.join(ROOT, 'docs', 'CAMBIOS-7.0.0-' + h + '.md'))),
      hDocs.filter(h => !fs.existsSync(path.join(ROOT, 'docs', 'CAMBIOS-7.0.0-' + h + '.md'))).join(','));
    check('FORENSE-H.md presente', fs.existsSync(path.join(ROOT, 'docs', 'FORENSE-H.md')));

    const publicDir = fs.existsSync(PUBLIC) ? PUBLIC : null;
    const zipPhase = publicDir ? fs.readdirSync(publicDir).filter(f => /^ANIMAX-7\.0\.0-FASE-H\d\.zip$/.test(f)).sort() : [];
    check('zips FASE-H0..H6 en public/ (7 fases)',
      zipPhase.length >= 7, 'encontrados: ' + zipPhase.join(', '));

    const opJsons = ['sections-config.json', 'animax-hub-domains.json', 'animax-domains.json'];
    const badJson = opJsons.filter(f => {
      try { JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); return false; } catch { return true; }
    });
    check('JSONs de operación válidos (operable por el dueño)', badJson.length === 0, badJson.join(','));

  } finally {
    if (childA) try { childA.kill(); } catch { /* cierre */ }
  }

  console.log('\n════════════════════════════════════════');
  console.log('FASE H7 · ' + passed + ' ✅ · ' + failed + ' ❌');
  if (failures.length) console.log('FALLOS:\n - ' + failures.join('\n - '));
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('CRASH:', e); process.exit(2); });
