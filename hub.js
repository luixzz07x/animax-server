'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v7.0 · FASE H3 — HUB 2.0 · BRIDGE COMPLETO + ANALIZADOR
   REMOTO (hub.js)
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

   v7.0 (FASE H2) · HUB 2.0 — de 2 páginas a PORTAL completo (el
   «tiktik.pro» de AniMax, servido por TU servidor):
   · GET /hub                        → PORTAL: estrenos de temporada,
                                       tendencias, teatros (Anime ·
                                       Películas · Series · Doramas),
                                       top-10 en vivo y géneros (AniList)
   · GET /hub?q=…                    → búsqueda unificada propia
   · GET /hub/theater?stream=…       → TEATRO: grid + orden + género +
                                       paginación (datos del filmCenter)
   · GET /hub/detail?filmId|t|u      → FICHA UNIFICADA para catálogo Y
                                       sitios externos + «Ver ahora»
   · GET /hub/watch?u=…&t=…&src=…    → FICHA-WATCH propia unificada
       - Episodios resueltos por el servidor (/api/episodes)
       - Grid de episodios en bloques de 50 (espejo de la ficha nativa)
       - Chips de FUENTES/SERVIDORES (sourceList) + dots de idioma
       - window.quan = CONTRATO COMPLETO (H1): switchEpisode(n),
         switchSeason(s), switchQuality(i), switchSource(i),
         switchSubtitle(t), pauseVideo() + openEpisode/autoNext/currentLang
       - Selector de CALIDAD dentro de la página (chips por espejo)
       - AnimaxHub.postMessage(jsonBody)                     (H5 → nativo)
       - Modo navegador puro: <video> propio + espejos en cascada

   v7.0 (FASE H3) · BRIDGE COMPLETO + ANALIZADOR REMOTO:
   · RESPUESTA JsResponseData (espejo H1): TODAS las acciones quan.*
     aceptan un `uuid` y responden por AnimaxHub.postMessage con
     {code, uuid, value} — el nativo correlaciona pregunta ↔ respuesta,
     igual que quan_function.postMessage en Seekee 1.4.0.
   · switchSeason REAL: la página analiza la página de origen con el
     ANALIZADOR REMOTO (GET /api/v1/hub/analyze — el mismo script que
     sirve /api/v1/config/analyzer.js) y pinta chips de temporada;
     switchSeason(s) cambia de temporada SIN recargar datos.
   · quan.onAnalyzerSeasons(json): la APP puede alimentar las temporadas
     con SU analizador local (ResourceAnalyzer.kt + asset
     resourceAnalysis.html) cuando el server no pudo resolver episodios
     — fallback CERO CAÍDAS, el mismo contrato AnalysisResourceData.

   Montaje: index.js llama a createHub(ctx) y le pasa cada petición
   /hub* ANTES del router clásico. ctx.seekeeSearch lo aporta v4-api.js
   (se auto-inyecta en el ctx compartido al crearse la capa v4) y
   ctx.hubPortal expone las mismas fuentes del filmCenter que la app.
   El GATE honesto vive aquí: index.js NO devuelve 401 JSON para /hub*.
   ═════════════════════════════════════════════════════════════════════ */

