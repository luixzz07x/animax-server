#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
   AniMax 4.0.0 · FASE 7 — SNIFFER DE VÍDEO (sniffer-script.js)
   Espejo del ResourceAnalysisScript de Seekee 1.4.0.
   ════════════════════════════════════════════════════════════════════════

   USO:
     node sniffer-script.js > sniffer.js

   Este archivo NO es un servidor: es un GENERADOR. Al ejecutarse imprime
   por consola (console.log) el JavaScript PURO que debe servirse como
   `application/javascript` en:

     GET /api/v1/config/sniffer.js   (contrato ya presente en v4-api.js)
     GET /api/v1/config/sniffer      (alias que VideoSniffer.kt también prueba)

   El orquestador de la Fase 7 debe copiar el cuerpo de SNIFFER_JS de aquí
   a la constante SNIFFER_JS de v4-api.js (sustituyendo la versión básica
   de Fase 1), o leer este archivo con fs.readFileSync al arrancar.

   El script inyectado:
     · Detecta en vivo URLs .m3u8 (master y variantes), .mp4 directos,
       iframes de players (filemoon/dood/mixdrop/streamtape/streamwish/
       vidmoly/uqload/mp4upload/okru) y blobs de <video src>.
     · Interceptar XMLHttpRequest.prototype.open y window.fetch: reporta
       por EXTENSIÓN de la URL y por Content-Type de la RESPUESTA
       (mpegurl / mp4).
     · Reporta cada hallazgo llamando a
       window.AnimaxSniffer?.resourceAnalysisCallback(JSON.stringify({
         url, type: 'M3U8'|'MP4'|'IFRAME', title, pageUrl, ts }))
       (con respaldo en window.AnimaxResourceAnalysis para el script v1
       que el servidor sirve hoy).
     · Callbacks espejo de Seekee: resourceAnalysisCallback,
       webStateChangeCallback (estados de carga) y htmlResourceCallback
       (outerHTML recortado a 200 KB cuando cambia el DOM de un player).
     · Todo envuelto en try/catch — NUNCA rompe la página anfitriona.
     · Idempotente: guard window.__animaxSnifferV1.
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

/* v4.0 (Fase 7): el cuerpo inyectable. Sin backticks ni interpolación
   para poder copiarse TAL CUAL a la constante SNIFFER_JS de v4-api.js
   (template literal de Node) y a SNIPPER_FALLBACK_JS de VideoSniffer.kt
   (raw string de Kotlin: tampoco puede contener '$'). */
