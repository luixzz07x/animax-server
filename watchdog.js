'use strict';
/* ═══════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · FASE 2 — WATCHDOG DE DOMINIOS + ROTACIÓN REAL
   ═══════════════════════════════════════════════════════════════════
   El corazón de la "actualización real" de Seekee: los sitios de anime
   cambian de dominio constantemente (los .to/.st/.ch caen, renacen en
   otro TLD). Con dominios duros en la app, eso se arregla con un APK
   nuevo cada vez. Aquí NO: el servidor VIGILA y ROTA:

     1. SALUD   · cada ciclo sondea la plantilla de búsqueda de cada
                  sitio (HTTP/TLS, reto Cloudflare, página aparcada).
     2. DESCUBRE· si un dominio falla 2 ciclos seguidos, busca el nuevo:
                  historial propio + Bing + DuckDuckGo + semillas de TLD
                  (monoschinos.st → monoschinos.com/.net/.io/…), con
                  coincidencia difusa del nombre para no aceptar basura.
     3. ROTA    · el primer candidato sano pasa a ser el dominio
                  vigente. Todas las apps instaladas lo reciben por
                  queryFreshDomainList / navigationList en ≤6 h SIN
                  tocar el APK (WhiteListConfig{url,freshEnable,
                  webFreshEnable} del contrato de Seekee).

   Persistencia best-effort en animax-domains.json (disco efímero en
   Render: se pierde al reiniciar, la señal se regenera sola).
   ═══════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const STATE_FILE = process.env.ANIMAX_DOMAINS_FILE
  ? path.resolve(process.env.ANIMAX_DOMAINS_FILE)
  : path.join(__dirname, 'animax-domains.json');

/* Semillas de TLD: los sitios de este mundillo renacen cambiando el
   sufijo. Se prueban DESPUÉS del historial y de los buscadores. */
const TLD_SEEDS = [
  '.com', '.net', '.org', '.info', '.io', '.tv', '.to', '.st', '.sx',
  '.mx', '.ch', '.in', '.pro', '.vip', '.lol', '.icu', '.xyz', '.app',
  '.life', '.fun', '.site', '.online', '.shop', '.mov', '.id', '.wiki'
];

/* Hosts que NUNCA son candidatos aunque Bing los mezcle en los
   resultados (buscadores, redes, tiendas de dominios…). */
const BLOCKLIST = new Set([
  'bing.com', 'msn.com', 'microsoft.com', 'google.com', 'duckduckgo.com',
  'youtube.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'x.com',
  'twitter.com', 'wikipedia.org', 'reddit.com', 'pinterest.com',
  'amazon.com', 'play.google.com', 'apps.apple.com', 'github.com',
  'spotify.com', 'twitch.tv', 'soundcloud.com', 'medium.com', 'quora.com',
  'yahoo.com', 'yandex.com', 'baidu.com', 'europa.eu', 'gob.mx'
]);

/* Marcas de dominio aparcado / en venta: "sano" a nivel TCP pero inútil. */
const PARKING_RE = /domain (?:is |for )?(?:for sale|sale|parked)|buy (?:this|the) domain|sedoparking|parkingcrew|hugedomains|afternic|dan\.com\/domain|godaddy\.com\/domains|is for sale/i;

/* Reto anti-bot de Cloudflare (mismo criterio que probeSite de index.js). */
const CHALLENGE_RE = /cf-chl|challenge-platform|Just a moment\.\.\.|<title>Success!/i;