const HUB_VERSION = 'animax-hub/3 (FASE H3)';

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
  /* v7.0 (H2) · HUB 2.0: el portal se alimenta del MISMO filmCenter que
     la app (v4-api.js expone homeSections/theaterPage/filmDetail/… en
     ctx.hubPortal) + API key para el gate honesto «solo AniMax». */
  const portal = ctx.hubPortal || {};
  const API_KEY = ctx.apiKey || '';
  const YEAR_NOW = new Date().getFullYear();

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
  /* v7.0 (H2) · portal: grid de pósters, ficha unificada y paginación */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(102px, 1fr)); gap: 10px; }
  .pcard { display: block; }
  .pcard img, .pcard .ph { width: 100%; aspect-ratio: 2/3; object-fit: cover;
    border-radius: 12px; background: ${C.elevated}; display: block; }
  .pcard b { display: block; font-size: 12px; margin: 6px 2px 0; line-height: 1.3; }
  .pcard span { display: block; color: ${C.text2}; font-size: 10.5px; margin: 2px 2px 0; }
  .pcard:active img { outline: 2px solid ${C.blue}; }
  .detail { display: flex; gap: 14px; margin: 14px 0; }
  .detail img { width: 126px; aspect-ratio: 2/3; object-fit: cover;
    border-radius: 14px; background: ${C.elevated}; }
  .detail .info { flex: 1; min-width: 0; }
  .meta { color: ${C.text2}; font-size: 12px; margin: 4px 0; line-height: 1.5; }
  .score { color: ${C.amber}; font-weight: 700; }
  .syn { color: ${C.text2}; font-size: 13px; line-height: 1.65; margin: 12px 0; }
  .pager { display: flex; gap: 10px; margin: 18px 0 4px; }
  .pager a { flex: 1; text-align: center; background: ${C.surface};
    border: 1px solid ${C.muted}44; border-radius: 12px; padding: 11px 0;
    color: ${C.text2}; font-size: 13px; }
  .spinner {
    width: 34px; height: 34px; margin: 26px auto; border-radius: 50%;
    border: 3px solid ${C.elevated}; border-top-color: ${C.blue};
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .err { color: ${C.red}; text-align: center; margin: 22px 12px; font-size: 13.5px; }
  video { width: 100%; border-radius: 14px; background: #000; margin-top: 12px; }
  .foot { margin-top: 26px; color: ${C.muted}; font-size: 11px; text-align: center; line-height: 1.6; }
  button.big, a.big {
    width: 100%; padding: 13px; border: 0; border-radius: 14px;
    background: ${C.blue}; color: #fff; font-size: 15px; font-weight: 700;
    display: block; text-align: center; box-sizing: border-box;
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
        // v7.0 (H2): el resultado lleva a su FICHA PROPIA (/hub/detail),
        // que resuelve episodios y ofrece «Ver ahora» → /hub/watch.
        const det = `/hub/detail?u=${encodeURIComponent(c.url || '')}` +
          `&t=${encodeURIComponent(c.title || '')}` +
          (c.cover ? `&c=${encodeURIComponent(c.cover)}` : '') +
          (src ? `&src=${src}` : '') + keyQs;
        return `<a class="card" href="${htmlEscape(det)}" style="display:flex">
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
  <div class="chips" id="seasons" style="display:none"></div>
  <div class="chips" id="blocks" style="display:none"></div>
  <div class="eps" id="eps"></div>
  <div id="status"></div>
  <div class="chips" id="quality" style="display:none"></div>
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
  // v7.0 (H2) · selector de CALIDAD dentro de la página (contrato
  // quan.switchQuality): espejos etiquetados con quality tras resolver.
  var CURRENT_PLAY = null, QUALITIES = [], qCur = 0;
  // v7.0 (H3) · TEMPORADAS REALES (análisis remoto de la página de
  // origen, contrato AnalysisResourceData): cuando el analizador del
  // server (o el de la app vía onAnalyzerSeasons) encuentra >1,
  // la página pinta chips de temporada y switchSeason funciona REAL.
  var SEASONS = [], currentSeason = 0, seasonsTried = false;

  /* ---------- RESPUESTA JsResponseData (espejo H1) ----------------
     El nativo llama quan.switchEpisode(n, uuid) y la página le responde
     por AnimaxHub con {code, uuid, value} — misma correlación que
     quan_function.postMessage en Seekee. Sin uuid → no-op (barato). */
  function respond(uuid, code, value) {
    if (!uuid) return;
    post({
      type: 'js-response',
      code: (code == null ? 0 : Number(code) | 0),
      uuid: String(uuid),
      value: (value == null) ? '' : JSON.stringify(value)
    });
  }

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
    var total = epsActive().length;
    var box = $('blocks');
    if (total <= BLOCK) { box.style.display = 'none'; return; }
    var html = '';
    for (var i = 0; i < total; i += BLOCK) {
      var a = i + 1, b = Math.min(i + BLOCK, total);
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
    var eps = epsActive();
    var from = blockIndex * BLOCK, to = Math.min(from + BLOCK, eps.length);
    var html = '';
    for (var i = from; i < to; i++) {
      var e = eps[i];
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

  /* ---------- v7.0 (H3) · TEMPORADAS (AnalysisResourceData) --------
     El episodio activo se busca SIEMPRE en la temporada activa: sin
     análisis → la lista plana EPISODES; con análisis → la temporada
     elegida. NUNCA lanza: cualquier forma rara se ignora. */
  function epsActive() {
    if (SEASONS.length && SEASONS[currentSeason] && SEASONS[currentSeason].episodes) {
      return SEASONS[currentSeason].episodes;
    }
    return EPISODES;
  }
  function normSeasons(raw) {
    try {
      var arr = (typeof raw === 'string') ? JSON.parse(raw) : raw;
      if (!arr || typeof arr !== 'object') return [];
      var list = Array.isArray(arr) ? arr : (arr.seasons || []);
      if (!Array.isArray(list)) return [];
      var out = [];
      for (var i = 0; i < list.length && out.length < 40; i++) {
        var s = list[i] || {};
        var eps = [];
        var ea = s.episodes || [];
        for (var j = 0; j < ea.length && eps.length < 1500; j++) {
          var e = ea[j] || {};
          var eu = String(e.url || '');
          if (eu.indexOf('http') !== 0) continue;
          // Nº real desde el campo n, del título («Episodio 1122») o por orden.
          var tn = (String(e.title || e.text || '').match(/(\d{1,4})/) || [])[0];
          var n = Number(e.n || tn || (j + 1)) | 0;
          if (n < 1) n = j + 1;
          eps.push({ n: n, url: eu, text: String(e.title || e.text || ('Episodio ' + n)).slice(0, 60), lang: e.lang || CURRENT_LANG });
        }
        if (!eps.length) continue;
        out.push({
          id: String(s.id || ('s' + (out.length + 1))),
          title: String(s.title || ('Temporada ' + (out.length + 1))).slice(0, 60),
          isActive: !!s.isActive,
          episodes: eps
        });
      }
      return out;
    } catch (e) { return []; }
  }
  function renderSeasonChips() {
    var box = $('seasons');
    if (!box) return;
    if (SEASONS.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < SEASONS.length; i++) {
      html += '<span class="chip' + (i === currentSeason ? ' on' : '') + '" data-i="' + i + '">' +
        esc(SEASONS[i].title) + ' · ' + SEASONS[i].episodes.length + '</span>';
    }
    box.innerHTML = html;
    box.style.display = 'flex';
    Array.prototype.forEach.call(box.children, function (chip) {
      chip.onclick = function () { switchSeason(Number(chip.getAttribute('data-i'))); };
    });
  }
  function applySeasons(list, fromNative) {
    if (!list || list.length < 1) return false;
    // Solo adopta temporadas si aportan MÁS estructura que lo actual
    // (1 sola temporada igual que la plana no vale la pena).
    if (list.length < 2 && EPISODES.length && list[0].episodes.length <= EPISODES.length) return false;
    SEASONS = list;
    var act = -1;
    for (var i = 0; i < list.length; i++) if (list[i].isActive) { act = i; break; }
    currentSeason = act >= 0 ? act : 0;
    blockIndex = 0;
    renderSeasonChips();
    renderBlocks();
    renderEps();
    post({
      type: 'seasons',
      seasons: list.map(function (s, i) {
        return { id: s.id, title: s.title, isActive: i === currentSeason };
      }),
      from: fromNative ? 'analyzer-app' : 'analyzer-server'
    });
    return true;
  }
  /* El análisis del SERVER (arranque) — GET /api/v1/hub/analyze?u=…  */
  function loadSeasons() {
    if (seasonsTried || !PAGE_URL) return;
    seasonsTried = true;
    try {
      api('/api/v1/hub/analyze?u=' + encodeURIComponent(PAGE_URL)).then(function (r) {
        if (!r || !r.ok || !r.data) return;
        applySeasons(normSeasons(r.data), false);
      }).catch(function () {});
    } catch (e) {}
  }

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
    if (!SOURCES.length) return false;
    i = Math.max(0, Math.min(SOURCES.length - 1, i | 0));
    if (i === currentServer) return false;
    location.replace(watchUrlFor(i));
    return true;
  }
  /* v7.0 (H2) · selector de CALIDAD: chips por espejo etiquetado. En la
     app re-emite el MISMO contrato 'play' con la URL del espejo elegido
     (el reproductor nativo lo recibe como un play normal); en navegador
     puro cambia el src del <video>. */
  function renderQuality() {
    var box = $('quality');
    if (!box) return;
    if (QUALITIES.length < 2) { box.style.display = 'none'; return; }
    var html = '';
    QUALITIES.forEach(function (q, i) {
      html += '<span class="chip' + (i === qCur ? ' on' : '') +
        '" data-i="' + i + '">' + esc(q.label) + '</span>';
    });
    box.innerHTML = html;
    box.style.display = 'flex';
    Array.prototype.forEach.call(box.children, function (chip) {
      chip.onclick = function () { switchQuality(Number(chip.getAttribute('data-i'))); };
    });
  }
  function switchQuality(i) {
    if (!QUALITIES.length) return false;
    i = Math.max(0, Math.min(QUALITIES.length - 1, i | 0));
    if (i === qCur) return false;
    var q = QUALITIES[i];
    if (!q || !q.url) return false;
    qCur = i;
    renderQuality();
    if (hasNative && CURRENT_PLAY) {
      var p = {};
      for (var k in CURRENT_PLAY) p[k] = CURRENT_PLAY[k];
      p.url = q.url;
      p.isIframe = !!q.isIframe;
      p.quality = q.label;
      post(p);
      setStatus('Cambiando a ' + q.label + '…', true);
    } else {
      playInline({ url: q.url, mirrors: [] });
      setStatus('Calidad: ' + q.label, true);
    }
    return true;
  }
  window.quan = {
    version: ${JSON.stringify(HUB_VERSION)},
    /* v7.0 (H3) · CONTRATO COMPLETO quan.* (espejo Loklok, beans H1):
       switchEpisode · switchSeason · switchQuality · switchSource ·
       switchSubtitle · pauseVideo (nativo → H5) + RESPUESTA
       js-response {code, uuid, value} (H5 → nativo, espejo
       quan_function.postMessage). El uuid llega como ÚLTIMO argumento. */
    switchSource: function (i, uuid) {
      var r = switchSource(Number(i) | 0);
      respond(uuid, r ? 0 : 1, { source: Number(i) | 0, switched: !!r });
    },
    switchEpisode: function (n, uuid) {
      var ep = Number(n) || 0;
      var ok = openEpisode(ep);
      respond(uuid, ok ? 0 : 1, { episode: ep, opened: !!ok });
    },
    switchQuality: function (i, uuid) {
      var ok = switchQuality(Number(i) | 0);
      respond(uuid, ok ? 0 : 1, { quality: Number(i) | 0, applied: !!ok });
    },
    /* v7.0 (H3) · switchSeason REAL: con temporadas del analizador
       cambia en local (sin recargar datos) y responde; sin ellas
       responde honesto (seasons: 0) — jamás finge. */
    switchSeason: function (s, uuid) {
      var idx = Number(s) | 0;
      if (SEASONS.length) {
        idx = Math.max(0, Math.min(SEASONS.length - 1, idx));
        currentSeason = idx;
        blockIndex = 0;
        renderSeasonChips();
        renderBlocks();
        renderEps();
        var cur = SEASONS[idx];
        post({ type: 'season', value: idx, title: cur.title, total: cur.episodes.length });
        respond(uuid, 0, { season: idx, title: cur.title, episodes: cur.episodes.length });
      } else {
        post({ type: 'season', value: idx });
        respond(uuid, 1, { season: idx, seasons: 0 });
      }
    },
    switchSubtitle: function (t, uuid) {
      // H3 honesto: los subtítulos del Hub se conectan en H6 (el
      // contrato ya existe en HubContracts.kt); hoy se informa Y responde.
      var name = (t == null) ? '' : String(t);
      post({ type: 'subtitle', value: name });
      respond(uuid, 0, { subtitle: name, connected: false });
    },
    pauseVideo: function (uuid) {
      var v = document.querySelector('#playerBox video');
      var paused = false;
      if (v) { try { v.pause(); paused = true; } catch (e) {} }
      post({ type: 'paused', by: 'native' });
      respond(uuid, 0, { paused: paused });
    },
    /* v7.0 (H3) · FALLBACK CERO CAÍDAS: la APP analizó la página de
       origen con SU ResourceAnalyzer (asset resourceAnalysis.html +
       /api/v1/config/analyzer.js) y entrega el AnalysisResourceData —
       la página lo adopta (chips de temporada incluidos). */
    onAnalyzerSeasons: function (json, uuid) {
      var list = normSeasons(json);
      var ok = applySeasons(list, true);
      setStatus(ok ? 'El analizador de la app encontró ' + list.length +
        ' temporada(s) — ya están en la página.' : 'El análisis no aportó temporadas.', ok);
      respond(uuid, ok ? 0 : 1, { seasons: list.length, applied: ok });
    },
    openEpisode: function (n, uuid) {
      var ok = openEpisode(Number(n) || 0);
      respond(uuid, ok ? 0 : 1, { episode: Number(n) || 0, opened: !!ok });
    },
    seasons: function () { return SEASONS.length; },
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
    var eps = epsActive();
    var ep = null;
    for (var i = 0; i < eps.length; i++) if (eps[i].n === n) { ep = eps[i]; break; }
    if (!ep) return false;
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
        return true;
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
      // v7.0 (H2) · chips de CALIDAD: Auto (el mejor) + espejos etiquetados
      // con quality (los que la resolución logró etiquetar).
      CURRENT_PLAY = payload;
      qCur = 0;
      QUALITIES = [{ label: 'Auto', url: best.url, isIframe: !!best.isIframe }]
        .concat((r.mirrors || []).filter(function (m) { return m && m.url; }).map(function (m, j) {
          return { label: m.quality || ('Espejo ' + (j + 1)), url: m.url, isIframe: !!m.isIframe };
        }));
      renderQuality();
      var handled = post(payload);
      if (!handled) playInline(payload);   // modo navegador puro
      else setStatus('Reproduciendo en el reproductor de AniMax…', true);
      return true;
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

  // v7.0 (H3) · TEMPORADAS REALES: se pide al servidor el análisis de la
  // página de origen (mismo script que /api/v1/config/analyzer.js). Si
  // el server falla, la APP puede alimentarlas luego vía
  // quan.onAnalyzerSeasons (ResourceAnalyzer local — CERO CAÍDAS).
  loadSeasons();

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
    total: epsActive().length,
    episodes: epsActive().map(function (e) {
      return { n: e.n, text: e.text, lang: e.lang };
    })
  });

  /* v4.1 (FASE D1) · CERO CAÍDAS: si llegamos aquí tras un cambio de
     fuente automático (autoNextSource guardó el episodio), re-abrimos
     SOLITO ese episodio en la fuente nueva — el usuario solo ve "probando
     otra fuente…" y el capítulo arranca. */
  if (AUTO_EP > 0 && epsActive().some(function (e) { return e.n === AUTO_EP; })) {
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
     v7.0 (H2) · GATE HONESTO «solo AniMax» — espejo del token= de
     Loklok, pero SIN ENGAÑOS: sin X-Api-Key/?key= válida la página dice
     abiertamente que se abre dentro de AniMax (no finge contenido).
     ───────────────────────────────────────────────────────────────── */
  function gateAllowed(req, parsed) {
    if (!API_KEY) return true;                       // servidor personal → abierto
    const h = String((req && req.headers && req.headers['x-api-key']) || '');
    if (h === API_KEY) return true;                  // la app (header del WebView)
    const k = String((parsed && parsed.searchParams.get('key')) || '');
    return k === API_KEY;                            // enlaces internos ?key=…
  }

  function renderGate() {
    return pageHead('AniMax · Contenido solo en la app') + `
<body>
<div class="wrap" style="text-align:center;padding-top:64px">
  <div style="font-size:58px;margin:8px 0 4px">🎬</div>
  <h2 style="margin:0 0 10px;font-size:21px">Abre este contenido dentro de AniMax</h2>
  <p style="color:${C.text2};font-size:13.5px;line-height:1.7;max-width:430px;margin:0 auto 16px">
    Esta página es <b style="color:${C.text}">una página propia del Hub de AniMax</b>,
    servida por el servidor privado de tu app: sin anuncios, con el puente
    nativo y con el reproductor de la aplicación.</p>
  <div class="badge own" style="margin:0 0 26px">Gate honesto · ${htmlEscape(HUB_VERSION)}</div>
  <p style="color:${C.muted};font-size:12px;line-height:1.7;max-width:430px;margin:0 auto">
    ¿Eres el dueño del servidor? En AniMax entra a <b>Ajustes → Servidor</b> y
    define esta misma URL y la API key: la app abre el contenido enviando
    <b>X-Api-Key</b> (los enlaces internos viajan con ?key=).</p>
</div>
</body>
</html>`;
  }

  /* ─────────────────────────────────────────────────────────────────
     v7.0 (H2) · PORTAL (/hub) — el «tiktik.pro» de AniMax:
     estrenos de temporada, tendencias, teatros, top-10 y géneros.
     Datos del MISMO filmCenter que la app (AniList/TMDB vía ctx.hubPortal).
     Toda sección con guard: si una fuente falla, la sección desaparece
     — NUNCA lanza, jamás portal en blanco.
     ───────────────────────────────────────────────────────────────── */
  async function safe(fn, fb) {
    try { const r = await fn(); return r == null ? fb : r; } catch { return fb; }
  }

  /* meta crudo (catalogPage) → tarjeta de póster del portal */
  function cardOf(m) {
    return {
      filmId: String((m && m.id) || ''),
      title: (m && m.title) || '',
      cover: (m && (m.image || m.banner)) || '',
      rating: String((m && m.score) || ''),
      year: String((m && m.year) || '')
    };
  }

  function posterCard(f, keyQs) {
    if (!f || !f.title) return '';
    const href = '/hub/detail?filmId=' + encodeURIComponent(f.filmId || '') +
      '&t=' + encodeURIComponent(f.title || '') + keyQs;
    return `<a class="pcard" href="${htmlEscape(href)}">` +
      (f.cover ? `<img src="${htmlEscape(f.cover)}" alt="" loading="lazy">` : '<div class="ph"></div>') +
      `<b>${htmlEscape(String(f.title).slice(0, 44))}</b>` +
      `<span>${htmlEscape(f.year || '')}${f.rating ? ' · ★' + htmlEscape(f.rating) : ''}</span>` +
      '</a>';
  }

  function posterRow(title, list, keyQs, moreHref) {
    if (!list || !list.length) return '';
    return `<div class="sect"><b>${htmlEscape(title)}</b>` +
      (moreHref ? `<a href="${htmlEscape(moreHref)}">Ver todo →</a>` : '') +
      `</div><div class="grid">${list.map(f => posterCard(f, keyQs)).join('')}</div>`;
  }

  async function renderPortal(keyParam) {
    const keyQs = keyParam ? '&key=' + encodeURIComponent(keyParam) : '';

    const [trend, estrenos, movies, series, genres, rank] = await Promise.all([
      safe(() => portal.catalogPage ? portal.catalogPage({ code: 'comic', page: 1, pageSize: 12, orderType: 'trending' }) : null, null),
      safe(() => portal.catalogPage ? portal.catalogPage({ code: 'comic', page: 1, pageSize: 12, orderType: 'trending', year: YEAR_NOW }) : null, null),
      safe(() => portal.catalogPage ? portal.catalogPage({ code: 'movie', page: 1, pageSize: 12, orderType: 'popularity' }) : null, null),
      safe(() => portal.catalogPage ? portal.catalogPage({ code: 'drama', page: 1, pageSize: 12, orderType: 'popularity' }) : null, null),
      safe(() => portal.popularGenres ? portal.popularGenres() : [], []),
      safe(() => ctx.hotTab ? ctx.hotTab('anime') : [], [])
    ]);

    /* Teatros del portal (espejo del filmCenter de Seekee) */
    const theaters = [
      { code: 'comic', name: 'Anime' },
      { code: 'movie', name: 'Películas' },
      { code: 'drama', name: 'Series' },
      { code: 'short', name: 'Doramas' }
    ];
    const theaterChips = `<div class="chips">` + theaters.map(t =>
      `<a class="chip" href="/hub/theater?stream=${t.code}${keyQs}">${t.name}</a>`).join('') + `</div>`;

    const hero = (trend && trend.list && trend.list[0]) || null;
    const heroHtml = hero ? `<div class="hero">` +
      ((hero.banner || hero.image) ? `<img src="${htmlEscape(hero.banner || hero.image)}" alt="" onerror="this.remove()">` : '') +
      `<div class="over">
        <span class="badge own">Estreno destacado</span>
        <h2>${htmlEscape(hero.title || '')}</h2>
        <div>
          ${hero.year ? `<span class="badge">${htmlEscape(String(hero.year))}</span>` : ''}
          ${hero.score ? `<span class="badge">★ ${htmlEscape(String(hero.score))}</span>` : ''}
          <a class="badge own" href="/hub/detail?filmId=${encodeURIComponent(String(hero.id || ''))}&t=${encodeURIComponent(hero.title || '')}${keyQs}">Ver ficha →</a>
        </div>
      </div>
    </div>` : '';

    const rankChips = `<div class="chips">` + ((rank || []).slice(0, 10).map((it, i) =>
      `<a class="chip" href="/hub/detail?t=${encodeURIComponent(it.title || '')}${keyQs}">${i + 1}. ${htmlEscape(String(it.title || '').slice(0, 32))}</a>`
    ).join('') || '<span class="badge">El ranking aún se está calentando</span>') + `</div>`;

    const genreChips = `<div class="chips">` + ((genres || []).slice(0, 12).map(g =>
      `<a class="chip" href="/hub/theater?stream=comic&genre=${encodeURIComponent(g.label || '')}${keyQs}">${htmlEscape(g.name || '')}</a>`
    ).join('') || '<span class="badge">Géneros no disponibles ahora</span>') + `</div>`;

    const keyTheater = (code) => '/hub/theater?stream=' + code + (keyParam ? '&key=' + encodeURIComponent(keyParam) : '');

    return pageHead('AniMax Hub · Anime, Películas, Series y Doramas') + `
<body>
<div class="wrap">
  <div class="brand">
    <div class="logo">🎬</div>
    <h1>AniMax Hub<small>Portal propio · Anime · Películas · Series · Doramas</small></h1>
  </div>
  <form action="/hub" method="get" style="margin:0">
    ${keyParam ? `<input type="hidden" name="key" value="${htmlEscape(keyParam)}">` : ''}
    <input type="search" name="q" placeholder="Buscar animes, películas, series…" autocomplete="off">
  </form>

  <div class="sect" style="margin-top:18px"><b>Teatros</b><span class="badge own">FASE H2 · portal propio</span></div>
  ${theaterChips}

  ${heroHtml}

  ${posterRow('Estrenos de temporada ' + YEAR_NOW, ((estrenos && estrenos.list) || []).slice(0, 12).map(cardOf), keyQs)}
  ${posterRow('Tendencias ahora', ((trend && trend.list) || []).slice(0, 12).map(cardOf), keyQs)}
  ${posterRow('Películas del momento', ((movies && movies.list) || []).slice(0, 12).map(cardOf), keyQs, keyTheater('movie'))}
  ${posterRow('Series del momento', ((series && series.list) || []).slice(0, 12).map(cardOf), keyQs, keyTheater('drama'))}

  <div class="sect"><b>Top 10 · los más buscados</b><span>en vivo</span></div>
  ${rankChips}

  <div class="sect"><b>Géneros populares</b><span>catálogo AniList</span></div>
  ${genreChips}

  <div class="foot">
    AniMax Hub ${HUB_VERSION} · portal servido por tu servidor privado con los datos del
    MISMO filmCenter que la app (AniList/TMDB) — el modelo de plataforma propia de
    Seekee/Loklok: catálogo propio + páginas propias + puente nativo.
  </div>
</div>
</body>
</html>`;
  }

  /* ─────────────────────────────────────────────────────────────────
     v7.0 (H2) · TEATRO (/hub/theater) — grid del filmCenter con
     orden, género y paginación (el mismo contrato que la app consume
     vía film/subPage — aquí servido como página propia).
     ───────────────────────────────────────────────────────────────── */
  async function renderTheater(stream, order, genre, page, keyParam) {
    const keyQs = keyParam ? '&key=' + encodeURIComponent(keyParam) : '';
    const data = await safe(() => portal.theaterPage
      ? portal.theaterPage(stream, order, (genre && genre !== 'all') ? genre : null, page, 24, null, null)
      : null, null);
    if (!data || !Array.isArray(data.filmCardList)) {
      return pageHead('Teatro · AniMax Hub') + `<body><div class="wrap">
        <div class="err">El catálogo no respondió para este teatro. Espera un momento y recarga — el servidor reintenta solo.</div>
        <a class="chip" href="/hub${keyQs}">← Volver al portal</a></div></body></html>`;
    }
    const linkFor = (o, g, pg) => '/hub/theater?stream=' + encodeURIComponent(data.streamCode || stream) +
      '&order=' + encodeURIComponent(o || order) +
      (g ? '&genre=' + encodeURIComponent(g) : '') +
      (pg > 1 ? '&page=' + pg : '') + keyQs;
    const orderChips = `<div class="chips">` + (data.orderTypeList || []).map(o =>
      `<a class="chip${o.orderType === order ? ' on' : ''}" href="${htmlEscape(linkFor(o.orderType, genre, 1))}">${htmlEscape(o.orderTypeName)}</a>`).join('') + `</div>`;
    const genreChips = `<div class="chips">` +
      `<a class="chip${!genre ? ' on' : ''}" href="${htmlEscape(linkFor(order, '', 1))}">Todos</a>` +
      (data.genreList || []).map(g =>
        `<a class="chip${g.genreCode === genre ? ' on' : ''}" href="${htmlEscape(linkFor(order, g.genreCode, 1))}">${htmlEscape(g.genreName)}</a>`).join('') + `</div>`;
    const pager = `<div class="pager">` +
      (page > 1 ? `<a href="${htmlEscape(linkFor(order, genre, page - 1))}">← Anterior</a>` : '') +
      (!data.isLast ? `<a href="${htmlEscape(linkFor(order, genre, page + 1))}">Siguiente →</a>` : '') +
      `</div>`;
    return pageHead(data.streamName + ' · AniMax Hub') + `
<body>
<div class="wrap">
  <div class="brand">
    <div class="logo">🎬</div>
    <h1>${htmlEscape(data.streamName)}<small>${htmlEscape(data.description || '')}</small></h1>
  </div>
  <div class="sect"><b>Ordenar</b><span>${data.totalFilms || 0} obras</span></div>
  ${orderChips}
  <div class="sect"><b>Género</b><span></span></div>
  ${genreChips}
  <div class="grid" style="margin-top:14px">${(data.filmCardList || []).map(f => posterCard(f, keyQs)).join('')}</div>
  ${pager}
  <div class="foot"><a href="/hub${keyQs}">← Portal AniMax</a> · AniMax Hub ${HUB_VERSION}</div>
</div>
</body>
</html>`;
  }

  /* ─────────────────────────────────────────────────────────────────
     v7.0 (H2) · FICHA UNIFICADA (/hub/detail) — para el CATÁLOGO
     (filmId de AniList/tmdb o título) y para SITIOS EXTERNOS (u).
     La misma página que produce el hubUrl que el server llena en las
     tarjetas de búsqueda (fillHubUrls en v4-api.js).
     ───────────────────────────────────────────────────────────────── */
  async function renderDetail(p) {
    const keyQs = p.key ? '&key=' + encodeURIComponent(p.key) : '';

    /* 1) CATÁLOGO: filmDetail (filmId AniList / tmdb-{movie|tv}-{id} o título).
       v7.0 (H2) · si viene ?u= externa, esa manda (el título t= es solo
       la etiqueta de la ficha externa — NO una búsqueda de catálogo). */
    if ((p.filmId || p.t) && !/^https?:/i.test(p.u || '')) {
      const cat = await safe(() => portal.filmDetail ? portal.filmDetail(p.filmId || p.t, null) : null, null);
      if (cat && cat.title) {
        const meta = [];
        if (cat.year) meta.push(htmlEscape(String(cat.year)) + (cat.endYear ? '–' + htmlEscape(String(cat.endYear)) : ''));
        if (cat.format) meta.push(htmlEscape(cat.format));
        if (cat.episodes) meta.push(cat.episodes + ' eps');
        if (cat.duration) meta.push(cat.duration + ' min');
        if (cat.seasons > 1) meta.push(cat.seasons + ' temporadas');
        if (cat.rated) meta.push(htmlEscape(String(cat.rated)));
        const simHtml = (cat.similar || []).length
          ? `<div class="sect"><b>Similares</b><span>del mismo género</span></div>
             <div class="grid">${cat.similar.map(f => posterCard(f, keyQs)).join('')}</div>`
          : '';
        const trailer = (cat.jikan && cat.jikan.trailerUrl)
          ? `<p style="margin:12px 0 0"><a href="${htmlEscape(cat.jikan.trailerUrl)}">▶ Tráiler (YouTube)</a></p>` : '';
        return pageHead(cat.title + ' · AniMax Hub') + `
<body>
<div class="wrap">
  <div class="hero">
    ${(cat.banner || cat.cover) ? `<img src="${htmlEscape(cat.banner || cat.cover)}" alt="" onerror="this.remove()">` : ''}
    <div class="over">
      <span class="badge own">Catálogo AniMax</span>
      <h2>${htmlEscape(cat.title)}</h2>
    </div>
  </div>
  <div class="detail">
    ${cat.cover ? `<img src="${htmlEscape(cat.cover)}" alt="">` : ''}
    <div class="info">
      <div class="meta">${cat.score ? `<span class="score">★ ${htmlEscape(String(cat.score))}</span> · ` : ''}${meta.join(' · ')}</div>
      <div class="chips" style="margin:8px 0 0">${(cat.genres || []).slice(0, 5).map(g => `<span class="chip">${htmlEscape(g)}</span>`).join('')}</div>
    </div>
  </div>
  <p class="syn">${htmlEscape((cat.synopsis || 'Sin sinopsis disponible.').slice(0, 900))}</p>
  ${trailer}
  <a class="big" style="margin-top:14px" href="/hub?q=${encodeURIComponent(cat.title)}${keyQs}">Buscar dónde ver →</a>
  ${simHtml}
  <div class="foot"><a href="/hub${keyQs}">← Portal AniMax</a> · AniMax Hub ${HUB_VERSION}</div>
</div>
</body>
</html>`;
      }
      /* Honestidad: el catálogo no resolvió la obra → página honesta
         con buscador, jamás un 404 pelado. */
      return pageHead('Obra no encontrada · AniMax Hub') + `<body><div class="wrap">
        <div class="err">No encontramos «${htmlEscape(p.filmId || p.t)}» en el catálogo.</div>
        <form action="/hub" method="get">
          ${p.key ? `<input type="hidden" name="key" value="${htmlEscape(p.key)}">` : ''}
          <input type="search" name="q" placeholder="Buscar en la web de fuentes…" autocomplete="off">
        </form>
      </div></body></html>`;
    }

    /* 2) EXTERNO: página real (u) → episodios resueltos EN EL SERVIDOR */
    const host = hostOf(p.u) || '';
    const title = p.t || host;
    let eps = 0; let epsErr = '';
    try {
      const list = await ctx.buildEpisodes(p.u);
      eps = (list && list.episodes) ? list.episodes.length : 0;
      if (!eps) epsErr = (list && list.error === 'no-page')
        ? 'La página de origen no respondió (¿dominio caído?). Aún puedes intentar reproducir.'
        : 'Esta fuente no expuso episodios legibles. Aún puedes intentar reproducir.';
    } catch { epsErr = 'No se pudo leer la página de origen. Aún puedes intentar reproducir.'; }
    const srcB64 = encodeSources(p.src || []);
    const watchHref = '/hub/watch?u=' + encodeURIComponent(p.u) +
      '&t=' + encodeURIComponent(title) +
      (p.c ? '&c=' + encodeURIComponent(p.c) : '') +
      (srcB64 ? '&src=' + srcB64 : '') + keyQs;
    const srcChips = (p.src || []).length
      ? `<div class="sect"><b>Fuentes por idioma</b><span>latino primero</span></div><div class="chips">` +
        p.src.map(s => `<span class="chip"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${LANG_DOT[s.g] || C.muted};margin-right:6px"></span>${htmlEscape(s.n || hostOf(s.u) || '')}${s.l ? ' · ' + htmlEscape(s.l) : ''}</span>`).join('') +
        `</div>`
      : '';
    return pageHead(title + ' · AniMax Hub') + `
<body>
<div class="wrap">
  <div class="hero">
    ${p.c ? `<img src="${htmlEscape(p.c)}" alt="" onerror="this.remove()">` : ''}
    <div class="over">
      <span class="badge own">Página propia · fuente externa</span>
      <h2>${htmlEscape(title)}</h2>
      <div>
        <span class="badge">${htmlEscape(host)}</span>
        ${eps ? `<span class="badge">${eps} episodios</span>` : ''}
      </div>
    </div>
  </div>
  ${srcChips}
  ${epsErr ? `<div class="err">${htmlEscape(epsErr)}</div>` : ''}
  <a class="big" style="margin-top:14px" href="${htmlEscape(watchHref)}">Ver ahora en AniMax →</a>
  <div class="foot">
    La ficha unificada sirve para catálogo y fuentes externas: mismo portal,
    mismo puente AnimaxHub — espejo de la ficha H5 de Seekee.<br>
    <a href="/hub${keyQs}">← Portal AniMax</a> · AniMax Hub ${HUB_VERSION}
  </div>
</div>
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
      /* v7.0 (H2) · GATE HONESTO «solo AniMax»: con ANIMAX_API_KEY activa,
         las páginas solo abren con X-Api-Key (header de la app) o ?key=.
         Sin clave NO hay 401 JSON: PORTADA HONESTA de «ábrelo dentro de
         AniMax» (index.js ya NO intercepta /hub* con el gate global).
         /hub/version queda abierta (JSON de versión, sin contenido). */
      if (path !== '/hub/version' && !gateAllowed(req, parsed)) {
        return send(200, renderGate()), true;
      }

      if (path === '/hub') {
        const q = (parsed.searchParams.get('q') || '').trim();
        const key = parsed.searchParams.get('key') || '';
        // v7.0 (H2): sin q → PORTAL (estrenos/tendencias/teatros/rankings);
        // con q → búsqueda unificada propia (renderHome, D0.5).
        if (!q) return send(200, await renderPortal(key)), true;
        return send(200, await renderHome(q, key)), true;
      }

      if (path === '/hub/theater') {
        const stream = (parsed.searchParams.get('stream') || 'comic').trim();
        const order = (parsed.searchParams.get('order') || 'trending').trim();
        const genre = (parsed.searchParams.get('genre') || '').trim();
        const page = Math.max(1, Number(parsed.searchParams.get('page')) || 1);
        const key = parsed.searchParams.get('key') || '';
        return send(200, await renderTheater(stream, order, genre, page, key)), true;
      }

      if (path === '/hub/detail') {
        const filmId = (parsed.searchParams.get('filmId') || '').trim().slice(0, 80);
        const t = (parsed.searchParams.get('t') || '').trim().slice(0, 120);
        const u = (parsed.searchParams.get('u') || '').trim();
        const c = (parsed.searchParams.get('c') || '').trim();
        const src = decodeSources(parsed.searchParams.get('src') || '');
        const key = parsed.searchParams.get('key') || '';
        if (!filmId && !t && !/^https?:/i.test(u)) {
          return send(400, pageHead('Error · AniMax') +
            '<body><div class="wrap"><div class="err">Falta ?filmId=, ?t= o ?u=http…</div></div></body></html>'), true;
        }
        return send(200, await renderDetail({ filmId, t, u, c, src, key })), true;
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
/* v7.0 (H2): mismo codec b64url (u/n/l/g) para que v4-api.js llene el
   src= del hubUrl con la MISMA codificación que decodifica el hub. */
module.exports.encodeSources = encodeSources;
