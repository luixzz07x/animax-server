'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · FASE 3 — MOTOR DE BÚSQUEDA AGREGADO v2
   ═════════════════════════════════════════════════════════════════════
   Capa espejo de la API de Seekee 1.4.0 (Fase 1) + búsqueda agregada
   por título con sourceList (Latino → Castellano → Sub + reputación),
   relatedQueries en 3 capas, forecast de texto, search/hot con
   heatScore y re-priorización automática de fuentes (feedback.js).

   Contrato extraído del APK de Seekee (Retrofit Oooo000/OooO00o.java →
   AppUrl.kt, 47 endpoints contra mobile-api.buscari.com) y replicado
   aquí con rutas propias /api/v1/… y LAS MISMAS FORMAS de respuesta
   (beans Gson: TabData, TabPageData, PageContent, AlbumData,
   NavigationGroup, WhiteListConfig, DomainSubtitlesBean,
   AdBlockSubscription, AdBlockDomain, AppRemoveConfigData, UpgradeInfo,
   DiscoveryModularizedData, TheaterCover, FilterItem, SortItem,
   GenreCover, GenreDetailPageData, DiscoveryDetailPageData,
   SearchResultPageData, HotRecommendData, RecommendResp,
   ScreeningListResp, ScreeningTheaterResp).

   Lo que NO se replica (decisión del plan maestro): cuentas/login en la
   nube, telemetría con datos personales, deportes e IA (fases futuras o
   fuera de alcance). AniMax es app privada sin anuncios.

   Cómo se monta: index.js construye un ctx con el motor v3 (búsqueda,
   episodios, resolutor, rankings, adblock) y llama a este módulo con
   cada petición /api/v1/* y /api/report*.
   ═════════════════════════════════════════════════════════════════════ */

const feedback = require('./feedback');
/* v7.0 (H4): dominios propios del Hub del dueño (animax-hub-domains.json,
   patrón mtime-cache como sections-config). Requerido directo como
   feedback.js — el mismo módulo lo consume index.js para el watchdog. */
const hubDomains = require('./hub-domains');
const { penaltyTotalOf, statsOf } = feedback;
const enrich = require('./enrich');   // v4.0 (Fase 4): Jikan (MAL) + TMDB opcional
const fs = require('fs');            // v4.0 (Fase 9): sections-config.json
const pathMod = require('path');     // v4.0 (Fase 7): sniffer-script.js
const vm = require('vm');            // v7.0 (H3): sandbox del analizador remoto

/* ── Tipos de recurso (ResourceType del APK) ─────────────────────────
   movie · drama · comic · short (· sport se omite).                      */
const RESOURCE_TYPES = {
  movie: { nombre: 'Película', streamName: 'Películas', formatos: ['MOVIE'], anilistSort: 'POPULARITY_DESC' },
  drama: { nombre: 'Serie', streamName: 'Series', formatos: ['TV', 'TV_SHORT'], anilistSort: 'POPULARITY_DESC' },
  comic: { nombre: 'Anime', streamName: 'Anime', formatos: null, anilistSort: 'TRENDING_DESC' },
  short: { nombre: 'Minidrama', streamName: 'Minidramas', formatos: ['ONA'], anilistSort: 'POPULARITY_DESC' }
};

/* Tab de home por defecto: el primero que ve el usuario (Seekee devuelve
   sus pestañas del home; las nuestras equivalen a las 4 del ranking). */
const NAV_BAR = [
  { labelName: 'Anime', labelCode: 'comic' },
  { labelName: 'Series', labelCode: 'drama' },
  { labelName: 'Películas', labelCode: 'movie' },
  { labelName: 'Minidramas', labelCode: 'short' }
];

/* Géneros (FilterItem): código AniList + nombre en español. */
const GENEROS = [
  { genreCode: 'Action', genreName: 'Acción' },
  { genreCode: 'Adventure', genreName: 'Aventura' },
  { genreCode: 'Comedy', genreName: 'Comedia' },
  { genreCode: 'Drama', genreName: 'Drama' },
  { genreCode: 'Fantasy', genreName: 'Fantasía' },
  { genreCode: 'Horror', genreName: 'Terror' },
  { genreCode: 'Mecha', genreName: 'Mecha' },
  { genreCode: 'Music', genreName: 'Música' },
  { genreCode: 'Mystery', genreName: 'Misterio' },
  { genreCode: 'Psychological', genreName: 'Psicológico' },
  { genreCode: 'Romance', genreName: 'Romance' },
  { genreCode: 'Sci-Fi', genreName: 'Ciencia ficción' },
  { genreCode: 'Slice of Life', genreName: 'Recuento de la vida' },
  { genreCode: 'Sports', genreName: 'Deportes' },
  { genreCode: 'Supernatural', genreName: 'Sobrenatural' },
  { genreCode: 'Thriller', genreName: 'Suspenso' }
];

/* Orden (SortItem): igual espíritu que orderTypes de Seekee. */
const ORDER_TYPES = [
  { orderType: 'trending', orderTypeName: 'Tendencia' },
  { orderType: 'newest', orderTypeName: 'Más recientes' },
  { orderType: 'rating', orderTypeName: 'Mejor valorados' },
  { orderType: 'popularity', orderTypeName: 'Popularidad' }
];
const ORDER_TO_SORT = {
  trending: 'TRENDING_DESC', newest: 'START_DATE_DESC',
  rating: 'SCORE_DESC', popularity: 'POPULARITY_DESC'
};

/* Etiquetas de idioma (LanguageLabelData) — prioridad Latino > Castellano > Sub. */
const LANG_META = {
  latino: { labelCode: 'latino', labelName: 'Latino', countryFlagCode: 'mx' },
  castellano: { labelCode: 'castellano', labelName: 'Castellano', countryFlagCode: 'es' },
  sub: { labelCode: 'sub', labelName: 'Subtitulado', countryFlagCode: 'jp' }
};

/* Farmacias de players conocidas (para tv/configuration/subtitles). */
const FARM_DOMAINS = [
  'filemoon.sx', 'streamtape.com', 'dood.to', 'dood.wf', 'doodstream.com',
  'mixdrop.co', 'mixdrop.to', 'ok.ru', 'streamsb.net', 'vidmoly.to',
  'megacloud.tv', 'playersb.cc', 'embtaku.pro', 'streamwish.to'
];

/* ══════════════════════════════════════════════════════════════════
   REPUTACIÓN DE FUENTES (feedback ✗/✓ estilo Seekee) — v4.0 (Fase 3)
   El almacén vive en ./feedback.js (requerido arriba), compartido con
   el motor v3: groupOptions lo usa para ordenar y resolveStream/
   buildOptions escriben AUTO-REPORTES. penaltyTotalOf ordena resultados
   y sourceList; statsOf alimenta la pantalla "Estado de fuentes".
   ══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   SCRIPT SNIFFER (ResourceAnalysisScript.js de Seekee, versión propia)
   La app lo descarga del servidor (querySettings → detailJsScriptUrl)
   y lo inyecta en las webs del navegador interno. Detecta .m3u8/.mp4/
   iframes de players EN VIVO y avisa al puente nativo.
   v4.0 (Fase 1): versión funcional básica — la Fase 7 la amplía.
   ══════════════════════════════════════════════════════════════════ */
const SNIFFER_JS = `(function () {
  'use strict';
  /* AniMax ResourceAnalysisScript v4.0 (Fase 1) — espejo del sniffer de
     Seekee: detecta recursos de video y avisa al puente nativo. */
  if (window.__animaxSniffer) return;
  window.__animaxSniffer = true;

  var PLAYER_RE = /(?:filemoon|streamtape|dood|mixdrop|ok\\.ru|streamsb|vidmoly|megacloud|streamwish|embtaku|playersb|mp4upload|streamplay)|\\.m3u8|\\.mp4|\\/embed/i;
  var VIDEO_RE = /\\.(m3u8|mp4|mkv|webm)(\\?|#|$)/i;
  var seen = {};
  var bridge = function () {
    try { return window.AnimaxResourceAnalysis || window.ResourceAnalysis; }
    catch (e) { return null; }
  };
  function report(url, kind) {
    if (!url || seen[url]) return;
    seen[url] = true;
    try {
      var b = bridge();
      if (b && b.resourceAnalysisCallback) {
        b.resourceAnalysisCallback(JSON.stringify({ url: url, kind: kind, ts: Date.now() }));
      } else if (window.console && console.log) {
        console.log('[animax] video detectado (' + kind + '): ' + url);
      }
    } catch (e) { /* nunca romper la página */ }
  }
  function scanDom() {
    try {
      var els = document.querySelectorAll('video source, iframe[src], embed[src]');
      for (var i = 0; i < els.length; i++) {
        var s = els[i].src || '';
        if (s && (VIDEO_RE.test(s) || PLAYER_RE.test(s))) {
          report(s, VIDEO_RE.test(s) ? 'video' : 'player');
        }
      }
    } catch (e) {}
  }
  /* 1. Interceptar XMLHttpRequest */
  try {
    var xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      if (typeof u === 'string' && VIDEO_RE.test(u)) report(u, 'video');
      return xo.apply(this, arguments);
    };
  } catch (e) {}
  /* 2. Interceptar fetch */
  try {
    var ff = window.fetch;
    if (ff) window.fetch = function (input) {
      try {
        var u = (input && input.url) || String(input);
        if (u && VIDEO_RE.test(u)) report(u, 'video');
      } catch (e) {}
      return ff.apply(this, arguments);
    };
  } catch (e) {}
  /* 3. Escanear el DOM al cargar y ante cambios (players perezosos) */
  if (document.readyState !== 'loading') scanDom();
  else document.addEventListener('DOMContentLoaded', scanDom);
  window.addEventListener('load', scanDom);
  try {
    var mo = new MutationObserver(function () { scanDom(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { mo.disconnect(); }, 30000);
  } catch (e) {}
  /* 4. Recursos de red ya descargados (performance) */
  try {
    var ping = setInterval(function () {
      try {
        var rs = performance.getEntriesByType('resource') || [];
        for (var i = 0; i < rs.length; i++) {
          var n = rs[i].name || '';
          if (VIDEO_RE.test(n)) report(n, 'video');
        }
      } catch (e) {}
    }, 2500);
    setTimeout(function () { clearInterval(ping); }, 30000);
  } catch (e) {}
  /* 5. Aviso de estado al nativo (webStateChangeCallback espejo) */
  try {
    var b = bridge();
    if (b && b.webStateChangeCallback) {
      b.webStateChangeCallback(JSON.stringify({ state: 'injected', url: location.href, ts: Date.now() }));
    }
  } catch (e) {}
})();`;

/* ══════════════════════════════════════════════════════════════════
   HELPERS DE MAPEO AniList → BEANS DE SEEKEE
   ══════════════════════════════════════════════════════════════════ */

const AL_FIELDS = `
  id
  title { romaji english native }
  synonyms
  coverImage { extraLarge large }
  bannerImage
  startDate { year month day }
  endDate { year }
  format
  episodes
  duration
  isAdult
  averageScore
  popularity
  genres
  countryOfOrigin
  description(asHtml: false)
`;

function alMap(m) {
  if (!m || !m.title) return null;
  const t = (m.title.english || m.title.romaji || '').trim();
  if (!t) return null;
  return {
    id: m.id,
    title: t,
    alt: [m.title.romaji, m.title.native, ...(m.synonyms || [])].filter(Boolean),
    image: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large)) || '',
    banner: m.bannerImage || '',
    year: (m.startDate && m.startDate.year) || 0,
    endYear: (m.endDate && m.endDate.year) || 0,
    format: m.format || '',
    episodes: m.episodes || 0,
    duration: m.duration || 0,
    rated: m.isAdult ? 'TV-MA' : 'TV-14',
    genres: m.genres || [],
    score: m.averageScore ? Math.round(m.averageScore) / 10 : 0,
    popularity: m.popularity || 0,
    country: m.countryOfOrigin || 'JP',
    synopsis: String(m.description || '').replace(/<[^>]*>/g, '').slice(0, 300)
  };
}

/** meta → TheaterCover (ficha de "teatro" del filmCenter). */
function toTheater(meta, streamCode) {
  const rt = RESOURCE_TYPES[streamCode] || RESOURCE_TYPES.comic;
  const fmtDur = meta.duration ? meta.duration + 'm' : '';
  return {
    filmId: String(meta.id),
    title: meta.title,
    cover: meta.image,
    genre: (meta.genres || []).slice(0, 3).map(g => esGenero(g)).join(', '),
    info: meta.synopsis ? meta.synopsis.slice(0, 120) + '…' : '',
    rating: String(meta.score || ''),
    eps: meta.episodes ? String(meta.episodes) : '',
    time: fmtDur,
    year: String(meta.year || ''),
    pg: meta.rated,
    languageCode: 'es',
    languageNames: 'Latino',
    type: streamCode === 'comic' ? 'comic' : streamCode,
    _extras: { alt: meta.alt, banner: meta.banner, country: meta.country, endYear: meta.endYear }
  };
}

/** meta → AlbumData (tarjeta del home server-driven). v7.0 (H5): cada
 *  tarjeta lleva `_meta.source` con su origen (anilist|tmdb|jikan|local). */
function toAlbum(meta, streamCode) {
  const cover = toTheater(meta, streamCode);
  return {
    title: meta.title,
    cover: meta.image,
    type: streamCode,
    genre: cover.genre,
    info: cover.info,
    rating: cover.rating,
    eps: cover.eps,
    time: cover.time,
    year: cover.year,
    pg: meta.rated,
    integrationId: Number(meta.id) || 0,
    _meta: { source: meta._src || 'local' }
  };
}

function esGenero(code) {
  const g = GENEROS.find(x => x.genreCode === code);
  return g ? g.genreName : code;
}

function streamCodeOf(v) {
  const s = String(v || '').toLowerCase().trim();
  if (RESOURCE_TYPES[s]) return s;
  if (/pel[ií]cul|movie|film/.test(s)) return 'movie';
  if (/serie|drama|tv/.test(s)) return 'drama';
  if (/anime|comic/.test(s)) return 'comic';
  if (/mini|short|dorama/.test(s)) return 'short';
  return 'comic';
}

/* ══════════════════════════════════════════════════════════════════
   FÁBRICA DE LA CAPA v4
   ══════════════════════════════════════════════════════════════════ */
