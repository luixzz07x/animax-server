'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.1 · FASE D0.5 — PÁGINAS PROPIAS UNIFICADAS (hub.js)
   ═════════════════════════════════════════════════════════════════════
   Espejo de las "páginas propias" de Seekee 1.4.0 halladas en el APK:

   · Seekee NO navega TioAnime/MonosChinos: su ficha de reproducción es
     una página H5 PROPIA (h5.otv.cc · test-h5.onfilom.com en el código;
     dominios frescos entregados en runtime por
     /buscari/app/content/website/queryFreshDomainList → WhiteListConfig
     y /quan/app/content/website/navigationList → NavigationGroup).
   · El puente nativo de Seekee: la H5 envía jsonBody por un
     "javascriptChannel" (EpisodeWebData/SeasonWebData/ServerDomainWebData/
     SubtitleWebData/ClarityWebData) y el nativo llama
     quan.switchSource(...) para cambiar de servidor. El play final llega
     como VideoPlayerBean{mediaUrl, originUrl, mediaRequestHeader}.

   Este módulo crea lo equivalente para AniMax: el servidor genera páginas
   H5 PROPIAS (sin anuncios, tema oscuro de la app) que la app abre en su
   WebView interno con el MISMO estilo de puente:

   · GET /hub                        → portada propia (buscador + ranking)
   · GET /hub?q=…                    → búsqueda unificada propia
   · GET /hub/watch?u=…&t=…&src=…    → FICHA-WATCH propia unificada
       - Episodios resueltos por el servidor (/api/episodes)
       - Grid de episodios en bloques de 50 (espejo de la ficha nativa)
       - Chips de FUENTES/SERVIDORES (sourceList) + dots de idioma
       - window.quan = { switchSource(i), openEpisode(n) }   (nativo → H5)
       - AnimaxHub.postMessage(jsonBody)                     (H5 → nativo)
       - Modo navegador puro: <video> propio + espejos en cascada

   Montaje: index.js llama a createHub(ctx) y le pasa cada petición
   /hub* ANTES del router clásico. ctx.seekeeSearch lo aporta v4-api.js
   (se auto-inyecta en el ctx compartido al crearse la capa v4).
   ═════════════════════════════════════════════════════════════════════ */

const HUB_VERSION = 'animax-hub/1 (FASE D0.5)';

/* Paleta de la app (core/theme/Color.kt) para que la página propia se
   vea EXACTAMENTE como AniMax. */
const C = {
  bg: '#050507',
  surface: '#1a1a22',
  elevated: '#23232c',
  blue: '#4f9cf9',
  blueDark: '#1d4ed8',
  text: '#f2f4f7',
  text2: '#9ba0aa',
  muted: '#5c616b',
  red: '#ef5350',
  amber: '#ffc94d',
  green: '#4ade80'
};