const SNIFFER_JS = `(function () {
  'use strict';
  /* AniMax ResourceAnalysisScript v4.0 (Fase 7) — espejo del sniffer de
     Seekee 1.4.0. Detección en vivo de recursos de vídeo para el puente
     nativo (VideoSniffer.kt). Nunca rompe la página anfitriona. */
  if (window.__animaxSnifferV1) { return; }
  window.__animaxSnifferV1 = true;

  /* ---------------- Clasificación ---------------- */
  var M3U8_RE = /(?:\\.|=)m3u8(?:\\?|#|$)/i;
  var MP4_RE = /(?:\\.|=)(mp4|m4v|mov|webm|mkv|flv|3gp)(?:\\?|#|$)/i;
  var PLAYER_RE = /(filemoon|dood(?:stream)?|mixdrop|streamtape|streamwish|vidmoly|uqload|mp4upload|ok\\.ru|okru|streamsb|megacloud|embtaku)/i;
  var VIDEO_CT_RE = /(mpegurl|application\\/mp4|video\\/mp4)/i;
  var M3U8_CT_RE = /mpegurl/i;

  var seen = {};
  var lastHtmlSent = '';
  var lastHtmlAt = 0;

  /* ---------------- Puente nativo (espejo Seekee) ----------------
     VideoSniffer.kt registra la interfaz como "AnimaxSniffer"; el script
     v1 de Fase 1 del servidor usaba "AnimaxResourceAnalysis" — se aceptan
     ambos nombres para no romper la retro-compatibilidad. */
  function bridge() {
    try { return window.AnimaxSniffer || window.AnimaxResourceAnalysis || null; }
    catch (e) { return null; }
  }

  function classify(u) {
    try {
      if (!u || typeof u !== 'string' || u.length < 5) { return ''; }
      if (u.indexOf('data:') === 0 || u.indexOf('javascript:') === 0) { return ''; }
      if (M3U8_RE.test(u)) { return 'M3U8'; }
      if (MP4_RE.test(u)) { return 'MP4'; }
      if (PLAYER_RE.test(u)) { return 'IFRAME'; }
      return '';
    } catch (e) { return ''; }
  }

  function report(url, type) {
    try {
      if (!url || typeof url !== 'string') { return; }
      if (url.indexOf('data:') === 0) { return; }
      if (url === 'blob:' || url === 'about:blank') { return; }
      if (seen[url]) { return; }
      seen[url] = true;
      var b = bridge();
      if (!b || !b.resourceAnalysisCallback) { return; }
      b.resourceAnalysisCallback(JSON.stringify({
        url: url,
        type: type,
        title: (document.title || '').substring(0, 200),
        pageUrl: location.href,
        ts: Date.now()
      }));
    } catch (e) { /* nunca romper la página */ }
  }

  function reportUrl(u) {
    var t = classify(u);
    if (t) { report(u, t); }
  }

  /* ---------------- webStateChangeCallback (estados de carga) ---------------- */
  function state(s) {
    try {
      var b = bridge();
      if (b && b.webStateChangeCallback) {
        b.webStateChangeCallback(JSON.stringify({
          state: s, url: location.href, ts: Date.now()
        }));
      }
    } catch (e) {}
  }

  /* ---------------- htmlResourceCallback (DOM del player) ----------------
     outerHTML de documentElement recortado a 200 KB, con debounce de 3 s
     y deduplicación del HTML idéntico consecutivo. */
  function sendHtml() {
    try {
      var now = Date.now();
      if (now - lastHtmlAt < 3000) { return; }
      var b = bridge();
      if (!b || !b.htmlResourceCallback) { return; }
      var html = (document.documentElement && document.documentElement.outerHTML) || '';
      if (!html || html === lastHtmlSent) { return; }
      lastHtmlSent = html;
      lastHtmlAt = now;
      if (html.length > 200000) { html = html.substring(0, 200000); }
      b.htmlResourceCallback(JSON.stringify({
        html: html, url: location.href, ts: now
      }));
    } catch (e) {}
  }

  /* ---------------- Escáneo del DOM (en vivo) ---------------- */
  function scanDom() {
    try {
      var els = document.querySelectorAll('video, video source, iframe[src], embed[src]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var tag = (el.tagName || '').toLowerCase();
        if (tag === 'iframe' || tag === 'embed') {
          var isrc = el.getAttribute('src') || '';
          if (isrc && PLAYER_RE.test(isrc)) { report(isrc, 'IFRAME'); }
          continue;
        }
        var src = el.currentSrc || el.getAttribute('src') || '';
        if (!src) { continue; }
        if (src.indexOf('blob:') === 0) {
          /* blob NO vacío de <video src>: se reporta como MP4 (el nativo
             decide si le sirve; los blob vacíos se descartan aquí y allí). */
          if (src.length > 5) { report(src, 'MP4'); }
          continue;
        }
        reportUrl(src);
      }
    } catch (e) {}
  }

  /* ---------------- 1. XMLHttpRequest.prototype.open ---------------- */
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      try {
        if (arguments.length > 1) { reportUrl(String(arguments[1])); }
      } catch (e) {}
      var xhr = this;
      try {
        xhr.addEventListener('load', function () {
          try {
            var ct = (xhr.getResponseHeader && xhr.getResponseHeader('Content-Type')) || '';
            var finalUrl = xhr.responseURL || '';
            if (ct && finalUrl && VIDEO_CT_RE.test(ct)) {
              report(finalUrl, M3U8_CT_RE.test(ct) ? 'M3U8' : 'MP4');
            }
          } catch (e) {}
        });
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
  } catch (e) {}

  /* ---------------- 2. window.fetch ---------------- */
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function () {
        try {
          var a = arguments[0];
          var u = (typeof a === 'string') ? a : (a && a.url) ? String(a.url) : '';
          if (u) { reportUrl(u); }
        } catch (e) {}
        var p = origFetch.apply(this, arguments);
        try {
          p.then(function (resp) {
            try {
              var ct = (resp && resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
              if (ct && resp.url && VIDEO_CT_RE.test(ct)) {
                report(resp.url, M3U8_CT_RE.test(ct) ? 'M3U8' : 'MP4');
              }
            } catch (e) {}
          }).catch(function () {});
        } catch (e) {}
        return p;
      };
    }
  } catch (e) {}

  /* ---------------- 3. Asignaciones video.src = ... (blobs incluidos) ---------------- */
  try {
    var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    var desc = proto && Object.getOwnPropertyDescriptor(proto, 'src');
    if (desc && desc.get && desc.set) {
      Object.defineProperty(proto, 'src', {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () { try { return desc.get.call(this); } catch (e) { return ''; } },
        set: function (v) {
          try {
            var s = String(v || '');
            if (s.indexOf('blob:') === 0) { if (s.length > 5) { report(s, 'MP4'); } }
            else { reportUrl(s); }
          } catch (e) {}
          try { desc.set.call(this, v); } catch (e) {}
        }
      });
    }
  } catch (e) {}

  /* ---------------- 4. Players perezosos: MutationObserver ---------------- */
  try {
    var mo = new MutationObserver(function () { scanDom(); sendHtml(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { try { mo.disconnect(); } catch (e) {} }, 60000);
  } catch (e) {}

  /* ---------------- 5. Recursos de red ya descargados (performance) -------- */
  try {
    var ping = setInterval(function () {
      try {
        var rs = performance.getEntriesByType('resource') || [];
        for (var i = 0; i < rs.length; i++) { reportUrl(String(rs[i].name || '')); }
      } catch (e) {}
    }, 2500);
    setTimeout(function () { clearInterval(ping); }, 60000);
  } catch (e) {}

  /* ---------------- Arranque + estados ---------------- */
  if (document.readyState !== 'loading') {
    scanDom(); sendHtml();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      scanDom(); sendHtml(); state('domContentLoaded');
    });
  }
  window.addEventListener('load', function () { scanDom(); sendHtml(); state('load'); });
  state('injected');
})();`;

/* Salida: SOLO el JavaScript inyectable (el servidor lo sirve crudo,
   content-type application/javascript — nunca JSON).
   v4.0 (Fase 7): exportable — v4-api.js lo require() y sirve el script
   con caché por mtime (editar este archivo en el servidor actualiza el
   sniffer de todas las apps SIN publicar APK). */
if (require.main === module) console.log(SNIFFER_JS);
module.exports = { SNIFFER_JS };