module.exports = function createV4Api(ctx) {
  const {
    json, readBody, cacheGet, cacheSet, TTL,
    allSitesConfig, siteHealth, siteIsUsable, hostOf,
    hotTab, buildOptions, metaSearch, metaMatch,
    anilistQuery, buildAdblockList, buildAdblockHideList, VERSION, request, absolutize, stripTags, RE, // buildAdblockHideList: v4.0 (Fase 6)
    normalizeTitle, titleRank, heatFor,   // v4.0 (Fase 3): motor de búsqueda v2
    watchdog,   // v4.0 (Fase 2) — puede faltar en despliegues antiguos
    /* v6.0 (G2) · proveedores reales + resolutores (pueden faltar en
       despliegues viejos → guard con ctx.providers &&) */
    buildEpisodes, providers, resolveStream, deepResolveFarm, quickValidate
  } = ctx;

  // FASE D0.5: se expone seekeeSearch en el ctx compartido para las
  // PÁGINAS PROPIAS del hub (hub.js /hub?q=… reutiliza el motor agregado
  // sin duplicar nada). Declaración de función → hoisted, vale aquí.
  ctx.seekeeSearch = seekeeSearch;
  /* v7.0 (H2) · HUB 2.0: el portal propio (/hub) consume las MISMAS
     fuentes que la API de la app (filmCenter + AniList) — una sola
     puerta de datos, cero duplicación. hub.js las llama con guard
     (NUNCA lanza: si una falla, la sección desaparece). */
  ctx.hubPortal = {
    homeSections, streamTypes, theaterPage, popularGenres,
    genreFilms, filmDetail, screeningList, catalogPage, filmCenterHomepage
  };

  TTL.v4 = 30 * 60 * 1000;          // catálogo (home/filmCenter)
  TTL.v4genres = 6 * 60 * 60 * 1000; // géneros: casi estáticos

  /* ── AniList paginado con filtros (filmCenter/subPage/screening) ── */
  async function alPage(opts) {
    const {
      page = 1, perPage = 20, formats = null, genre = null,
      sort = 'TRENDING_DESC', year = null, country = null, search = null
    } = opts || {};
    const vars = { p: page, s: perPage, sort };
    if (formats) vars.f = formats;
    if (genre) vars.g = genre;
    if (year) vars.y = year;
    if (country) vars.c = country;
    if (search) vars.q = search;
    const q = `query ($p:Int,$s:Int,$f:[MediaFormat],$g:String,$sort:[MediaSort],$y:Int,$c:CountryCode,$q:String) {
      Page(page:$p, perPage:$s) {
        pageInfo { currentPage lastPage hasNextPage total }
        media(type: ANIME, isAdult:false, format_in:$f, genre:$g, sort:$sort, seasonYear:$y, countryOfOrigin:$c, search:$q) { ${AL_FIELDS} }
      }
    }`;
    const data = await anilistQuery(q, vars);
    const pg = data && data.data && data.data.Page;
    if (!pg) return { list: [], lastPage: 1, total: 0 };
    return {
      list: (pg.media || []).map(alMap).filter(Boolean),
      lastPage: (pg.pageInfo && pg.pageInfo.lastPage) || 1,
      total: (pg.pageInfo && pg.pageInfo.total) || 0
    };
  }

  /* ── Catálogo unificado (FASE 4) ─────────────────────────────────────
     UNA sola puerta para TODO el filmCenter: paginación + filtros
     (género / orden / año / región). Decide la fuente por pestaña:
       · movie/drama → TMDB si hay ANIMAX_TMDB_KEY (cine y series de
         acción real, igual que el filmCenter de Seekee), si no AniList.
       · comic/short → AniList (anime ONA/TV/película) como siempre.
     Devuelve { list, lastPage, total, source } en la forma de alMap. */
  async function catalogPage(opts) {
    const {
      code = 'comic', genre = null, orderType = null,
      page = 1, pageSize = 20, year = null, area = null, search = null
    } = opts || {};
    const rt = RESOURCE_TYPES[code] || RESOURCE_TYPES.comic;

    // TMDB: solo Películas/Series y solo con key (nunca fija en el código).
    if (enrich.tmdbEnabled() && (code === 'movie' || code === 'drama')) {
      const r = await enrich.tmdbDiscover(code === 'movie' ? 'movie' : 'tv', {
        page, perPage: pageSize, genre, year,
        sort: orderType || 'trending', country: area
      });
      // el discover de TMDB no devuelve géneros por entrada: si el grid
      // está FILTRADO por género, lo reflejamos en cada tarjeta.
      if (genre && genre !== 'all') {
        for (const m of r.list) if (!m.genres.length) m.genres = [genre];
      }
      if (r.list.length || page > 1) return { ...r, source: 'tmdb' };
      // TMDB vacío (género raro/fallo) → cae a AniList, nunca pantalla vacía
    }

    const r = await alPage({
      page, perPage: pageSize, formats: rt.formatos, genre,
      sort: ORDER_TO_SORT[orderType] || rt.anilistSort,
      year, country: area, search
    });
    return { ...r, source: 'anilist' };
  }

  /** Ficha AniList por id (para film/detail). */
  async function alById(id) {
    const q = `query ($id: Int) { Media(id: $id, type: ANIME) { ${AL_FIELDS} } }`;
    const data = await anilistQuery(q, { id: Number(id) });
    const m = data && data.data && data.data.Media;
    return m ? alMap(m) : null;
  }

  /* AniList sort → orderType (para reutilizar SECTION_DEFS). */
  const SORT_TO_ORDER = {
    TRENDING_DESC: 'trending', POPULARITY_DESC: 'popularity',
    SCORE_DESC: 'rating', START_DATE_DESC: 'newest'
  };

  /* ── HOME server-driven ───────────────────────────────────────────
     getSectionContentByPage({labelCode, page, pageSize}) → TabPageData.
     Cada tab produce hasta 3 secciones SINGLE_ALBUM (tendencias, mejor
     valoradas, recientes) con paginación por sección.
     v4.0 (Fase 4): pasa por catalogPage → con TMDB activo, las pestañas
     Películas/Series del home traen CINE Y SERIES REALES.               */
  const SECTION_DEFS = {
    comic: [
      { sectionName: 'Tendencias ahora', sort: 'TRENDING_DESC' },
      { sectionName: 'Los más populares', sort: 'POPULARITY_DESC' },
      { sectionName: 'Mejor valorados', sort: 'SCORE_DESC' }
    ],
    drama: [
      { sectionName: 'Series del momento', sort: 'TRENDING_DESC' },
      { sectionName: 'Mejor valoradas', sort: 'SCORE_DESC' },
      { sectionName: 'Estrenos recientes', sort: 'START_DATE_DESC' }
    ],
    movie: [
      { sectionName: 'Películas del momento', sort: 'TRENDING_DESC' },
      { sectionName: 'Mejor valoradas', sort: 'SCORE_DESC' },
      { sectionName: 'Estrenos recientes', sort: 'START_DATE_DESC' }
    ],
    short: [
      { sectionName: 'Minidramas populares', sort: 'POPULARITY_DESC' },
      { sectionName: 'Mejor valorados', sort: 'SCORE_DESC' }
    ]
  };

  /* ── v4.0 (Fase 9): HOME server-driven desde sections-config.json ──
     El archivo lo edita el panel de administración (POST /api/v1/config/
     sections): cambiar el servidor cambia el home de TODAS las apps sin
     publicar APK. Caché por mtime; archivo ausente o corrupto → las
     definiciones fijas de SECTION_DEFS (el home NUNCA se rompe).        */
  const SECTIONS_FILE = pathMod.join(__dirname, 'sections-config.json');
  const SNIFFER_FILE = pathMod.join(__dirname, 'sniffer-script.js');
  /* v7.0 (H3): hermano del sniffer — analizador de páginas remoto. */
  const ANALYZER_FILE = pathMod.join(__dirname, 'analyzer-script.js');
  /* v7.0 (H5) · SECCIONES NUEVAS DEL HOME DE PLATAFORMA (server-driven):
     SEASON_NOW    — «Estrenos de temporada» (AniList GraphQL SeasonNow,
                     caché en memoria 45 min, SIN API key).
     TRENDING_NOW  — «Tendencias ahora» (AniList trending fusionado con lo
                     que ya sirve el catálogo del tab).
     GENRE_ROW     — «Por género» paramétrica (campo `genre` del JSON).
     MY_LIST       — «Mi lista» de feed LOCAL (la app la llena con su
                     BD de favoritos — igual que CONTINUE con el historial).
     Rankings G8 ya viven como RANK_LIST (siguen intactos). */
  const SECTION_STYLES = ['BANNER', 'CONTINUE', 'SINGLE_ALBUM', 'RANK_LIST', 'MULTIPLE_ALBUM',
    'SEASON_NOW', 'TRENDING_NOW', 'GENRE_ROW', 'MY_LIST'];
  /* Feed LOCAL: el server DECLARA la sección (localFeed:true) y la APP
     la llena desde su store (historial / MyList) — nunca va por red. */
  const LOCAL_FEED_STYLES = ['CONTINUE', 'MY_LIST'];
  const CFG_SORTS = ['trending', 'popularity', 'rating', 'newest'];
  let cfgCache = { mtime: 0, data: null };

  /** Config normalizada: { tab: [{id, sectionName, style, sort, genre,
      localFeed}] }. H5: acepta `genre` (GENRE_ROW) y marca localFeed. */
  function sectionsConfig() {
    try {
      const st = fs.statSync(SECTIONS_FILE);
      if (cfgCache.data && st.mtimeMs === cfgCache.mtime) return cfgCache.data;
      const raw = JSON.parse(fs.readFileSync(SECTIONS_FILE, 'utf8'));
      const tabs = raw && raw.tabs;
      if (!tabs || typeof tabs !== 'object') throw new Error('sin tabs');
      const clean = {};
      for (const [code, list] of Object.entries(tabs)) {
        if (!Array.isArray(list)) continue;
        const defs = list
          .filter(s => s && s.name && SECTION_STYLES.includes(s.style))
          .map((s, i) => ({
            id: Number(s.id) || (i + 1),
            sectionName: String(s.name),
            style: s.style,
            sort: CFG_SORTS.includes(s.sort) ? s.sort : 'trending',
            // v7.0 (H5): género paramétrico (GENRE_ROW) + feed local
            genre: typeof s.genre === 'string' && s.genre.trim()
              ? s.genre.trim().slice(0, 40) : '',
            localFeed: LOCAL_FEED_STYLES.includes(s.style) || s.localFeed === true
          }));
        if (defs.length) clean[code] = defs;
      }
      if (!Object.keys(clean).length) throw new Error('config vacía');
      cfgCache = { mtime: st.mtimeMs, data: clean };
      return clean;
    } catch (e) {
      /* Fallback: equivalentes fijos a la config por defecto. */
      const fb = {};
      for (const [code, defs] of Object.entries(SECTION_DEFS)) {
        fb[code] = defs.map((d, i) => ({ id: i + 1, sectionName: d.sectionName, style: 'SINGLE_ALBUM', sort: SORT_TO_ORDER[d.sort] || 'trending', genre: '', localFeed: false }));
      }
      return fb;
    }
  }

  /** Elementos de una sección (catálogo por orderType). Lista vacía NO se
      cachea (la CONTINUE vacía se oculta en la app). v7.0 (H5): cada
      tarjeta lleva `_meta.source` (anilist|tmdb|jikan|local). */
  async function sectionItems(code, def, page, size) {
    const key = 'v4:sec2:' + code + ':' + def.id + ':' + def.sort + ':' + page + ':' + size
      + (enrich.tmdbEnabled() ? ':tmdb' : '');
    let items = cacheGet(key, TTL.v4);
    if (!items) {
      const r = await catalogPage({ code, page, pageSize: size, orderType: def.sort });
      items = r.list.map(m => toAlbum(withSource(m, r.source), code));
      if (!items.length) return items;
      cacheSet(key, items);
    }
    return items;
  }

  /* ── v7.0 (H5) · ESTRENOS DE TEMPORADA + TENDENCIAS (AniList) ─────
     Consulta pública graphql.anilist.co (SeasonNow) con CACHÉ EN MEMORIA
     de 45 min y SIN API key (regla 2 del plan). NUNCA lanza: fallo → []
     honesto y la sección se omite del home (fallback honesto del plan). */
  const SEASON_TTL = 45 * 60 * 1000;   // 45 min (plan H5: 30–60 min)
  let seasonCache = { t: 0, list: null };

  function anilistSeasonOf(d) {
    const m = d.getUTCMonth();
    return m < 3 ? 'WINTER' : m < 6 ? 'SPRING' : m < 9 ? 'SUMMER' : 'FALL';
  }

  /** AniList SeasonNow → metas con `_src:"anilist"` (caché 45 min). */
  async function alSeasonNow() {
    if (seasonCache.list && Date.now() - seasonCache.t < SEASON_TTL) {
      return seasonCache.list;
    }
    try {
      const y = new Date().getUTCFullYear();
      const q = 'query ($s: MediaSeason, $y: Int) { Page(perPage: 24) { ' +
        'media(type: ANIME, season: $s, seasonYear: $y, isAdult: false, ' +
        'sort: POPULARITY_DESC) { ' + AL_FIELDS + ' } } }';
      const data = await anilistQuery(q, { s: anilistSeasonOf(new Date()), y });
      const raw = (data && data.data && data.data.Page && data.data.Page.media) || [];
      const list = raw.map(alMap).filter(Boolean).map(m => ({ ...m, _src: 'anilist' }));
      if (list.length) seasonCache = { t: Date.now(), list };   // fallo → sin caché negativa larga
      return list;
    } catch (e) {
      return seasonCache.list || [];   // fuente caída → lo último bueno o []
    }
  }

  /** Estampa la fuente de origen en el metadato (para `_meta` de tarjeta). */
  function withSource(meta, source) {
    return { ...meta, _src: meta._src || source || 'anilist' };
  }

  /** Enriquecimiento JIKAN opcional (sin keys, caché propio de enrich.js):
      sinopsis larga para las primeras N tarjetas. Best-effort con carrera
      contra timeout: si Jikan no responde, la tarjeta queda igual (fuente
      anilist) — NUNCA lanza ni cuelga el home. */
  async function enrichWithJikan(list, max) {
    try {
      const top = (list || []).slice(0, max || 3);
      await Promise.all(top.map(async (m) => {
        try {
          const j = await Promise.race([
            enrich.jikanByTitle(m.title),
            new Promise(r => setTimeout(() => r(null), 6000))
          ]);
          if (j) {
            if (j.synopsis && String(j.synopsis).length > String(m.synopsis || '').length) {
              m.synopsis = String(j.synopsis).slice(0, 300);
            }
            m._src = 'jikan';   // la tarjeta fue enriquecida por MAL
          }
        } catch (e) { /* Jikan caído → tarjeta anilist normal */ }
      }));
    } catch (e) { /* best-effort jamás lanza */ }
    return list || [];
  }

  /** Elementos de las secciones NUEVAS H5 → { items, meta } — NUNCA lanza.
      `meta` describe la fuente para el `_meta` de la sección. */
  async function h5SectionItems(code, def, page, size) {
    const fallback = { items: [], meta: { source: 'local', note: 'fuente no disponible' } };
    try {
      if (def.style === 'SEASON_NOW') {
        if (page > 1) return fallback;          // la temporada es de una página
        const list = await alSeasonNow();
        await enrichWithJikan(list, 3);         // opcional, sin keys, con fallback
        return {
          items: list.slice(0, size).map(m => toAlbum(m, code)),
          meta: { source: 'anilist', note: 'AniList ' + anilistSeasonOf(new Date()) + ' ' + new Date().getUTCFullYear() }
        };
      }
      if (def.style === 'TRENDING_NOW') {
        if (page > 1) return fallback;
        // AniList trending FUSIONADO con lo que ya sirve el tab (plan H5):
        const [cur, al] = await Promise.all([
          catalogPage({ code, page: 1, pageSize: size, orderType: 'trending' }).catch(() => ({ list: [], source: 'local' })),
          alPage({ page: 1, perPage: size, sort: 'TRENDING_DESC' }).catch(() => ({ list: [] }))
        ]);
        const seen = new Set();
        const merged = [];
        for (const m of [...cur.list.map(x => ({ ...x, _src: cur.source || 'anilist' })),
                         ...al.list.map(x => ({ ...x, _src: 'anilist' }))]) {
          const k = normalizeTitleV2(m.title);
          if (!k || seen.has(k)) continue;
          seen.add(k);
          merged.push(m);
          if (merged.length >= size) break;
        }
        return { items: merged.map(m => toAlbum(m, code)), meta: { source: 'anilist+catalogo' } };
      }
      if (def.style === 'GENRE_ROW') {
        // Paramétrica por género (campo `genre` del JSON del dueño):
        const r = await catalogPage({
          code, page, pageSize: size, orderType: def.sort,
          genre: def.genre || null
        });
        return {
          items: r.list.map(m => toAlbum(withSource(m, r.source), code)),
          meta: { source: r.source || 'anilist', genre: def.genre || '' }
        };
      }
    } catch (e) {
      return fallback;   // NUNCA lanza: sección omitida por el builder
    }
    return null;         // estilo no-H5 → el builder usa sectionItems
  }

  async function homeSections(labelCode, page, pageSize) {
    const code = streamCodeOf(labelCode);
    const cfg = sectionsConfig();
    const defs = cfg[code] || cfg.comic || Object.values(cfg)[0] || [];
    const size = Math.min(Math.max(pageSize || 20, 6), 30);
    /* v4.0 (Fase 23): las secciones se calculan EN PARALELO — en frío el
       home pasaba de 12 s (6 secciones × AniList en serie) a ~2 s. La
       lista vacía (CONTINUE) se resuelve sin ir a la red.
       v7.0 (H5): las secciones NUEVAS pasan por h5SectionItems (AniList
       temporada/tendencias, género paramétrico, feeds locales) y las de
       fuente externa que quedan VACÍAS se OMITEN — fallback honesto del
       plan (la sección desaparece, jamás un error en pantalla). */
    const listas = await Promise.all(defs.map(def => {
      if (def.localFeed) {
        return Promise.resolve({ items: [], meta: { source: 'local', localFeed: true } });
      }
      return h5SectionItems(code, def, page, size).then(async res =>
        res || {
          /* H5 · CORREGIDO: `await` — sin él `items` era una PROMESA
             (sin .length) y el builder omitía TODAS las secciones
             clásicas (RANK_LIST/SINGLE_ALBUM/BANNER/MULTIPLE_ALBUM).
             El fallo lo cacha el .catch de abajo → omisión honesta. */
          items: def.style === 'CONTINUE' ? [] : await sectionItems(code, def, page, size),
          meta: { source: 'catalogo' }
        })
        .catch(() => ({ items: [], meta: { source: 'local', note: 'fuente no disponible' } }));
    }));
    const content = [];
    defs.forEach((def, i) => {
      const { items, meta } = listas[i] || { items: [], meta: {} };
      const local = def.localFeed === true || LOCAL_FEED_STYLES.includes(def.style);
      /* H5 · fallback honesto: sección de fuente externa vacía → omitida. */
      if (!items.length && !local) return;
      content.push({
        sectionId: def.id,
        sectionName: def.sectionName,
        sectionStyle: def.style,
        // v7.0 (H5): feed LOCAL declarado (la app lo llena de su store:
        // CONTINUE → historial, MY_LIST → favoritos). Campo ADITIVO: los
        // clientes viejos lo ignoran y siguen pintando la lista vacía.
        localFeed: local,
        singleAlbumList: def.style === 'MULTIPLE_ALBUM' ? [] : items,
        multipleAlbumList: def.style === 'MULTIPLE_ALBUM' ? items : [],
        /* v6.0 (G8) · paridad SearchLeaderBoard (FORENSE-G8): cada entrada
           del ranking lleva viewCount — calor determinista por día del
           título en esa posición (heatFor ya usado por search/hot). La app
           lo pinta «🔥 12.3K» y distingue el top-3. */
        rankList: def.style === 'RANK_LIST'
          ? items.slice(0, 10).map((album, idx) => ({
              rank: idx + 1,
              album,
              viewCount: heatFor(album.title || `#${idx + 1}`, idx)
            }))
          : [],
        // v7.0 (H5): `_meta` de la SECCIÓN (fuente + nota) — aditivo.
        _meta: { source: meta.source || 'local', ...(meta.note ? { note: meta.note } : {}), ...(meta.genre ? { genre: meta.genre } : {}) }
      });
    });
    return {
      content,
      isLast: page >= 3,          // 3 páginas de fondo en caché
      page,
      pageSize: pageSize || 20,
      totalElements: content.reduce(
        (n, s) => n + s.singleAlbumList.length + s.multipleAlbumList.length, 0),
      // v7.0 (H5): metadatos del home (fuente de config + cuenta).
      _meta: {
        config: 'sections-config.json',
        secciones: content.length,
        feedsLocales: content.filter(s => s.localFeed).map(s => s.sectionStyle),
        temporada: anilistSeasonOf(new Date()) + ' ' + new Date().getUTCFullYear()
      }
    };
  }

  /** getSingle/getMultipleAlbumDetail: {titles:[..], type} → AlbumData[] */
  async function albumDetail(titles, type) {
    const code = streamCodeOf(type || 'comic');
    const out = [];
    for (const raw of (titles || []).slice(0, 12)) {
      const t = String(raw || '').trim();
      if (!t) continue;
      const key = 'v4:album:' + t.toLowerCase();
      let meta = cacheGet(key, TTL.v4);
      if (!meta) {
        const list = await metaSearch(t);
        meta = (list && list[0]) || null;
        if (meta) cacheSet(key, meta);
      }
      if (meta) out.push(toAlbum(meta, code));
    }
    return out;
  }

  /* ── FILMCENTER ─────────────────────────────────────────────────── */

  /* Descripciones de "teatro" (cabecera de cada pestaña, estilo Seekee). */
  const THEATER_DESC = {
    movie: 'Cartelera y clásicos: el cine del momento, de estrenos a taquillazos, en castellano y latino.',
    drama: 'Series completas y de temporada: las producciones que todo el mundo está viendo ahora mismo.',
    comic: 'Anime en emisión y clásicos de culto: la temporada actual, los imprescindibles y las joyas escondidas.',
    short: 'Minidramas y doramas cortos: historias completas, capítulos de minutos, para ver de un tirón.'
  };

  /** Héroe de página (teatro/género): TheaterCover + sinopsis COMPLETA. */
  function heroCard(meta, code) {
    return { ...toTheater(meta, code), synopsis: meta.synopsis || '' };
  }

  /** stream/types CON PORTADAS DE TEATRO (Fase 4): un "teatro" por
   *  pestaña — portada grande (banner del #1), póster y total de obras.
   *  Contrato nuevo: [{streamName, streamCode, cover, poster, totalFilms}]
   *  + `names` (las cadenas del contrato Fase 1, compatibles). */
  async function streamTypes() {
    const out = [];
    for (const code of ['movie', 'drama', 'comic', 'short']) {
      const key = 'v4:stype:' + code + (enrich.tmdbEnabled() ? ':tmdb' : '');
      let entry = cacheGet(key, TTL.v4);
      if (!entry) {
        const r = await catalogPage({ code, page: 1, pageSize: 1, orderType: 'trending' });
        const top = r.list[0] || null;
        entry = {
          streamName: RESOURCE_TYPES[code].streamName,
          streamCode: code,
          cover: top ? (top.banner || top.image) : '',
          poster: top ? top.image : '',
          totalFilms: r.total || 0
        };
        cacheSet(key, entry);
      }
      out.push(entry);
    }
    return out;
  }

  /** PÁGINA DE TEATRO espejo (Fase 4): cabecera con póster grande +
   *  grid INFINITO (página 1 incluida; el resto llega por film/subPage
   *  con los mismos filtros → sin saltos ni duplicados entre páginas). */
  async function theaterPage(stream, orderType, genre, page, pageSize, year, area) {
    const code = streamCodeOf(stream);
    const rt = RESOURCE_TYPES[code];
    const heroKey = 'v4:theaterhero:' + code + (enrich.tmdbEnabled() ? ':tmdb' : '');
    let hero = cacheGet(heroKey, TTL.v4);
    if (hero === null || hero === undefined) {
      const r = await catalogPage({ code, page: 1, pageSize: 1, orderType: 'trending' });
      hero = r.list[0] || null;
      cacheSet(heroKey, hero);   // null también se cachea: sin héroe la
    }                            // cabecera usa la descripción del teatro
    const grid = await filmSubPage(stream, genre, orderType, page, pageSize, year, area);
    return {
      streamName: rt.streamName,
      streamCode: code,
      cover: hero ? (hero.banner || hero.image) : '',
      background: hero ? hero.image : '',
      heroTitle: hero ? hero.title : '',
      description: THEATER_DESC[code] || '',
      totalFilms: grid.totalElements || 0,
      orderTypeList: ORDER_TYPES,
      genreList: GENEROS,
      filmCardList: grid.content,
      page: grid.page,
      isLast: grid.isLast,
      pageSize: grid.pageSize
    };
  }

  async function filmCenterHomepage() {
    const sections = [];
    // 1) Categorías populares (collectList de GenreCover)
    const popular = await popularGenres();
    sections.push({
      title: 'Categorías populares',
      modularType: 'GENRE',
      resourceType: '',
      origin: 'animax',
      defaultData: false,
      tabList: [],
      collectList: popular,
      filmCardList: []
    });
    // 2) Un "teatro" por tipo de stream (filmCardList de TheaterCover)
    for (const code of ['movie', 'drama', 'comic', 'short']) {
      const rt = RESOURCE_TYPES[code];
      const r = await catalogPage({ code, page: 1, pageSize: 12, orderType: 'trending' });
      if (!r.list.length) continue;
      sections.push({
        title: rt.streamName,
        modularType: 'THEATER',
        resourceType: code,
        origin: 'animax',
        defaultData: false,
        tabList: [rt.streamName],
        collectList: [],
        filmCardList: r.list.map(m => toTheater(m, code))
      });
    }
    return sections;
  }

  async function streamFilms(stream) {
    const code = streamCodeOf(stream);
    const key = 'v4:films:' + code + (enrich.tmdbEnabled() ? ':tmdb' : '');
    let list = cacheGet(key, TTL.v4);
    if (!list) {
      const r = await catalogPage({ code, page: 1, pageSize: 18, orderType: 'trending' });
      list = r.list.map(m => toTheater(m, code));
      cacheSet(key, list);
    }
    return list;
  }

  async function popularGenres() {
    let cached = cacheGet('v4:genres:popular', TTL.v4genres);
    if (cached) return cached;
    /* UNA sola consulta (los 50 más populares) y de ahí se derivan las
       portadas por género: el primer título de cada género. Así no se
       agota el límite de 30 req/min de AniList (v4.0 · Fase 1). */
    const r = await alPage({ page: 1, perPage: 50, sort: 'POPULARITY_DESC' });
    const coverOf = new Map();
    for (const m of r.list) {
      for (const g of (m.genres || [])) {
        if (!coverOf.has(g) && GENEROS.some(x => x.genreCode === g)) coverOf.set(g, m.image);
      }
    }
    const out = GENEROS.slice(0, 12).map(g => ({
      name: g.genreName,
      label: g.genreCode,
      cover: coverOf.get(g.genreCode) || ''
    }));
    cacheSet('v4:genres:popular', out);
    return out;
  }

  /** PÁGINA DE GÉNERO espejo (Fase 4): cabecera con póster grande
   *  (héroe + sinopsis completa), filas top Películas/Series/Anime y
   *  grid infinito vía film/subPage?genre= (contrato GenreDetail). */
  async function genreFilms(genreCode) {
    const g = GENEROS.find(x => x.genreCode.toLowerCase() === String(genreCode || '').toLowerCase())
      || { genreCode: String(genreCode || ''), genreName: String(genreCode || 'Género') };
    const key = 'v4:genrefilms:' + g.genreCode + (enrich.tmdbEnabled() ? ':tmdb' : '');
    let out = cacheGet(key, TTL.v4);
    if (out) return out;
    const [movies, tv, animes] = await Promise.all([
      catalogPage({ code: 'movie', genre: g.genreCode, page: 1, pageSize: 10, orderType: 'popularity' }),
      catalogPage({ code: 'drama', genre: g.genreCode, page: 1, pageSize: 10, orderType: 'popularity' }),
      alPage({ page: 1, perPage: 10, genre: g.genreCode, sort: 'POPULARITY_DESC' })
    ]);
    const hero = movies.list[0] || tv.list[0] || animes.list[0] || null;
    out = {
      collectId: 1,
      name: g.genreName,
      cover: hero ? (hero.banner || hero.image) : '',
      description: 'Lo mejor del género ' + g.genreName + ': películas, series y anime ordenados por popularidad, con estrenos y clásicos.',
      hero: hero ? heroCard(hero, movies.list[0] ? 'movie' : (tv.list[0] ? 'drama' : 'comic')) : null,
      topMovies: {
        title: 'Películas de ' + g.genreName,
        modularType: 'THEATER', resourceType: 'movie', origin: 'animax',
        defaultData: false, tabList: [], collectList: [],
        filmCardList: movies.list.map(m => toTheater(m, 'movie'))
      },
      topTvShows: {
        title: 'Series de ' + g.genreName,
        modularType: 'THEATER', resourceType: 'drama', origin: 'animax',
        defaultData: false, tabList: [], collectList: [],
        filmCardList: tv.list.map(m => toTheater(m, 'drama'))
      },
      topAnimes: {
        title: 'Anime de ' + g.genreName,
        modularType: 'THEATER', resourceType: 'comic', origin: 'animax',
        defaultData: false, tabList: [], collectList: [],
        filmCardList: animes.list.map(m => toTheater(m, 'comic'))
      },
      totalFilms: (movies.total || 0) + (tv.total || 0) + (animes.total || 0),
      // el grid infinito de la página de género sigue por film/subPage
      grid: { genre: g.genreCode, orderTypeList: ORDER_TYPES }
    };
    cacheSet(key, out);
    return out;
  }

  /** film/subPage (Fase 4): paginación infinita del grid de teatro y
   *  de género, ahora con TODOS los filtros de Seekee — género, orden,
   *  AÑO y REGIÓN — y con totalElements + isLast estables (misma
   *  ordenación por página → sin duplicados entre páginas). */
  async function filmSubPage(stream, genre, orderType, page, pageSize, year, area) {
    const code = streamCodeOf(stream);
    const rt = RESOURCE_TYPES[code];
    const g = genre && genre !== 'all' ? genre : null;
    const y = year && year !== 'all' ? Number(year) : null;
    const a = area && area !== 'all' ? String(area).toUpperCase() : null;
    const size = Math.min(Math.max(pageSize || 20, 6), 40);
    const key = 'v4:sub:' + code + ':' + (g || '-') + ':' + (orderType || '-')
      + ':' + (y || '-') + ':' + (a || '-') + ':' + page + ':' + size
      + (enrich.tmdbEnabled() ? ':tmdb' : '');
    let out = cacheGet(key, TTL.v4);
    if (!out) {
      const r = await catalogPage({
        code, genre: g, orderType, page, pageSize: size, year: y, area: a
      });
      out = {
        content: r.list.map(m => toTheater(m, code)),
        isLast: page >= r.lastPage,
        page,
        pageSize: size,
        totalElements: r.total || 0,
        streamName: rt.streamName,
        streamCode: code
      };
      cacheSet(key, out);
    }
    return out;
  }

  /** film/detail (Fase 4): ficha COMPLETA de una obra del catálogo por
   *  filmId (id AniList, o "tmdb-movie-123" si vino de TMDB) o por
   *  título (respaldo). Trae sinopsis larga, géneros en español y una
   *  fila de SIMILARES (mismo género principal, ordenado por popularidad
   *  — la técnica de Seekee para "tal vez te guste"). Con Jikan (MAL):
   *  tráiler de YouTube, estudios y puntuación MAL. Best-effort: si
   *  Jikan no responde, la ficha sale igual (solo sin el extra). */
  async function filmDetail(idOrTitle, stream) {
    const raw = String(idOrTitle || '').trim();
    if (!raw || raw.length < 1) return null;
    const key = 'v4:detail:' + raw.toLowerCase() + ':' + (stream || '')
      + (enrich.tmdbEnabled() ? ':tmdb' : '');
    const cached = cacheGet(key, TTL.v4);
    if (cached !== null && cached !== undefined) return cached;

    let meta = null;
    let code = streamCodeOf(stream);
    // 1) por filmId: tmdb-{movie|tv}-{id} o id numérico AniList
    const tm = /^tmdb-(movie|tv)-(\d+)$/.exec(raw);
    if (tm) {
      meta = await enrich.tmdbDetail(tm[1], Number(tm[2]));
      code = tm[1] === 'movie' ? 'movie' : 'drama';
    } else if (/^\d+$/.test(raw)) {
      meta = await alById(raw);
    }
    // 2) por título (respaldo — la app puede mandar el título tal cual)
    if (!meta && raw.length >= 2) {
      const list = await metaSearch(raw);
      meta = (list && list[0]) || null;
    }
    if (!meta) { cacheSet(key, null); return null; }

    // Similares: mismo género principal, los más populares (sin ella misma)
    const gcode = (meta.genres || [])[0] || null;
    let similar = [];
    if (gcode) {
      const r = await alPage({ page: 1, perPage: 10, genre: gcode, sort: 'POPULARITY_DESC' });
      similar = r.list
        .filter(m => m.title !== meta.title)
        .slice(0, 8)
        .map(m => toTheater(m, code));
    }

    // Jikan (MAL): tráiler + estudios + puntuación — solo animes.
    const jikan = code === 'comic'
      ? await enrich.jikanByTitle(meta.title)
      : null;

    const out = {
      filmId: String(meta.id),
      title: meta.title,
      cover: meta.image,
      banner: meta.banner || '',
      year: meta.year || 0,
      endYear: meta.endYear || 0,
      format: meta.format || '',
      episodes: meta.episodes || 0,
      duration: meta.duration || 0,
      seasons: meta.seasons || 0,
      score: meta.score || 0,
      rated: meta.rated || 'TV-14',
      country: meta.country || '',
      genres: (meta.genres || []).slice(0, 5).map(esGenero),
      // sinopsis LARGA: la de Jikan (700 chars) si hay, si no la del propio
      synopsis: (jikan && jikan.synopsis) || meta.synopsis || '',
      jikan,
      similar
    };
    cacheSet(key, out);
    return out;
  }

  /* ── SCREENING (categorías para navegar) ────────────────────────── */
  function screeningList() {
    const years = [];
    const yNow = new Date().getFullYear();
    for (let y = yNow; y >= yNow - 12; y--) years.push(String(y));
    return [
      {
        id: 1, name: 'Género', screeningType: 'GENRE',
        screeningItems: GENEROS.map((g, i) => ({ id: i + 1, name: g.genreName, params: JSON.stringify({ genre: g.genreCode }) }))
      },
      {
        id: 2, name: 'Año', screeningType: 'YEAR',
        screeningItems: years.map((y, i) => ({ id: i + 1, name: y, params: JSON.stringify({ year: Number(y) }) }))
      },
      {
        id: 3, name: 'Región', screeningType: 'AREA',
        screeningItems: [
          { id: 1, name: 'Japón', params: JSON.stringify({ area: 'JP' }) },
          { id: 2, name: 'Corea', params: JSON.stringify({ area: 'KR' }) },
          { id: 3, name: 'China', params: JSON.stringify({ area: 'CN' }) },
          { id: 4, name: 'Taiwán', params: JSON.stringify({ area: 'TW' }) }
        ]
      },
      {
        id: 4, name: 'Tipo', screeningType: 'TYPE',
        screeningItems: [
          { id: 1, name: 'Película', params: JSON.stringify({ type: 'movie' }) },
          { id: 2, name: 'Serie', params: JSON.stringify({ type: 'drama' }) },
          { id: 3, name: 'Anime', params: JSON.stringify({ type: 'comic' }) },
          { id: 4, name: 'Minidrama', params: JSON.stringify({ type: 'short' }) }
        ]
      }
    ];
  }

  async function categoryList(f) {
    const code = streamCodeOf(f.type || 'comic');
    const r = await catalogPage({
      code,
      page: Math.max(1, Number(f.page) || 1),
      pageSize: Math.min(30, Math.max(6, Number(f.pageSize) || 20)),
      genre: f.genre && f.genre !== 'all' ? f.genre : null,
      orderType: f.orderType || null,
      year: f.year && f.year !== 'all' ? Number(f.year) : null,
      area: f.area && f.area !== 'all' ? f.area : null
    });
    return {
      dataList: r.list.map(m => ({
        cover: m.image,
        title: m.title,
        startYear: m.year || null,
        endYear: m.endYear || null,
        eps: m.episodes || null,
        score: m.score || null,
        time: m.duration ? m.duration + 'm' : '',
        sort: code,
        type: code
      }))
    };
  }

  /* ── BÚSQUEDA v2 (Fase 3 · SearchResultPageData espejo AGREGADO) ──
     Cambio clave respecto a Fase 1: los resultados web ya no van UNO
     por opción, sino AGREGADOS POR TÍTULO — igual que Seekee muestra
     una tarjeta por obra con sus "redes" (websiteLabelList). Cada
     tarjeta trae sourceList: TODAS las fuentes que tienen ese título,
     ordenadas por Latino → Castellano → Sub y, dentro de cada idioma,
     por REPUTACIÓN (feedback ✗/✓ + desempeño de búsqueda). */
  const LANG_PRIORITY = { latino: 0, castellano: 1, sub: 2 };

  /* ── v7.0 (H5) · NORMALIZACIÓN DE TÍTULOS REFORZADA ────────────────
     Sobre la base (normalizeTitle del ctx) añade: ARTÍCULOS iniciales
     (the/la/el/los/las/un/una…), AÑOS «(2024)» en cualquier posición,
     sufijos de idioma «(Sub)/(Lat)/(Dub)/(Cast)», ACENTOS (NFD),
     mayúsculas y PUNTUACIÓN suelta. Solo para la BÚSQUEDA v2 y el home
     H5 (el motor viejo conserva su normalizeTitle — cero regresión). */
  const H5_ARTICLE_RE = /^(the|a|an|la|el|los|las|un|una|unos|unas)\s+/;
  const H5_LANG_TAG_RE = /\((sub|subs|subtitulado|subtitulos|lat|latino|latam|dub|doblado|doblaje|cast|castellano|espanol)\)/g;

  function normalizeTitleV2(t) {
    let s = String(t || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* entornos sin normalize */ }
    s = s.replace(/[|·—–]\s*.*$/, ' ')          // cola «X | ver online»
      .replace(/\((\d{4})\)/g, ' ')              // años (2024)
      .replace(H5_LANG_TAG_RE, ' ')              // (Sub)/(Lat)/(Dub)/(Cast)
      .replace(RE.EP_NUM, ' ')                   // «capitulo 12», «ep 3»…
      /* ruido de webs SOLO como PALABRAS COMPLETAS y de prefijo: el
         «ver» de «Black Clover» y el «online» de «Sword Art Online» son
         parte del título real y JAMÁS se recortan (QA dura H5, casos
         13 y 27). Los prefijos de página «Ver X…» sí se quitan. */
      .replace(/\b(ver|descargar|watch|mira|mirar)\s+/gi, ' ')
      .replace(/[^\w\s]/g, ' ')                  // puntuación suelta
      .replace(/\s+/g, ' ').trim();
    // artículos iniciales (una pasada: «the one piece» → «one piece»)
    let prev = null;
    while (prev !== s) { prev = s; s = s.replace(H5_ARTICLE_RE, ''); }
    return s.trim();
  }

  /** Ranking v2: EXACTO (0) > empieza-por (1) > contiene (2) > nada (3).
      Espejo extendido de titleRank (index.js) — mismo espíritu, más casos. */
  function titleRankV2(tNorm, qNorm) {
    if (!tNorm || !qNorm) return 3;
    if (tNorm === qNorm) return 0;
    if (tNorm.startsWith(qNorm) || qNorm.startsWith(tNorm)) return 1;
    if (tNorm.includes(qNorm) || qNorm.includes(tNorm)) return 2;
    return 3;
  }

  /* ── v7.0 (H5) · TARJETA DE PÁGINA PROPIA DEL HUB AL FRENTE ────────
     Cuando el título consultado existe en el catálogo, la búsqueda lleva
     PRIMERO una tarjeta de la página PROPIA del Hub — el «clear play» de
     Seekee/Loklok en limpio: clearFlag:true + watchFlag:true +
     siteName:"AniMax Hub" + url → /hub/detail?t=… (el formato real de
     hub.js para catálogo). Se construye AQUÍ (título/portada/idiomas) y
     el ROUTE le llena la URL POR PETICIÓN con el host que pide, igual
     que fillHubUrls — y `hub=0` la apaga honestamente. */
  function buildHubCard(meta, query) {
    const langs = Object.keys(LANG_PRIORITY).sort((a, b) => LANG_PRIORITY[a] - LANG_PRIORITY[b])
      .filter(l => l !== 'castellano');   // catálogo: latino + sub (mejor idioma primero)
    return {
      title: meta.title,
      url: '',                          // ← por petición (hubFrontCard)
      cover: meta.image || '',
      description: meta.synopsis || '',
      icon: '',
      siteName: 'AniMax Hub',
      type: 'hub',
      resourceId: 0,
      integrationId: 0,
      score: meta.score || null,
      startYear: meta.year || null,
      endYear: null,
      episodeList: [],
      categoryList: [meta.type || 'TV Serie'],
      labelList: langs.map(l => langLabel(l)),
      websiteLabelList: langs.map(l => langLabel(l)),
      websiteId: 0,
      hubUrl: '',                       // ← por petición (hubFrontCard)
      sourceList: [],
      watchFlag: true,
      clearFlag: true,
      tailCollectList: [],
      _meta: { source: 'local', page: 'hub-detail', langs, query: String(query || '').slice(0, 80) }
    };
  }

  /** Rellena la tarjeta del Hub con el host que pide y la pone AL FRENTE.
      NO muta el caché (copia) y NUNCA lanza. `on=false` (hub=0) → la
      omite; sin host → la omite (honesto: sin URL no hay tarjeta). */
  function hubFrontCard(data, req, on) {
    try {
      const out = { ...data, content: Array.isArray(data.content) ? data.content.slice() : [] };
      delete out._hubCard;                       // campo interno, jamás viaja
      const sk = data && data._hubCard;
      if (on && sk && sk.title) {
        const origin = hubOrigin(req);
        if (origin) {
          const u = origin + '/hub/detail?t=' + encodeURIComponent(sk.title);
          out.content = [{ ...sk, url: u, hubUrl: u, watchFlag: true, clearFlag: true }, ...out.content];
        }
      }
      return out;
    } catch (e) {
      return data;   // jamás romper la búsqueda
    }
  }

  function langLabel(lang) { return LANG_META[lang] || LANG_META.sub; }

  /* ── v7.0 (H2) · HUBURL DEL «CLEAR PLAY» PROPIO ────────────────────
     El server llena `hubUrl` de cada tarjeta de búsqueda con su página
     propia (/hub/detail): para catálogo (ficha por filmId/título) y para
     web (ficha externa ?u= con TODAS las fuentes en src=). Se llena POR
     PETICIÓN — el caché guarda '' porque la URL depende del host que
     pide (localhost, dominio del dueño, mirror…). Al existir página
     propia real, watchFlag + clearFlag pasan a true (honestidad: el
     «clear play» de verdad existe — espejo SearchResultData de Loklok). */
  function hubOrigin(req) {
    try {
      const host = (req && (req.headers['x-forwarded-host'] || req.headers.host)) || '';
      const proto = String((req && req.headers['x-forwarded-proto']) || 'http').split(',')[0].trim();
      if (!host) return '';
      return proto + '://' + host;
    } catch { return ''; }
  }

  /* b64url idéntico al codec (u/n/l/g) de hub.js (encodeSources). */
  function encodeSourcesB64(list) {
    try {
      return Buffer.from(JSON.stringify((list || []).slice(0, 12).map(s => ({
        u: s.url, n: s.siteName, l: s.label,
        g: ['latino', 'castellano', 'sub'].includes(s.lang) ? s.lang : 'sub'
      }))), 'utf8').toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch { return ''; }
  }

  function fillHubUrls(data, req) {
    try {
      if (!data || !Array.isArray(data.content)) return;
      const origin = hubOrigin(req);
      if (!origin) return;
      for (const c of data.content) {
        if (!c || c.hubUrl) continue;
        if (c.type === 'filmCenter' && c.title) {
          c.hubUrl = origin + '/hub/detail?t=' + encodeURIComponent(c.title);
        } else if (c.type === 'web' && c.title && c.url && /^https?:/i.test(c.url)) {
          const b64 = encodeSourcesB64(c.sourceList || []);
          c.hubUrl = origin + '/hub/detail?u=' + encodeURIComponent(c.url) +
            '&t=' + encodeURIComponent(c.title) + (b64 ? '&src=' + b64 : '');
        }
        if (c.hubUrl) { c.watchFlag = true; c.clearFlag = true; }
      }
    } catch { /* nunca lanza */ }
  }

  /** Agrupa las opciones web por TÍTULO normalizado → tarjetas con
   *  TODAS sus fuentes (sourceList) ordenadas idioma+reputación.
   *  v7.0 (H5): normalización REFORZADA (normalizeTitleV2) y ranking
   *  exacto>empieza>contiene con desempate por idioma latino→castellano→sub. */
  function aggregateByTitle(options, query) {
    const qNorm = normalizeTitleV2(query);
    const cards = new Map();   // títuloNormalizado → card
    for (const o of options) {
      if (!o.pageUrl) continue;
      const tNorm = normalizeTitleV2(o.title);
      if (!tNorm) continue;
      let card = cards.get(tNorm);
      if (!card) {
        card = {
          title: o.title, tNorm,
          kind: o.kind || 'anime',
          hitTitle: o.title,
          sources: [],
          meta: o.meta || null,
          rank: titleRankV2(normalizeTitleV2(o.title), qNorm)
        };
        cards.set(tNorm, card);
      }
      // la fuente con mejor metadato/idioma pinta la cabecera de la tarjeta
      if (!card.meta && o.meta) card.meta = o.meta;
      if (o.meta && card.meta && (o.meta.image && !card.meta.image)) card.meta = o.meta;
      card.sources.push({
        url: o.pageUrl,
        host: o.host || hostOf(o.pageUrl),
        lang: o.lang || 'sub',
        langLabel: langLabel(o.lang || 'sub'),
        penalty: penaltyTotalOf(o.host || hostOf(o.pageUrl) || '')
      });
    }
    return [...cards.values()].map(card => {
      // sourceList: idioma (latino manda) → reputación (mejor primero)
      card.sources.sort((a, b) => {
        const la = LANG_PRIORITY[a.lang] ?? 3, lb = LANG_PRIORITY[b.lang] ?? 3;
        if (la !== lb) return la - lb;
        if (a.penalty !== b.penalty) return a.penalty - b.penalty;
        return 0;
      });
      card.best = card.sources[0];
      card.langs = [...new Set(card.sources.map(s => s.lang))]
        .sort((a, b) => (LANG_PRIORITY[a] ?? 3) - (LANG_PRIORITY[b] ?? 3));
      return card;
    }).sort((a, b) => {
      // 1) coincidencia EXACTA del título primero (la serie manda sobre spin-offs)
      if (a.rank !== b.rank) return a.rank - b.rank;
      // 2) prioridad de idioma del mejor source: Latino → Castellano → Sub
      const la = LANG_PRIORITY[a.langs[0]] ?? 3, lb = LANG_PRIORITY[b.langs[0]] ?? 3;
      if (la !== lb) return la - lb;
      // 3) anime antes que otro tipo
      const ka = a.kind === 'anime' ? 0 : 1, kb = b.kind === 'anime' ? 0 : 1;
      if (ka !== kb) return ka - kb;
      // 4) reputación de la mejor fuente
      return (a.best?.penalty || 0) - (b.best?.penalty || 0);
    });
  }

  async function seekeeSearch(keyWord, page, pageSize, type) {
    page = Math.max(1, Number(page) || 1);
    pageSize = Math.min(30, Math.max(6, Number(pageSize) || 20));

    // Contenido de catálogo (filmCenter): metadatos del título.
    const metas = await metaSearch(keyWord);

    // Resultados web: motor multi-fuente (opciones con idioma) y su
    // AGREGACIÓN por título con sourceList (novedad Fase 3).
    let options = [];
    if (page === 1) {
      const built = await buildOptions(keyWord);
      options = built.options || [];
    }
    const cards = aggregateByTitle(options, keyWord);

    const content = [];
    // 1) Tarjetas de catálogo (type: filmCenter).
    if (page === 1) {
      const cardTitles = new Set(cards.map(c => c.tNorm));   // claves V2 (H5)
      for (const m of metas.slice(0, 4)) {
        // no duplicar: si ya hay tarjeta web del mismo título, gana la web
        if (cardTitles.has(normalizeTitleV2(m.title))) continue;
        content.push({
          title: m.title,
          url: '',
          cover: m.image,
          description: m.synopsis || '',
          icon: '',
          siteName: 'AniMax',
          type: 'filmCenter',
          resourceId: 0,
          integrationId: 0,
          score: m.score || null,
          startYear: m.year || null,
          endYear: null,
          episodeList: [],
          categoryList: [m.type || 'TV Serie'],
          // G6 · "Navegador Seekee": idiomas QUE EL CATÁLOGO BUSCA de
          // verdad para este tipo (latino + sub) — la ficha ofrece ambos
          // y los chips del resultado lo reflejan (como los badges
          // SUB/LATINO de los resultados de Seekee).
          labelList: [LANG_META.latino, LANG_META.sub],
          websiteLabelList: [LANG_META.latino, LANG_META.sub],
          websiteId: 0,
          /* v7.0 (H1) · `hubUrl`: URL de la página PROPIA del Hub para este
             título (el «clear play» de Seekee). Vacío hasta H2 — el campo
             ya viaja para que la app lo consuma sin cambio de contrato. */
          hubUrl: '',
          sourceList: [],
          watchFlag: false,
          clearFlag: false,
          tailCollectList: []
        });
      }
    }
    // 2) Tarjetas web AGREGADAS por título (type: web) — paginadas.
    const start = (page - 1) * pageSize;
    for (const card of cards.slice(start, start + pageSize)) {
      const bestLang = card.langs[0] || 'sub';
      const lang = langLabel(bestLang);
      content.push({
        title: card.title,
        url: card.best ? card.best.url : '',
        cover: (card.meta && card.meta.image) || '',
        description: (card.meta && card.meta.synopsis) || (card.best ? card.best.host : ''),
        icon: '',
        siteName: card.best ? card.best.host : '',
        type: 'web',
        resourceId: 0,
        integrationId: 0,
        score: (card.meta && card.meta.score) || null,
        startYear: (card.meta && card.meta.year) || null,
        endYear: null,
        episodeList: [],
        categoryList: [card.kind || 'anime'],
        labelList: [lang],
        // websiteLabelList estilo Seekee: TODOS los idiomas disponibles
        // de ESTE título, en orden de prioridad (Latino primero).
        websiteLabelList: card.langs.map(l => langLabel(l)),
        websiteId: 0,
        hubUrl: '',   // v7.0 (H1): contrato — H2 llena con la página del Hub
        // NOVEDAD Fase 3 · sourceList: todas las fuentes de este título,
        // ordenadas idioma+reputación. La app las ofrece como "redes" y
        // manda el feedback ✗/✓ por URL (re-priorización automática).
        sourceList: card.sources.map(s => ({
          url: s.url,
          siteName: s.host,
          lang: s.lang,
          label: s.langLabel,
          penalty: Number(s.penalty.toFixed(3))
        })),
        sourceCount: card.sources.length,
        watchFlag: false,
        clearFlag: false,
        tailCollectList: []
      });
    }
    const totalWeb = cards.length;
    const total = content.length;

    /* v4.0 (Fase 22-23) · ÚLTIMO RECURSO WEB: si tras el catálogo y las
       fuentes conocidas NO hay NADA, se pregunta a DuckDuckGo (HTML, sin
       API) por "{título} ver online" y se devuelven enlaces genéricos.
       La app los abre en el NAVEGADOR INTERNO, donde el sniffer caza el
       stream → "no disponible" deja de existir mientras exista en la web. */
    if (total === 0 && page === 1) {
      const ddg = await webLastResort(keyWord);
      for (const w of ddg) {
        content.push({
          title: w.title,
          url: w.url,
          cover: '',
          description: w.host,
          icon: '',
          siteName: w.host,
          type: 'web',
          resourceId: 0, integrationId: 0, score: null,
          startYear: null, endYear: null,
          episodeList: [], categoryList: ['web'],
          labelList: [LANG_META.sub],
          websiteLabelList: [],
          websiteId: 0,
          sourceList: [{ url: w.url, siteName: w.host, lang: 'sub', label: LANG_META.sub, penalty: 0 }],
          sourceCount: 1,
          hubUrl: '',
          watchFlag: false, clearFlag: false, tailCollectList: []
        });
      }
      /* Red de seguridad FINAL (siempre que exista internet): un enlace
         de búsqueda web que la app abre en su NAVEGADOR INTERNO — ahí el
         usuario elige el sitio y el SNIFFER caza el stream. Es honesto:
         no finge disponibilidad, da el camino garantizado hacia ella. */
      if (!content.length) {
        const busq = 'https://www.google.com/search?q=' + encodeURIComponent(keyWord + ' ver online');
        content.push({
          title: `Buscar "${keyWord}" en la web`,
          url: busq,
          cover: '', description: 'Ábrelo en el navegador de AniMax: el sniffer detectará el vídeo',
          icon: '', siteName: 'google.com',
          type: 'web',
          resourceId: 0, integrationId: 0, score: null,
          startYear: null, endYear: null,
          episodeList: [], categoryList: ['web'],
          labelList: [LANG_META.sub], websiteLabelList: [], websiteId: 0,
          sourceList: [{ url: busq, siteName: 'google.com', lang: 'sub', label: LANG_META.sub, penalty: 0 }],
          sourceCount: 1,
          hubUrl: '',
          watchFlag: false, clearFlag: false, tailCollectList: []
        });
      }
    }

    /* v7.0 (H5) · «SIEMPRE ENCUENTRA»: si el título consultado existe en
       el catálogo, el ROUTE pone AL FRENTE la tarjeta de la página propia
       del Hub (clearFlag + siteName "AniMax Hub"). Aquí se elige la MEJOR
       coincidencia del catálogo con la normalización reforzada (exacto >
       empieza > contiene) y viaja como campo interno `_hubCard`; el route
       le llena la URL con el host que pide y `hub=0` la desactiva. */
    let hubSkeleton = null;
    if (page === 1 && metas.length) {
      try {
        const qN = normalizeTitleV2(keyWord);
        let best = null;
        for (const m of metas.slice(0, 4)) {
          const r = titleRankV2(normalizeTitleV2(m.title), qN);
          if (!best || r < best.rank) best = { m, rank: r };
        }
        if (best && best.rank <= 2) hubSkeleton = buildHubCard(best.m, keyWord);
      } catch (e) { hubSkeleton = null; }   // jamás romper la búsqueda
    }

    return {
      content,
      hotSearchContent: page === 1 ? await hotSearchContent() : null,
      isLast: page > 1 || totalWeb <= pageSize,
      page,
      pageSize,
      totalElements: content.length,
      // estadísticas del motor (Fase 3): fuentes y títulos encontrados
      _engine: { options: options.length, cards: totalWeb, metas: metas.length },
      // v7.0 (H5): esqueleto de la tarjeta del Hub (el route la materializa)
      _hubCard: hubSkeleton
    };
  }

  /** v4.0 (Fase 22-23): DuckDuckGo HTML → enlaces "ver online" (≤8). */
  async function webLastResort(keyWord) {
    const key = 'v4:ddg:' + keyWord.toLowerCase();
    let cached = cacheGet(key, 60 * 60 * 1000);   // 1 h: no martillar
    if (cached) return cached;
    const out = [];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(keyWord + ' ver online'), {
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' }
      });
      clearTimeout(timer);
      if (res.ok) {
        const html = await res.text();
        const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        while ((m = re.exec(html)) && out.length < 8) {
          let url = m[1];
          // DDG envuelve en /l/?uddg=<url-encoded>
          const inner = /[?&]uddg=([^&]+)/.exec(url);
          if (inner) url = decodeURIComponent(inner[1]);
          if (!/^https?:\/\//i.test(url)) continue;
          const host = hostOf(url);
          if (/duckduckgo|google|youtube\.com|facebook|wikipedia|imdb\.com|m.facebook/i.test(host)) continue;
          const title = stripTags(m[2]).trim().slice(0, 90);
          if (!title) continue;
          out.push({ title, url, host });
        }
      }
    } catch { /* sin internet al buscador: lista vacía, sin error */ }
    cacheSet(key, out);
    return out;
  }

  async function hotSearchContent() {
    const items = await hotTab('anime');
    return {
      hotShow: true,
      list: (items || []).slice(0, 10).map(i => ({ cover: i.image || '', title: i.title })),
      screening: { area: '', genre: '', type: '' }
    };
  }

  /* relatedQueries v3 (G6 · "Navegador Seekee"): sugerencias EN ESPAÑOL
     — paridad con el buscador del navegador de Seekee, donde al teclear
     salen opciones relacionadas en español y luego los resultados con
     SUB/LATINO. Capas:
     0) Plantillas ES reales de búsqueda de anime ("X sub español",
        "ver X online", "X latino", "X castellano", capítulos…).
     1) Títulos del catálogo (AniList) — autocompletado; los sinónimos
        solo entran si COMPARTEN alguna palabra con la consulta (así el
        sinónimo italiano "All'arrembaggio!" no aparece para "one piece",
        pero "One Piece: La Película" sí).
     2) Bitácora de la propia app (lo que TÚ buscaste, con calor).
     3) Tendencias del día.
     Orden: 1 palabra → títulos primero (autocompletar); 2+ palabras →
     plantillas ES primero (refinar como en Seekee). Máx 10, sin duplicados. */
  const ES_TEMPLATES = [
    (k) => k + ' sub español',
    (k) => 'ver ' + k,
    (k) => k + ' latino',
    (k) => 'ver ' + k + ' online',
    (k) => k + ' online',
    (k) => k + ' castellano',
    (k) => k + ' todos los capítulos',
    (k) => k + ' película'
  ];
  async function relatedQueries(keyWord) {
    const kw = String(keyWord || '').trim();
    if (!kw) return [];
    const out = [];
    const seen = new Set([kw.toLowerCase()]);
    const push = (t) => {
      const s = String(t || '').trim();
      if (!s || s.length < 2 || s.length > 90) return;
      // v4.0 (Fase 3): solo sugerencias en alfabeto latino (app en
      // español) — los sinónimos nativos (呪術廻戦, Магическая битva…)
      // no se ofrecen como consulta.
      if (/[^\u0000-\u024F\u2000-\u206F\u3000-\u303F!¡¿?'"():;.,\-–—…·&%$#@\s\/+*]/.test(s)) return;
      const k = s.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(s);
    };
    // Palabras normalizadas de la consulta (para filtrar sinónimos ajenos).
    const kwWords = kw.toLowerCase().split(/[\s:·,.'"()\-–—]+/)
      .map(w => w.trim()).filter(w => w.length >= 3);
    const sharesWord = (s) => {
      const words = String(s).toLowerCase().split(/[^a-z0-9áéíóúüñ]+/)
        .filter(w => w.length >= 3);
      return words.some(w => kwWords.includes(w));
    };

    // 0) PLANTILLAS ES (G6): el sello del buscador en español.
    const multiWord = /\s/.test(kw);
    const templateBudget = multiWord ? 5 : 3;
    if (!multiWord) {
      // 1) Catálogo primero (autocompletar la palabra suelta).
      const list = await metaSearch(kw);
      for (const m of list) {
        if (out.length >= 6) break;
        push(m.title);
        for (const a of (m.alt || [])) {
          if (out.length >= 6) break;
          if (!sharesWord(a)) continue;   // G6: sin sinónimos ajenos (italiano/alemán…)
          push(a);
        }
      }
    }
    for (const t of ES_TEMPLATES) {
      if (out.length >= (multiWord ? 5 : 8)) break;
      push(t(kw));
    }
    if (multiWord) {
      // 1-bis) Catálogo después (refinar el título exacto).
      const list = await metaSearch(kw);
      for (const m of list) {
        if (out.length >= 10) break;
        push(m.title);
        for (const a of (m.alt || [])) {
          if (out.length >= 10) break;
          if (!sharesWord(a)) continue;
          push(a);
        }
      }
    }
    void templateBudget;

    // 2) Bitácora: lo más buscado que empiece por o contenga la palabra.
    if (out.length < 10) {
      for (const s of feedback.logMatches(kw, 4)) push(s);
    }

    // 3) Tendencias del día (solo si aún hay hueco y el query es corto).
    if (out.length < 8 && kw.length <= 10) {
      const items = await hotTab('anime');
      for (const it of (items || [])) {
        if (out.length >= 10) break;
        const t = it.title || '';
        if (t.toLowerCase().includes(kw.toLowerCase())) push(t);
      }
    }
    return out.slice(0, 10);
  }

  /* Forecast de texto (Fase 3): predicción MIENTRAS escribes — antes
     de pulsar buscar. Mezcla bitácora (lo que se busca en TU app) con
     el ranking caliente; devuelve [{keyWord, heatScore}] para poder
     pintar el 🔺 de calor como hace Seekee. */
  async function searchForecast(keyWord) {
    const kw = String(keyWord || '').trim();
    if (kw.length < 1) return [];
    const out = [];
    const seen = new Set([kw.toLowerCase()]);
    const push = (display, heatScore) => {
      const k = display.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ keyWord: display, heatScore: Math.max(1, Math.round(heatScore)) });
    };

    // 1) Bitácora de búsqueda (prefix > palabra interna), con calor real.
    const log = feedback.logMatches(kw, 5);
    const heatOf = feedback.hotQueries(50);
    const heatMap = new Map(heatOf.map(h => [h.display.toLowerCase(), h.heat]));
    for (const s of log) push(s, (heatMap.get(s.toLowerCase()) || 1) * 100);

    // 2) Ranking caliente del día filtrado por prefijo/palabra.
    const items = await hotTab('anime');
    const kwl = kw.toLowerCase();
    for (const it of (items || [])) {
      if (out.length >= 8) break;
      const t = String(it.title || '');
      const tl = t.toLowerCase();
      if (tl.startsWith(kwl) || tl.split(/\s+/).some(w => w.startsWith(kwl))) {
        push(t, (it.score || (100 - (it.rank || 1) * 3)) / 100);
      }
    }

    // 3) Catálogo (solo queries de 3+ letras): títulos que empiezan igual.
    if (out.length < 6 && kw.length >= 3) {
      const metas = await metaSearch(kw);
      for (const m of metas) {
        if (out.length >= 8) break;
        if (normalizeTitle(m.title).startsWith(normalizeTitle(kw))) {
          push(m.title, 50);
        }
      }
    }
    return out.slice(0, 8);
  }

  /* search/hot v2 (Fase 3): con PUNTUACIÓN DE CALOR explícita
     (heatScore) y ordenado por ella — el contrato de Seekee muestra
     el 🔺 junto a cada término popular. */
  async function searchHot(type) {
    const map = { movie: 'peliculas', drama: 'series', comic: 'anime', short: 'minidramas' };
    const tab = map[streamCodeOf(type)] || 'anime';
    const items = await hotTab(tab);
    return (items || []).map((i, idx) => ({
      resourceId: i.rank || idx + 1,
      resourceName: i.title,
      resourceType: streamCodeOf(type),
      resourceTypeName: RESOURCE_TYPES[streamCodeOf(type)].nombre,
      // v4.0 (Fase 3): calor explícito (el score del ranking diario)
      heatScore: i.score || 0,
      cover: i.image || '',
      startYear: i.year || null
    })).sort((a, b) => (b.heatScore || 0) - (a.heatScore || 0));
  }

  /* ── CATÁLOGO DE SITIOS (navigationList) ────────────────────────── */
  /* FASE D0.5: el PRIMER grupo son las PÁGINAS PROPIAS de AniMax (el
     hub de hub.js) — espejo del grupo de sitios propios con que Seekee
     abre su home web (NavigationGroup con sus H5). El resto de grupos
     (catálogo externo) queda detrás, como en el APK. */
  function navigationList(req) {
    const sites = allSitesConfig();
    let own = '';
    try {
      const h = (req && req.headers) || {};
      const host = h['x-forwarded-host'] || h.host || 'localhost';
      const proto = h['x-forwarded-proto'] || (String(host).includes('localhost') ? 'http' : 'https');
      own = proto + '://' + host + '/hub';
    } catch { own = '/hub'; }
    const groups = [
      { title: 'AniMax · Páginas propias', own: true },
      { title: 'Anime Latino', kind: 'anime', lang: 'latino' },
      { title: 'Anime Subtitulado', kind: 'anime', lang: 'sub' },
      { title: 'Películas y Series', kind: null, lang: 'latino' },
      { title: 'Doramas y Minidramas', kind: 'dorama', lang: null }
    ];
    return groups.map(g => {
      if (g.own) {
        return {
          title: g.title,
          pickCover: '',
          unPickCover: '',
          selected: true,
          sites: [
            { url: own, cover: '', name: 'AniMax Hub', own: true,
              description: 'Búsqueda + fichas unificadas (páginas propias)' },
            { url: own + '?q=naruto', cover: '', name: 'Probar búsqueda', own: true,
              description: 'Ejemplo: resultados unificados de "naruto"' }
          ]
        };
      }
      return {
        title: g.title,
        pickCover: '',
        unPickCover: '',
        sites: sites
          .filter(s => (g.kind === null ? (s.kind === 'pelicula' || s.kind === 'serie') : s.kind === g.kind))
          .filter(s => g.lang === null || s.lang === g.lang)
          .map(s => ({
            url: 'https://' + s.host,
            cover: 'https://icons.duckduckgo.com/ip3/' + s.host + '.ico'
          }))
      };
    }).filter(g => g.sites.length);
  }

  /* Dominios vigentes (contrato WhiteListConfig de Loklok — FORENSE-H
     §5.1). v7.0 (H4): queryFreshDomainList v2 — además de la lista plana
     compat (sites), el endpoint entrega el MAPA COMPLETO
     {hub:[WhiteListConfig…], sites:[WhiteListConfig…]} con los dominios
     PROPIOS del Hub del dueño (animax-hub-domains.json + mirrors con
     failover del watchdog). Flags: freshEnable = captura de medios
     (sitio vivo o sin sondear), webFreshEnable = el navegador interno
     puede abrir la web aunque el scraper falle, desktop = UA
     Chrome-desktop por dominio (operable por el dueño desde H4).
     _meta lleva la ROTACIÓN (dominio previo, cuándo cambió, fuente del
     descubrimiento) y en el Hub: primary/active/aliveMs/lastCheck.
     freshDomainMap() es la fuente; freshDomainList() conserva la forma
     plana EXACTA de siempre para apps y tests viejos (cero regresión). */
  function freshDomainMap() {
    const siteEntries = allSitesConfig().map(s => {
      const h = siteHealth.get(s.host);
      const alive = !h ? true : (Date.now() - h.ts > 30 * 60 * 1000 ? true : h.ok);
      const rot = s.rotated || null;
      return {
        url: 'https://' + s.host,
        freshEnable: alive,
        webFreshEnable: true,
        desktop: s.desktop === true,   // v7.0 (H1): contrato WhiteListConfig completo
        _meta: {
          id: String(s.host).replace(/^www\./, '').split('.')[0],
          role: 'site',                // v7.0 (H4): rol en el mapa v2
          kind: s.kind, lang: s.lang, aliveMs: h ? h.ms : null,
          lastCheck: h ? h.ts : null,
          previousDomain: rot ? rot.from : null,
          changedAt: rot ? rot.at : null,
          discoverySource: rot ? rot.source : 'catalogo'
        }
      };
    });

    /* v7.0 (H4) · Dominios del HUB del dueño: la vista del watchdog da
       la salud y el mirror ACTIVO (failover/restauración automática).
       Sin configuración del dueño → [] honesto (la app sigue con su
       searchServerUrl; el portal /hub no depende de esto). */
    const hubStat = watchdog && typeof watchdog.hubStatus === 'function'
      ? watchdog.hubStatus() : null;
    const hubEntries = (hubDomains.hubDomainsConfig() || []).map(hd => {
      const mir = hubStat && hubStat.mirrors
        ? hubStat.mirrors.find(m => m.url === hd.url) : null;
      const alive = mir ? mir.ok !== false : true;  // sin sondear → vivo
      return {
        url: hd.url,
        freshEnable: hd.freshEnable && alive,
        webFreshEnable: hd.webFreshEnable,
        desktop: hd.desktop,
        _meta: {
          id: 'hub-' + (String(hd.url).replace(/^https?:\/\//, '').split('.')[0]),
          role: 'hub',
          kind: 'hub', lang: 'hub', aliveMs: mir ? mir.ms : null,
          lastCheck: mir ? mir.lastCheck : null,
          primary: hd.primary === true,
          active: hubStat ? hubStat.active === hd.url : hd.primary === true,
          previousDomain: hubStat && hubStat.active && hubStat.primary &&
            hubStat.active !== hubStat.primary ? hubStat.primary : null,
          changedAt: hubStat ? hubStat.changedAt : null,
          discoverySource: 'hub-config'
        }
      };
    });
    return { hub: hubEntries, sites: siteEntries };
  }

  function freshDomainList() {
    /* v7.0 (H4): la lista plana sigue siendo SOLO sites (contrato y
       consumidores viejos intactos); el mapa {hub, sites} completo viaja
       en el campo `v2` de la respuesta del endpoint. */
    return freshDomainMap().sites;
  }

  /* v7.0 (H4) · MAPA v2 del endpoint queryFreshDomainList: {hub, sites,
     primaryHub, generatedAt}. primaryHub = mirror ACTIVO del Hub (con
     failover ya aplicado por el watchdog) o '' si el dueño no configuró
     dominios propios — la app usa su searchServerUrl en ese caso. */
  function freshDomainV2() {
    const map = freshDomainMap();
    const hubStat = watchdog && typeof watchdog.hubStatus === 'function'
      ? watchdog.hubStatus() : null;
    return {
      hub: map.hub,
      sites: map.sites,
      primaryHub: hubStat && hubStat.configured ? hubStat.active : '',
      generatedAt: Date.now()
    };
  }

  /* v4.0 (Fase 2) · ESTADO DE FUENTES para la pantalla de la app:
     salud por sitio + resumen del watchdog + penalización por reportes
     (la "reputación" que hunde a los sitios que fallan).
     v4.0 (Fase 3): ahora TAMBIÉN con desempeño de búsqueda (hits/misses)
     y el penalty COMBINADO (reproducción + búsqueda + frescura). */
  function sourcesStatus() {
    const base = watchdog ? watchdog.status() : { sources: [], hub: null, summary: null };
    const sources = base.sources.map(s => ({
      ...s,
      penalty: statsOf(s.host).penalty,
      search: statsOf(s.host).search
    }));
    return {
      ok: true,
      version: VERSION,
      sources,
      hub: base.hub || (watchdog && typeof watchdog.hubStatus === 'function'
        ? watchdog.hubStatus() : null),   // v7.0 (H4): dominios del Hub
      summary: base.summary
    };
  }

  /* ── ADBLOCK / SUBTÍTULOS / CONFIG / UPDATE ─────────────────────── */
  async function adBlockRule() {
    const body = await buildAdblockList();
    const hosts = body.trim() ? body.trim().split('\n') : [];
    // v4.0 (Fase 6): URL de la lista de OCULTACIÓN de elementos (cosméticos)
    // que la app inyecta en el WebView (equivalente al elemhide de ABP,
    // servida por GET /api/adblock/hide).
    return {
      subscription: { url: '/api/adblock', versionCode: 1 },
      elementHideUrl: '/api/adblock/hide',
      domainList: hosts
    };
  }

  function subtitlesConfig() {
    return {
      subtitles: {
        domainList: FARM_DOMAINS,
        vttList: [],          // la Fase 13 añade VTT por dominio
        filePath: '',
        vttFilePath: '',
        interfaceSwitch: false
      },
      domainList: FARM_DOMAINS,
      autoTranslation: false  // la Fase 13 lo activa con traducción real
    };
  }

  function querySettings() {
    // AppRemoveConfigData: la app descarga de AQUÍ los scripts sniffer y
    // analyzer → actualizables sin tocar el APK (técnica Seekee
    // sp_html_inject_data). v7.0 (H3): analyzerScriptUrl nuevo.
    return {
      detailJsScriptUrl: '/api/v1/config/sniffer.js',
      analyzerScriptUrl: '/api/v1/config/analyzer.js',
      javasUrl: ''
    };
  }

  /* ══ v7.0 (H3) · ANALIZADOR DE PÁGINAS REMOTO (hermano del sniffer) ══
     El MISMO script (analyzer-script.js) se sirve crudo en
     /api/v1/config/analyzer.js (para el asset resourceAnalysis.html de la
     app — actualizable sin APK) y se EJECUTA AQUÍ en una sandbox `vm`
     para el endpoint /api/v1/hub/analyze: el servidor descarga la página
     y devuelve el AnalysisResourceData (temporadas/episodios) — la misma
     función, dos entornos, cero divergencia.                                */

  let analyzerCache = null;   // { mtime, js }

  /** v7.0 (H3): etiqueta de motor que viaja en /api/v1/hub/analyze. */
  const ANALYZER_ENGINE = 'analyzer/1 (FASE H3)';

  /** Carga (con caché por mtime) el JS del analizador; null si falla. */
  function analyzerJs() {
    try {
      const st = fs.statSync(ANALYZER_FILE);
      if (analyzerCache && analyzerCache.mtime === st.mtimeMs) return analyzerCache.js;
      const resolved = require.resolve('./analyzer-script.js');
      delete require.cache[resolved];            // recarga si cambió
      const mod = require('./analyzer-script.js');
      const js = mod && mod.ANALYZER_JS && String(mod.ANALYZER_JS).trim();
      if (js && js.length >= 200) {
        analyzerCache = { mtime: st.mtimeMs, js };
        return js;
      }
      return analyzerCache ? analyzerCache.js : null;   // script inválido → lo anterior
    } catch (e) {
      return analyzerCache ? analyzerCache.js : null;
    }
  }

  /** Fallback embebido mínimo (solo si analyzer-script.js desaparece):
      contrato válido con seasons vacías — NUNCA 404 ni basura. */
  const ANALYZER_JS_MIN = `(function () {
  'use strict';
  var w = (typeof window !== 'undefined') ? window : this;
  if (w) { w.__animaxAnalyzerRemoteV1 = true; }
  function onceAnalyzer(html, pageUrl) {
    try {
      var t = String(html || '').match(/<title>([^<]{3,160})<\\/title>/i);
      return JSON.stringify({
        pageBaseInfo: { title: (t && t[1]) ? t[1] : '', cover: '', description: '' },
        seasons: []
      });
    } catch (e) {
      return '{"pageBaseInfo":{"title":"","cover":"","description":""},"seasons":[]}';
    }
  }
  if (w) { w.onceAnalyzer = onceAnalyzer; w.onceParser = onceAnalyzer; }
  return onceAnalyzer;
})();`;

  /**
   * Ejecuta onceAnalyzer(html, url) en una sandbox `vm` (timeout 4 s,
   * sin red, sin require) — el analizador es puro string, así que la
   * sandbox es hermética. Devuelve el objeto {pageBaseInfo, seasons}
   * parseado o null (NUNCA lanza).
   */
  function runAnalyzer(html, pageUrl) {
    try {
      const src = analyzerJs() || ANALYZER_JS_MIN;
      const sandbox = { window: {} };
      vm.createContext(sandbox);
      vm.runInContext(src, sandbox, { timeout: 4000, displayErrors: false });
      const fn = sandbox.window && (sandbox.window.onceAnalyzer || sandbox.window.onceParser);
      if (typeof fn !== 'function') return null;
      const raw = String(fn(String(html || ''), String(pageUrl || '')) || '');
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || !Array.isArray(obj.seasons)) return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  /** Analiza una página REAL: la descarga (request del ctx: UA/redirects/
      proxy heredados del motor) y ejecuta el analizador. Cacheada 30 min
      por URL. null si la página o el análisis fallan (NUNCA lanza). */
  async function hubAnalyze(pageUrl) {
    const key = 'hub:analyze:' + pageUrl;
    const cached = cacheGet(key, 30 * 60 * 1000);
    if (cached) return cached;
    let data = null;
    try {
      const r = await request(pageUrl, { timeoutMs: 12000, maxBytes: 3 * 1024 * 1024 });
      if (r && r.ok && r.body && r.body.length > 60) {
        data = runAnalyzer(r.body, pageUrl);
      }
    } catch (e) { data = null; }
    if (data) cacheSet(key, data);
    return data;
  }

  /* ── v4.0 (Fase 21) · UPDATE IN-APP REAL ──────────────────────────
     El dueño publica una actualización SIN tocar el código: sube el APK
     firmado al servidor (animax-latest.apk) y ajusta animax-update.json
     (a mano o con POST /api/v1/config/update). El contrato es el nuevo:
     {updateAvailable, versionCode, versionName, changelog, downloadUrl,
      forced} + los campos viejos del UpgradeInfo por compatibilidad. */
  const UPDATE_CFG_FILE = pathMod.join(__dirname, 'animax-update.json');
  let updCache = { mtime: 0, data: null };
  function updateConfig() {
    try {
      const st = fs.statSync(UPDATE_CFG_FILE);
      if (updCache.data && st.mtimeMs === updCache.mtime) return updCache.data;
      const raw = JSON.parse(fs.readFileSync(UPDATE_CFG_FILE, 'utf8'));
      const cfg = {
        versionCode: Math.max(0, Number(raw.versionCode) || 0),
        versionName: String(raw.versionName || ''),
        changelog: String(raw.changelog || ''),
        downloadUrl: String(raw.downloadUrl || '/apk/animax-latest.apk'),
        forced: !!raw.forced
      };
      if (!cfg.versionCode || !cfg.versionName) throw new Error('incompleto');
      updCache = { mtime: st.mtimeMs, data: cfg };
      return cfg;
    } catch { return null; }   // sin archivo/json roto → sin update (nunca error)
  }

  function appUpdateCheck(currentVersionCode) {
    const cfg = updateConfig();
    const current = Number(currentVersionCode) || 0;
    if (!cfg) {
      return { content: '', loginType: 0, show: 0, status: 0, title: '', updateType: 0, updateUrl: '', updateAvailable: false };
    }
    const disponible = cfg.versionCode > current;
    return {
      updateAvailable: disponible,
      versionCode: cfg.versionCode,
      versionName: cfg.versionName,
      changelog: cfg.changelog,
      downloadUrl: cfg.downloadUrl,
      forced: !!cfg.forced,
      /* Campos del UpgradeInfo viejo (compatibilidad): */
      content: cfg.changelog, show: disponible ? 1 : 0,
      status: disponible ? 1 : 0, title: 'Nueva versión ' + cfg.versionName,
      updateType: cfg.forced ? 2 : 1, updateUrl: cfg.downloadUrl
    };
  }

  async function recommendList() {
    const r = await alPage({ page: 1, perPage: 10, sort: 'TRENDING_DESC' });
    return { title: 'Los más populares', list: r.list.map(m => ({ cover: m.image, title: m.title })) };
  }

  /* ════════════════════════════════════════════════════════════════
     ROUTER v4 — devuelve true si gestionó la petición
     ════════════════════════════════════════════════════════════════ */
  const v4Route = async function (req, res, path, query, started) {
    const method = req.method;
    // Query params Y body JSON se funden (los HashMap de Retrofit llegan
    // como query en GET y como body en POST — aceptamos ambos).
    const body = (method === 'POST' || method === 'PUT') ? await readBody(req) : {};
    const f = { ...Object.fromEntries(query.entries()), ...body };
    const ok = (obj) => json(res, 200, { ...obj, took: Date.now() - started + 'ms' });

    /* ════════ HOME (server-driven, contrato /quan/app/content/home/*) ════════ */
    if (path === '/api/v1/app/content/home/navigationBar' && method === 'GET') {
      return ok({ ok: true, data: NAV_BAR });
    }

    if (path === '/api/v1/app/content/home/getSectionContentByPage') {
      const page = Math.max(1, Number(f.page) || 1);
      const data = await homeSections(f.labelCode || 'comic', page, Number(f.pageSize) || 20);
      return ok({ ok: true, ...data });
    }

    if (path === '/api/v1/app/content/home/getSingleAlbumDetail' ||
        path === '/api/v1/app/content/home/getMultipleAlbumDetail') {
      const titles = Array.isArray(f.titles) ? f.titles
        : String(f.titles || f.titles || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!titles.length) return ok({ ok: false, error: 'faltan titles (array o CSV)' });
      return ok({ ok: true, data: await albumDetail(titles, f.type) });
    }

    /* v6.0 (G8) · paridad del contrato Seekee getGuideImgList (FORENSE-G8):
       Seekee devuelve aquí las URLs de las imágenes del onboarding. AniMax
       lleva las guías EMBEBIDAS en el APK (assets/onboarding/ → offline-
       safe), así que la lista va vacía; si un operador quiere servir las
       suyas puede añadirlas como imageUrl en /config/onboarding. */
    if (path === '/api/v1/app/content/home/getGuideImgList' && method === 'GET') {
      return ok({ ok: true, data: [] });
    }

    /* ══ v4.0 (Fase 9) · ONBOARDING (4 pasos) + PANEL DE SECCIONES ══
       El home es 100% server-driven: POST /config/sections reordena o
       reescribe las secciones de cada tab y TODAS las apps lo reflejan
       en su siguiente getSectionContentByPage — sin publicar APK. */
    if (path === '/api/v1/config/onboarding' && method === 'GET') {
      /* v6.0 (G8): cada paso acepta `imageUrl` OPCIONAL (URL absoluta o ruta
         servida por el operador) — si viene, la app la muestra en el pager
         del onboarding en lugar de la ilustración embebida del APK. */
      return ok({ ok: true, data: [
        { title: 'Bienvenido a AniMax', description: 'Todo el catálogo de Seekee, sin anuncios y privado. Latino → Castellano → Sub siempre.', emoji: '🍿' },
        { title: 'Todo disponible', description: 'Si una web se abre en un navegador, se reproduce en AniMax: el motor WebView abre los players y extrae el vídeo.', emoji: '▶️' },
        { title: 'Sin anuncios', description: 'El bloqueador integrado filtra las redes de publicidad de cada sitio y oculta sus cajas.', emoji: '🛡️' },
        { title: 'Tú mandas', description: 'El home, las fuentes y las reglas se cambian desde tu servidor: la app se actualiza sola.', emoji: '⚙️' }
      ] });
    }

    if (path === '/api/v1/config/sections' && method === 'GET') {
      const cfg = sectionsConfig();
      const tabs = {};
      for (const [code, defs] of Object.entries(cfg)) {
        // v7.0 (H5): el panel refleja genre/localFeed además de lo de siempre
        tabs[code] = defs.map(d => ({ id: d.id, name: d.sectionName, style: d.style, sort: d.sort,
          genre: d.genre || '', localFeed: d.localFeed === true }));
      }
      return ok({ ok: true, data: { tabs }, _meta: { estilos: SECTION_STYLES, feedsLocales: LOCAL_FEED_STYLES } });
    }

    if (path === '/api/v1/config/sections' && method === 'POST') {
      const tabs = f.tabs || f.data && f.data.tabs;
      if (!tabs || typeof tabs !== 'object' || Array.isArray(tabs)) {
        return ok({ ok: false, error: 'cuerpo esperado: {tabs:{comic:[…],drama:[…],movie:[…],short:[…]}}' });
      }
      const clean = {};
      let total = 0;
      for (const [code, list] of Object.entries(tabs)) {
        if (!Array.isArray(list)) continue;
        const defs = [];
        for (let i = 0; i < list.length && i < 12; i++) {
          const s = list[i] || {};
          if (!s.name || !SECTION_STYLES.includes(s.style)) continue;
          defs.push({
            id: Number(s.id) || (defs.length + 1),
            name: String(s.name).slice(0, 60),
            style: s.style,
            sort: CFG_SORTS.includes(s.sort) ? s.sort : 'trending',
            // v7.0 (H5): género paramétrico + feed local persistidos
            genre: typeof s.genre === 'string' && s.genre.trim() ? s.genre.trim().slice(0, 40) : '',
            localFeed: LOCAL_FEED_STYLES.includes(s.style) || s.localFeed === true
          });
        }
        if (defs.length) { clean[code] = defs; total += defs.length; }
      }
      if (!total) return ok({ ok: false, error: 'ninguna sección válida (name + style BANNER|CONTINUE|SINGLE_ALBUM|RANK_LIST|MULTIPLE_ALBUM|SEASON_NOW|TRENDING_NOW|GENRE_ROW|MY_LIST)' });
      try {
        fs.writeFileSync(SECTIONS_FILE, JSON.stringify({ tabs: clean }, null, 2) + '\n');
        cfgCache = { mtime: 0, data: null };   // invalida: próximo GET recarga
        return ok({ ok: true, tabs: Object.keys(clean), secciones: total });
      } catch (e) {
        return ok({ ok: false, error: 'no-se-pudo-escribir: ' + e.message });
      }
    }

    /* ════════ CATÁLOGO DE SITIOS (contrato /buscari/app/content/website/*) ════════ */
    if (path === '/api/v1/app/content/website/navigationList' && method === 'GET') {
      return ok({ ok: true, data: navigationList(req) });
    }
    if (path === '/api/v1/app/content/website/queryFreshDomainList' && method === 'GET') {
      /* v7.0 (H4): `data` = lista plana de SITIOS (contrato idéntico a
         H0–H3, cero regresión) + campo `v2` con el mapa COMPLETO
         {hub:[WhiteListConfig…], sites:[…], primaryHub, generatedAt}. */
      return ok({ ok: true, data: freshDomainList(), v2: freshDomainV2() });
    }

    /* ════════ v4.0 (FASE 2) · WATCHDOG DE DOMINIOS ════════
       Estado de fuentes (salud por sitio, última verificación,
       rotaciones, reputación) + disparo manual de un ciclo. */
    if (path === '/api/v1/config/sources/status' && method === 'GET') {
      const st = sourcesStatus();
      /* v6.0 (G2): salud de los proveedores reales (allanime/hianime) */
      if (providers) st.providers = providers.status();
      return ok(st);
    }
    if (path === '/api/v1/config/sources/refresh' && method === 'POST') {
      if (!watchdog) return ok({ ok: false, error: 'watchdog-no-disponible' });
      const started = watchdog.trigger();
      return ok({ ok: true, started, alreadyRunning: !started });
    }

    /* ════════ FILMCENTER (contrato /buscari/content/filmCenter/*) ════════ */
    if (path === '/api/v1/content/filmCenter/homepage' && method === 'GET') {
      const key = 'v4:homepage' + (enrich.tmdbEnabled() ? ':tmdb' : '');
      let data = cacheGet(key, TTL.v4);
      if (!data) { data = await filmCenterHomepage(); cacheSet(key, data); }
      return ok({ ok: true, data });
    }
    if (path === '/api/v1/content/filmCenter/stream/types' && method === 'GET') {
      // v4.0 (Fase 4): stream/types CON PORTADAS de teatro (el contrato
      // Fase 1 devolvía solo nombres — `names` los conserva por compat).
      const key = 'v4:stypes' + (enrich.tmdbEnabled() ? ':tmdb' : '');
      let data = cacheGet(key, TTL.v4);
      if (!data) { data = await streamTypes(); cacheSet(key, data); }
      return ok({ ok: true, data, names: data.map(d => d.streamName) });
    }
    /* v4.0 (Fase 4) · PÁGINA DE TEATRO espejo: cabecera con póster
       grande + grid infinito (misma fuente/filtros que film/subPage). */
    if (path === '/api/v1/content/filmCenter/theater/page' && method === 'GET') {
      const data = await theaterPage(f.stream, f.orderType, f.genre,
        Math.max(1, Number(f.page) || 1), Number(f.pageSize) || 20,
        f.year, f.area);
      return ok({ ok: true, ...data });
    }
    /* v4.0 (Fase 4) · FICHA de catálogo por filmId o título: sinopsis
       larga, géneros ES, similares y extra Jikan (tráiler, estudios). */
    if (path === '/api/v1/content/filmCenter/film/detail' && method === 'GET') {
      const id = f.filmId || f.filmID || f.title || f.id;
      const d = await filmDetail(id, f.stream);
      if (!d) return ok({ ok: false, error: 'obra no encontrada (filmId o título)' });
      return ok({ ok: true, data: d });
    }
    if (path === '/api/v1/content/filmCenter/stream/films' && method === 'GET') {
      return ok({ ok: true, data: await streamFilms(f.stream) });
    }
    if (path === '/api/v1/content/filmCenter/genres/films' && method === 'GET') {
      if (!f.genre) return ok({ ok: false, error: 'falta ?genre=' });
      const key = 'v4:genrefilms-route:' + f.genre + (enrich.tmdbEnabled() ? ':tmdb' : '');
      let data = cacheGet(key, TTL.v4);
      if (!data) { data = await genreFilms(f.genre); cacheSet(key, data); }
      return ok({ ok: true, ...data });
    }
    if (path === '/api/v1/content/filmCenter/film/subPage') {
      const data = await filmSubPage(f.stream, f.genre, f.orderType,
        Math.max(1, Number(f.page) || 1), Number(f.pageSize) || 20,
        f.year, f.area);
      return ok({ ok: true, ...data });
    }

    /* ════════ GÉNEROS Y ORDEN (contrato /buscari/config/filmCenter/*) ════════ */
    if (path === '/api/v1/config/filmCenter/genres' && method === 'GET') {
      return ok({ ok: true, data: GENEROS });
    }
    if (path === '/api/v1/config/filmCenter/genres/popular' && method === 'GET') {
      return ok({ ok: true, data: await popularGenres() });
    }
    if (path === '/api/v1/config/filmCenter/orderTypes' && method === 'GET') {
      return ok({ ok: true, data: ORDER_TYPES });
    }

    /* ════════ BÚSQUEDA (contrato /buscari/app/search/* + /buscari/search/*) ════════ */
    if (path === '/api/v1/app/search/search') {
      const kw = String(f.keyWord || f.keyword || f.q || '').trim();
      if (!kw) return ok({ ok: false, error: 'falta keyWord' });
      feedback.recordQuery(kw);   // v4.0 (Fase 3): bitácora → relatedQueries/forecast
      const key = 'v4:search:' + kw.toLowerCase() + ':' + (f.page || 1);
      let data = cacheGet(key, TTL.search);
      if (!data) { data = await seekeeSearch(kw, f.page, f.pageSize, f.type); cacheSet(key, data); }
      /* v7.0 (H2) · HUB 2.0: el caché guarda hubUrl '' — se llena AQUÍ,
         por petición, con el host que pide (fillHubUrls arriba). */
      fillHubUrls(data, req);
      /* v7.0 (H5) · «siempre encuentra»: la tarjeta de la PÁGINA PROPIA
         del Hub AL FRENTE cuando el título está en el catálogo. Parámetro
         honesto `hub` (por defecto 1): `hub=0` la desactiva SIN cambiar
         nada más de la respuesta (contrato intacto, solo se resta). */
      const hubOn = String(f.hub === undefined ? '1' : f.hub) !== '0';
      const out = hubFrontCard(data, req, hubOn);
      return ok({ ok: true, ...out });
    }
    if (path === '/api/v1/search/relatedQueries' && method === 'GET') {
      const kw = String(f.keyWord || '').trim();
      if (!kw) return ok({ ok: false, error: 'falta ?keyWord=' });
      const key = 'v4:related:' + kw.toLowerCase();
      let data = cacheGet(key, TTL.related);
      if (!data) { data = await relatedQueries(kw); cacheSet(key, data); }
      return ok({ ok: true, data });
    }
    /* v4.0 (Fase 3) · FORECAST de texto: predicción mientras escribes
       (antes de buscar). Misma forma que relatedQueries pero con calor. */
    if (path === '/api/v1/app/search/forecast' && method === 'GET') {
      const kw = String(f.keyWord || f.keyword || f.q || '').trim();
      if (!kw) return ok({ ok: true, data: [] });
      const key = 'v4:forecast:' + kw.toLowerCase();
      let data = cacheGet(key, TTL.related);
      if (!data) { data = await searchForecast(kw); cacheSet(key, data); }
      return ok({ ok: true, data });
    }
    if (path === '/api/v1/api/home/search/hot') {
      return ok({ ok: true, data: await searchHot(f.type) });
    }
    if (path === '/api/v1/app/search/screening/list' && method === 'GET') {
      return ok({ ok: true, data: screeningList() });
    }
    if (path === '/api/v1/app/search/category/list') {
      return ok({ ok: true, ...(await categoryList(f)) });
    }

    /* ════════ REPRODUCTOR (contrato /buscari/tv/configuration/subtitles) ════════ */
    if (path === '/api/v1/tv/configuration/subtitles' && method === 'GET') {
      return ok({ ok: true, ...subtitlesConfig() });
    }

    /* ════════ ANTI-ANUNCIOS (contrato /buscari/api/config/*) ════════ */
    if (path === '/api/v1/api/config/getAdBlockRule' && method === 'GET') {
      return ok({ ok: true, ...await adBlockRule() });
    }
    if (path === '/api/v1/api/config/v2/getAdBlockDomain' && method === 'GET') {
      const body2 = await buildAdblockList();
      const hosts = body2.trim() ? body2.trim().split('\n') : [];
      return ok({ ok: true, domainList: hosts });
    }

    /* ════════ CONFIG REMOTA + UPDATE (contrato /buscari/config/*) ════════ */
    if (path === '/api/v1/config/javs/querySettings' && method === 'GET') {
      return ok({ ok: true, ...querySettings() });
    }
    /* ══ v4.0 (Fase 7) · SNIFFER v2 — se sirve desde sniffer-script.js con
       caché por mtime: editar ese archivo en el servidor actualiza el
       sniffer de todas las apps SIN publicar APK. Si falta o falla →
       versión básica embebida de Fase 1 (nunca 404 ni vacío).          */
    if ((path === '/api/v1/config/sniffer.js' || path === '/api/v1/config/sniffer') && method === 'GET') {
      let js = null;
      try {
        const st = fs.statSync(SNIFFER_FILE);
        if (module.exports.__snifferCache && module.exports.__snifferCache.mtime === st.mtimeMs) {
          js = module.exports.__snifferCache.js;
        } else {
          const resolved = require.resolve('./sniffer-script.js');
          delete require.cache[resolved];          // recarga si cambió
          const mod = require('./sniffer-script.js');
          js = mod && mod.SNIFFER_JS && String(mod.SNIFFER_JS).trim();
          if (js && js.length >= 200) {
            module.exports.__snifferCache = { mtime: st.mtimeMs, js };
          } else {
            js = null;                             // script inválido → fallback
          }
        }
      } catch (e) { js = null; }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(js || SNIFFER_JS);
    }
    /* ══ v7.0 (H3) · ANALYZER v1 — hermano del sniffer: se sirve desde
       analyzer-script.js con caché por mtime (editar ese archivo en el
       servidor actualiza el analizador de TODAS las apps SIN publicar
       APK — el arreglo definitivo de «dejó de funcionar un sitio»).
       Si falta o falla → versión mínima embebida (nunca 404 ni vacío). */
    if ((path === '/api/v1/config/analyzer.js' || path === '/api/v1/config/analyzer') && method === 'GET') {
      const js = analyzerJs() || ANALYZER_JS_MIN;
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(js);
    }
    /* ══ v7.0 (H3) · ANÁLISIS EN EL SERVIDOR: el MISMO script del analyzer
       se ejecuta aquí (sandbox vm) sobre la página descargada — el hub
       watch (/hub/watch) lo llama para las TEMPORADAS reales y el
       contrato AnalysisResourceData (H1) viaja completo. GET ?u= o POST
       {pageUrl}. Sin página/datos → ok:false honesto (nunca lanza). */
    if (path === '/api/v1/hub/analyze' && (method === 'GET' || method === 'POST')) {
      const pageUrl = String(f.pageUrl || f.u || '').trim();
      if (!/^https?:\/\//i.test(pageUrl)) {
        return ok({ ok: false, error: 'bad-url', engine: ANALYZER_ENGINE });
      }
      const data = await hubAnalyze(pageUrl);
      return ok({
        ok: !!data,
        engine: ANALYZER_ENGINE,
        pageUrl,
        data: data || { pageBaseInfo: { title: '', cover: '', description: '' }, seasons: [] }
      });
    }
    if (path === '/api/v1/config/appUpdate/check' && method === 'GET') {
      // v4.0 (Fase 21): compara contra el versionCode QUE REPORTA LA APP.
      return ok({ ok: true, ...appUpdateCheck(f.versionCode) });
    }

    /* ══ v4.0 (Fase 21) · PUBLICAR UPDATE SIN APK ══
       POST /api/v1/config/update {versionCode, versionName, changelog,
       forced?, downloadUrl?} → escribe animax-update.json (mtime cache).
       El APK se sube aparte como animax-latest.apk junto al servidor. */
    if (path === '/api/v1/config/update' && method === 'POST') {
      const versionCode = Number(f.versionCode) || 0;
      const versionName = String(f.versionName || '').trim();
      if (!versionCode || !versionName) {
        return ok({ ok: false, error: 'faltan versionCode y versionName' });
      }
      try {
        fs.writeFileSync(UPDATE_CFG_FILE, JSON.stringify({
          versionCode, versionName,
          changelog: String(f.changelog || ''),
          downloadUrl: String(f.downloadUrl || '/apk/animax-latest.apk'),
          forced: !!f.forced
        }, null, 2) + '\n');
        updCache = { mtime: 0, data: null };
        const apk = pathMod.join(__dirname, 'animax-latest.apk');
        const apkOk = fs.existsSync(apk) ? fs.statSync(apk).size : 0;
        return ok({ ok: true, publicado: true, apkEnServidor: apkOk });
      } catch (e) {
        return ok({ ok: false, error: 'no-se-pudo-escribir: ' + e.message });
      }
    }

    /* ══ v4.0 (Fase 21) · DESCARGA DEL APK ══ — sirve el binario del
       servidor con Content-Length (la app muestra progreso real).     */
    if (path.startsWith('/apk/') && method === 'GET') {
      const safe = pathMod.basename(path);          // sin rutas relativas
      if (!safe.endsWith('.apk')) return ok({ ok: false, error: 'solo .apk' });
      const file = pathMod.join(__dirname, safe);
      if (!fs.existsSync(file)) return ok({ ok: false, error: 'apk-no-encontrado: ' + safe });
      const size = fs.statSync(file).size;
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': size,
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(file).pipe(res);
      return true;
    }

    /* ══ v4.0 (Fase 22) · REPORTE ANÓNIMO DE FALLOS DE REPRODUCCIÓN ══
       La app reporta cuando un stream muere; el servidor penaliza suave
       la fuente (feedback.js) y guarda la señal para el watchdog.     */
    if (path === '/api/v1/report/playback' && method === 'POST') {
      const url = String(f.url || '').trim();
      if (!/^https?:/i.test(url)) return ok({ ok: false, error: 'falta url' });
      const host = feedback.recordReport(url, false, 'playback:' + String(f.error || '').slice(0, 80));
      return ok({ ok: true, host, penalty: penaltyTotalOf(host) });
    }

    /* ══ v6.0 (G4) · DIAGNÓSTICO DEL DUEÑO — stats de bloqueos de ads ══
       La app (opcional, NO automático: cero telemetría por defecto)
       reporta cuántos anuncios bloqueó y los hosts más frecuentes
       (anónimo, deviceId local). Sirve para afinar las listas: si un
       host domina los bloqueos, entra en ad_hosts del server.
         POST {deviceId, blocked, topHosts:[{host,count}]}
         GET  → resumen acumulado (curl / pantalla del dueño).          */
    const ADBLOCK_STATS_FILE = pathMod.join(__dirname, 'animax-adblock-stats.json');
    function adblockStatsLoad() {
      try { return JSON.parse(fs.readFileSync(ADBLOCK_STATS_FILE, 'utf8')); }
      catch { return { devices: {}, updatedAt: null }; }
    }
    function adblockStatsSave(db) {
      try { fs.writeFileSync(ADBLOCK_STATS_FILE, JSON.stringify(db)); } catch {}
    }
    if (path === '/api/v1/report/adblock' && method === 'POST') {
      const deviceId = String(f.deviceId || '').trim().slice(0, 64);
      const blocked = Math.max(0, Math.min(100000, Number(f.blocked) || 0));
      const topHosts = Array.isArray(f.topHosts) ? f.topHosts.slice(0, 50) : [];
      if (!deviceId) return ok({ ok: false, error: 'falta deviceId' });
      const db = adblockStatsLoad();
      const prev = db.devices[deviceId] || { total: 0, topHosts: {} };
      const merged = { ...prev.topHosts };
      for (const th of topHosts) {
        if (!th || !th.host) continue;
        const host = String(th.host).slice(0, 120);
        merged[host] = (merged[host] || 0) + (Number(th.count) || 0);
      }
      db.devices[deviceId] = {
        total: (prev.total || 0) + blocked,
        topHosts: Object.fromEntries(
          Object.entries(merged).sort((a, b) => b[1] - a[1]).slice(0, 50)
        ),
        updatedAt: new Date().toISOString()
      };
      db.updatedAt = db.devices[deviceId].updatedAt;
      adblockStatsSave(db);
      return ok({ ok: true, total: db.devices[deviceId].total });
    }
    if (path === '/api/v1/report/adblock' && method === 'GET') {
      const db = adblockStatsLoad();
      const devices = Object.keys(db.devices || {}).length;
      const total = Object.values(db.devices || {}).reduce((s, d) => s + (d.total || 0), 0);
      const top = {};
      for (const d of Object.values(db.devices || {})) {
        for (const [h, c] of Object.entries(d.topHosts || {})) top[h] = (top[h] || 0) + c;
      }
      return ok({
        ok: true, devices,
        totalBlocked: total,
        topHosts: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 20)
          .map(([host, count]) => ({ host, count })),
        updatedAt: db.updatedAt || null
      });
    }

    /* ════════ RECOMENDADOS (contrato /buscari/api/content/recommend/list) ════════ */
    if (path === '/api/v1/api/content/recommend/list' && method === 'GET') {
      const key = 'v4:recommend';
      let data = cacheGet(key, TTL.hot);
      if (!data) { data = await recommendList(); cacheSet(key, data); }
      return ok({ ok: true, ...data });
    }

    /* ══ v4.0 (Fase 18) · MÓDULO IA (Discover AI) — proxy privado ══
       El dueño configura ANIMAX_AI_URL (endpoint compatible OpenAI),
       ANIMAX_AI_KEY y ANIMAX_AI_MODEL en el servidor. La app NUNCA ve
       la clave. Sin configurar → error "ai-no-configurada" y la app usa
       su fallback local (sin fingir IA). Cero telemetría.               */
    /* ════════ v6.0 (G2) · PROVEEDORES REALES DE EPISODIOS ════════
       Un solo call para la app: título + episodio + idioma → FUENTES
       reproducibles (HLS/MP4/embeds resueltos en profundidad). Cadena:
       proveedores (allanime → hianime) → motor propio v3. Si TODO
       falla, ok:false y la app usa su extractor local del WebView. */
    if (path === '/api/v1/app/episode/list' && (method === 'GET' || method === 'POST')) {
      const q = String(f.q || f.title || '').trim();
      const episode = Number(f.episode || f.ep || 0);
      const lang = String(f.lang || 'any').toLowerCase();
      if (!q) return ok({ ok: false, error: 'falta ?q= (titulo)' });
      if (!episode || episode < 1) return ok({ ok: false, error: 'falta ?episode=' });
      /* v6.0 (G2) · los proveedores externos son OPCIONALES: si faltan o
         fallan, el episodio se resuelve con el MOTOR v3 (fallback más
         abajo). Ya no hay 'proveedores-no-disponibles' duro. */
      if (!providers && typeof buildOptions !== 'function') {
        return ok({ ok: false, error: 'proveedores-no-disponibles' });
      }

      const key = 'prov:res:' + q.toLowerCase() + '|' + episode + '|' + lang;
      const hit = cacheGet(key, TTL.resolve || 900000);
      if (hit) return ok({ ok: true, cached: true, ...hit });

      // 1) Buscar el título en los proveedores y elegir el mejor match.
      const provErrors = [];
      let candidates = [];
      try { candidates = providers ? await providers.searchShow(q) : []; } catch { /* defensivo */ }
      const best3 = candidates.filter(c => c.score >= 0.6).slice(0, 3);
      if (!best3.length) best3.push(...candidates.slice(0, 2));
      if (!best3.length) provErrors.push('proveedores externos: sin resultados para el título');

      // 2) Fuentes por candidato (máx 3) → embeds → resolución profunda.
      const sources = [];
      let fallbackUsed = false;   // v6.0 (G2): true si resolvió el motor propio
      for (const cand of best3) {
        if (sources.length >= 6) break;
        try {
          const { sources: src, errors } = await providers.streamsOf(cand.provider + ':' + cand.showId, episode, lang);
          if (errors && errors.length) provErrors.push(...errors);
          for (const s of src) {
            if (sources.length >= 6) break;
            if (s.type === 'embed' && typeof deepResolveFarm === 'function') {
              try {
                const direct = await deepResolveFarm(s.url, '');
                if (direct) {
                  let valid = false;
                  try { valid = !!(await quickValidate(direct, s.referer)); } catch { valid = false; }
                  sources.push({ ...s, url: direct, type: /\.m3u8(\?|$)/i.test(direct) ? 'hls' : 'mp4', resolvedFrom: s.url, valid });
                  continue;
                }
              } catch { /* embed roto → siguiente */ }
              // sin resolución profunda → se entrega como embed de respaldo
              sources.push({ ...s, valid: false });
              continue;
            }
            let valid = false;
            try { valid = !!(await quickValidate(s.url, s.referer)); } catch { valid = false; }
            sources.push({ ...s, valid });
          }
        } catch (e) {
          provErrors.push(cand.provider + ': ' + String(e && e.message || e).slice(0, 140));
        }
      }

      /* v6.0 (G2) · FALLBACK MOTOR PROPIO: proveedores externos no dieron
         NADA (Cloudflare 403, dominio caído, título raro) → el episodio se
         caza con el motor v3 del SERVIDOR (búsqueda directa en los sitios
         vivos + granja profunda + validación). Mismo contrato de fuentes:
         el teléfono ni se entera de qué cadena funcionó. Límite de 2
         opciones y 6 fuentes para respetar el readTimeout (30 s) del app. */
      if (!sources.length && typeof buildOptions === 'function' && typeof resolveStream === 'function') {
        try {
          const built = await buildOptions(q);
          const opts = (built && built.options) || [];
          const LANG_RANK = { latino: 0, castellano: 1, sub: 2 };
          const wanted = ['latino', 'castellano', 'sub'].includes(lang) ? lang : null;
          const pool = (opts || [])
            .filter(o => o && o.pageUrl && /^https?:\/\//i.test(o.pageUrl))
            .filter(o => !wanted || o.lang === wanted)
            .filter(o => (typeof siteIsUsable !== 'function') || siteIsUsable(o.host) !== false)
            .sort((a, b) => (LANG_RANK[a.lang] ?? 2) - (LANG_RANK[b.lang] ?? 2))
            .slice(0, 2);
          if (!pool.length) provErrors.push('motor propio: sin opciones vivas para "' + q + '"');
          for (const opt of pool) {
            if (sources.length >= 6) break;
            try {
              const r = await resolveStream({ pageUrl: opt.pageUrl, episodeUrl: '', episode, lang: opt.lang });
              const mirrors = (r && r.mirrors) || [];
              for (const m of mirrors) {
                if (sources.length >= 6) break;
                if (!m || !m.url || !/^https?:\/\//i.test(m.url)) continue;
                const isEmb = !!m.isIframe;
                sources.push({
                  url: m.url,
                  provider: opt.host || hostOf(opt.pageUrl),
                  server: m.serverName || m.label || 'espejo',
                  quality: '',
                  type: isEmb ? 'embed' : (/\.m3u8(\?|$)/i.test(m.url) ? 'hls' : 'mp4'),
                  lang: opt.lang || 'sub',
                  referer: m.referer || opt.pageUrl,
                  valid: m.validated === true,
                  source: 'engine-v3'
                });
              }
            } catch (e) {
              provErrors.push('motor:' + (opt.host || '?') + ': ' + String(e && e.message || e).slice(0, 120));
            }
          }
          if (sources.length) {
            fallbackUsed = true;
            provErrors.push('resuelto con el motor propio (engine-v3): ' + sources.length + ' fuente(s)');
          }
        } catch (e) {
          provErrors.push('motor propio: ' + String(e && e.message || e).slice(0, 120));
        }
      }

      // 3) Orden: validados primero, HLS/MP4 antes que embed.
      sources.sort((a, b) => (b.valid - a.valid) || ((a.type === 'embed') - (b.type === 'embed')));
      const payload = {
        query: q, episode, lang, total: sources.length,
        sources,
        engine: fallbackUsed ? 'engine-v3' : 'providers',
        providerErrors: provErrors.slice(0, 6),
        candidates: best3.map(c => ({ provider: c.provider, showId: c.showId, title: c.title, score: c.score }))
      };
      if (sources.length) cacheSet(key, payload);
      if (!sources.length && providers) payload.providerStatus = providers.status();
      return ok({ ok: sources.length > 0, ...payload });
    }

    if (path === '/api/v1/app/episode/resolve' && method === 'POST') {
      const showRef = String(f.showRef || f.showId || '').trim();
      const episode = Number(f.episode || 0);
      const lang = String(f.lang || 'any').toLowerCase();
      if (!showRef || !episode) return ok({ ok: false, error: 'faltan showRef|episode' });

      /* v6.0 (G2) · refs "engine:<pageUrl>" → MOTOR PROPIO. Igual que el
         fallback de episode/list: la granja profunda resuelve el episodio
         desde la página del sitio, sin proveedores externos. */
      if (showRef.startsWith('engine:')) {
        const pageUrl = showRef.slice('engine:'.length).trim();
        if (!/^https?:\/\//i.test(pageUrl)) return ok({ ok: false, error: 'engine-ref-invalida' });
        try {
          const r = await resolveStream({ pageUrl, episodeUrl: '', episode, lang });
          const sources = ((r && r.mirrors) || []).filter(m => m && m.url).slice(0, 6).map(m => ({
            url: m.url,
            provider: hostOf(pageUrl),
            server: m.serverName || m.label || 'espejo',
            quality: '',
            type: m.isIframe ? 'embed' : (/\.m3u8(\?|$)/i.test(m.url) ? 'hls' : 'mp4'),
            lang: lang === 'any' ? 'sub' : lang,
            referer: m.referer || pageUrl,
            valid: m.validated === true,
            source: 'engine-v3'
          }));
          return ok({ ok: sources.length > 0, episode, lang, total: sources.length, sources, engine: 'engine-v3' });
        } catch (e) {
          return ok({ ok: false, error: 'engine-resolve: ' + String(e && e.message || e).slice(0, 140) });
        }
      }

      if (!providers) return ok({ ok: false, error: 'proveedores-no-disponibles' });
      try {
        const { sources: src, errors } = await providers.streamsOf(showRef, episode, lang);
        const sources = [];
        for (const s of src) {
          if (s.type === 'embed' && typeof deepResolveFarm === 'function') {
            try {
              const direct = await deepResolveFarm(s.url, '');
              if (direct) { sources.push({ ...s, url: direct, type: /\.m3u8(\?|$)/i.test(direct) ? 'hls' : 'mp4', resolvedFrom: s.url }); continue; }
            } catch { /* siguiente */ }
          }
          sources.push(s);
        }
        return ok({ ok: sources.length > 0, episode, lang, total: sources.length, sources, providerErrors: errors.slice(0, 6) });
      } catch (e) {
        return ok({ ok: false, error: 'resolve-error: ' + String(e && e.message || e).slice(0, 140) });
      }
    }

    /* ════════ v6.0 (G3+G9) · CONFIG IA (quick prompts en español) ════════
       Equivalente propio de /quan/tools/ai/center/config/info de Seekee
       (FORENSE-G9: AiChatResp → AiCenterConfig → AiTabSubConfig): el
       CONTENIDO del chat lo define NUESTRO servidor — bienvenida, sugerencias
       y placeholder — sin credenciales de terceros y sin publicar APK.
       Override del operador: animax-ai-config.json junto a este archivo
       (patrón sections-config.json, caché por mtime; archivo ausente o
       corrupto → valores por defecto, el endpoint NUNCA se rompe). */
    const AI_CFG_FILE = pathMod.join(__dirname, 'animax-ai-config.json');
    const AI_CFG_DEFAULT = {
      welcomeText: '¡Hola! Soy AniMax IA, tu guía de anime, películas y series. Pregúntame qué ver y te doy recomendaciones en español, con chips «Buscar en la app» para ir directo a la lupa.',
      description: 'Recomendaciones y guía dentro de AniMax. Toca una sugerencia o escribe tu pregunta.',
      inputPrompt: 'Pregúntame qué ver…',
      quickPrompts: [
        { code: 'recomienda', label: 'Recomiéndame algo', prompt: 'Recomiéndame 5 animes buenos y por qué' },
        { code: 'similar', label: 'Parecidos a…', prompt: 'Dime 5 animes similares a ' },
        { code: 'resumen', label: 'Sin spoilers', prompt: 'Resume este anime sin spoilers: ' },
        { code: 'final-cerrado', label: 'Final cerrado', prompt: 'Animes buenos con final cerrado' },
        { code: 'cortos', label: 'Serie corta (≤12 eps)', prompt: 'Animes muy buenos de 12 episodios o menos' },
        { code: 'top-accion', label: 'Top acción', prompt: 'Los 5 mejores animes de acción con buena animación' },
        { code: 'deportes', label: 'Deportes', prompt: 'Animes deportivos que valgan la pena' },
        { code: 'romance', label: 'Romance', prompt: 'Animes de romance maduros y bien escritos' },
        { code: 'clasifican', label: 'Ayúdame a elegir', prompt: 'Estoy entre dos animes: ' },
        { code: 'peliculas', label: 'Películas', prompt: 'Las 5 mejores películas anime imprescindibles' }
      ]
    };
    let aiCfgCache = { mtime: 0, data: null };
    function aiConfig() {
      try {
        const st = fs.statSync(AI_CFG_FILE);
        if (aiCfgCache.data && st.mtimeMs === aiCfgCache.mtime) return aiCfgCache.data;
        const raw = JSON.parse(fs.readFileSync(AI_CFG_FILE, 'utf8'));
        const clean = {
          welcomeText: String(raw.welcomeText || AI_CFG_DEFAULT.welcomeText),
          description: String(raw.description || AI_CFG_DEFAULT.description),
          inputPrompt: String(raw.inputPrompt || AI_CFG_DEFAULT.inputPrompt),
          quickPrompts: Array.isArray(raw.quickPrompts) && raw.quickPrompts.length
            ? raw.quickPrompts
                .filter(p => p && p.label && p.prompt !== undefined)
                .map((p, i) => ({
                  code: String(p.code || ('p' + (i + 1))),
                  label: String(p.label),
                  prompt: String(p.prompt)
                }))
            : AI_CFG_DEFAULT.quickPrompts
        };
        aiCfgCache = { mtime: st.mtimeMs, data: clean };
        return clean;
      } catch {
        return AI_CFG_DEFAULT;   // sin override del operador (o corrupto)
      }
    }
    if (path === '/api/v1/ai/config' && method === 'GET') {
      const cfg = aiConfig();
      return ok({
        ok: true,
        // v6.0 (G9): bandera de capacidad por AiType (paridad Text/Image).
        // Image queda DESACTIVADA hasta que el operador conecte un backend
        // de imágenes — no se finge capacidad que no hay.
        aiTypes: [
          { code: 'Text', name: 'Chat', enabled: !!process.env.ANIMAX_AI_URL },
          { code: 'Image', name: 'Imagen', enabled: false }
        ],
        welcomeText: cfg.welcomeText,
        description: cfg.description,
        inputPrompt: cfg.inputPrompt,
        quickPrompts: cfg.quickPrompts
      });
    }

    if (path === '/api/v1/ai/chat' && method === 'POST') {
      const messages = Array.isArray(f.messages) ? f.messages : [];
      if (!messages.length) return ok({ ok: false, error: 'faltan messages' });
      const aiUrl = process.env.ANIMAX_AI_URL;
      const aiKey = process.env.ANIMAX_AI_KEY || '';
      const aiModel = process.env.ANIMAX_AI_MODEL || '';
      if (!aiUrl) return ok({ ok: false, error: 'ai-no-configurada' });
      const model = (typeof f.model === 'string' && f.model.trim()) || aiModel || 'default';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 55000);
        const upstream = await fetch(aiUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            ...(aiKey ? { authorization: 'Bearer ' + aiKey } : {})
          },
          body: JSON.stringify({ model, messages })
        });
        clearTimeout(timer);
        if (!upstream.ok) return ok({ ok: false, error: 'ai-upstream-' + upstream.status });
        const data = await upstream.json();
        const reply = data &&
          (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
          data.reply || data.content || data.text || '';
        if (!reply) return ok({ ok: false, error: 'ai-respuesta-vacia' });
        return ok({ ok: true, reply: String(reply), model: String(data.model || model) });
      } catch (e) {
        return ok({ ok: false, error: 'ai-error: ' + (e && e.message) });
      }
    }

    if (path === '/api/v1/ai/models' && method === 'GET') {
      const list = String(process.env.ANIMAX_AI_MODELS || '')
        .split(',').map(s => s.trim()).filter(Boolean)
        .map(id => ({ id, name: id }));
      if (process.env.ANIMAX_AI_MODEL && !list.some(m => m.id === process.env.ANIMAX_AI_MODEL)) {
        list.unshift({ id: process.env.ANIMAX_AI_MODEL, name: process.env.ANIMAX_AI_MODEL });
      }
      return ok({ ok: true, data: list });
    }

    /* ══ v4.0 (Fase 20) · DEPORTES — fixtures de fútbol (proxy ESPN) ══
       Fuente pública (site.api.espn.com), cacheada 10 min por liga+fecha.
       Ligas: Premier, LaLiga, Serie A, Bundesliga, Ligue 1, Champions,
       Liga MX, Argentina, Colombia, Brasil.                            */
    const SPORT_LEAGUES = [
      { id: 'eng.1', name: 'Premier League', country: 'Inglaterra' },
      { id: 'esp.1', name: 'LaLiga', country: 'España' },
      { id: 'ita.1', name: 'Serie A', country: 'Italia' },
      { id: 'ger.1', name: 'Bundesliga', country: 'Alemania' },
      { id: 'fra.1', name: 'Ligue 1', country: 'Francia' },
      { id: 'uefa.champions', name: 'Champions League', country: 'Europa' },
      { id: 'mex.1', name: 'Liga MX', country: 'México' },
      { id: 'arg.1', name: 'Liga Profesional', country: 'Argentina' },
      { id: 'col.1', name: 'Categoría Primera A', country: 'Colombia' },
      { id: 'bra.1', name: 'Brasileirão', country: 'Brasil' }
    ];
    async function espnFixtures(leagueId, date) {
      const key = 'v4:sport:' + leagueId + ':' + date;
      let cached = cacheGet(key, 10 * 60 * 1000);
      if (cached) return cached;
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueId}/scoreboard?dates=${date}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const events = [];
      try {
        const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0 AniMax/4.0' } });
        if (res.ok) {
          const data = await res.json();
          for (const ev of (data.events || [])) {
            const comp = ev.competitions && ev.competitions[0];
            if (!comp) continue;
            const team = side => {
              const c = (comp.competitors || []).find(x => x.homeAway === side) || {};
              return {
                name: c.team && (c.team.displayName || c.team.name) || side,
                logo: c.team && c.team.logo || '',
                score: typeof c.score === 'string' ? parseInt(c.score, 10) : (typeof c.score === 'number' ? c.score : -1)
              };
            };
            const rawStatus = (ev.status && (ev.status.type || ev.status.description)) || {};
            const state = String(rawStatus.state || rawStatus.name || 'pre').toLowerCase();
            const status = state === 'in' ? 'LIVE' : state === 'post' ? 'FINISHED' : 'SCHEDULED';
            events.push({
              id: String(ev.id || (leagueId + date + events.length)),
              leagueId,
              startTime: Number(ev.date ? Date.parse(ev.date) : (comp.date ? Date.parse(comp.date) : 0)),
              status,
              homeName: team('home').name, homeLogo: team('home').logo, homeScore: team('home').score,
              awayName: team('away').name, awayLogo: team('away').logo, awayScore: team('away').score,
              venue: (comp.venue && comp.venue.fullName) || ''
            });
          }
        }
      } catch (e) { /* sin fixtures: lista vacía, nunca error 500 */ }
      finally { clearTimeout(timer); }
      cacheSet(key, events);   // también vacía: 10 min sin martillar ESPN
      return events;
    }

    if (path === '/api/v1/sports/leagues' && method === 'GET') {
      return ok({ ok: true, data: SPORT_LEAGUES });
    }

    if (path === '/api/v1/sports/fixtures' && method === 'GET') {
      const leagueId = String(f.league || '').trim();
      if (!SPORT_LEAGUES.some(l => l.id === leagueId)) {
        return ok({ ok: false, error: 'liga-desconocida (usa /api/v1/sports/leagues)' });
      }
      let date = String(f.date || '').trim();
      if (!/^\d{8}$/.test(date)) date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      return ok({ ok: true, date, data: await espnFixtures(leagueId, date) });
    }

    /* ════════ REPORTES DE FUENTES (re-priorización, anónimo) ════════ */

    /* ══ v4.0 (Fase 15) · SINCRONIZACIÓN DE "CONTINUAR VIENDO" ══
       Historial privado multi-dispositivo: cada app hace push/pull de
       su progreso (deviceId local, UUID) y el servidor fusiona por
       contentId+episodeId ganando el updatedAt mayor. Privado: solo
       con la API key del dueño (si está configurada).                  */
    const HISTORY_FILE = pathMod.join(__dirname, 'animax-history.json');
    function historyLoad() {
      try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); }
      catch { return { entries: {} }; }   // clave "contentId|episodeId|deviceId"
    }
    function historySave(db) {
      try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(db)); } catch {}
    }

    if (path === '/api/v1/sync/history' && method === 'POST') {
      const deviceId = String(f.deviceId || '').trim();
      const entries = Array.isArray(f.entries) ? f.entries : [];
      if (!deviceId) return ok({ ok: false, error: 'falta deviceId' });
      if (!entries.length) return ok({ ok: true, guardadas: 0 });
      const db = historyLoad();
      let guardadas = 0;
      for (const e of entries.slice(0, 500)) {
        if (!e || !e.contentId || !e.episodeId) continue;
        const key = `${e.contentId}|${e.episodeId}|${deviceId}`;
        const prev = db.entries[key];
        const next = {
          contentId: String(e.contentId), episodeId: String(e.episodeId),
          positionMs: Math.max(0, Number(e.positionMs) || 0),
          durationMs: Math.max(0, Number(e.durationMs) || 0),
          sourceUrl: String(e.sourceUrl || ''), lang: String(e.lang || ''),
          title: String(e.title || ''), cover: String(e.cover || ''),
          deviceId, updatedAt: Number(e.updatedAt) || Date.now()
        };
        if (prev && prev.updatedAt >= next.updatedAt) continue;  // merge: gana el más nuevo
        db.entries[key] = next;
        guardadas++;
      }
      if (guardadas) historySave(db);
      return ok({ ok: true, guardadas });
    }

    if (path === '/api/v1/sync/history' && method === 'GET') {
      const since = Number(f.since) || 0;
      const db = historyLoad();
      const all = Object.values(db.entries).filter(e => e.updatedAt > since);
      /* Sin deviceId: TODO el historial (fusión multi-dispositivo, es del
         mismo dueño). Con deviceId: solo el de ese dispositivo.          */
      const mine = f.deviceId ? all.filter(e => e.deviceId === String(f.deviceId)) : all;
      mine.sort((a, b) => a.updatedAt - b.updatedAt);
      return ok({ ok: true, data: mine.slice(0, 1000) });
    }

    if (path === '/api/v1/sync/history/devices' && method === 'GET') {
      const db = historyLoad();
      const devices = [...new Set(Object.values(db.entries).map(e => e.deviceId))];
      return ok({ ok: true, data: devices });
    }

    if (path === '/api/report/web' || path === '/api/v1/report/web') {
      if (method === 'POST') {
        const url = String(f.url || '').trim();
        if (!/^https?:/i.test(url)) return ok({ ok: false, error: 'falta url' });
        const host = feedback.recordReport(url, !!f.ok, f.reason);
        return ok({ ok: true, host, penalty: penaltyTotalOf(host) });
      }
      // GET: resumen de salud por fuente (pantalla "Estado de fuentes").
      // Incluye los sitios del catálogo Y cualquier host con reportes
      // (aunque ya no esté en el catálogo, su señal sigue siendo útil).
      const seen = new Set();
      const summary = [];
      for (const s of allSitesConfig()) {
        seen.add(s.host);
        const h = siteHealth.get(s.host);
        const st = statsOf(s.host);
        summary.push({
          host: s.host, kind: s.kind, lang: s.lang,
          alive: h ? h.ok : null, ms: h ? h.ms : null,
          reports: st.reports, search: st.search,
          penalty: st.penalty, lastReason: st.lastReason
        });
      }
      for (const host of feedback.reportStore.keys()) {
        if (seen.has(host)) continue;
        const st = statsOf(host);
        summary.push({
          host, kind: 'desconocido', lang: 'desconocido',
          alive: null, ms: null,
          reports: st.reports, search: st.search,
          penalty: st.penalty, lastReason: st.lastReason
        });
      }
      return ok({ ok: true, summary });
    }

    return false;   // no era ruta v4 → sigue el router clásico
  };

  /* v7.0 (H5): ganchos para el arnés de pruebas (test-H5-v4.js) —
     normalización reforzada, ranking y tarjeta del Hub, sin arrancar
     server. El router en runtime no los usa. */
  v4Route._h5 = {
    normalizeTitleV2, titleRankV2, buildHubCard, hubFrontCard,
    LANG_PRIORITY, SECTION_STYLES, LOCAL_FEED_STYLES, anilistSeasonOf
  };
  return v4Route;
};

/* Expuesto solo para el arnés de pruebas (test-v4-api.js). */
module.exports.SNIFFER_JS = SNIFFER_JS;