function htmlEscape(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* src viaja como JSON → base64url (compacto y sin escapar en la URL). */
function encodeSources(list) {
  try {
    return Buffer.from(JSON.stringify(list || []), 'utf8')
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch { return ''; }
}
function decodeSources(b64) {
  try {
    const norm = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(norm, 'base64').toString('utf8');
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter(s => s && typeof s.u === 'string' && /^https?:/i.test(s.u))
      .slice(0, 12)
      .map(s => ({
        u: s.u,
        n: String(s.n || '').slice(0, 60),
        l: String(s.l || '').slice(0, 20),
        g: ['latino', 'castellano', 'sub'].includes(s.g) ? s.g : 'sub'
      }));
  } catch { return []; }
}

const LANG_DOT = { latino: C.blue, castellano: C.amber, sub: C.muted };
const LANG_LABEL = { latino: 'Latino', castellano: 'Castellano', sub: 'Sub' };

module.exports = function createHub(ctx) {

  const buildEpisodes = ctx.buildEpisodes;
  const hostOf = ctx.hostOf;
  const stripTags = ctx.stripTags;
  const hotTab = ctx.hotTab;
  const cacheGet = ctx.cacheGet;
  const cacheSet = ctx.cacheSet;

  /* ─────────────────────────────────────────────────────────────────
     HEAD común (tema oscuro, viewport móvil, cero recursos externos)
     ───────────────────────────────────────────────────────────────── */
  function pageHead(title) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${C.bg}">
<title>${htmlEscape(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; background: ${C.bg}; color: ${C.text};
    font-family: -apple-system, 'Segoe UI', Roboto, sans-serif;
    padding-bottom: env(safe-area-inset-bottom);
  }
  a { color: ${C.blue}; text-decoration: none; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 14px 16px 40px; }
  .brand { display: flex; align-items: center; gap: 10px; margin: 6px 0 18px; }
  .brand .logo {
    width: 38px; height: 38px; border-radius: 50%;
    background: ${C.blue}2e; display: flex; align-items: center;
    justify-content: center; font-size: 19px;
  }
  .brand h1 { font-size: 17px; margin: 0; }
  .brand small { display: block; color: ${C.text2}; font-size: 11.5px; font-weight: 400; }
  .badge {
    display: inline-flex; align-items: center; gap: 5px;
    background: ${C.elevated}; color: ${C.text2};
    border: 1px solid ${C.muted}55; border-radius: 999px;
    font-size: 11px; padding: 4px 10px;
  }
  .badge.own { color: ${C.blue}; border-color: ${C.blue}66; }
  input[type=search] {
    width: 100%; padding: 13px 16px; border-radius: 26px; border: 1px solid ${C.muted}55;
    background: ${C.surface}; color: ${C.text}; font-size: 15px; outline: none;
  }
  input[type=search]:focus { border-color: ${C.blue}; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; }
  .chip {
    background: ${C.surface}; border: 1px solid ${C.muted}44; color: ${C.text2};
    border-radius: 999px; padding: 7px 13px; font-size: 12.5px; cursor: pointer;
  }
  .chip:active { background: ${C.elevated}; }
  .chip.on { background: ${C.blue}22; border-color: ${C.blue}; color: ${C.blue}; font-weight: 600; }
  .card {
    display: flex; gap: 12px; background: ${C.surface};
    border-radius: 16px; padding: 10px; margin: 10px 0;
  }
  .card img { width: 72px; height: 100px; object-fit: cover; border-radius: 10px; background: ${C.elevated}; }
  .card .info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .card h3 { margin: 2px 0 4px; font-size: 14.5px; line-height: 1.25; }
  .card p { margin: 0; color: ${C.text2}; font-size: 12px; line-height: 1.4; }
  .pill { display: inline-block; background: ${C.elevated}; border-radius: 6px; color: ${C.text2};
          font-size: 10.5px; padding: 2px 7px; margin: 4px 6px 0 0; }
  .hero { position: relative; border-radius: 18px; overflow: hidden; background: ${C.surface}; }
  .hero img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; opacity: .55; }
  .hero .over {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    justify-content: flex-end; padding: 16px;
    background: linear-gradient(180deg, transparent 30%, ${C.bg}f2 100%);
  }
  .hero h2 { margin: 0 0 6px; font-size: 21px; line-height: 1.2; }
  .eps { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 8px; }
  .ep {
    position: relative; background: ${C.surface}; border: 1px solid ${C.muted}33;
    border-radius: 12px; padding: 11px 4px 9px; text-align: center; cursor: pointer;
    font-size: 14px; font-weight: 600;
  }
  .ep:active { background: ${C.elevated}; border-color: ${C.blue}; }
  .ep .dot {
    position: absolute; top: 6px; right: 6px; width: 7px; height: 7px;
    border-radius: 50%;
  }
  .sect { margin: 20px 0 10px; font-size: 13px; color: ${C.text2};
          display: flex; align-items: center; justify-content: space-between; }
  .sect b { color: ${C.text}; font-size: 15px; }
  .spinner {
    width: 34px; height: 34px; margin: 26px auto; border-radius: 50%;
    border: 3px solid ${C.elevated}; border-top-color: ${C.blue};
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .err { color: ${C.red}; text-align: center; margin: 22px 12px; font-size: 13.5px; }
  video { width: 100%; border-radius: 14px; background: #000; margin-top: 12px; }
  .foot { margin-top: 26px; color: ${C.muted}; font-size: 11px; text-align: center; line-height: 1.6; }
  button.big {
    width: 100%; padding: 13px; border: 0; border-radius: 14px;
    background: ${C.blue}; color: #fff; font-size: 15px; font-weight: 700;
  }
  button.big:active { background: ${C.blueDark}; }
  button.ghost {
    width: 100%; padding: 11px; border-radius: 14px; margin-top: 8px;
    background: transparent; border: 1px solid ${C.muted}66; color: ${C.text2};
    font-size: 13.5px;
  }
</style>
</head>`;
  }

  /* ─────────────────────────────────────────────────────────────────
     PORTADA PROPIA (/hub) + BÚSQUEDA PROPIA (/hub?q=…)
     ───────────────────────────────────────────────────────────────── */
  async function renderHome(q, keyParam) {
    // Sufijo de API key: para enlaces que YA llevan query (?a=b) va con
    // «&»; para el form lo mete el <input type=hidden> de abajo.
    const keyQs = keyParam ? '&key=' + encodeURIComponent(keyParam) : '';
    let resultsHtml = '';
    let heading = 'Tendencias';

    if (q && q.trim()) {
      const kw = q.trim().slice(0, 80);
      let data = cacheGet && cacheGet('hub:search:' + kw.toLowerCase(), 5 * 60 * 1000);
      if (!data && ctx.seekeeSearch) {
        try { data = await ctx.seekeeSearch(kw, 1, 20); } catch { data = null; }
        if (data && cacheSet) cacheSet('hub:search:' + kw.toLowerCase(), data);
      }
      const content = (data && data.content) || [];
      heading = content.length
        ? `${content.length} resultado${content.length === 1 ? '' : 's'} para “${kw}”`
        : `Sin resultados para “${kw}”`;
      resultsHtml = content.map(c => {
        if (c.type === 'filmCenter') {
          return `<div class="card">
            ${c.cover ? `<img src="${htmlEscape(c.cover)}" alt="" loading="lazy">` : ''}
            <div class="info">
              <h3>${htmlEscape(c.title)}</h3>
              <div>
                ${(c.startYear ? `<span class="pill">${htmlEscape(c.startYear)}</span>` : '')}
                ${(c.labelList || []).slice(0, 3).map(l => `<span class="pill">${htmlEscape(l)}</span>`).join('')}
              </div>
              <p>${htmlEscape((c.description || '').slice(0, 150))}</p>
              <p style="color:${C.muted};margin-top:6px">Catálogo AniMax · ábrelo desde la app</p>
            </div>
          </div>`;
        }
        const src = encodeSources(c.sourceList && c.sourceList.length
          ? c.sourceList.map(s => ({ u: s.url, n: s.siteName, l: s.label, g: s.lang }))
          : (c.url ? [{ u: c.url, n: c.siteName, l: '', g: 'sub' }] : []));
        const watch = `/hub/watch?u=${encodeURIComponent(c.url || '')}` +
          `&t=${encodeURIComponent(c.title || '')}` +
          (c.cover ? `&c=${encodeURIComponent(c.cover)}` : '') +
          (src ? `&src=${src}` : '') + keyQs;
        return `<a class="card" href="${htmlEscape(watch)}" style="display:flex">
          ${c.cover ? `<img src="${htmlEscape(c.cover)}" alt="" loading="lazy">` : ''}
          <div class="info">
            <h3>${htmlEscape(c.title)}</h3>
            <div>
              ${(c.startYear ? `<span class="pill">${htmlEscape(c.startYear)}</span>` : '')}
              ${(c.websiteLabelList || c.labelList || []).slice(0, 3).map(l => `<span class="pill">${htmlEscape(l)}</span>`).join('')}
              ${c.sourceCount > 1 ? `<span class="pill">${c.sourceCount} fuentes</span>` : ''}
            </div>
            <p>${htmlEscape((c.description || '').slice(0, 150))}</p>
            <p style="color:${C.blue};margin-top:6px">Ver en página propia de AniMax →</p>
          </div>
        </a>`;
      }).join('');
    } else {
      // Tendencias del ranking (hotTab del motor v3).
      let items = [];
      try { items = (await hotTab('anime')) || []; } catch { items = []; }
      resultsHtml = items.slice(0, 10).map((it, i) =>
        `<a class="chip" href="/hub?q=${encodeURIComponent(it.title || '')}${keyQs}">
          ${i + 1}. ${htmlEscape((it.title || '').slice(0, 34))}
        </a>`).join('');
      resultsHtml = `<div class="chips">${resultsHtml || '<span class="badge">Sin tendencias ahora mismo</span>'}</div>`;
    }

    return pageHead(q ? `Buscar “${q}” · AniMax Hub` : 'AniMax Hub · Páginas propias') + `
<body>
<div class="wrap">
  <div class="brand">
    <div class="logo">🎬</div>
    <h1>AniMax Hub<small>Páginas propias unificadas · estilo Seekee</small></h1>
  </div>
  <form action="/hub" method="get" style="margin:0">
    ${keyParam ? `<input type="hidden" name="key" value="${htmlEscape(keyParam)}">` : ''}
    <input type="search" name="q" value="${htmlEscape(q || '')}" placeholder="Buscar animes, películas, series…" autocomplete="off">
  </form>
  <div class="sect" style="margin-top:18px"><span>${htmlEscape(heading)}</span><span class="badge own">FASE D0.5</span></div>
  ${resultsHtml}
  <div class="foot">
    AniMax Hub ${HUB_VERSION} · página propia servida por tu servidor privado<br>
    La app abre estas páginas con el puente nativo <b>AnimaxHub</b> (espejo del
    javascriptChannel + quan.switchSource de Seekee 1.4.0).
  </div>
</div>
</body>
</html>`;
  }

  /* ─────────────────────────────────────────────────────────────────
     FICHA-WATCH PROPIA (/hub/watch) — corazón de la FASE D0.5
     ───────────────────────────────────────────────────────────────── */
  async function renderWatch(u, t, cover, sources, keyParam) {
    const host = hostOf(u) || '';
    const keyQs = keyParam ? '&key=' + encodeURIComponent(keyParam) : '';
    const srcB64 = encodeSources(sources);
    const srcJson = JSON.stringify(sources);

    // Episodios resueltos EN EL SERVIDOR (motor v3, con caché).
    let episodes = [];
    let error = '';
    try {
      const list = await buildEpisodes(u);
      episodes = (list && list.episodes) || [];
      if (!episodes.length) error = (list && list.error === 'no-page')
        ? 'No se pudo leer la página de origen (¿dominio caído?). Prueba otra fuente.'
        : 'No se encontraron episodios en esta fuente.';
    } catch (e) {
      error = 'Error resolviendo episodios: ' + (e && e.message ? e.message : e);
    }

    const epsJson = JSON.stringify(episodes.map(e => ({
      n: e.n, url: e.url, text: String(e.text || '').slice(0, 60), lang: e.lang || 'sub'
    })));

    return pageHead((t || host || 'Ver') + ' · AniMax') + `
<body>
<div class="wrap">
  <div class="brand">
    <div class="logo">🎬</div>
    <h1>${htmlEscape(t || host || 'AniMax')}<small>${htmlEscape(host)} · página propia de AniMax</small></h1>
  </div>

  <div class="hero">
    ${cover ? `<img src="${htmlEscape(cover)}" alt="" onerror="this.remove()">` : ''}
    <div class="over">
      <h2>${htmlEscape(t || host || 'Título')}</h2>
      <div>
        <span class="badge own">Página propia</span>
        <span class="badge">${htmlEscape(host)}</span>
        ${episodes.length ? `<span class="badge">${episodes.length} episodios</span>` : ''}
      </div>
    </div>
  </div>

  ${sources.length > 1 ? `
  <div class="sect"><b>Fuentes / servidores</b><span>espejo quan.switchSource</span></div>
  <div class="chips" id="servers"></div>` : `
  <div class="sect"><b>Fuente</b><span>${htmlEscape(sources.length ? (sources[0].n || host) : host)}</span></div>`}

  <div class="sect">
    <b>Episodios</b>
    <span id="ep-note">${episodes.length ? (episodes.length > 50 ? 'bloques de 50' : '') : ''}</span>
  </div>
  <div class="chips" id="blocks" style="display:none"></div>
  <div class="eps" id="eps"></div>
  <div id="status"></div>
  <div id="playerBox"></div>

  <div class="foot">
    AniMax Hub ${HUB_VERSION} · puente: <b>AnimaxHub.postMessage(jsonBody)</b> (H5 → nativo)
    y <b>window.quan.switchSource(i)</b> / <b>quan.openEpisode(n)</b> (nativo → H5),
    el mismo contrato del javascriptChannel de Seekee.
  </div>
</div>

<script>
(function () {
  'use strict';

  /* ---------- datos inyectados por el servidor -------------------- */
  var PAGE_URL  = ${JSON.stringify(u)};
  var SRC_B64   = ${JSON.stringify(srcB64)};
  var SOURCES   = ${srcJson};
  var EPISODES  = ${epsJson};
  var TITLE     = ${JSON.stringify(t || host || 'AniMax')};
  var HOST      = ${JSON.stringify(host)};
  var KEY       = ${JSON.stringify(keyParam || '')};
  var ERROR     = ${JSON.stringify(error)};

  var $ = function (id) { return document.getElementById(id); };
  var BLOCK = 50, blockIndex = 0, currentServer = 0;
  // v4.1 (FASE D1) · idioma de la fuente ACTIVA (g de cada fuente: latino/
  // castellano/sub) — viaja en cada play/espejo para el bloqueo de idioma.
  var CURRENT_LANG = (SOURCES[0] && SOURCES[0].g) || 'sub';
  var AUTO_EP = 0;
  try { AUTO_EP = Number(sessionStorage.getItem('animax.autoEp')) || 0; sessionStorage.removeItem('animax.autoEp'); } catch (e) {}

  /* ---------- puente H5 → nativo (AnimaxHub = javascriptChannel) -- */
  function post(msg) {
    msg.jsonBody = true;                       // espejo del campo del APK
    try {
      if (window.AnimaxHub && window.AnimaxHub.postMessage) {
        window.AnimaxHub.postMessage(JSON.stringify(msg));
        return true;
      }
    } catch (e) {}
    return false;
  }
  var hasNative = !!(window.AnimaxHub && window.AnimaxHub.postMessage);

  /* ---------- fetch con API key (si el servidor la pide) ---------- */
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    if (KEY) opts.headers['X-Api-Key'] = KEY;
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  /* ---------- bloque de 50 (series largas, espejo de la ficha) ---- */
  function renderBlocks() {
    var box = $('blocks');
    if (EPISODES.length <= BLOCK) { box.style.display = 'none'; return; }
    var html = '';
    for (var i = 0; i < EPISODES.length; i += BLOCK) {
      var a = i + 1, b = Math.min(i + BLOCK, EPISODES.length);
      html += '<span class="chip' + (i === blockIndex * BLOCK ? ' on' : '') +
        '" data-from="' + i + '">' + a + '–' + b + '</span>';
    }
    box.innerHTML = html; box.style.display = 'flex';
    Array.prototype.forEach.call(box.children, function (chip) {
      chip.onclick = function () {
        blockIndex = Math.floor(Number(chip.getAttribute('data-from')) / BLOCK);
        renderBlocks(); renderEps();
      };
    });
  }

  function renderEps() {
    var from = blockIndex * BLOCK, to = Math.min(from + BLOCK, EPISODES.length);
    var html = '';
    for (var i = from; i < to; i++) {
      var e = EPISODES[i];
      var dot = LANG_DOT_MAP[e.lang] || LANG_DOT_MAP.sub;
      html += '<div class="ep" data-n="' + e.n + '" data-url="' + encodeURIComponent(e.url) + '">' +
        '<span class="dot" style="background:' + dot + '"></span>' + e.n + '</div>';
    }
    $('eps').innerHTML = html;
    Array.prototype.forEach.call($('eps').children, function (cell) {
      cell.onclick = function () { openEpisode(Number(cell.getAttribute('data-n'))); };
    });
  }
  var LANG_DOT_MAP = ${JSON.stringify(LANG_DOT)};

  /* ---------- chips de fuentes/servidores (ServerDomainWebData) --- */
  function renderServers() {
    var box = $('servers');
    if (!box || !SOURCES.length) return;
    var html = '';
    SOURCES.forEach(function (s, i) {
      var label = (s.l ? s.l + ' · ' : '') + (s.n || hostOfSrc(s.u));
      html += '<span class="chip' + (i === currentServer ? ' on' : '') +
        '" data-i="' + i + '" title="' + esc(s.u) + '">' + esc(label) + '</span>';
    });
    box.innerHTML = html;
    Array.prototype.forEach.call(box.children, function (chip) {
      chip.onclick = function () { switchSource(Number(chip.getAttribute('data-i'))); };
    });
  }
  function hostOfSrc(u) {
    try { return new URL(u).hostname.replace(/^www\\./, ''); } catch (e) { return u; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- nativo → H5: window.quan (espejo Seekee) ------------ */
  function watchUrlFor(i) {
    var s = SOURCES[i];
    var qs = '?u=' + encodeURIComponent(s.u) +
      '&t=' + encodeURIComponent(TITLE) +
      (document.querySelector('.hero img') ? '&c=' + encodeURIComponent(document.querySelector('.hero img').src) : '') +
      (SRC_B64 ? '&src=' + SRC_B64 : '') +
      (KEY ? '&key=' + encodeURIComponent(KEY) : '');
    return '/hub/watch' + qs;
  }
  function switchSource(i) {
    if (!SOURCES.length) return;
    i = Math.max(0, Math.min(SOURCES.length - 1, i | 0));
    if (i === currentServer) return;
    location.replace(watchUrlFor(i));
  }
  window.quan = {
    version: ${JSON.stringify(HUB_VERSION)},
    switchSource: switchSource,
    openEpisode: function (n) { openEpisode(n); },
    servers: function () { return SOURCES.length; },
    /* v4.1 (FASE D1) · CERO CAÍDAS: el reproductor nativo agotó los espejos
       de ESTA fuente → cambiar a la siguiente del MISMO IDIOMA y re-abrir
       el episodio allá (mismo camino que autoNextSource). */
    autoNext: function (ep) { autoNextSource(Number(ep) || 0); },
    /* Idioma de la fuente activa (para que el nativo ordene su cascada). */
    currentLang: function () { return CURRENT_LANG; }
  };

  /* ---------- resolver + reproducir ------------------------------- */
  function openEpisode(n) {
    var ep = null;
    for (var i = 0; i < EPISODES.length; i++) if (EPISODES[i].n === n) { ep = EPISODES[i]; break; }
    if (!ep) return;
    setStatus('Resolviendo episodio ' + n + '…', true);
    post({ type: 'resolving', episode: n, title: TITLE });
    api('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // v4.1 (FASE D1) · BLOQUEO DE IDIOMA: se envía el idioma de la fuente
      // activa para que el servidor etiquete cada espejo y la cascada del
      // reproductor nativo salte de servidor SIN cambiar de idioma.
      body: JSON.stringify({ pageUrl: PAGE_URL, episodeUrl: ep.url, episode: n, lang: ep.lang || CURRENT_LANG })
    }).then(function (r) {
      var best = r && r.best;
      if (!best || !best.url) {
        setStatus('Ningún servidor de video respondió para el episodio ' + n + '. Probando otra fuente…', true);
        post({ type: 'error', message: 'sin-espejos', episode: n });
        autoNextSource(n);
        return;
      }
      var label = 'E' + n + (ep.lang ? ' · ' + ep.lang : '') + ' · ' + HOST;
      var payload = {
        type: 'play',
        url: best.url,
        referer: (best.headers && best.headers.Referer) || PAGE_URL,
        userAgent: (best.headers && best.headers['User-Agent']) || '',
        title: TITLE,
        episode: label,
        episodeNumber: n,
        isIframe: !!best.isIframe,
        lang: ep.lang || best.lang || CURRENT_LANG,
        mirrors: (r.mirrors || []).slice(0, 6).map(function (m) {
          return { url: m.url, server: m.server || '', quality: m.quality || '', isIframe: !!m.isIframe, lang: m.lang || ep.lang || CURRENT_LANG };
        })
      };
      var handled = post(payload);
      if (!handled) playInline(payload);   // modo navegador puro
      else setStatus('Reproduciendo en el reproductor de AniMax…', true);
    }).catch(function (e) {
      setStatus('Error de red al resolver: ' + e + '. Probando otra fuente…', false);
      post({ type: 'error', message: String(e), episode: n });
      autoNextSource(n);
    });
  }

  /* v4.1 (FASE D1) · CERO CAÍDAS: cuando una fuente no entrega espejos (o
     la resolución falla), la H5 cambia SOLA a la siguiente fuente DEL
     MISMO IDIOMA (quan.switchSource) — el usuario nunca ve "no hay
     servidores" mientras quede una fuente española viva. */
  function autoNextSource(episode) {
    if (!SOURCES.length || SOURCES.length < 2) return;
    var from = currentServer;
    var curLang = (SOURCES[from] && SOURCES[from].g) || CURRENT_LANG || '';
    var order = [];
    for (var d = 1; d < SOURCES.length; d++) {
      var idx = (from + d) % SOURCES.length;
      order.push(idx);
    }
    // 1º mismo idioma, 2º cualquier español (nunca inglés: el servidor ya
    // excluye las opciones 'en').
    var same = order.filter(function (i) { return !curLang || (SOURCES[i].g || '') === curLang; });
    var target = same[0] != null ? same[0] : order[0];
    if (target == null) return;
    try {
      sessionStorage.setItem('animax.autoEp', String(episode || 0));
    } catch (e) {}
    setTimeout(function () { switchSource(target); }, 900);
  }

  /* Modo NAVEGADOR PURO (sin app): <video> propio + cascada de espejos. */
  var mirrorIdx = 0;
  function playInline(p) {
    var box = $('playerBox');
    if (/\\.(m3u8|mpd)(\\?|$)/i.test(p.url) && !canNativeHls()) {
      box.innerHTML = '<div class="err">El navegador no reproduce este stream. ' +
        '<a href="' + esc(p.url) + '">Abrir directamente</a></div>';
      return;
    }
    mirrorIdx = 0;
    tryMirror(p);
    function tryMirror(pp) {
      box.innerHTML = '<video controls autoplay playsinline src="' + esc(pp.url) + '"></video>' +
        '<button class="ghost" id="retry">Este servidor no carga → probar otro espejo</button>';
      var v = box.querySelector('video');
      v.onerror = function () { nextMirror(pp); };
      v.play().catch(function () {});
      $('retry').onclick = function () { nextMirror(pp); };
    }
    function nextMirror(pp) {
      var list = [{ url: pp.url }].concat(pp.mirrors || []);
      mirrorIdx++;
      if (mirrorIdx >= list.length) {
        box.innerHTML = '<div class="err">Se agotaron los espejos. Prueba otra fuente arriba.</div>';
        return;
      }
      var m = list[mirrorIdx];
      tryMirror({
        url: m.url, mirrors: pp.mirrors
      });
      setStatus('Probando espejo ' + (mirrorIdx + 1) + '/' + (list.length) + '…', true);
    }
  }
  function canNativeHls() {
    var v = document.createElement('video');
    return !!(v.canPlayType && v.canPlayType('application/vnd.apple.mpegurl'));
  }

  function setStatus(msg, busy) {
    $('status').innerHTML = (busy ? '<div class="spinner"></div>' : '') +
      '<div class="' + (busy ? 'foot' : 'err') + '" style="margin:14px 0">' + esc(msg) + '</div>';
  }

  /* ---------- arranque --------------------------------------------- */
  renderBlocks(); renderEps(); renderServers();

  if (ERROR) {
    setStatus(ERROR, false);
  } else if (!EPISODES.length) {
    setStatus('Esta fuente no expuso episodios.', false);
  }

  // jsonBody inicial (espejo del flujo de Seekee: la H5 anuncia estado).
  post({
    type: 'ready',
    title: TITLE, host: HOST,
    total: EPISODES.length,
    pageUrl: PAGE_URL,
    native: hasNative,
    version: ${JSON.stringify(HUB_VERSION)}
  });
  post({
    type: 'servers',
    servers: SOURCES.map(function (s, i) {
      return { title: (s.l ? s.l + ' · ' : '') + (s.n || hostOfSrc(s.u)), isActive: i === 0 };
    })
  });
  post({
    type: 'episodes',
    total: EPISODES.length,
    episodes: EPISODES.map(function (e) {
      return { n: e.n, text: e.text, lang: e.lang };
    })
  });

  /* v4.1 (FASE D1) · CERO CAÍDAS: si llegamos aquí tras un cambio de
     fuente automático (autoNextSource guardó el episodio), re-abrimos
     SOLITO ese episodio en la fuente nueva — el usuario solo ve "probando
     otra fuente…" y el capítulo arranca. */
  if (AUTO_EP > 0 && EPISODES.some(function (e) { return e.n === AUTO_EP; })) {
    setTimeout(function () {
      try { openEpisode(AUTO_EP); } catch (e) {}
    }, 600);
  }
})();
</script>
</body>
</html>`;
  }

  /* ─────────────────────────────────────────────────────────────────
     ROUTER del hub
     ───────────────────────────────────────────────────────────────── */
  return async function hubRoute(req, res, path, parsed) {
    const send = (code, body) => {
      res.writeHead(code, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(body);
    };

    try {
      if (path === '/hub') {
        const q = (parsed.searchParams.get('q') || '').trim();
        const key = parsed.searchParams.get('key') || '';
        return send(200, await renderHome(q, key)), true;
      }

      if (path === '/hub/watch') {
        const u = (parsed.searchParams.get('u') || '').trim();
        if (!/^https?:/i.test(u)) {
          return send(400, pageHead('Error · AniMax') +
            '<body><div class="wrap"><div class="err">Falta ?u=http… (URL de la página de origen)</div></div></body></html>'), true;
        }
        const t = (parsed.searchParams.get('t') || '').trim().slice(0, 120);
        const c = (parsed.searchParams.get('c') || '').trim();
        const sources = decodeSources(parsed.searchParams.get('src') || '');
        const key = parsed.searchParams.get('key') || '';
        // La fuente primaria (u) SIEMPRE primera; el resto del sourceList detrás.
        const merged = (() => {
          const rest = sources.filter(s => s.u !== u);
          // v4.1 (FASE D1): idioma inferido de la URL si el sourceList no
          // traía la primaria (latino/castellano/sub → bloqueo de idioma).
          const ul = u.toLowerCase();
          const urlLang = /latino|doblado/.test(ul) ? 'latino'
            : /castellano/.test(ul) ? 'castellano'
            : 'sub';
          const prim = { u, n: (sources[0] && sources[0].u === u ? sources[0].n : '') || hostOf(u) || '', l: '', g: urlLang };
          // Si el sourceList traía la primaria con idioma, respétalo.
          const fromList = sources.find(s => s.u === u);
          if (fromList) { prim.l = fromList.l; prim.g = fromList.g || urlLang; prim.n = fromList.n || prim.n; }
          return [prim].concat(rest);
        })();
        return send(200, await renderWatch(u, t, c, merged, key)), true;
      }

      if (path === '/hub/version') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, hub: HUB_VERSION }));
        return true;
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pageHead('Error · AniMax') +
        '<body><div class="wrap"><div class="err">Error interno del hub: ' +
        htmlEscape(e && e.message ? e.message : String(e)) + '</div></div></body></html>');
      return true;
    }

    return false;   // no era ruta del hub
  };
};

module.exports.HUB_VERSION = HUB_VERSION;