function hostOf(u) {
  try { return new URL(u).host.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

/** Etiqueta registrable del host: monoschinos.st → "monoschinos". */
function siteName(host) {
  return String(host || '').replace(/^www\./, '').split('.')[0] || String(host);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}

/** ¿El host candidato parece ser ESTE sitio? (coincidencia difusa segura) */
function matchesSite(name, candHost) {
  const cand = siteName(candHost);
  if (!name || !cand) return false;
  if (cand === name) return true;
  // nombres largos: vale contener ("gogoanimehd" ~ "gogoanimehd2")
  if (name.length >= 6 && (cand.includes(name) || name.includes(cand))) return true;
  // erratas de renombre: monoschinos ~ monoschlnos
  const tol = Math.max(1, Math.floor(name.length * 0.25));
  return levenshtein(name, cand) <= tol;
}

module.exports = function createWatchdog(ctx) {
  const { request, siteHealth, rawSitesCatalog, onRotate, DEBUG } = ctx;

  const log = (...a) => console.error('[watchdog]', ...a);
  const dlog = (...a) => { if (DEBUG) console.error('[watchdog:d]', ...a); };

  /* ── Estado persistente: siteId → datos de dominio ───────────────── */
  const state = new Map(); // id → { current, previous, changedAt, source, fails, ok, ms, lastCheck, searchOk, candidates[] }

  (function loadState() {
    try {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8') || '{}');
      for (const [id, v] of Object.entries((data && data.sites) || {})) {
        if (v && typeof v === 'object' && v.current) {
          state.set(id, {
            current: String(v.current),
            previous: v.previous || null,
            changedAt: Number(v.changedAt) || 0,
            source: v.source || 'catalogo',
            fails: Number(v.fails) || 0,
            ok: !!v.ok,
            ms: Number(v.ms) || 0,
            lastCheck: Number(v.lastCheck) || 0,
            searchOk: v.searchOk !== false,
            candidates: Array.isArray(v.candidates) ? v.candidates.slice(0, 12) : []
          });
        }
      }
      if (state.size) dlog('estado cargado:', state.size, 'sitios');
    } catch { /* sin fichero: se empieza del catálogo */ }
  })();

  function saveState() {
    try {
      const sites = {};
      for (const [id, v] of state) sites[id] = v;
      fs.writeFileSync(STATE_FILE, JSON.stringify({ version: 2, savedAt: Date.now(), sites }));
    } catch { /* best-effort (disco efímero en Render) */ }
  }

  function newState(host) {
    return {
      current: host, previous: null, changedAt: 0, source: 'catalogo',
      fails: 0, ok: true, ms: 0, lastCheck: 0, searchOk: true, candidates: []
    };
  }

  /* ── Sondeo ──────────────────────────────────────────────────────── */

  /** Prueba UNA URL: HTTP ok, sin reto Cloudflare, sin parking. */
  async function probeUrl(u, opts) {
    const { timeoutMs = 8000, maxBytes = 400 * 1024, minBody = 300 } = opts || {};
    const t0 = Date.now();
    let res;
    try { res = await request(u, { timeoutMs, maxBytes }); }
    catch { res = { ok: false }; }
    const body = res.body || '';
    const challenge = CHALLENGE_RE.test(body.slice(0, 4000));
    const parked = res.ok && PARKING_RE.test(body.slice(0, 6000));
    const ok = !!(res.ok && !challenge && !parked &&
      (res.status >= 200 && res.status < 400) &&
      (!minBody || body.length > minBody || /\/embed|player/i.test(u)));
    return { ok, status: res.status || 0, ms: Date.now() - t0, challenge, parked };
  }

  /* ── Descubrimiento (Bing + DuckDuckGo + semillas) ───────────────── */

  /** Bing: hosts enlazados que coinciden difusamente con el nombre. */
  async function bingHosts(name) {
    const out = new Set();
    const queries = [`"${name}" anime`, `"${name}" ver online`];
    for (const q of queries) {
      const res = await request('https://www.bing.com/search?q=' + encodeURIComponent(q),
        { timeoutMs: 8000, maxBytes: 700 * 1024 });
      if (!res.ok || !res.body) continue;
      const re = /<a[^>]+href="(https?:\/\/[^"]+)"/gi;
      let m;
      while ((m = re.exec(res.body)) !== null) {
        const h = hostOf(m[1]);
        if (!h) continue;
        const root = h.split('.').slice(-2).join('.');
        if (BLOCKLIST.has(h) || BLOCKLIST.has(root) || BLOCKLIST.has(siteName(h) + '.' + h.split('.').pop())) continue;
        if (matchesSite(name, h)) out.add(h);
      }
    }
    return [...out];
  }

  /** DuckDuckGo (html, POST): los enlaces llegan como uddg=<url-cifrada>. */
  async function ddgHosts(name) {
    const body = 'q=' + encodeURIComponent(`"${name}" anime`);
    const res = await request('https://html.duckduckgo.com/html/', {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeoutMs: 8000, maxBytes: 700 * 1024
    });
    if (!res.ok || !res.body) return [];
    const out = new Set();
    const re = /uddg=([^&"]+)/g;
    let m;
    while ((m = re.exec(res.body)) !== null) {
      let target;
      try { target = decodeURIComponent(m[1]); } catch { continue; }
      const h = hostOf(target);
      if (!h) continue;
      const root = h.split('.').slice(-2).join('.');
      if (BLOCKLIST.has(h) || BLOCKLIST.has(root)) continue;
      if (matchesSite(name, h)) out.add(h);
    }
    return [...out];
  }

  /** Lista ordenada de candidatos: historial → buscadores → semillas TLD.
   *  Nunca propone el dominio vigente de OTRO sitio del catálogo
   *  (evita que dos fuentes acaben apuntando al mismo host). */
  async function buildCandidates(site, st) {
    const name = siteName(site.host);
    const id = name;
    const others = new Set();
    for (const s of rawSitesCatalog()) {
      const otherId = siteName(s.host);
      if (otherId !== id) others.add(s.host);
      const ost = state.get(otherId);
      if (ost && ost.current) others.add(ost.current);
    }
    const seen = new Set([st.current, site.host, site.host.replace(/^www\./, '')]);
    const list = [];
    const push = (host, source) => {
      host = String(host || '').toLowerCase().replace(/^www\./, '');
      if (!host || !/\.[a-z]{2,}$/.test(host) || seen.has(host)) return;
      if (others.has(host)) return; // dominio de otra fuente: prohibido
      seen.add(host);
      list.push({ host, source });
    };
    // 1. Historial: dominios que ya fueron vigentes alguna vez.
    if (st.previous) push(st.previous, 'historial');
    for (const c of (st.candidates || [])) push(c.host, 'historial');
    // 2. Buscadores (descubrimiento real de dominios NUEVOS).
    const [bing, ddg] = await Promise.all([
      bingHosts(name).catch(() => []),
      ddgHosts(name).catch(() => [])
    ]);
    for (const h of bing) push(h, 'bing');
    for (const h of ddg) push(h, 'duckduckgo');
    // 3. Semillas de TLD (renacimiento en otro sufijo).
    for (const tld of TLD_SEEDS) {
      const h = name + tld;
      if (h !== site.host && h !== st.current) push(h, 'semilla-tld');
    }
    // Se recuerdan para ciclos futuros (el historial gana prioridad).
    st.candidates = list.slice(0, 12).map(c => ({ host: c.host, source: c.source, firstSeen: Date.now() }));
    return list;
  }

  /* ── Mantenimiento de UN sitio ───────────────────────────────────── */

  /** Reescribe la plantilla al dominio vigente (host y www.host). */
  function rewriteTpl(tpl, from, to) {
    let out = tpl;
    const froms = new Set([from]);
    try { froms.add(new URL('https://' + from).host); } catch { /* noop */ }
    for (const f of froms) out = out.split(f).join(to);
    return out.split('www.' + to).join(to);
  }

  async function maintainSite(site) {
    const id = siteName(site.host);
    let st = state.get(id);
    if (!st) { st = newState(site.host); state.set(id, st); }

    const host = st.current;
    const tpl = host === site.host ? site.tpl : rewriteTpl(site.tpl, site.host, host);

    // 1) SALUD del dominio vigente — se reutiliza un sondeo fresco (<10 min)
    //    de la capa de búsqueda para no sondear dos veces lo mismo.
    let ok, ms, status;
    const h = siteHealth.get(host);
    if (h && Date.now() - h.ts < 10 * 60 * 1000) {
      ok = h.ok; ms = h.ms; status = h.status;
    } else {
      const probe = await probeUrl(tpl.replace('{q}', encodeURIComponent('naruto')),
        { maxBytes: 512 * 1024, minBody: 500 });
      ok = probe.ok; ms = probe.ms; status = probe.status;
      siteHealth.set(host, { ok, ts: Date.now(), ms, status });
    }
    st.ok = ok; st.ms = ms; st.lastCheck = Date.now(); st.searchOk = ok;

    if (ok) {
      if (st.fails) { st.fails = 0; }
      state.set(id, st);
      return;
    }

    // 2) FALLECIDO: suma un fallo; a los 2 seguidos → descubrimiento.
    st.fails++;
    dlog(id, 'fallo', st.fails, '(' + status + ')');
    if (st.fails < 2) { state.set(id, st); return; }

    const candidates = await buildCandidates(site, st);
    dlog(id, 'caído, candidatos:', candidates.map(c => c.host + ':' + c.source).join(', ') || 'ninguno');

    for (const cand of candidates.slice(0, 8)) {
      // 2a) portada rápida (rechaza aparcados y muertos en 6 s)
      const home = await probeUrl('https://' + cand.host + '/', { timeoutMs: 6000, maxBytes: 200 * 1024, minBody: 200 });
      if (!home.ok) continue;
      // 2b) la plantilla de búsqueda debe funcionar de verdad
      const candTpl = rewriteTpl(site.tpl, site.host, cand.host);
      const tp = await probeUrl(candTpl.replace('{q}', encodeURIComponent('naruto')),
        { maxBytes: 512 * 1024, minBody: 500 });
      siteHealth.set(cand.host, { ok: tp.ok, ts: Date.now(), ms: tp.ms, status: tp.status });
      if (tp.ok) {
        // 3) ROTACIÓN REAL
        log(`ROTACIÓN ${id}: ${st.current} → ${cand.host} (fuente: ${cand.source})`);
        st.previous = st.current;
        st.current = cand.host;
        st.changedAt = Date.now();
        st.source = cand.source;
        st.fails = 0; st.ok = true; st.ms = tp.ms; st.searchOk = true;
        rotationsThisRun++;
        state.set(id, st);
        try { if (onRotate) onRotate(id, st.previous, cand.host); } catch (e) { dlog('onRotate error', e); }
        return;
      }
    }
    state.set(id, st);
  }

  /* ── Ciclo completo + temporizador ───────────────────────────────── */

  let running = false;
  let lastRunAt = 0;
  let nextRunAt = 0;
  let rotationsThisRun = 0;

  async function runCycle() {
    if (running) return false;
    running = true;
    const t0 = Date.now();
    try {
      const sites = rawSitesCatalog();
      // en tandas de 4 para no disparar rate-limits
      for (let i = 0; i < sites.length; i += 4) {
        await Promise.all(sites.slice(i, i + 4).map(s => maintainSite(s).catch(() => {})));
      }
      lastRunAt = Date.now();
      log(`ciclo completo en ${Math.round((lastRunAt - t0) / 1000)}s ·` +
        ` vivos ${countUp()}/${sites.length} · rotaciones ${rotationsThisRun}`);
      rotationsThisRun = 0;
      saveState();
      return true;
    } finally {
      running = false;
    }
  }

  function countUp() {
    let n = 0;
    for (const [, st] of state) if (st.ok) n++;
    return n;
  }

  /** Lanza un ciclo en segundo plano (endpoint manual). true si arrancó. */
  function trigger() {
    if (running) return false;
    runCycle().catch(e => dlog('ciclo manual falló:', e));
    return true;
  }

  function intervalMs() {
    const min = Number(process.env.ANIMAX_WATCHDOG_MIN || 0);
    return (min > 0 ? min : 360) * 60 * 1000; // por defecto: cada 6 h
  }

  function start() {
    if (process.env.ANIMAX_WATCHDOG_OFF) { log('desactivado (ANIMAX_WATCHDOG_OFF)'); return; }
    const schedule = () => {
      nextRunAt = Date.now() + intervalMs();
      setTimeout(() => {
        runCycle().catch(() => {}).then(schedule);
      }, intervalMs());
    };
    // Primera pasada a los 10 s del arranque; luego cada 6 h.
    nextRunAt = Date.now() + 10 * 1000;
    setTimeout(() => {
      runCycle().catch(() => {}).then(schedule);
    }, 10 * 1000);
    log('arrancado · ciclo cada ' + Math.round(intervalMs() / 60000) + ' min');
  }

  /* ── Vistas para la API ──────────────────────────────────────────── */

  /** Catálogo con los dominios RESUELTOS (rotados) aplicados. */
  function resolveSites(catalog) {
    return catalog.map(site => {
      const st = state.get(siteName(site.host));
      if (!st || !st.current || st.current === site.host) return site;
      return {
        ...site,
        host: st.current,
        tpl: rewriteTpl(site.tpl, site.host, st.current),
        rotated: { from: site.host, at: st.changedAt, source: st.source }
      };
    });
  }

  /** Estado de todas las fuentes (pantalla "Estado de fuentes" de la app). */
  function status() {
    const sites = rawSitesCatalog();
    let up = 0, down = 0, unknown = 0;
    const sources = sites.map(site => {
      const id = siteName(site.host);
      const st = state.get(id) || newState(site.host);
      const host = st.current;
      const h = siteHealth.get(host);
      const alive = h ? h.ok : (st.lastCheck ? st.ok : null);
      if (alive === true) up++;
      else if (alive === false) down++;
      else unknown++;
      return {
        id,
        name: id,
        kind: site.kind,
        lang: site.lang,
        host,
        url: 'https://' + host + '/',
        status: alive === true ? 'up' : (alive === false ? 'down' : 'unknown'),
        ms: h ? h.ms : (st.ms || null),
        lastCheck: h ? h.ts : (st.lastCheck || null),
        previousDomain: st.previous || null,
        changedAt: st.changedAt || null,
        discoverySource: st.source || 'catalogo',
        candidates: (st.candidates || []).length
      };
    });
    return {
      sources,
      summary: {
        total: sites.length, up, down, unknown,
        running,
        lastRun: lastRunAt || null,
        nextRun: nextRunAt || null,
        intervalMin: Math.round(intervalMs() / 60000)
      }
    };
  }

  return { resolveSites, status, runCycle, trigger, start, intervalMs };
};
