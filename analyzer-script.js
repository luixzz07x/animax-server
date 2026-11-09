#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   AniMax 7.0.0 · FASE H3 — ANALIZADOR DE PÁGINAS REMOTO (analyzer-script.js)
   Espejo del resourceAnalysis.html + onceParser de Seekee 1.4.0, en limpio.
   ════════════════════════════════════════════════════════════════════════

   USO:
     node analyzer-script.js > analyzer.js     (solo el JS inyectable)

   Este archivo NO es un servidor: GENERA el JavaScript que el servidor
   sirve crudo en `application/javascript` en:

     GET /api/v1/config/analyzer.js   (hermano de sniffer.js — v4-api.js)
     GET /api/v1/config/analyzer      (alias)

   · Se inyecta en el asset `resourceAnalysis.html` de la app
     (ResourceAnalyzer.kt: WebView del asset → onceAnalyzer(html, url) →
     JSON AnalysisResourceData por el interfaz `AnimaxAnalyzer`).
   · El SERVIDOR también lo ejecuta (mismo script, mismo contrato) dentro
     de una sandbox `vm` para el endpoint GET/POST /api/v1/hub/analyze —
     una sola implementación, dos entornos, CERO divergencia.

   CONTRATO (beans espejo de H1, docs/HubContracts.kt):
     onceAnalyzer(html, url) → STRING JSON de
     {
       "pageBaseInfo": { "title", "cover", "description" },
       "seasons": [ { "id", "title", "url", "isActive",
                      "episodes": [ { "id", "title", "url", "isActive" } ] } ]
     }
   · Alias `onceParser` (nombre del original de Seekee) por fidelidad.
   · Actualizable SIN APK: si un sitio cambia su HTML, se actualiza este
     script en el servidor y TODAS las apps vuelven a funcionar — el
     arreglo definitivo de «dejó de funcionar un sitio».

   REGLAS del script (para poder vivir en los 3 entornos):
     · SIN caracteres "$" y SIN backticks (se embebe como raw string de
       Kotlin en ResourceAnalyzer.kt, igual que SNIPPER_FALLBACK_JS).
     · Puro procesamiento de STRINGS — sin DOM, sin document, sin
       location: todo sale del `html` y de la `url` recibidos.
     · Nunca lanza: cualquier error → JSON con seasons vacías.
     · Idempotente: guard window.__animaxAnalyzerRemoteV1 (distinto del
       guard del asset embebido para que la inyección remota SIEMPRE
       pueda sobrescribir window.onceAnalyzer).
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

const ANALYZER_JS = `(function () {
  'use strict';
  /* AniMax ResourceAnalyzer v1.0 (FASE H3) — espejo del onceParser de
     Seekee 1.4.0, reimplementado en limpio. Analiza el HTML de una página
     de episodios y extrae {pageBaseInfo, seasons[]} para el puente nativo.
     Nunca rompe el entorno anfitrión (app, asset o sandbox Node). */
  var w = (typeof window !== 'undefined') ? window : this;
  if (w && w.__animaxAnalyzerRemoteV1) { return; }
  if (w) { w.__animaxAnalyzerRemoteV1 = true; }

  /* ---------------- utilidades de texto ---------------- */
  function decodeEntities(s) {
    return String(s || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/&#x2F;/gi, '/').replace(/&nbsp;/g, ' ');
  }
  function stripTags(s) {
    return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' '))
      .replace(/\\s+/g, ' ').trim();
  }
  function firstGroup(m) { return (m && m[1]) ? m[1] : ''; }

  /* ---------------- utilidades de URL ---------------- */
  function originOf(u) {
    var m = String(u || '').match(/^https?:\\/\\/[^\\/?#]+/i);
    return m ? m[0] : '';
  }
  function dirOf(u) {
    var o = originOf(u);
    var rest = String(u || '').slice(o.length);
    var q = rest.indexOf('?'); if (q >= 0) { rest = rest.slice(0, q); }
    var h = rest.indexOf('#'); if (h >= 0) { rest = rest.slice(0, h); }
    var i = rest.lastIndexOf('/');
    return o + (i > 0 ? rest.slice(0, i + 1) : '/');
  }
  function absolutize(href, base) {
    try {
      var t = String(href || '').trim();
      if (!t || t.charAt(0) === '#') { return ''; }
      if (/^(javascript|mailto|tel|data):/i.test(t)) { return ''; }
      if (/^https?:\\/\\/[^\\/?#]+/i.test(t)) { return t; }
      if (t.indexOf('//') === 0) { return 'https:' + t; }
      if (t.indexOf('/') === 0) { return originOf(base) + t; }
      return dirOf(base) + t;
    } catch (e) { return ''; }
  }

  /* ---------------- clasificación ---------------- */
  var AD_HINT = /(doubleclick|googlesyndication|googleadservices|adservice|adsrvr|adnxs|criteo|taboola|outbrain|popads|popcash|propellerads|exoclick|juicyads|mgid|revcontent)/i;
  var NOISE_HREF = /(facebook\\.com|twitter\\.com|x\\.com|instagram\\.com|youtube\\.com|t\\.me|telegram|whatsapp|discord|tiktok\\.com|mailto:|play\\.google|apple\\.com)/i;
  var PAGINATION = /\\/?(?:page|pag|pagina)\\/?\\d+/i;
  var GENERIC_LIST = '|finalizado|en emisi\\u00f3n|en emision|en curso|en vivo|ver|ver online|ver m\\u00e1s|ver mas|ver todo|online|hd|4k|latino|subtitulado|doblado|estreno|estrenos|nuevo|popular|tendencia|trending|dorama|doramas|pelicula|pel\\u00edculas|peliculas|serie|series|anime|menu|menus|inicio|buscar|descargar|comentar|comentarios|';
  function isGenericText(t) {
    var s = String(t || '').toLowerCase();
    return s.length < 26 && GENERIC_LIST.indexOf('|' + s + '|') >= 0;
  }
  var EP_TEXT = /(?:episodio|episodios|episode|cap[ií]tulo|capitulo|cap|ep)[\\s_.-]*(\\d{1,4})(?!\\d)/i;
  var EP_HREF = /\\/(?:episodio|episodios|episode|capitulo|cap[ií]tulo|cap|ep)[\\s_-]*(\\d{1,4})(?!\\d)/i;
  var EP_SLUG = /-ep(?:isodio)?[-_]?(\\d{1,4})(?!\\d)/i;
  var SEASON_WORD = /(?:temporada|season|sagas?)\\s*(\\d{1,2})(?!\\d)/gi;
  var TITLE_RE = /<title>([^<]{3,160})<\\/title>/i;
  var OG_IMAGE = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i;
  var OG_DESC = /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i;
  var META_DESC = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i;
  var JS_EPISODES = /var\\s+episodes\\s*=\\s*\\[([\\d,\\s]+)\\]/;

  var MAX_EPS = 1500, MAX_SEASONS = 40;

  /* ---------------- extracción de enlaces de episodio ---------------- */
  function collectEpisodes(html, base, seen) {
    var out = [];
    var byNum = {};
    var re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      try {
        var abs = absolutize(m[1], base);
        if (!abs || abs.indexOf('http') !== 0) { continue; }
        if (AD_HINT.test(abs) || NOISE_HREF.test(abs) || PAGINATION.test(abs)) { continue; }
        var text = stripTags(m[2]);
        if (!text || text.length > 90) { continue; }
        if (isGenericText(text)) { continue; }
        var n = null, mm = (text + ' ' + abs).match(EP_TEXT);
        if (mm) { n = parseInt(mm[1], 10); }
        if (n == null) { mm = abs.match(EP_HREF); if (mm) { n = parseInt(mm[1], 10); } }
        if (n == null) { mm = abs.match(EP_SLUG); if (mm) { n = parseInt(mm[1], 10); } }
        if (n == null || n < 1 || n > 2000) { continue; }
        if (!byNum[n] && !seen[abs]) {
          byNum[n] = true; seen[abs] = true;
          out.push({ id: abs, title: text.slice(0, 80), url: abs, n: n });
        }
      } catch (e) { /* nunca romper el escaneo */ }
    }
    out.sort(function (a, b) { return a.n - b.n; });
    var clean = [];
    for (var i = 0; i < out.length && clean.length < MAX_EPS; i++) {
      clean.push({
        id: out[i].id,
        title: out[i].title,
        url: out[i].url,
        isActive: clean.length === 0
      });
    }
    return clean;
  }

  /* ---------------- temporadas por encabezados «Temporada N» --------------
     La interpretación más precisa del documento: cada marca «Temporada N»
     delata un BLOQUE del HTML con su propia lista de episodios. Cada
     bloque debe rendir >= 3 episodios para contar (evita sinopsis que
     mencionan «temporada» de pasada).                                  */
  function seasonsFromHeadings(html, base, seen) {
    var marks = [];
    var re = new RegExp(SEASON_WORD.source, 'gi'), m;
    while ((m = re.exec(html)) !== null) {
      marks.push({ n: parseInt(m[1], 10), at: m.index });
      if (marks.length >= MAX_SEASONS * 3) { break; }
    }
    if (marks.length < 2) { return []; }
    var out = [];
    for (var i = 0; i < marks.length; i++) {
      try {
        var from = marks[i].at;
        var to = (i + 1 < marks.length) ? marks[i + 1].at : html.length;
        if (to - from > 120000) { to = from + 120000; }
        var eps = collectEpisodes(html.slice(from, to), base, seen);
        if (eps.length >= 3) {
          var dup = null;
          for (var j = 0; j < out.length; j++) {
            if (out[j].season === marks[i].n) { dup = out[j]; break; }
          }
          if (!dup) {
            out.push({ season: marks[i].n, title: 'Temporada ' + marks[i].n, episodes: eps });
          } else if (eps.length > dup.episodes.length) {
            dup.episodes = eps;
          }
        }
        if (out.length >= MAX_SEASONS) { break; }
      } catch (e) { /* nunca romper el análisis */ }
    }
    return out;
  }

  /* ---------------- síntesis tipo tioanime (JSON numérico) ---------------- */
  function synthFromJson(html, pageUrl, seen) {
    try {
      var jsEps = html.match(JS_EPISODES);
      var slug = (pageUrl.match(/\\/anime\\/([^\\/?#]+)/) || [])[1];
      if (!jsEps || !slug) { return []; }
      var nums = jsEps[1].split(',').map(function (s) { return parseInt(s, 10); })
        .filter(function (n) { return n > 0 && n <= 2000; });
      if (nums.length < 3) { return []; }
      var origin = originOf(pageUrl);
      var template = origin + '/ver/' + slug + '-{N}';
      var eps = [];
      for (var i = 0; i < nums.length && eps.length < MAX_EPS; i++) {
        var url = template.replace('{N}', String(nums[i]));
        if (seen[url]) { continue; }
        seen[url] = true;
        eps.push({
          id: url, title: 'Episodio ' + nums[i], url: url,
          isActive: eps.length === 0
        });
      }
      return [{ season: 1, title: 'Episodios', episodes: eps }];
    } catch (e) { return []; }
  }

  /* ---------------- NÚCLEO: onceAnalyzer(html, url) ---------------- */
  function onceAnalyzer(html, pageUrl) {
    var result = {
      pageBaseInfo: { title: '', cover: '', description: '' },
      seasons: []
    };
    try {
      html = String(html || '');
      pageUrl = String(pageUrl || '');
      if (!html || html.length < 60 || pageUrl.indexOf('http') !== 0) {
        return JSON.stringify(result);
      }
      /* pageBaseInfo (espejo del bean de H1) */
      result.pageBaseInfo.title = stripTags(firstGroup(html.match(TITLE_RE))).slice(0, 160);
      result.pageBaseInfo.cover = decodeEntities(firstGroup(html.match(OG_IMAGE))).slice(0, 500);
      result.pageBaseInfo.description = stripTags(firstGroup(html.match(OG_DESC)) ||
        firstGroup(html.match(META_DESC))).slice(0, 400);

      var seasons = [];
      var sn = (pageUrl.match(/temporada-(\\d{1,2})/i) || pageUrl.match(/season-(\\d{1,2})/i) || [])[1];

      /* 1) ESTRUCTURA REAL: encabezados «Temporada N» que dividen el HTML
         en bloques con SU PROPIA lista de episodios. Primero y con seen
         limpio (sin contaminar): es la interpretación más fiel del documento. */
      var heads = seasonsFromHeadings(html, pageUrl, {});
      if (heads.length >= 2) {
        seasons = heads;
      } else {
        /* 2) ESTRUCTURA PLANA: enlaces de episodio del documento completo
           (una única temporada — la mayoría de los sitios de anime). */
        var flat = collectEpisodes(html, pageUrl, {});
        if (flat.length >= 2) {
          seasons.push({
            id: 'page', title: sn ? ('Temporada ' + sn) : 'Episodios', url: '',
            season: sn ? parseInt(sn, 10) : 1,
            episodes: flat
          });
        }
        /* Un único bloque de headings mejor etiquetado gana si es al menos
           tan completo como la lista plana. */
        if (heads.length === 1 &&
            (!seasons.length || heads[0].episodes.length >= seasons[0].episodes.length)) {
          seasons = heads;
        }
        /* 3) Síntesis JSON (tioanime y clones) si aún no hay nada. */
        if (!seasons.length) {
          seasons = synthFromJson(html, pageUrl, {});
        }
      }

      /* Normalizar al contrato AnalysisResourceData (H1) */
      var out = [];
      var ordered = seasons.slice(0, MAX_SEASONS);
      ordered.sort(function (a, b) { return (a.season || 1) - (b.season || 1); });
      for (var s = 0; s < ordered.length; s++) {
        var se = ordered[s];
        if (!se.episodes || !se.episodes.length) { continue; }
        out.push({
          id: String(se.id || ('s' + (s + 1))),
          title: String(se.title || ('Temporada ' + (s + 1))).slice(0, 60),
          url: String(se.url || ''),
          isActive: out.length === 0,
          episodes: se.episodes
        });
      }
      result.seasons = out;
      return JSON.stringify(result);
    } catch (e) {
      try { return JSON.stringify(result); } catch (e2) { return '{"pageBaseInfo":{"title":"","cover":"","description":""},"seasons":[]}'; }
    }
  }

  /* Contrato de la app: window.onceAnalyzer + alias onceParser (nombre
     del original de Seekee). En la sandbox Node, w === sandbox.window. */
  if (w) {
    w.onceAnalyzer = onceAnalyzer;
    w.onceParser = onceAnalyzer;
  }
  return onceAnalyzer;
})();`;

/* Salida: SOLO el JavaScript inyectable. Exportable — v4-api.js lo
   require() y lo sirve con caché por mtime (igual que sniffer-script.js),
   y el endpoint /api/v1/hub/analyze lo ejecuta en sandbox `vm`. */
if (require.main === module) console.log(ANALYZER_JS);
module.exports = { ANALYZER_JS };
