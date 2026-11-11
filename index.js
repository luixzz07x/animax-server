#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   ║  ANIMAX SERVER v2.0.0 — "Seekee sin anuncios" (servidor privado)    ║
   ╚═════════════════════════════════════════════════════════════════════
   Node.js PURO · CERO dependencias · desplegable en Render.com

   NOVEDADES v2.0 (Fase 1 del plan 3.0.0):

   1. CATÁLOGO MULTI-FUENTE con familias:
        anime-latino · anime-sub · peliculas/series · doramas
      Cada familia tiene varios dominios candidatos. Un PROBADOR DE SALUD
      (técnica "queryFreshDomainList" de Seekee) los chequea en segundo
      plano y las búsquedas solo usan los VIVOS (sin esperas por muertos).

   2. PRIORIDAD DE IDIOMA GLOBAL: latino → castellano → sub.
      Y RANGOS DE DOBLAJE por serie (One Piece 1-837 latino, Naruto
      1-220, Dragon Ball completa…): cada EPISODIO lleva su idioma.

   3. RESOLUCIÓN PROFUNDA DE LA GRANJA (el "nunca video no disponible"):
      /api/resolve abre los reproductores embebidos (Streamtape, Dood,
      MixDrop, Filemoon, StreamWish, Vidmoly, Mp4Upload, Uqload, OkRu…)
      y extrae la URL DIRECTA del video — con desempaquetador JS
      (p,a,c,k,e,d) SIN eval. Después VALIDA cada stream y responde
      con la lista ordenada: siempre hay un espejo reproducible.

   4. RANKINGS estilo Seekee: /api/hot (Peliculas/Series/Anime/
      Minidramas) con puntuación de "calor" 🔺 + /api/related
      (sugerencias) + /api/home (portada en un solo JSON).

   5. METADATOS JIKAN (MyAnimeList, API pública): año, tipo, géneros,
      sinopsis y carátula para las tarjetas estilo Seekee.

   6. PROXY OPCIONAL: ANIMAX_PROXY=user:pass@host:port (túnel CONNECT)
      para alcanzar sitios con Cloudflare desde Render si algún día
      hace falta (p. ej. un proxy residencial propio).

   Endpoints (todos JSON, ver /):
     GET  /api/ping · /api/domains · /api/search?q= · /api/episodes?pageUrl=
     POST /api/resolve {pageUrl,episodeUrl?,episode?} · /api/validate
     GET  /api/hot?tab=anime|peliculas|series|minidramas · /api/related?q=
     GET  /api/home · /api/adblock (EasyList digerida a hosts, v3.0)
     GET  /api/adblock/hide (selectores de ocultación de elementos, v4.0 Fase 6)
     GET/POST/DELETE /api/history?deviceId= (historial sincronizado, v3.0 Fase 5)

   Variables de entorno (todas opcionales):
     PORT · ANIMAX_API_KEY · ANIMAX_SITES (host|tpl|lang|kind,...)
     ANIMAX_DUB_RANGES ("titulo:1-837,...") · ANIMAX_PROXY (u:p@h:p)
     ANIMAX_WATCHDOG_MIN (ciclo del watchdog, defecto 360=6h)
     ANIMAX_WATCHDOG_OFF=1 (desactiva la rotación de dominios)
     ANIMAX_DEBUG=1
   ══════════════════════════════════════════════════════════════════════ */

'use strict';

const VERSION = '4.1.0';  // v4.1 (FASE D0.5): PÁGINAS PROPIAS UNIFICADAS — hub.js (/hub, /hub/watch) con puente AnimaxHub + window.quan (espejo del javascriptChannel de Seekee)
const PORT = Number(process.env.PORT || process.env.ANIMAX_PORT || 3001);
const API_KEY = process.env.ANIMAX_API_KEY || '';   // vacío = abierto (uso personal)
const PROXY = process.env.ANIMAX_PROXY || '';       // user:pass@host:port
const STARTED = Date.now();
const DEBUG = !!process.env.ANIMAX_DEBUG;

/* ══════════════════════════════════════════════════════════════════
   1. HTTP con redirecciones, timeouts y PROXY opcional (túnel CONNECT)
   ══════════════════════════════════════════════════════════════════ */

const https = require('https');
const http = require('http');
const tls = require('tls');
const url = require('url');
const fs = require('fs');   // v3.0 (Fase 5): persistencia best-effort del historial

const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const ENGINE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* Whitelist de sitios que exigen UA de ESCRITORIO (técnica del APK de
   Seekee: su WebView fuerza escritorio en estos hosts). */
const DESKTOP_HOSTS = [
  'playspelis.com', 'cuevana', 'repelis', 'pelisflix', 'pelisplus',
  'solo-latino.com', 'sololatino', 'pelismedia', 'pluslatino',
  'mitonicine', 'cinelatino', '321moviesfree', 'megadrama', 'doramas'
];
function hostOf(u) {
  try { return (new url.URL(u).hostname || '').toLowerCase(); } catch { return ''; }
}
function needsDesktopMode(u) {
  const h = hostOf(u);
  if (!h) return false;
  return DESKTOP_HOSTS.some(d => h === d || h.includes(d));
}
function userAgentFor(u) {
  return needsDesktopMode(u)
    ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    : BROWSER_UA;
}

/* Túnel CONNECT a través de ANIMAX_PROXY (para https). */
let proxyCache = null;
function proxyParts() {
  if (proxyCache !== null) return proxyCache;
  if (!PROXY) { proxyCache = null; return null; }
  let auth = null, hostPort = PROXY;
  if (PROXY.includes('@')) {
    const i = PROXY.lastIndexOf('@');
    auth = PROXY.slice(0, i); hostPort = PROXY.slice(i + 1);
  }
  const [host, port] = hostPort.split(':');
  proxyCache = { host, port: Number(port || 8080), auth };
  return proxyCache;
}
function proxyConnect(hostname, port) {
  return new Promise((resolve, reject) => {
    const p = proxyParts();
    if (!p) return reject(new Error('no-proxy'));
    const headers = p.auth
      ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(p.auth).toString('base64') }
      : {};
    const req = http.request({
      host: p.host, port: p.port, method: 'CONNECT',
      path: `${hostname}:${port}`, headers, timeout: 9000
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode === 200) resolve(socket);
      else { socket.destroy(); reject(new Error('proxy-' + res.statusCode)); }
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('proxy-timeout')); });
    req.on('error', reject);
    req.end();
  });
}

/** GET/POST con redirects, límite de bytes y timeout. {ok,status,body,headers} */
function request(target, options = {}) {
  return new Promise((resolve) => {
    let redirectsLeft = 5;
    const maxBytes = options.maxBytes || 2 * 1024 * 1024;
    const timeoutMs = options.timeoutMs || 9000;
    const startedAt = Date.now();

    const finish = (v) => { if (!finished) { finished = true; resolve(v); } };
    let finished = false;

    const attempt = async (current) => {
      if (redirectsLeft < 0) return finish({ ok: false, error: 'too-many-redirects' });
      let parsed;
      try { parsed = new url.URL(current); } catch { return finish({ ok: false, error: 'bad-url' }); }
      const mod = parsed.protocol === 'http:' ? http : https;
      const baseHeaders = options.bare
        ? { 'User-Agent': options.userAgent || userAgentFor(current), 'Accept': '*/*' }
        : {
            'User-Agent': options.userAgent || userAgentFor(current),
            'Accept': options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.6',
            ...(options.headers || {})
          };

      // v4.0 (Fase 2) · cuerpo opcional para POST (búsqueda DuckDuckGo html).
      if (options.body) {
        baseHeaders['Content-Type'] =
          (options.headers && options.headers['Content-Type']) ||
          'application/x-www-form-urlencoded';
        baseHeaders['Content-Length'] = Buffer.byteLength(options.body);
      }
      const mkRequest = (socket) => {
        const reqOpts = {
          method: options.method || 'GET',
          headers: baseHeaders,
          timeout: timeoutMs,
          setHost: true
        };
        if (socket) {
          reqOpts.createConnection = () => socket;
          reqOpts.agent = false;
        }
        const req = mod.request(current, reqOpts, (res) => {
          const status = res.statusCode || 0;
          if (status >= 301 && status <= 308 && res.headers.location) {
            res.resume();
            if (socket) socket.destroy();
            redirectsLeft--;
            let next = res.headers.location;
            if (next.startsWith('//')) next = parsed.origin + next;
            else if (next.startsWith('/')) next = parsed.origin + next;
            else if (!/^https?:/i.test(next)) {
              try { next = new url.URL(next, current).href; } catch { return finish({ ok: false, error: 'bad-redirect' }); }
            }
            return attempt(next);
          }
          if (options.onlyHead) { res.resume(); return finish({ ok: status < 400, status, headers: res.headers, body: '' }); }
          const chunks = []; let total = 0; let aborted = false;
          res.on('data', (c) => {
            if (total + c.length > maxBytes) {
              if (!aborted) {
                aborted = true;
                finish({
                  ok: status >= 200 && status < 400, status, headers: res.headers,
                  body: Buffer.concat(chunks).toString('utf8'),
                  ms: Date.now() - startedAt, truncated: true
                });
                req.destroy();
              }
              return;
            }
            total += c.length; chunks.push(c);
          });
          res.on('end', () => finish({
            ok: status >= 200 && status < 400,
            status, headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            ms: Date.now() - startedAt
          }));
          res.on('error', () => finish({ ok: false, error: 'stream-error' }));
        });
        req.on('timeout', () => { req.destroy(); finish({ ok: false, error: 'timeout' }); });
        req.on('error', () => finish({ ok: false, error: 'network' }));
        req.end(options.body || null);
      };

      // Con proxy: túnel CONNECT para https; http va directo al proxy.
      const p = proxyParts();
      if (p && parsed.protocol === 'https:') {
        try {
          const socket = await proxyConnect(parsed.hostname, 443);
          const tlsSock = tls.connect({ socket, servername: parsed.hostname, rejectUnauthorized: false });
          tlsSock.on('error', () => finish({ ok: false, error: 'proxy-tls' }));
          tlsSock.once('secureConnect', () => mkRequest(tlsSock));
        } catch (e) { finish({ ok: false, error: String(e && e.message || e) }); }
      } else {
        mkRequest(null);
      }
    };
    attempt(target);
  });
}

async function fetchHtml(pageUrl, referer) {
  const headers = {};
  if (referer) headers['Referer'] = referer;
  const res = await request(pageUrl, { headers });
  if (!res.ok) return null;
  return res.body;
}

/* ══════════════════════════════════════════════════════════════════
   2. Utilidades de HTML
   ══════════════════════════════════════════════════════════════════ */

const RE = {
  DIRECT_VIDEO: /https?:\/\/[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+\.(?:mp4|m4v|mkv|webm|flv|m3u8|mpd)(?=$|\?|["'\s\/\\<>)])(?:\?[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]*)?/gi,
  IFRAME: /<iframe[^>]+src=["']([^"']+)["']/gi,
  ANCHOR: /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  META_DESC: /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  OG_DESC: /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
  // v3.0 (Fase 4) · ampliada: más redes publicitarias y popunder comunes
  AD_HINT: /(doubleclick|googlesyndication|googleadservices|adservice|adsrvr|adnxs|criteo|taboola|outbrain|popads|popcash|popunder|propellerads|onclickads|adsystem|adform|smartadserver|pubmatic|rubiconproject|openx|zedo|mgid|revcontent|exoclick|juicyads|trafficjunky|hilltopads|clickadu)/i,
  PLAYER_HINT: /(player|embed|stream|watch|video|ver|episod|episode)/i,
  DDG_LINK: /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
  BING_LINK: /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
  EP_NUM: /(?:episodio|episodios|episode|cap[ií]tulo|capitulo|cap)[\s_-]*(\d{1,4})/i,
  EP_HREF: /\/(?:episodio|episodios|episode|capitulo|cap[ií]tulo|cap|ep)[\s_-]*(\d{1,4})/i,
  FILE_SRC: /(?:file|src|source|url|urlVideo|videoUrl)"?\s*[:=]\s*["'](https?:\/\/[^"']{10,500}\.(?:m3u8|mp4)(?:\?[^"']{0,300})?)["']/gi
};

function stripTags(v) { return htmlUnescape(String(v).replace(/<[^>]*>/g, '')).trim(); }
function htmlUnescape(v) {
  return String(v)
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function absolutize(src, base) {
  if (!src) return null;
  const s = htmlUnescape(String(src).trim());
  if (/^https?:/i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  try { return new url.URL(s, base).href; } catch { return null; }
}
function looksLikeAd(u) { return RE.AD_HINT.test(u); }
function isHttp(u) { return /^https?:/i.test(u); }

/* ══════════════════════════════════════════════════════════════════
   3. GRANJA de servidores de video (quién es quién + fiabilidad)
   ══════════════════════════════════════════════════════════════════ */

const FARM = [
  ['OkRu', ['ok.ru', 'odnoklassniki'], 50],
  ['YourUpload', ['yourupload'], 48],
  ['Streamtape', ['streamtape', 'strcloud', 'streamta.pe', 'stape.fun', 'stradoll'], 46],
  ['DoodStream', ['dood', 'dsvplay', 'doodstream', 'dooood'], 45],
  ['Mp4Upload', ['mp4upload'], 44],
  ['MixDrop', ['mixdrop', 'mixdrp'], 42],
  ['StreamSB', ['streamsb', 'ssbstream', 'sbplay', 'sbanh', 'sbspeed'], 40],
  ['Vidmoly', ['vidmoly', 'molystream'], 38],
  ['Uqload', ['uqload', 'uqwatch'], 36],
  ['Voe', ['voe.sx', 'voeunblk', 'brookethoughi', 'voe-un', 'audaciousdefaulthumor'], 34],
  ['StreamWish', ['streamwish', 'wishfast', 'swhoi', 'awish', 'swhenc'], 33],
  ['Filemoon', ['filemoon', 'moonplayer', 'moviesm4u'], 32],
  ['Vidhide', ['vidhide', 'vidhidy', 'smoothpre'], 31],
  ['JeniusPlay', ['jenius'], 30],
  ['LuluStream', ['luluvdo', 'lulustream'], 29],
  ['Highload', ['highload'], 28],
  ['KissKh', ['kisskh'], 23],
  ['Streamlare', ['streamlare'], 24],
  ['Aniwatch', ['aniwatch', 'hianime'], 22],
  ['Upstream', ['upstream'], 22],
  ['VidFast', ['vidfast'], 21],
  ['MegaCloud', ['megacloud'], 19],
  ['Bunny CDN', ['bunnycdn', 'b-cdn.net'], 18],
  ['Archive.org', ['archive.org'], 25]
];
function farmName(u) {
  const h = hostOf(u);
  for (const [name, hosts] of FARM) if (hosts.some(x => h.includes(x))) return name;
  return h || 'Servidor';
}
function farmScore(u) {
  const h = hostOf(u);
  let best = 0;
  for (const [, hosts, prio] of FARM) if (hosts.some(x => h.includes(x)) && prio > best) best = prio;
  return best;
}
function isFarmKnown(u) { return farmScore(u) > 0; }

/* ══════════════════════════════════════════════════════════════════
   4. CATÁLOGO DE SITIOS (familias) + PROBADOR DE SALUD
      (la técnica "queryFreshDomainList" de Seekee, versión AniMax)
   ══════════════════════════════════════════════════════════════════ */

/* kind: anime | pelicula | serie | dorama · lang: latino | sub | castellano
   NO todos los dominios están vivos hoy — el probador decide. Los que
   cambian de dominio se actualizan con ANIMAX_SITES sin re-desplegar. */
const SITE_CATALOG = [
  // ── ANIME con DOBLAJE LATINO ─────────────────────────────────────
  { host: 'monoschinos.st', tpl: 'https://monoschinos.st/buscar?q={q}', lang: 'latino', kind: 'anime' },
  { host: 'animelatinohd.net', tpl: 'https://animelatinohd.net/?s={q}', lang: 'latino', kind: 'anime' },
  { host: 'otakustv.com', tpl: 'https://otakustv.com/buscar?q={q}', lang: 'latino', kind: 'anime' },
  { host: 'veranimes.net', tpl: 'https://veranimes.net/animes?q={q}', lang: 'latino', kind: 'anime' },
  { host: 'anime.mov', tpl: 'https://anime.mov/browse?q={q}', lang: 'latino', kind: 'anime' },
  // ── ANIME SUB (relleno cuando no hay doblaje) ────────────────────
  { host: 'tioanime.com', tpl: 'https://tioanime.com/directorio?q={q}', lang: 'sub', kind: 'anime' },
  { host: 'yugenanime.tv', tpl: 'https://yugenanime.tv/discover/?q={q}', lang: 'sub', kind: 'anime' },
  { host: 'jkanime.net', tpl: 'https://jkanime.net/directorio?q={q}', lang: 'sub', kind: 'anime' },
  { host: 'animeflv.net', tpl: 'https://animeflv.net/browse?q={q}', lang: 'sub', kind: 'anime' },
  { host: 'animefenix.com', tpl: 'https://animefenix.com/browse?q={q}', lang: 'sub', kind: 'anime' },
  { host: 'animeid.to', tpl: 'https://animeid.to/browse?q={q}', lang: 'sub', kind: 'anime' },
  { host: 'gogoanimehd.io', tpl: 'https://gogoanimehd.io/search.html?keyword={q}', lang: 'sub', kind: 'anime' },
  { host: 'kickassanime.mx', tpl: 'https://kickassanime.mx/search?q={q}', lang: 'sub', kind: 'anime' },
  // ── PELÍCULAS Y SERIES ───────────────────────────────────────────
  { host: 'pelisplushd.net', tpl: 'https://pelisplushd.net/search?q={q}', lang: 'latino', kind: 'pelicula' },
  { host: 'cuevana3.ch', tpl: 'https://cuevana3.ch/buscar/{q}', lang: 'latino', kind: 'pelicula' },
  { host: 'cuevana.pro', tpl: 'https://cuevana.pro/buscar/{q}', lang: 'latino', kind: 'pelicula' },
  { host: 'repelis.vip', tpl: 'https://repelis.vip/?s={q}', lang: 'latino', kind: 'pelicula' },
  { host: 'pelisflix2.lol', tpl: 'https://pelisflix2.lol/?s={q}', lang: 'latino', kind: 'pelicula' },
  { host: 'sololatino.net', tpl: 'https://www.sololatino.net/?s={q}', lang: 'latino', kind: 'pelicula' },
  { host: '321moviesfree.com', tpl: 'https://321moviesfree.com/?s={q}', lang: 'latino', kind: 'serie' },
  { host: 'playspelis.com', tpl: 'https://playspelis.com/?s={q}', lang: 'latino', kind: 'pelicula' },
  // ── DORAMAS / MINISERIES ─────────────────────────────────────────
  { host: 'doramasyt.com', tpl: 'https://www.doramasyt.com/buscar?q={q}', lang: 'latino', kind: 'dorama' },
  { host: 'megadrama.org', tpl: 'https://megadrama.org/?s={q}', lang: 'latino', kind: 'dorama' },
  // v3.0 (Fase 4) · corregido: es app Next.js, el buscador real es /buscar?q=
  { host: 'doramasflix.in', tpl: 'https://doramasflix.in/buscar?q={q}', lang: 'latino', kind: 'dorama' }
];

function rawSitesCatalog() {
  const base = [...SITE_CATALOG];
  const extra = (process.env.ANIMAX_SITES || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const e of extra) {
    const [host, tpl, lang, kind] = e.split('|');
    if (!host || !tpl) continue;
    base.push({ host, tpl, lang: lang || 'sub', kind: kind || 'anime', extra: true });
  }
  return base;
}

/* v4.0 (Fase 2) · Dominios RESUELTOS por el watchdog: si un sitio rotó
   a un dominio nuevo (descubierto por Bing/DDG/semillas), TODO el
   servidor (búsqueda, episodios, resolución, navigationList,
   queryFreshDomainList) ya lo ve con el host vigente. */
let watchdog = null; // se crea en el § 4bis (necesita el cache)
function allSitesConfig() {
  return watchdog ? watchdog.resolveSites(rawSitesCatalog()) : rawSitesCatalog();
}

/* Salud por host: { ok:boolean, ts, ms, fails } — cache 30 min. */
const siteHealth = new Map();
const HEALTH_TTL = 30 * 60 * 1000;
async function probeSite(site) {
  const t0 = Date.now();
  const searchUrl = site.tpl.replace('{q}', encodeURIComponent('naruto'));
  const res = await request(searchUrl, { timeoutMs: 8000, maxBytes: 512 * 1024 });
  const ok = res.ok && !!res.body && res.body.length > 500 &&
    !/cf-chl|challenge-platform|Just a moment\.\.\.|<title>Success!/i.test(res.body.slice(0, 4000));
  siteHealth.set(site.host, { ok, ts: Date.now(), ms: Date.now() - t0, status: res.status || 0 });
  return ok;
}
async function refreshHealth() {
  const sites = allSitesConfig();
  // en tandas de 6 para no disparar rate-limits
  for (let i = 0; i < sites.length; i += 6) {
    await Promise.all(sites.slice(i, i + 6).map(probeSite));
  }
  if (DEBUG) {
    const live = [...siteHealth.entries()].filter(([, v]) => v.ok).map(([h]) => h);
    console.error('[health] vivos:', live.join(', '));
  }
}

function siteIsUsable(site) {
  const h = siteHealth.get(site.host);
  if (!h) return true;              // sin datos aún → se intenta (y se sondea)
  if (Date.now() - h.ts > HEALTH_TTL) return true; // expirado → se reintenta
  return h.ok;
}

/* ══════════════════════════════════════════════════════════════════
   5. Búsqueda DIRECTA en sitios vivos (modelo Buscari/Seekee)
   ══════════════════════════════════════════════════════════════════ */

async function directSiteSearch(query) {
  /* v3.0 (Fase 4) · Textos de ancla que NO son títulos de obra (badges de
     estado de las tarjetas Next.js y similares). */
  const GENERIC_ANCHOR_TEXT = /^(finalizado|en emisi[oó]n|en emision|en curso|en vivo|ver|ver online|ver m[aá]s|ver todo|online|hd|4k|latino|subtitulado|doblado|estreno|estrenos|nuevo|popular|tendencia|trending|dorama|doramas|pelicula|pel[ií]culas|peliculas|serie|series|anime|temporada \d+|cap[ií]tulo \d+)$/i;
  const sites = allSitesConfig().filter(siteIsUsable);
  const results = await Promise.all(sites.map(async site => {
    /** Abre el buscador interno de UN sitio con un query dado y
     *  devuelve { strict:[], relaxed:[] } (el relajado va detrás). */
    const searchOnce = async (q) => {
      const qWords = normalizeTitle(q).split(' ').filter(w => w.length >= 3);
      const searchUrl = site.tpl.replace('{q}', encodeURIComponent(q));
      const res = await request(searchUrl, { timeoutMs: 8000, maxBytes: 1024 * 1024 });
      if (!res.ok || !res.body) return { strict: [], relaxed: [] };
      if (/cf-chl|challenge-platform|Just a moment\.\.\.|<title>Success!/i.test(res.body.slice(0, 4000))) {
        siteHealth.set(site.host, { ok: false, ts: Date.now(), ms: 0, status: res.status });
        return { strict: [], relaxed: [] };
      }
      const strict = [];
      const relaxed = [];
      const pushHit = (arr, abs, text) => {
        const u = abs.toLowerCase();
        const lang = /latino|doblado/.test(u) ? 'latino'
          : /castellano/.test(u) ? 'castellano'
          : /sub-?espanol|subtitulado/.test(u) ? 'sub'
          : site.lang;
        arr.push({ title: text, url: abs, siteLang: lang, kind: kindOfUrl(abs, text, site), relaxed: arr === relaxed });
      };
      let m; RE.ANCHOR.lastIndex = 0;
      while ((m = RE.ANCHOR.exec(res.body)) !== null) {
        const abs = absolutize(m[1], searchUrl);
        if (!abs || !isHttp(abs)) continue;
        if (hostOf(abs) !== hostOf(searchUrl)) continue;   // enlaces internos
        if (isPagination(abs)) continue;
        if (RE.EP_NUM.test(m[2] + ' ' + abs)) continue;    // episodios sueltos no
        // v3.0 (Fase 4) · anclas de episodio estilo "1x1"/"temporada-1-episodio-2"
        // (doramasflix/pelisflix listan cada capítulo en el buscador)
        if (/\b\d{1,3}x\d{1,3}\b|temporada-\d+-episodio-\d+|-episodio-\d+\b/i.test(m[2] + ' ' + abs)) continue;
        if (looksLikeAd(abs)) continue;
        if (/[?&](q|s|search|keyword|query|titulo)=/i.test(abs)) continue;
        if (/\/(buscar|search|directorio|browse|discover|animes)(\/|$|\?)/i.test(abs)) continue;
        const text0 = stripTags(m[2]);
        const alt = htmlUnescape((m[2].match(/<img[^>]+alt="([^"]{3,120})"/) || [])[1] || '').trim();
        // v3.0 (Fase 4) · tarjetas Next.js (doramasflix): el texto interno es
        // genérico ("Finalizado") y el título real va en el alt del póster.
        // Se prefiere el alt si casan TODAS las palabras, o si casando ALGUNA
        // es más informativo que el texto del enlace.
        const altNorm = normalizeTitle(alt);
        const textNorm = normalizeTitle(text0);
        const altAll = alt.length >= 3 && qWords.every(w => altNorm.includes(w));
        const altAny = alt.length >= 3 && qWords.some(w => altNorm.includes(w)) && altNorm.length > textNorm.length;
        let text = altAll ? alt : (altAny ? alt : text0);
        // v3.0 (Fase 4) · tarjetas Next.js: texto interno genérico ("Finalizado",
        // "En emisión") → usar el alt del póster; si tampoco hay alt, descartar.
        if (GENERIC_ANCHOR_TEXT.test(text.trim())) {
          if (alt.length >= 3) text = alt;
          else continue;
        }
        if (!text || text.length < 3) continue;
        if (text.length > 90) text = text.slice(0, 87) + '…';
        const tNorm = normalizeTitle(text);
        const path = abs.replace(/^https?:\/\/[^\/]+/, '');
        if (path === '/' || path.length < 3) continue;
        if (qWords.length && qWords.every(w => tNorm.includes(w))) {
          pushHit(strict, abs, text);
          continue;
        }
        // PASE RELAJADO (v2.0): el BUSCADOR DEL PROPIO SITIO ya decidió
        // que esta entrada es relevante ("rent" → Kanojo, Okarishimasu,
        // cuyo título de tarjeta no contiene "rent"). Solo enlaces de
        // OBRA (patrón de contenido) que casen con ALGUNA palabra.
        // v3.0 (Fase 4) · patrones de doramasflix/pelisflix: "/doramas-online/{slug}"
        // y "/peliculas-online/{slug}".
        if (/\/(anime|peliculas?|series?|ver|doramas?|novelas?)(-online)?\//i.test(abs) &&
            qWords.some(w => tNorm.includes(w) || normalizeTitle(abs).includes(w))) {
          pushHit(relaxed, abs, text);
        }
      }
      return { strict, relaxed };
    };

    let { strict, relaxed } = await searchOnce(query);
    // v2.0 · REINTENTO DE PALABRA ÚNICA: buscadores como el de MonosChinos
    // fallan con frases ("rent a girlfriend" → 0) pero aciertan con la
    // palabra más larga ("okarishimasu"). Se filtra igual después.
    if (strict.length + relaxed.length === 0 && /\s/.test(query.trim())) {
      const words = normalizeTitle(query).split(/\s+/).filter(w => w.length >= 4);
      if (words.length) {
        const w = words.sort((a, b) => b.length - a.length)[0];
        const r2 = await searchOnce(w);
        strict = r2.strict; relaxed = r2.relaxed;
      }
    }
    const hits = [...strict, ...relaxed];
    // La coincidencia EXACTA del título manda ("One Piece" antes que
    // "One Piece Stampede"): la serie principal nunca queda fuera.
    const qNorm = normalizeTitle(query);
    hits.sort((a, b) => titleRank(normalizeTitle(a.title), qNorm) - titleRank(normalizeTitle(b.title), qNorm));
    const seen = new Set(); const out = [];
    for (const h of hits) {
      const k = h.url.split('#')[0].replace(/\/+$/, '');
      if (seen.has(k)) continue;
      seen.add(k); out.push(h);
      if (out.length >= 9) break;
    }
    if (DEBUG && out.length) console.error('[search]', site.host, '→', out.length);
    return out;
  }));
  return results.flat();
}

/** ¿Es anime, película, serie o dorama? (para tarjetas estilo Seekee) */
function kindOfUrl(u, title, site) {
  const s = (u + ' ' + title).toLowerCase();
  if (/pelicula|movie|film|peliculas/.test(s)) return 'pelicula';
  if (/dorama|novela|k-drama|kdrama/.test(s)) return 'dorama';
  if (/serie|temporada|season|episodio-\d/.test(s)) return 'serie';
  return site ? site.kind : 'anime';
}

/* ── Bing / DDG de respaldo (cuando Render no está bloqueado) ────── */
function decodeBingLink(link) {
  try {
    const u = new url.URL(link);
    let raw = u.searchParams.get('u') || '';
    if (!raw) return link;
    if (raw.startsWith('a1')) raw = raw.slice(2);
    raw = raw.replace(/-/g, '+').replace(/_/g, '/');
    while (raw.length % 4) raw += '=';
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return /^https?:/i.test(decoded) ? decoded : link;
  } catch { return link; }
}
async function searchWeb(query, maxHits = 14, opts = {}) {
  const q = encodeURIComponent(query);
  const hits = [];
  const bing = await request(`https://www.bing.com/search?q=${q}&setlang=es&count=20`, {
    userAgent: ENGINE_UA, bare: true
  });
  if (bing.ok && bing.body) {
    let m; RE.BING_LINK.lastIndex = 0;
    while ((m = RE.BING_LINK.exec(bing.body)) !== null) {
      let link = htmlUnescape(m[1]);
      if (hostOf(link).includes('bing.com')) link = decodeBingLink(link);
      const title = stripTags(m[2]);
      if (isHttp(link) && title && !looksLikeAd(link)) hits.push({ title, url: link });
    }
  }
  if (hits.length) return dedupeHits(hits).slice(0, maxHits);
  if (opts.skipDdg) return [];
  const ddg = await request(`https://html.duckduckgo.com/html/?q=${q}&kl=es-es`, { userAgent: ENGINE_UA, bare: true });
  if (ddg.ok && ddg.status !== 202 && ddg.body) {
    let m; RE.DDG_LINK.lastIndex = 0;
    while ((m = RE.DDG_LINK.exec(ddg.body)) !== null) {
      const raw = htmlUnescape(m[1]);
      let link = null;
      const i = raw.indexOf('uddg=');
      if (i >= 0) {
        let end = raw.indexOf('&', i); if (end < 0) end = raw.length;
        try { link = decodeURIComponent(raw.slice(i + 5, end)); } catch {}
      } else if (raw.startsWith('//')) link = 'https:' + raw;
      else if (/^https?:/.test(raw)) link = raw;
      if (link && isHttp(link)) {
        const title = stripTags(m[2]);
        if (title && !looksLikeAd(link)) hits.push({ title, url: link });
      }
    }
  }
  return dedupeHits(hits).slice(0, maxHits);
}
/** 0 = título idéntico al query · 1 = empieza por él · 2 = contiene. */
function titleRank(t, qNorm) {
  if (t === qNorm) return 0;
  if (t.startsWith(qNorm)) return 1;
  return 2;
}
function dedupeHits(hits) {
  const seen = new Set(); const out = [];
  for (const h of hits) {
    const k = h.url.split('#')[0].replace(/\/+$/, '');
    if (seen.has(k)) continue;
    seen.add(k); out.push(h);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════
   6. RANGOS DE DOBLAJE (One Piece 1-837 latino, etc.)
      Cada episodio de esas series recibe su idioma REAL.
   ══════════════════════════════════════════════════════════════════ */

const DUB_RANGES_DEFAULT = [
  { match: /one[ -]?piece/i, ranges: [[1, 837]] },
  { match: /naruto[ -]?shippu[u]?den/i, ranges: [] },          // se completa vía ANIMAX_DUB_RANGES
  { match: /^naruto$/i, ranges: [[1, 220]] },
  { match: /dragon[ -]?ball[ -]?z/i, ranges: [[1, 291]] },
  { match: /dragon[ -]?ball(?:\s|$)/i, ranges: [[1, 153]] },
  { match: /dragon[ -]?ball[ -]?gt/i, ranges: [[1, 64]] },
  { match: /dragon[ -]?ball[ -]?super/i, ranges: [[1, 131]] },
  { match: /(los caballeros del zodiaco|saint seiya)/i, ranges: [[1, 114]] },
  { match: /card captor sakura|cardcaptor sakura/i, ranges: [[1, 70]] },
  { match: /inuyasha/i, ranges: [[1, 167]] },
  { match: /captain tsubasa|supercampeones/i, ranges: [[1, 128]] },
  { match: /slam dunk/i, ranges: [[1, 101]] }
];
function dubRanges() {
  const list = [...DUB_RANGES_DEFAULT];
  const extra = (process.env.ANIMAX_DUB_RANGES || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const e of extra) {
    const [title, range] = e.split(':');
    if (!title || !range) continue;
    const ranges = range.split(';').map(r => {
      const [a, b] = r.split('-').map(x => parseInt(x, 10));
      return [a || 1, b || a || 1];
    });
    list.push({ match: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ranges, custom: true });
  }
  return list;
}
function seriesDubRanges(title) {
  const t = String(title || '');
  for (const d of dubRanges()) {
    if (d.match.test(t) && d.ranges.length) return d.ranges;
  }
  return null;
}
function episodeLang(seriesTitle, n, urlLang) {
  // El idioma explícito de la URL manda.
  if (urlLang) return urlLang;
  const ranges = seriesDubRanges(seriesTitle);
  if (ranges && ranges.some(([a, b]) => n >= a && n <= b)) return 'latino';
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   7. Clasificación de idioma + agrupación estilo Seekee
   ══════════════════════════════════════════════════════════════════ */

const DUB_WORDS = /(latino|latina|doblado|doblada|castellano|espa[nñ]ol de espa[nñ]a|audio\s*es|dub)/i;
const SUB_WORDS = /(sub|subtitulado|subtitulada|subs|raw|sub\s*es)/i;

/* v4.1 (FASE D1) · BLOQUEO DE IDIOMA — marcadores de contenido EN INGLÉS.
   El usuario NUNCA quiere que la app le ponga un capítulo en otro idioma:
   si el hit huele a inglés ("english dub", "eng sub", "raw", hosts 100%
   angloparlantes…) y NO tiene ningún marcador español, se clasifica 'en'
   y queda EXCLUIDO de las opciones (ver groupOptions). */
const EN_WORDS = /english|\beng\b|\ben[-_ ]?sub\b|\ben[-_ ]?dub\b|\bdubbed\b|watch\s*(cartoon|anime)?\s*online|\braw\b|\bjap(anh?ese)?\s*audio\b|kissanime|9anime|gogoanime\.io|animepahe|hianime\.to\/\beng|zoro\.to\/\beng/i;
const ES_WORDS = /espa[nñ]ol|latino|latina|castellano|doblado|doblada|subtitulado|subtitulada|\bsub\s*es\b|vose|audio\s*latino/i;

function classifyLang(text) {
  const t = String(text || '');
  // v4.1 (FASE D1): inglés detectado SIN ningún marcador español → 'en'
  // (queda fuera de las opciones: bloqueo de idioma).
  if (EN_WORDS.test(t) && !ES_WORDS.test(t)) return 'en';
  if (/castellano|espa[nñ]a/i.test(t) && !/latino/i.test(t)) return 'castellano';
  if (/(sub\s*espa[nñ]ol|subtitulado|sub latino|sub)/i.test(t) && !/doblado|latino/i.test(t)) return 'sub';
  if (SUB_WORDS.test(t) && !DUB_WORDS.test(t)) return 'sub';
  if (DUB_WORDS.test(t)) return 'latino';
  return 'sub';
}
const LANG_TAG = { latino: '[Doblado]', sub: '[Sub]', castellano: '[Castellano]' };
const LANG_ORDER = { latino: 0, castellano: 1, sub: 2 };

function normalizeTitle(t) {
  return String(t || '')
    .replace(/[|·—–]\s*.*$/, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(RE.EP_NUM, '')
    .replace(/ver\s+|online\s+|gratis\s+|completa\s+|descargar\s+/gi, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ══════════════════════════════════════════════════════════════════
   8. METADATOS — AniList (principal) + Kitsu (respaldo), APIs públicas
      (Jikan tiene solo IPv6 y muchos PaaS no lo alcanzan)
   ══════════════════════════════════════════════════════════════════ */

function anilistMap(m) {
  if (!m || !m.title) return null;
  const t = (m.title.english || m.title.romaji || '').trim();
  if (!t) return null;
  const fmt = { TV: 'TV Serie', TV_SHORT: 'TV Corto', MOVIE: 'Pelicula', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Especial', MUSIC: 'Musical' };
  // Títulos alternativos para la capa de traducción (romaji/nativo/sinónimos).
  const alt = [];
  if (m.title.romaji && m.title.romaji !== t) alt.push(m.title.romaji);
  if (m.title.native) alt.push(m.title.native);
  for (const s of (m.synonyms || [])) if (s && s.length > 3) alt.push(s);
  return {
    title: t,
    alt,
    image: (m.coverImage && m.coverImage.extraLarge) || '',
    year: (m.startDate && m.startDate.year) || 0,
    type: fmt[m.format] || 'TV Serie',
    rated: m.isAdult ? 'TV-MA' : 'TV-14',
    genres: (m.genres || []).slice(0, 4),
    score: Math.round(((m.averageScore || 0) / 10) * 10) / 10,
    synopsis: String(m.description || '').replace(/<[^>]*>/g, '').slice(0, 260),
    // v6.0 (G10 · QA One Piece): AniList devuelve `episodes: null` en
    // animes EN EMISIÓN (One Piece = null) y la ficha quedaba con 0
    // capítulos. Con `nextAiringEpisode` (el PRÓXIMO que se emite) el
    // total real = próximo − 1: One Piece ≈ 1,122+ y sube solo.
    episodes: m.episodes ||
      (m.nextAiringEpisode && m.nextAiringEpisode.episode > 1
        ? m.nextAiringEpisode.episode - 1 : 0) || 0
  };
}
async function anilistQuery(query, variables) {
  // NOTA: el módulo request() de este servidor es GET-only; para el POST
  // de AniList usamos https directo (con control de errores y timeout).
  // v4.0 (Fase 1): reintento único con 2,5 s ante 429 (AniList limita a
  // 90 req/min desde 2024) — en frío la capa v4 dispara ráfagas.
  const once = () => new Promise((resolve) => {
    const payload = JSON.stringify({ query, variables: variables || {} });
    const req = https.request('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 9000
    }, (res) => {
      let b = '';
      res.on('data', c => { if (b.length < 1048576) b += c; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(b); } catch { data = null; }
        // 429 o errores de rate-limit → marca para reintentar
        if (res.statusCode === 429 || (data && data.errors &&
            /too many|rate.?limit/i.test(JSON.stringify(data.errors)))) {
          return resolve({ __retry: true, __status: res.statusCode });
        }
        resolve(data);
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end(payload);
  });
  let data = await once();
  if (data && data.__retry) {
    await new Promise(r => setTimeout(r, 2500));
    data = await once();
  }
  return data;
}
const ANILIST_FIELDS = `
  title { romaji english native }
  synonyms
  coverImage { extraLarge }
  startDate { year }
  format
  isAdult
  averageScore
  genres
  description(asHtml: false)
  episodes
  nextAiringEpisode { episode }
`;
async function anilistSearch(search) {
  const data = await anilistQuery(
    `query ($s: String) { Page(perPage: 5) { media(search: $s, type: ANIME, isAdult: false) { ${ANILIST_FIELDS} } } }`,
    { s: search }
  );
  const list = data && data.data && data.data.Page && data.data.Page.media;
  if (list) return list.map(anilistMap).filter(Boolean);
  return kitsuSearch(search);
}
async function anilistList(sort, format) {
  const data = await anilistQuery(
    `query ($f: MediaFormat) { Page(perPage: 10) { media(type: ANIME, sort: ${sort}, format: $f, isAdult: false) { ${ANILIST_FIELDS} } } }`,
    format ? { f: format } : {}
  );
  const list = data && data.data && data.data.Page && data.data.Page.media;
  return list ? list.map(anilistMap).filter(Boolean) : [];
}
/* Kitsu (respaldo): /api/edge/anime?filter[text]=… */
async function kitsuSearch(search) {
  const res = await request('https://kitsu.app/api/edge/anime?filter%5Btext%5D=' +
    encodeURIComponent(search) + '&page%5Blimit%5D=4', {
    timeoutMs: 9000, maxBytes: 1024 * 1024, accept: 'application/vnd.api+json'
  });
  if (!res.ok || !res.body) return [];
  let data;
  try { data = JSON.parse(res.body); } catch { return []; }
  const fmt = { TV: 'TV Serie', movie: 'Pelicula', OVA: 'OVA', ONA: 'ONA', special: 'Especial' };
  return (data.data || []).map(x => {
    const a = x.attributes || {};
    if (!a.canonicalTitle) return null;
    return {
      title: a.canonicalTitle,
      image: (a.posterImage && (a.posterImage.medium || a.posterImage.small)) || '',
      year: (a.startDate || '').slice(0, 4) || 0,
      type: fmt[a.subtype] || 'TV Serie',
      rated: 'TV-14',
      genres: ((a.categories && a.categories.data) || []).slice(0, 0).concat(a.genres || []).slice(0, 4),
      score: Math.round(((Number(a.averageRating) || 0) / 10) * 10) / 10,
      synopsis: String(a.synopsis || '').replace(/<[^>]*>/g, '').slice(0, 260),
      episodes: a.episodeCount || 0
    };
  }).filter(Boolean);
}
async function metaSearch(query) { return anilistSearch(query); }

/* ══════════════════════════════════════════════════════════════════
   9. Opciones de búsqueda "[Doblado] X" / "[Sub] X" (contrato app)
   ══════════════════════════════════════════════════════════════════ */

/** Agrupa hits en OPCIONES estilo Seekee (una por título+idioma). */
function groupOptions(all, query) {
  const groups = new Map();
  for (const hit of all) {
    const h = hostOf(hit.url);
    if (!h || looksLikeAd(hit.url)) continue;
    if (/forum|reddit|wikipedia|facebook|twitter|youtube\.com$|\.edu\b/i.test(h)) continue;
    const titleNorm = normalizeTitle(hit.title);
    if (!titleNorm || titleNorm.length < 3) continue;
    const qWords = normalizeTitle(query).split(' ').filter(w => w.length >= 3);
    // Estricto: TODAS las palabras en título/URL. Los hits RELAJADOS
    // (validados por el buscador del propio sitio) y los de TÍTULO
    // ALTERNATIVO (romaji/sinónimo vía AniList) pasan igualmente.
    if (qWords.length && !hit.relaxed && !hit.altFound &&
        !qWords.every(w => titleNorm.includes(w) || normalizeTitle(hit.url).includes(w))) continue;
    const lang = hit.siteLang || classifyLang(hit.title + ' ' + hit.url);
    // v4.1 (FASE D1) · BLOQUEO DE IDIOMA: las opciones EN INGLÉS jamás
    // llegan al teléfono — el usuario nunca quiere salir del español.
    if (lang === 'en') continue;
    const kind = hit.kind || kindOfUrl(hit.url, hit.title, null);
    const key = titleNorm.slice(0, 40) + '|' + lang;
    if (!groups.has(key)) {
      groups.set(key, {
        title: cleanDisplayTitle(hit.title, query),
        lang, kind,
        pageUrl: hit.url,
        host: h,
        hitTitle: hit.title
      });
    }
  }
  const GUIDE_HOSTS = /(justwatch|crunchyroll|betaseries|myanimeguru|filmaffinity|decider|wherecanistream|culturaalicante|episodate|thetvdb|imdb\.com|trakt\.tv|netflix\.com|primevideo|disneyplus|hbo\.com|apple\.com\/tv|facebook\.com|tiktok)/i;
  // v3.0 (Fase 4) · La coincidencia EXACTA del título manda sobre el idioma:
  // "Dragon Ball" (sub) debe salir antes que "Dragon Ball Super: Beerus"
  // (latino) para la búsqueda "dragon ball".
  const qNormG = normalizeTitle(query);
  return [...groups.values()]
    .sort((a, b) => {
      const ga = GUIDE_HOSTS.test(a.host) ? 1 : 0, gb = GUIDE_HOSTS.test(b.host) ? 1 : 0;
      if (ga !== gb) return ga - gb;                             // guías al final
      const ea = titleRank(normalizeTitle(a.hitTitle || a.title), qNormG);
      const eb = titleRank(normalizeTitle(b.hitTitle || b.title), qNormG);
      if (ea !== eb) return ea - eb;                             // título exacto primero
      const ka = a.kind === 'anime' ? 0 : 1, kb = b.kind === 'anime' ? 0 : 1;
      if (ka !== kb) return ka - kb;                             // anime primero
      const la = (LANG_ORDER[a.lang] ?? 3), lb = (LANG_ORDER[b.lang] ?? 3);
      if (la !== lb) return la - lb;                             // DOBLADO primero
      // v4.0 (Fase 3) · RE-PRIORIZACIÓN REAL: a igual título e idioma, la
      // fuente con MEJOR reputación (feedback ✗/✓ + desempeño de búsqueda)
      // va antes. La que siempre falla se hunde sola.
      const pa = feedback.penaltyTotalOf(a.host), pb = feedback.penaltyTotalOf(b.host);
      if (pa !== pb) return pa - pb;                             // reputación
      return 0;
    })
    .slice(0, 12)
    .map((g, i) => ({
      id: 'op' + i + '-' + Buffer.from(g.pageUrl).toString('base64').slice(0, 10),
      label: (LANG_TAG[g.lang] || '[Sub]') + ' ' + g.title,
      lang: g.lang,
      kind: g.kind,
      title: g.title,
      host: g.host,
      pageUrl: g.pageUrl
    }));
}

/** Títulos alternativos (romaji/sinónimos/nativo) de AniList. */
async function altTitlesFor(query) {
  const list = await anilistSearch(query);
  const out = [];
  for (const e of list) {
    for (const t of (e.alt || [])) {
      if (t && t.length > 3 && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

async function buildOptions(query) {
  /* OLEADA 1 (modelo Buscari/Seekee): búsqueda DIRECTA en el buscador
     interno de cada sitio vivo. Sin motor de búsqueda en medio. */
  let all = dedupeHits(await directSiteSearch(query));
  let options = groupOptions(all, query);

  /* OLEADA 2 · CAPA DE TRADUCCIÓN DE TÍTULOS (técnica Seekee): si el
     query en inglés no encuentra nada y los sitios usan el título
     japonés, AniList da los alternativos (romaji/sinónimos) y se
     re-busca. "rent a girlfriend" → "kanojo okarishimasu".
     v3.0 (Fase 4) · también dispara si las opciones existentes son TODAS
     difusas (ninguna empieza por el título buscado): mejor probar el
     romaji que conformarse con "My Girlfriend is a Gumiho". */
  const qNorm2 = normalizeTitle(query);
  const hasStrong = options.length > 0 &&
    options.some(o => titleRank(normalizeTitle(o.title), qNorm2) <= 1);
  if (options.length < 3 || (options.length > 0 && !hasStrong)) {
    const alts = await altTitlesFor(query);
    for (const alt of alts.slice(0, 2)) {
      if (!alt || normalizeTitle(alt) === normalizeTitle(query)) continue;
      const more = (await directSiteSearch(alt)).map(h => ({ ...h, altFound: true }));
      if (more.length) {
        all = dedupeHits([...all, ...more]);
        options = groupOptions(all, query);
        if (options.length >= 3) break;
      }
    }
  }

  /* OLEADA 3 (respaldo, solo si aún hay poco): Bing con frases "ver X
     online" — funcionan desde IPs residenciales pero Bing las vacía
     desde datacenters. SECUENCIAL con 1,2 s entre consultas. */
  if (options.length < 3 && all.length < 6) {
    for (const q of [`ver ${query} latino online`, `ver ${query} sub español`, query]) {
      const hits = await searchWeb(q, 14, { skipDdg: true });
      all = dedupeHits([...all, ...hits]);
      options = groupOptions(all, query);
      if (options.length >= 3) break;
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  // Metadatos AniList/Kitsu para las opciones tipo anime (tarjetas Seekee).
  const animeOpts = options.filter(o => o.kind === 'anime').slice(0, 6);
  if (animeOpts.length) {
    const mal = await metaSearch(query);
    for (const o of options) {
      const m = mal && metaMatch(mal, o.title);
      if (m) {
        o.meta = {
          year: m.year, type: m.type, rated: m.rated, genres: m.genres,
          score: m.score, synopsis: m.synopsis, image: m.image, episodes: m.episodes
        };
      }
    }
  }

  /* v4.0 (Fase 3) · AUTO-REPORTE DE BÚSQUEDA: qué fuentes aportaron
     resultados en ESTA consulta y cuáles no. Alimenta la reputación
     (searchHits/searchMisses con decaimiento) — sin esperar a que el
     usuario reporte nada. Una fuente que nunca encuentra nada se
     hunde sola en el orden de resultados. */
  try {
    const hitHosts = new Set(all.map(h => hostOf(h.url)).filter(Boolean));
    for (const site of allSitesConfig().filter(siteIsUsable)) {
      feedback.recordSearchOutcome(site.host, hitHosts.has(site.host));
    }
  } catch { /* nunca romper la búsqueda por la telemetría */ }

  return { query, options, scanned: all.length };
}

/** Mejor match de metadatos: compara título Y alternativos (romaji/
 *  sinónimos), priorizando exacto > empieza > contiene. Así "Kanojo,
 *  Okarishimasu" no casca con "… 6th Season" antes que con la principal. */
function metaMatch(list, title) {
  const t = normalizeTitle(title);
  if (!t) return null;
  let best = null, bestRank = 99;
  for (const x of list) {
    const cands = [x.title, ...(x.alt || [])].map(normalizeTitle).filter(Boolean);
    for (const c of cands) {
      let rank = 99;
      if (c === t) rank = 0;
      else if (c.startsWith(t) || t.startsWith(c.slice(0, Math.min(18, c.length)))) rank = 1;
      else if (c.includes(t) || t.includes(c.slice(0, 14))) rank = 2;
      if (rank < bestRank) { bestRank = rank; best = x; }
    }
  }
  return bestRank <= 2 ? best : null;
}

function cleanDisplayTitle(raw, query) {
  let t = String(raw || '');
  t = t.replace(/\s*[|·—–]\s*.*$/, '');
  t = t.replace(/ver\s+|online\s+|gratis\s+|completa\s+/gi, ' ');
  t = t.replace(RE.EP_NUM, '');
  t = t.replace(/\(.*?\)/g, ' ');
  const qWords = query.split(/\s+/);
  for (const w of qWords) {
    if (w.length > 2) {
      const re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      const inRaw = raw.match(re);
      const inT = t.match(re);
      if (inRaw && inT) t = t.replace(re, inRaw[0]);
    }
  }
  return t.replace(/\s+/g, ' ').trim().slice(0, 60) || query;
}

async function fetchDescription(pageUrl) {
  const html = await fetchHtml(pageUrl);
  if (!html) return { description: '' };
  const meta = html.match(RE.META_DESC) || html.match(RE.OG_DESC);
  let description = meta ? htmlUnescape(meta[1]).trim() : '';
  if (description.length > 260) description = description.slice(0, 257) + '…';
  return { description };
}

/* ══════════════════════════════════════════════════════════════════
   10. EPISODIOS: lista completa + idioma por episodio (doblaje real)
   ══════════════════════════════════════════════════════════════════ */

const PAGINATION_RE = /\/page\/\d+(?:\/|$)|[?&](page|pagina|pag|pg|p)=\d+|\/paginas?\/\d+|\/listado?\//i;
function isPagination(u) {
  try {
    const pu = new url.URL(u);
    if (PAGINATION_RE.test(pu.pathname + pu.search)) return true;
    return false;
  } catch { return PAGINATION_RE.test(u); }
}

function urlLangHint(u) {
  const s = String(u || '').toLowerCase();
  if (/(latino|doblado)/.test(s)) return 'latino';
  if (/castellano/.test(s)) return 'castellano';
  if (/sub-?espanol|subtitulado/.test(s)) return 'sub';
  return null;
}

async function buildEpisodes(pageUrl) {
  const html = await fetchHtml(pageUrl);
  if (!html) return { episodes: [], error: 'no-page' };
  const seriesTitle = (html.match(/<title>([^<]{3,120})<\/title>/i) || [])[1] || pageUrl;

  const byNumber = new Map();
  let m; RE.ANCHOR.lastIndex = 0;
  while ((m = RE.ANCHOR.exec(html)) !== null) {
    const abs = absolutize(m[1], pageUrl);
    if (!abs || !isHttp(abs) || looksLikeAd(abs)) continue;
    if (hostOf(abs) !== hostOf(pageUrl)) continue;
    if (isPagination(abs)) continue;
    const text = stripTags(m[2]);
    const combined = text + ' ' + abs;
    let n = null;
    let mm = combined.match(RE.EP_NUM);
    if (mm) n = parseInt(mm[1], 10);
    if (n == null) { mm = abs.match(RE.EP_HREF); if (mm) n = parseInt(mm[1], 10); }
    if (n == null || n < 0 || n > 2000) continue;
    if (!byNumber.has(n)) byNumber.set(n, { n, url: abs, text: text.slice(0, 80) });
  }
  // HUB: buscar enlaces de temporadas/capítulos y escanear UNO más.
  let episodes = [...byNumber.values()].sort((a, b) => a.n - b.n);
  if (episodes.length < 3) {
    const hubLinks = [];
    RE.ANCHOR.lastIndex = 0;
    while ((m = RE.ANCHOR.exec(html)) !== null) {
      const abs = absolutize(m[1], pageUrl);
      if (!abs || !isHttp(abs) || hostOf(abs) !== hostOf(pageUrl)) continue;
      if (isPagination(abs)) continue;
      if (/(temporada|season|capitulo|cap[ií]tulos|episodio|episodios)/i.test(abs) && !looksLikeAd(abs)) {
        if (!hubLinks.some(l => l === abs)) hubLinks.push(abs);
      }
      if (hubLinks.length >= 3) break;
    }
    for (const hub of hubLinks) {
      const h2 = await fetchHtml(hub);
      if (!h2) continue;
      RE.ANCHOR.lastIndex = 0;
      while ((m = RE.ANCHOR.exec(h2)) !== null) {
        const abs = absolutize(m[1], hub);
        if (!abs || !isHttp(abs) || hostOf(abs) !== hostOf(pageUrl)) continue;
        if (isPagination(abs)) continue;
        const text = stripTags(m[2]);
        const combined = text + ' ' + abs;
        let mm = combined.match(RE.EP_NUM);
        let n = mm ? parseInt(mm[1], 10) : null;
        if (n == null) { mm = abs.match(RE.EP_HREF); if (mm) n = parseInt(mm[1], 10); }
        if (n == null || n < 1 || n > 2000 || byNumber.has(n)) continue;
        byNumber.set(n, { n, url: abs, text: text.slice(0, 80) });
      }
      episodes = [...byNumber.values()].sort((a, b) => a.n - b.n);
      if (episodes.length >= 3) break;
    }
  }
  // Síntesis de rango completo por plantilla de URL (One Piece 1100+…).
  if (byNumber.size >= 3) {
    const eps = [...byNumber.values()].sort((a, b) => a.n - b.n);
    const maxN = eps[eps.length - 1].n;
    if (maxN > byNumber.size + 5) {
      const firstUrl = eps[0].url;
      const lastDigit = firstUrl.match(/\d{1,4}(?!.*\d)/);
      if (lastDigit) {
        const idx = firstUrl.lastIndexOf(lastDigit[0]);
        const template = firstUrl.slice(0, idx) + '{N}' + firstUrl.slice(idx + lastDigit[0].length);
        const checks = eps.slice(1, 8).filter(e => e.url === template.replace('{N}', String(e.n)));
        if (checks.length >= 3) {
          for (let n = 1; n <= Math.min(maxN, 1300); n++) {
            if (!byNumber.has(n)) {
              byNumber.set(n, { n, url: template.replace('{N}', String(n)), text: 'Episodio ' + n, synth: true });
            }
          }
          episodes = [...byNumber.values()].sort((a, b) => a.n - b.n);
        }
      }
    }
  }
  // tioanime y clones: "var episodes = [220,219,…]".
  if (byNumber.size < 3) {
    const jsEps = html.match(/var\s+episodes\s*=\s*\[([\d,\s]+)\]/);
    const slug = (pageUrl.match(/\/anime\/([^\/?#]+)/) || [])[1];
    if (jsEps && slug) {
      const nums = jsEps[1].split(',').map(s => parseInt(s, 10)).filter(n => n > 0 && n <= 2000);
      if (nums.length >= 3) {
        const maxN = Math.max(...nums);
        const origin = new url.URL(pageUrl).origin;
        const template = origin + '/ver/' + slug + '-{N}';
        const checks = [1, Math.min(maxN, 12)];
        const oks = await Promise.all(checks.map(n =>
          request(template.replace('{N}', String(n)), { timeoutMs: 8000, maxBytes: 4096 }).then(r => !!r.ok)
        ));
        if (oks.every(Boolean)) {
          for (let n = 1; n <= Math.min(maxN, 1300); n++) {
            if (!byNumber.has(n)) {
              byNumber.set(n, { n, url: template.replace('{N}', String(n)), text: 'Episodio ' + n, synth: true });
            }
          }
          episodes = [...byNumber.values()].sort((a, b) => a.n - b.n);
        }
      }
    }
  }
  // Síntesis genérica con sondeo (monoschinos y similares).
  if (byNumber.size >= 1 && byNumber.size < 3) {
    const seed = [...byNumber.values()].sort((a, b) => a.n - b.n)[0];
    const dm = seed.url.match(/\d{1,4}(?!.*\d)/);
    if (dm) {
      const idx = seed.url.lastIndexOf(dm[0]);
      const template = seed.url.slice(0, idx) + '{N}' + seed.url.slice(idx + dm[0].length);
      const already = template.replace('{N}', String(seed.n));
      if (already === seed.url) {
        // v2.0 · Sondeo DOBLANTE: series largas (One Piece 1100+) se
        // sintetizan completas — se sigue subiendo mientras existan.
        const probes = [1, 12, 60, 150, 300, 600, 900, 1200, 1500];
        let lastOk = 0;
        let firstFail = 1600;
        for (const n of probes) {
          if (byNumber.has(n)) { lastOk = n; continue; }
          const r = await request(template.replace('{N}', String(n)), { timeoutMs: 7000, maxBytes: 4096 });
          if (!r.ok) { firstFail = n; break; }
          lastOk = n;
        }
        // Búsqueda BINARIA entre lastOk y firstFail: One Piece va por
        // ~1130 — el sondeo saltaba de 900 a 1200 y se perdía la cola.
        if (lastOk > 0 && firstFail - lastOk > 2) {
          let lo = lastOk + 1, hi = firstFail - 1;
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const r = await request(template.replace('{N}', String(mid)), { timeoutMs: 7000, maxBytes: 4096 });
            if (r.ok) { lastOk = mid; lo = mid + 1; }
            else { hi = mid - 1; }
          }
        }
        if (lastOk > 0) {
          for (let n = 1; n <= Math.min(lastOk, 1300); n++) {
            if (!byNumber.has(n)) {
              byNumber.set(n, { n, url: template.replace('{N}', String(n)), text: 'Episodio ' + n, synth: true });
            }
          }
          episodes = [...byNumber.values()].sort((a, b) => a.n - b.n);
        }
      }
    }
  }
  // v2.0 · IDIOMA por episodio (rangos de doblaje + pistas de URL).
  const hasExplicitLang = episodes.some(e => urlLangHint(e.url));
  episodes = episodes.map(e => {
    const urlLang = urlLangHint(e.url);
    const lang = episodeLang(seriesTitle, e.n, urlLang) ||
      (hasExplicitLang ? urlLang || 'sub' : 'sub');
    return { ...e, lang };
  });
  return { episodes, total: episodes.length, page: pageUrl };
}

/* ══════════════════════════════════════════════════════════════════
   11. DESEMPAQUETADOR JS (p,a,c,k,e,d) — SIN eval
      MixDrop/Filemoon/StreamWish/Vidmoly esconden el video aquí.
   ══════════════════════════════════════════════════════════════════ */

function unescapeJsString(s) {
  return String(s)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, '$1');
}
function unpackPacked(js) {
  if (!js) return null;
  const m = js.match(/\}\(('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\.\s*split\s*\(\s*['"]\|['"]/);
  if (!m) return null;
  let p = unescapeJsString(m[1].slice(1, -1));
  const a = parseInt(m[2], 10), c = parseInt(m[3], 10);
  if (!a || !c || a > 62 || c > 1200) return null;
  const k = unescapeJsString(m[4].slice(1, -1)).split('|');
  // e(c): base-a reversible (36 + letras)
  const dict = new Map();
  const enc = (n) => {
    let out = '';
    let rest = n;
    const digits = [];
    if (rest === 0) digits.push(0);
    while (rest > 0) { digits.push(rest % a); rest = Math.floor(rest / a); }
    for (let i = digits.length - 1; i >= 0; i--) {
      const d = digits[i];
      out += d > 35 ? String.fromCharCode(d + 29) : d.toString(36);
    }
    return out;
  };
  for (let i = 0; i < c; i++) {
    const tk = enc(i);
    const v = k[i];
    dict.set(tk, v && v.length ? v : tk);
  }
  return p.replace(/\b\w+\b/g, w => (dict.has(w) ? dict.get(w) : w));
}

/* ══════════════════════════════════════════════════════════════════
   12. RESOLUTORES PROFUNDOS DE LA GRANJA (uno por casa de video)
   ══════════════════════════════════════════════════════════════════ */

/** Streamtape: el enlace vive en robotlink (3 trozos, el del medio es cebo). */
function resolveStreamtape(html) {
  const m = html.match(/robotlink'\)\.innerHTML\s*=\s*([^;]+);/);
  if (!m) return null;
  const parts = (m[1].match(/'([^']*)'/g) || []).map(s => s.slice(1, -1));
  if (parts.length >= 3) {
    let u = parts[0] + parts[2];
    if (u.startsWith('//')) u = 'https:' + u;
    return /^https?:/.test(u) ? u : null;
  }
  if (parts.length === 2) {
    let u = parts[0] + parts[1];
    if (u.startsWith('//')) u = 'https:' + u;
    return /^https?:/.test(u) ? u : null;
  }
  return null;
}

/** Dood: pass_md5 → hash → hash.mp4?token=… */
async function resolveDood(html, pageUrl) {
  const m = html.match(/\/pass_md5\/[^'"\\ ]+/);
  if (!m) return null;
  const origin = 'https://' + hostOf(pageUrl);
  const passUrl = origin + m[0].replace(/\\\//g, '/');
  const res = await request(passUrl, {
    headers: { Referer: pageUrl }, timeoutMs: 8000, maxBytes: 4096
  });
  if (!res.ok || !res.body) return null;
  const token = m[0].replace(/\\\//g, '/').split('/').pop();
  const body = res.body.trim();
  if (/^https?:/.test(body)) return body + (body.includes('?') ? '&' : '?') + 'token=' + token;
  return `${origin}${body.startsWith('/') ? '' : ''}${body.startsWith('/') ? body : ''}`.replace(/^$/, '') ||
    (body + '.mp4?token=' + token);
}

/** MixDrop: MDCore.wurl tras desempaquetar. */
function resolveMixDrop(html, pageUrl) {
  const unpacked = unpackPacked(html) || html;
  const m = unpacked.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/) ||
            unpacked.match(/wurl\s*=\s*["']([^"']+)["']/);
  if (!m) return null;
  let u = m[1];
  if (u.startsWith('//')) u = 'https:' + u;
  else if (u.startsWith('/')) u = 'https://' + hostOf(pageUrl) + u;
  return /^https?:/.test(u) ? u : null;
}

/** Filemoon / StreamWish / Vidmoly / StreamSB: file:"…m3u8|mp4" (packed). */
function resolvePackedPlayer(html) {
  const unpacked = unpackPacked(html);
  const hay = unpacked || html;
  const patterns = [
    /file"\s*:\s*"(https?:\/\/[^"]+\.(?:m3u8|mp4)[^"]*)"/,
    /file\s*=\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/,
    /sources\s*:\s*\[\s*\{[^}]*file"\s*:\s*"(https?:\/\/[^"]+)"/,
    /(?:src|source|urlVideo|videoUrl)\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/
  ];
  for (const re of patterns) {
    const m = hay.match(re);
    if (m) {
      let u = m[1].replace(/\\\//g, '/');
      if (/^\/\//.test(u)) u = 'https:' + u;
      if (/^https?:/.test(u)) return u;
    }
  }
  return null;
}

/** OkRu: JSON "movie":{"src":…} o data-options. */
function resolveOkru(html) {
  let m = html.match(/"movie"\s*:\s*\{[\s\S]{0,400}?"src"\s*:\s*"([^"]+)"/);
  if (m) return m[1].replace(/\\\//g, '/').replace(/\\u002F/gi, '/');
  m = html.match(/data-options\s*=\s*'([^']+)'/);
  if (m) {
    try {
      const j = JSON.parse(htmlUnescape(m[1]).replace(/&quot;/g, '"'));
      const src = j && j.movie && (j.movie.src || (j.movie.videos && j.movie.videos[0] && j.movie.videos[0].src));
      if (src) return src;
    } catch {}
  }
  return null;
}

/** Mp4Upload / Uqload / genérico: player.src / sources:[{file:…}]. */
function resolveGenericPlayer(html) {
  let m = html.match(/player\.src\(\s*["'](https?:\/\/[^"']+)["']/) ||
          html.match(/player\.setup\(\{[\s\S]{0,400}?file\s*:\s*["'](https?:\/\/[^"']+)["']/) ||
          html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["'](https?:\/\/[^"']+)["']/) ||
          html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/);
  if (m) {
    let u = m[1].replace(/\\\//g, '/').replace(/\\u002F/gi, '/');
    if (/^\/\//.test(u)) u = 'https:' + u;
    if (/^https?:/.test(u)) return u;
  }
  return null;
}

/** Despachador: dado un iframe/embed de la granja, devuelve la URL directa. */
async function deepResolveFarm(embedUrl, pageUrl) {
  // v3.0 (Fase 4) · filemoon: los sitios enlazan la página de DESCARGA
  // (/d/{id}); el reproductor empaquetado está en /e/{id}.
  if (/filemoon|moonplayer|moviesm4u/.test(embedUrl)) {
    embedUrl = embedUrl.replace(/\/d\/([a-z0-9]+)/i, '/e/$1');
  }
  const h = hostOf(embedUrl);
  const html = await fetchHtml(embedUrl, pageUrl);
  if (!html) return null;
  const tryOrder = [];
  if (/streamtape|strcloud|stape\.fun|stradoll/.test(h)) tryOrder.push(() => resolveStreamtape(html));
  if (/dood/.test(h)) tryOrder.push(() => resolveDood(html, embedUrl));
  if (/mixdrop|mixdrp/.test(h)) tryOrder.push(() => resolveMixDrop(html, embedUrl));
  if (/ok\.ru|odnoklassniki/.test(h)) tryOrder.push(() => resolveOkru(html));
  if (/filemoon|streamwish|vidmoly|streamsb|swhoi|wishfast|sbanh|sbplay/.test(h)) {
    tryOrder.push(() => resolvePackedPlayer(html));
  }
  tryOrder.push(() => resolvePackedPlayer(html));
  tryOrder.push(() => resolveGenericPlayer(html));
  // Fallback final: regex directo de fuentes en el HTML crudo.
  tryOrder.push(() => {
    let m; RE.FILE_SRC.lastIndex = 0;
    while ((m = RE.FILE_SRC.exec(html)) !== null) {
      const u = m[1].replace(/\\\//g, '/');
      if (/^https?:/.test(u) && !looksLikeAd(u)) return u;
    }
    return null;
  });
  for (const t of tryOrder) {
    try {
      const u = await t();
      if (u && isHttp(u) && !looksLikeAd(u)) return u;
    } catch {}
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════
   13. Escaneo de página (streams directos + iframes + matrices JS)
   ══════════════════════════════════════════════════════════════════ */

function extractFromHtml(html, pageUrl) {
  const found = new Map();
  let m; RE.DIRECT_VIDEO.lastIndex = 0;
  while ((m = RE.DIRECT_VIDEO.exec(html)) !== null) {
    let u = m[0].replace(/\\\//g, '/').replace(/\\u002[Ff]/g, '/').replace(/[\\"']+$/, '');
    if (u.length > 600 || !isHttp(u) || looksLikeAd(u)) continue;
    const ext = (u.match(/\.(mp4|m4v|mkv|webm|flv|m3u8|mpd)/i) || [])[1];
    const label = ext === 'm3u8' ? 'HLS directo (m3u8)'
      : ext === 'mpd' ? 'DASH directo (mpd)'
      : 'Video directo (.' + (ext || 'video') + ')';
    const embedish = /\/embed\/|\/player\/|\/watch\//.test(u);
    if (!found.has(u)) found.set(u, {
      url: u, label: embedish ? 'Reproductor (' + hostOf(u) + ')' : label,
      isIframe: embedish, referer: pageUrl
    });
  }
  RE.IFRAME.lastIndex = 0;
  while ((m = RE.IFRAME.exec(html)) !== null) {
    const abs = absolutize(m[1], pageUrl);
    if (!abs || !isHttp(abs) || looksLikeAd(abs) || abs.length > 600) continue;
    const h = hostOf(abs);
    if (RE.PLAYER_HINT.test(abs) || h.includes('embed')) {
      if (!found.has(abs)) found.set(abs, { url: abs, label: 'Reproductor (' + h + ')', isIframe: true, referer: pageUrl });
    }
  }
  const jsVars = html.match(/var\s+videos\s*=\s*(\[\[[\s\S]{0,6000}?\]\])/);
  if (jsVars) {
    const pairRe = /\[\s*"([^"]{1,24})"\s*,\s*"((?:[^"\\]|\\.)*)"/g;
    let p;
    while ((p = pairRe.exec(jsVars[1])) !== null) {
      const name = p[1];
      const abs = p[2].replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\u002[Ff]/gi, '/');
      if (!isHttp(abs) || looksLikeAd(abs) || abs.length > 600) continue;
      if (!found.has(abs)) {
        found.set(abs, { url: abs, label: `${name} (${hostOf(abs)})`, isIframe: true, referer: pageUrl, serverName: name });
      }
    }
  }
  RE.ANCHOR.lastIndex = 0;
  while ((m = RE.ANCHOR.exec(html)) !== null) {
    const abs = absolutize(m[1], pageUrl);
    if (!abs || !isHttp(abs) || looksLikeAd(abs) || abs.length > 600) continue;
    if (farmScore(abs) <= 0 || found.has(abs)) continue;
    let path = '';
    try { path = new url.URL(abs).pathname; } catch {}
    const videoish = /\/(embed|e|d|v|video|watch)\//i.test(path) ||
      /^\/[a-z0-9]{6,}\.html?$/i.test(path);
    if (videoish) {
      found.set(abs, { url: abs, label: `${farmName(abs)} (enlace del sitio)`, isIframe: true, referer: pageUrl });
    }
  }
  return [...found.values()];
}

/* ══════════════════════════════════════════════════════════════════
   14. RESOLVE v2: granja profunda + validación + variantes + episodios
        → JAMÁS "video no disponible": siempre se prueba TODO antes
          de responder.
   ══════════════════════════════════════════════════════════════════ */

async function quickValidate(streamUrl, referer) {
  const headers = { Range: 'bytes=0-0' };
  if (referer) headers['Referer'] = referer;
  const res = await request(streamUrl, {
    headers,
    accept: 'video/*,*/*;q=0.8',
    timeoutMs: 7000,
    maxBytes: 2048
  });
  if (!res.ok) return false;
  const type = String(res.headers['content-type'] || '').toLowerCase();
  return /video\/|audio\/|mpegurl|octet-stream|mp2t|dash/.test(type) || type === '';
}

async function expandHlsVariants(candidate) {
  if (!/\.m3u8(\?|$)/i.test(candidate.url)) return [];
  const res = await request(candidate.url, {
    headers: candidate.referer ? { Referer: candidate.referer } : {},
    accept: 'video/*,*/*;q=0.8',
    timeoutMs: 8000,
    maxBytes: 256 * 1024
  });
  if (!res.ok || !res.body || !res.body.includes('#EXT-X-STREAM-INF')) return [];
  const lines = res.body.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const next = (lines[i + 1] || '').trim();
    if (!next || next.startsWith('#')) continue;
    const m = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
    const height = m ? parseInt(m[2], 10) : 0;
    const abs = absolutize(next, candidate.url);
    if (!abs || !isHttp(abs)) continue;
    variants.push({ height, url: abs });
  }
  const labeled = variants.filter(v => v.height > 0).sort((a, b) => b.height - a.height);
  return labeled.filter(v => v.url !== candidate.url);
}

async function resolveStream({ pageUrl, episodeUrl, episode, lang }) {
  const notes = [];
  let target = episodeUrl || pageUrl;

  // v4.1 (FASE D1) · Idioma de la opción (latino/castellano/sub) que pide
  // la app: se propaga a CADA espejo para que el teléfono pueda saltar de
  // servidor SIN cambiar de idioma (bloqueo de idioma en cascada).
  const optionLang = (lang === 'latino' || lang === 'castellano' || lang === 'sub') ? lang : null;
  let episodeLangHint = optionLang || urlLangHint(target || '') || urlLangHint(pageUrl || '');

  // Paso 1: episodio pedido sin URL → localizarlo.
  if (episode && !episodeUrl) {
    const list = await buildEpisodes(pageUrl);
    const found = list.episodes.find(e => e.n === episode);
    if (found) {
      target = found.url;
      // v4.1 (FASE D1): el idioma EXPLÍCITO del episodio (rango de doblaje
      // real) manda sobre el de la opción.
      if (found.lang) episodeLangHint = found.lang;
    }
    else notes.push(`episodio ${episode} no listado (${list.total} encontrados)`);
  }

  // Paso 2: escanear la página objetivo.
  const html = await fetchHtml(target);
  if (!html) {
    // v4.0 (Fase 3) · AUTO-REPORTE: página inaccesible → fallo de la fuente.
    try { feedback.recordReport(pageUrl, false, 'página no accesible'); } catch {}
    return { mirrors: [], best: null, scanned: 0, notes: ['página no accesible: ' + target] };
  }
  let candidates = extractFromHtml(html, target);
  let scanned = 1;

  // Paso 3 (NÚCLEO v2.0): profundizar en los iframes de la GRANJA y
  // resolverlos a URL DIRECTA. En tandas de 4, máximo 8 embeds.
  const embeds = candidates.filter(c => c.isIframe && isFarmKnown(c.url)).slice(0, 8);
  for (let i = 0; i < embeds.length; i += 4) {
    const batch = embeds.slice(i, i + 4);
    const deep = await Promise.all(batch.map(async emb => {
      const direct = await deepResolveFarm(emb.url, target);
      scanned++;
      return direct ? { direct, emb } : null;
    }));
    for (const r of deep) {
      if (!r) continue;
      if (candidates.some(c => c.url === r.direct)) continue;
      candidates.push({
        url: r.direct,
        label: farmName(r.emb.url) + ' (resuelto)',
        isIframe: false,
        referer: r.emb.url,
        deep: true,
        serverName: farmName(r.emb.url)
      });
    }
  }

  // v3.0 (Fase 4) · FILTRO FINAL ANTI-ADS: aunque la extracción ya filtra,
  // ningún espejo devuelto al teléfono puede ser un host de anuncios
  // (defensa en profundidad: extractFromHtml → deepResolve → aquí).
  const before = candidates.length;
  candidates = candidates.filter(c => isHttp(c.url) && !looksLikeAd(c.url));
  if (candidates.length !== before) notes.push(`${before - candidates.length} espejo(s) de anuncios descartado(s)`);

  // Paso 4: ordenar (directos primero por fiabilidad de granja).
  candidates.sort((a, b) => {
    const ia = a.isIframe ? 1 : 0, ib = b.isIframe ? 1 : 0;
    if (ia !== ib) return ia - ib;
    return farmScore(b.url) - farmScore(a.url);
  });
  candidates = candidates.slice(0, 40);

  // Paso 5: VALIDAR los 12 primeros directos.
  const toValidate = candidates.filter(c => !c.isIframe).slice(0, 12);
  const verdicts = await Promise.all(toValidate.map(c => quickValidate(c.url, c.referer).then(v => [c, v])));
  for (const [c, v] of verdicts) c.validated = v;

  // Paso 5b: m3u8 MASTER → variantes con CALIDAD REAL.
  const validatedDirect = candidates.filter(c => c.validated === true).slice(0, 4);
  const variantResults = await Promise.all(
    validatedDirect.map(c => expandHlsVariants(c).then(vs => [c, vs]))
  );
  for (const [master, vars] of variantResults) {
    for (const v of vars.slice(0, 6)) {
      if (candidates.some(c => c.url === v.url)) continue;
      candidates.push({
        url: v.url,
        label: `HLS ${v.height}p (variante real)`,
        isIframe: false,
        referer: master.referer,
        quality: `${v.height}p`,
        validated: true,
        variantOf: master.url
      });
    }
  }

  const ordered = [
    ...candidates.filter(c => c.validated === true),
    ...candidates.filter(c => !c.isIframe && c.validated !== true),
    ...candidates.filter(c => c.isIframe)
  ];

  // v2.0 · Dedupe por URL (Mega/YourUpload repetidos por sitio).
  const seenUrls = new Set();
  const mirrors = ordered.filter(c => {
    const k = c.url.split('#')[0];
    if (seenUrls.has(k)) return false;
    seenUrls.add(k);
    return true;
  }).map(c => ({
    url: c.url,
    label: `${farmName(c.url)} · ${c.quality ? c.quality + ' · ' : ''}${c.label}`,
    isIframe: c.isIframe,
    server: farmName(c.url),
    quality: c.quality || '',
    validated: c.validated === true,
    // v4.1 (FASE D1) · idioma del espejo (opción → episodio → URL) para
    // que la cascada del teléfono salte SIN cambiar de idioma.
    lang: episodeLangHint || urlLangHint(c.url) || 'sub',
    headers: {
      'User-Agent': userAgentFor(c.url),
      ...(c.referer ? { Referer: c.referer } : {})
    }
  }));

  // Paso 6: episodios con su idioma (rango de doblaje aplicado).
  let episodes = [];
  if (pageUrl && isHttp(pageUrl)) {
    const epResult = await buildEpisodes(pageUrl);
    episodes = (epResult.episodes || []).slice(0, 1300);
  }

  const result = {
    mirrors,
    best: mirrors[0] || null,
    scanned,
    notes,
    target,
    episodes: episodes.map(e => ({ n: e.n, url: e.url, text: e.text, lang: e.lang || 'sub', synth: !!e.synth })),
    episodeCount: episodes.length
  };

  /* v4.0 (Fase 3) · AUTO-REPORTE DE REPRODUCCIÓN — la señal más valiosa
     para la re-priorización, y el usuario ni se entera de que subió:
       · 0 espejos            → ✗ (fuente rota para ESTE título)
       · algún espejo VALIDADO → ✓ (funciona seguro)
       · espejos sin validar   → sin señal (ambiguo, no contamina)
     Solo se ejecuta en cache-miss (TTL.resolve), sin doble conteo. */
  try {
    if (mirrors.length === 0) {
      feedback.recordReport(pageUrl, false, 'auto-resolve-vacio');
    } else if (mirrors.some(m => m.validated)) {
      feedback.recordReport(pageUrl, true, 'auto-resolve-ok');
    }
  } catch { /* jamás romper la resolución */ }

  return result;
}

/* ══════════════════════════════════════════════════════════════════
   15. RANKINGS estilo Seekee (/api/hot, /api/home) + /api/related
   ══════════════════════════════════════════════════════════════════ */

function hashCode(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
/** Puntuación de "calor" 🔺 determinista por día (estable, estilo Seekee). */
function heatFor(title, rank) {
  const daySeed = Math.floor(Date.now() / 86400000);
  return 95000 - rank * 2400 + (hashCode(title + ':' + daySeed) % 900);
}

async function hotAnime() {
  const list = await anilistList('TRENDING_DESC');
  return list.map((e, i) => ({
    rank: i + 1,
    title: e.title, year: e.year, type: e.type, rated: e.rated,
    genres: e.genres, image: e.image, episodes: e.episodes,
    score: heatFor(e.title, i), country: 'JP'
  }));
}
async function hotFromMeta(sort, format) {
  const list = await anilistList(sort, format);
  return list.map((e, i) => ({
    rank: i + 1,
    title: e.title, year: e.year, type: e.type, rated: e.rated,
    genres: e.genres, image: e.image, episodes: e.episodes,
    score: heatFor(e.title, i), country: 'JP'
  }));
}
/** Tendencias de un sitio vivo: enlaces de obras de su portada. */
async function trendingFromSite(host, patterns) {
  // v4.0 (Fase 3) · CORRECCIÓN DE ROTACIÓN: el catálogo puede haber
  // rotado (pelisplushd.net → pelisplushd.info), así que se busca por
  // host VIGENTE o por el dominio ORIGINAL desde el que rotó.
  const site = allSitesConfig().find(s => s.host === host || (s.rotated && s.rotated.from === host));
  if (!site || !siteIsUsable(site)) return [];
  host = site.host;
  const res = await request('https://' + host + '/', { timeoutMs: 8000, maxBytes: 1024 * 1024 });
  if (!res.ok || !res.body) return [];
  const out = [];
  const seen = new Set();
  let m; RE.ANCHOR.lastIndex = 0;
  while ((m = RE.ANCHOR.exec(res.body)) !== null) {
    const abs = absolutize(m[1], 'https://' + host + '/');
    if (!abs || hostOf(abs) !== host) continue;
    if (!patterns.some(p => p.test(abs))) continue;
    const k = abs.split('#')[0].replace(/\/+$/, '');
    if (seen.has(k)) continue;
    const alt = (m[2].match(/<img[^>]+alt="([^"]{3,120})"/) || [])[1] || '';
    const title = htmlUnescape(alt).trim() || stripTags(m[2]);
    if (title.length < 3) continue;
    seen.add(k);
    out.push({ title: title.slice(0, 70), pageUrl: k });
    if (out.length >= 10) break;
  }
  return out.map((o, i) => ({
    rank: i + 1, title: o.title, pageUrl: o.pageUrl,
    score: heatFor(o.title, i + 4), country: 'KR'
  }));
}
async function hotTab(tab) {
  tab = (tab || 'anime').toLowerCase();
  if (tab === 'anime') return hotAnime();
  if (tab === 'peliculas') {
    const fromSites = await trendingFromSite('pelisplushd.net', [/\/pelicula\//]);
    if (fromSites.length) return fromSites;
    return hotFromMeta('POPULARITY_DESC', 'MOVIE');
  }
  if (tab === 'series') {
    const fromSites = await trendingFromSite('pelisplushd.net', [/\/serie\//]);
    if (fromSites.length) return fromSites;
    return hotFromMeta('POPULARITY_DESC', 'TV');
  }
  if (tab === 'minidramas') {
    const fromSites = await trendingFromSite('doramasyt.com', [/\/(ver|dorama)\//]);
    if (fromSites.length) return fromSites;
    return hotFromMeta('POPULARITY_DESC');
  }
  return [];
}

/* ══════════════════════════════════════════════════════════════════
   16. Caché en memoria (TTL por tipo)
   ══════════════════════════════════════════════════════════════════ */

const cache = new Map();
const TTL = {
  search: 10 * 60 * 1000,
  eps: 15 * 60 * 1000,
  resolve: 8 * 60 * 1000,
  hot: 60 * 60 * 1000,
  related: 60 * 60 * 1000,
  home: 60 * 60 * 1000
};
const CACHE_MAX = 300;
function cacheGet(k, ttl) {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.t > ttl) { cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  cache.set(k, { t: Date.now(), v });
}

/* ══════════════════════════════════════════════════════════════════
   16bis. WATCHDOG DE DOMINIOS + ROTACIÓN REAL (v4.0 · Fase 2)
   ══════════════════════════════════════════════════════════════════
   Cada 6 h (ANIMAX_WATCHDOG_MIN): sondea la salud de cada sitio y, si
   un dominio cae dos ciclos seguidos, DESCUBRE el nuevo (historial +
   Bing + DuckDuckGo + semillas de TLD) y ROTA. La app lo recibe por
   queryFreshDomainList/navigationList SIN actualizar el APK — la
   técnica de "actualización real" de Seekee, ahora en AniMax.
   ══════════════════════════════════════════════════════════════════ */
const createWatchdog = require('./watchdog');
/* 8.0.2 · Capa nube: fuentes/servidores/blocklist de stream actualizables. */
const { buildCloud } = require('./cloud');
/* v7.0 (H4): dominios propios del Hub del dueño (mtime-cache) — el
   watchdog los sondea y aplica el failover entre mirrors. */
const hubDomains = require('./hub-domains');
watchdog = createWatchdog({
  request, siteHealth, rawSitesCatalog, DEBUG,
  hubDomains: hubDomains.hubDomainsConfig,   // v7.0 (H4): salud + failover Hub
  // Al rotar se limpia la caché de resultados del dominio viejo para
  // que la búsqueda use el dominio nuevo desde la siguiente petición.
  onRotate: (siteId, fromHost) => {
    let flushed = 0;
    for (const k of [...cache.keys()]) {
      if (/^(search:|eps:|res:)/.test(k) || String(k).includes(fromHost)) {
        cache.delete(k); flushed++;
      }
    }
    console.error(`[watchdog] caché limpiada tras rotar ${siteId} (${flushed} entradas)`);
  }
});

/* ══════════════════════════════════════════════════════════════════
   16.5 BLOQUEADOR DE ANUNCIOS — EasyList DIGERIDA (v3.0 · Fase 3-C)
   ══════════════════════════════════════════════════════════════════
   Técnica "Seekee": el teléfono NUNCA descarga EasyList (~80.000 reglas
   Adblock Plus, ~2 MB). ESTE servidor la descarga, la digiere a SOLO
   HOSTS (formato plano que consume AdBlocker.kt: un host por línea) y
   se la sirve ya masticada con caché de 24 h. Si la red de Render está
   bloqueada, cae a una lista mínima empaquetada (~150 hosts comunes).
   ══════════════════════════════════════════════════════════════════ */

const EASYLIST_URL = 'https://easylist.to/easylist/easylist.txt';
const ADBLOCK_MAX_HOSTS = 30000;   // límite de respuesta (~1-2 MB ya digerido)
const ADBLOCK_MAX_HIDE = 3000;     // v4.0 (Fase 6): límite de reglas cosméticas servidas
TTL.adblock = 24 * 60 * 60 * 1000; // EasyList "Expires: 4 days" — 24 h sobra

/* Lista mínima empaquetada (fallback si la descarga falla): anunciantes
   y rastreadores MUY comunes. Escrita a mano, ~150 hosts. */
const FALLBACK_ADBLOCK_HOSTS = [
  // ── Google / DoubleClick (la madre de todos los anuncios) ──
  'doubleclick.net', 'googlesyndication.com', 'pagead2.googlesyndication.com',
  'googleadservices.com', 'adservice.google.com', '2mdn.net',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'googlesyndication.jp', 'admob.com', 'adservice.com',
  // ── Redes de anuncios / RTB ──
  'adnxs.com', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com',
  'mgid.com', 'revcontent.com', 'zedo.com', 'adform.net', 'smartadserver.com',
  'pubmatic.com', 'rubiconproject.com', 'openx.net', 'casalemedia.com',
  'bidswitch.net', 'sharethrough.com', 'sonobi.com', 'yieldmo.com',
  'media.net', 'adbrite.com', 'adroll.com', 'everesttech.net', 'yieldlab.net',
  'teads.tv', 'sekindo.com', 'zinc1adtech.com', 'adsrvr.org', 'adtech.de',
  'adtechus.com', 'advertising.com', 'admixer.com', 'adunity.com',
  'aduptech.com', 'plista.com', 'ligatus.com', 'content-ad.net',
  'flashtalking.com', 'sitescout.com', 'a-mo.net', 'amung.us',
  'betweendigital.com', 'brand-server.com', 'adition.com', 'adsymptotic.com',
  'amazon-adsystem.com', 'serving-sys.com', 'mathtag.com', 'adcolony.com',
  'applovin.com', 'unityads.unity3d.com', 'vungle.com', 'inmobi.com',
  'chartboost.com', 'ironsrc.com', 'mintegral.com', 'ogury.com',
  'admixer.ru', 'adskeeper.com', 'hilltopads.net',
  // ── Popunders / adware agresivo (los típicos de sitios de streaming) ──
  'popads.net', 'popcash.net', 'propellerads.com', 'exoclick.com',
  'trafficjunky.com', 'juicyads.com', 'trafficfactory.biz', 'clickadu.com',
  'adsterra.com', 'admatic.com.tr', 'clicksor.com', 'onclickads.net',
  'onclasrv.com', 'adcash.com', 'admaven.com', 'meebo.com.adsurfeasy.com',
  'meazy.net', 'adcrones.com', 'otclickads.ru',
  // ── Rastreo / analítica / fingerprinting ──
  'scorecardresearch.com', 'quantserve.com', 'hotjar.com', 'mixpanel.com',
  'amplitude.com', 'segment.io', 'crazyegg.com', 'luckyorange.com',
  'tealium.com', 'tealiumiq.com', 'chartbeat.com', 'parsely.com',
  'crwdcntrl.net', 'bttrack.com', 'tapad.com', 'rlcdn.com', 'agkn.com',
  'demdex.net', 'omtrdc.net', 'adsafeprotected.com', 'eyeota.net',
  'id5-sync.com', 'adsco.re', 'spotxchange.com', 'sync.adaptv.net',
  'pixel.quantserve.com', 'beacon.krxd.net', 'px.moatads.com'
];

/* Digestión de EasyList a hosts:
     · `||ejemplo.com^`            → host ejemplo.com
     · `|http://x.ejemplo.com/^`   → host de la URL (solo si acaba en ^)
     · Se IGNORAN: excepciones @@, opciones $ (third-party, domain=…),
       negaciones ~, selectores CSS ## / #@#, wildcards * y reglas
       demasiado genéricas (sin punto).
     · Deduplica (Set) y recorta al límite de forma DETERMINISTA (el
       orden de EasyList va de lo más relevante a lo específico). */
function digestEasyList(text) {
  const found = new Set();
  // ||dominio^  ·  ||dominio  (solo dominio completo, sin ruta/opciones)
  const RE_DOMAIN = /^\|\|([a-z0-9]([a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)\^?$/i;
  // |http://host/ruta^  ·  http://host/ruta^ (simple, termina en ^)
  const RE_URL = /^\|?https?:\/\/([a-z0-9][a-z0-9.-]*[a-z0-9])\/[^\s]*\^$/i;
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue; // comentarios/cabeceras
    if (line.startsWith('@@')) continue;                                  // excepciones
    if (/[$*~#]/.test(line)) continue;          // opciones $ · wildcards * · ~ · CSS ##
    let m = RE_DOMAIN.exec(line);
    if (!m) m = RE_URL.exec(line);
    if (m) found.add(m[1].toLowerCase());
  }
  return [...found].slice(0, ADBLOCK_MAX_HOSTS);
}

/* v4.0 (Fase 6) · OCULTACIÓN DE ELEMENTOS (reglas cosméticas) —
   Técnica equivalente al elemhideemu.js de AdBlock Plus que usa Seekee
   (¡sin copiar su código GPLv3!): digiere de EasyList las reglas
   `##selector` (element hiding) y sirve una lista compacta de selectores
   CSS estándar que la app inyecta en el WebView para que las CAJAS de
   anuncios desaparezcan del DOM (no basta con bloquear la petición:
     queda un hueco vacío).

   Formato de salida (EasyList conservado, la app lo parsea con `##` como
   separador y `,` como separador de dominios):
     · `##.ad-banner`            → genérica (todos los sitios)
     · `ejemplo.com##.adbox`     → solo en ese dominio

   Se IGNORAN: excepciones `#@#`, CSS extendido de ABP `#?#`, reglas con
   dominios de excepción (`~dominio.com`) y selectores con sintaxis
   propietaria que querySelectorAll NO entiende (`:-abp-`, `:has-text`,
   `:xpath(`, llaves, backslash…). Límite: ADBLOCK_MAX_HIDE reglas. */
function digestEasyListCosmetics(text) {
  const found = new Set();
  // Sintaxis propietaria ABP/uBO NO soportada por querySelectorAll estándar
  const RE_BAD_SELECTOR = /:-abp-|:has-text|:contains\(|:matches-|:matches-path\(|:style\(|:upward\(|:nth-ancestor\(|:remove\(|:xpath\(|:react\(|:if\(|:if-not\(|[\\{}]/;
  const RE_DOMAIN_ONE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue; // comentarios/cabeceras
    if (line.startsWith('@@')) continue;                 // excepciones de bloqueo
    if (line.includes('#@#') || line.includes('#?#')) continue; // exception/extended CSS
    const sep = line.indexOf('##');
    if (sep === -1) continue;                             // no es element hiding
    const domainsPart = line.slice(0, sep);
    const selector = line.slice(sep + 2).trim();
    // SANITIZACIÓN: selector vacío, demasiado largo o con sintaxis no-CSS → fuera
    if (!selector || selector.length > 200) continue;
    if (RE_BAD_SELECTOR.test(selector)) continue;
    let domains = '';
    if (domainsPart) {
      const parts = domainsPart.split(',');
      // dominios de excepción (~dominio.com) → la regla NO es aplicable, fuera
      if (parts.some(d => d.includes('~'))) continue;
      // cada dominio debe ser un host simple válido (sin rutas ni opciones)
      if (!parts.every(d => RE_DOMAIN_ONE.test(d))) continue;
      domains = parts.map(d => d.toLowerCase()).join(',');
    }
    found.add(domains ? domains + '##' + selector : '##' + selector);
    if (found.size >= ADBLOCK_MAX_HIDE) break;            // límite determinista
  }
  return [...found].slice(0, ADBLOCK_MAX_HIDE);
}

/* v6.0 (G4) · REGLAS URL de EasyList (nuevo digeridor) — el segundo
   pilar del motor ABP-equivalente: las reglas `||dominio^$tipo,tipo`
   que la digestión a hosts pierde (bloquean UN tipo de recurso, p. ej.
   solo scripts). Salida compacta, una regla por línea:

     rule:dominio.com|script,image

   La app (AdBlocker.kt) infiere el tipo del recurso por la extensión de
   la URL (.js→script, .css→stylesheet, .jpg/.png→image…). Tipos con
   whitelist ABP estándar; se DESCARTAN reglas con opciones complejas
   (domain=, ~, *), excepciones @@ y las que quedan sin tipo conocido
   (esas ya están como host). Límite determinista ADBLOCK_MAX_RULES. */
const ADBLOCK_MAX_RULES = 8000;
const RE_DOMAIN_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const RULE_TYPES_OK = new Set(['script', 'image', 'stylesheet', 'subdocument', 'xmlhttprequest', 'media', 'object', 'other']);
function digestEasyListRules(text) {
  const found = new Map();   // host → Set<tipo>
  // ||dominio^$opciones  (también ||dominio.sub^$opciones)
  const RE = /^\|\|([a-z0-9][a-z0-9.-]*[a-z0-9])\^(?:\$([a-z0-9,~_=-]+))?$/i;
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    if (line.startsWith('@@')) continue;                    // excepciones
    const m = RE.exec(line);
    if (!m) continue;
    const host = m[1].toLowerCase();
    if (!RE_DOMAIN_HOST.test(host)) continue;
    const opts = (m[2] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    // Opciones complejas (domain=, negaciones ~, match-case) → fuera:
    if (opts.some(o => o.includes('=') || o.startsWith('~'))) continue;
    const types = opts.filter(o => RULE_TYPES_OK.has(o));
    // Sin tipos reconocibles: ya está cubierto por la digestión a hosts.
    if (!types.length) continue;
    if (!found.has(host)) found.set(host, new Set());
    for (const t of types) found.get(host).add(t);
    if (found.size >= ADBLOCK_MAX_RULES) break;             // límite determinista
  }
  const out = [];
  for (const [host, types] of found) out.push('rule:' + host + '|' + [...types].join(','));
  return out.slice(0, ADBLOCK_MAX_RULES);
}

/* v6.0 (G3) · Persistencia de la última lista buena en disco (Render
   free reinicia la instancia y pierde el caché en memoria; el disco
   efímero al menos sobrevive mientras viva). + FUSIÓN con ad_hosts
   (11,290 dominios extraídos de Seekee, mismo propósito: bloquear ads). */
const ADBLOCK_DISK = __dirname + '/data/adblock-cache.json';
function adblockDiskGet(key) {
  try { return JSON.parse(fs.readFileSync(ADBLOCK_DISK, 'utf8'))[key] || null; } catch { return null; }
}
function adblockDiskSet(key, value) {
  try {
    let all = {};
    try { all = JSON.parse(fs.readFileSync(ADBLOCK_DISK, 'utf8')) || {}; } catch {}
    all[key] = value; all.savedAt = new Date().toISOString();
    fs.writeFileSync(ADBLOCK_DISK, JSON.stringify(all));
  } catch { /* best-effort */ }
}
function loadAdHosts() {
  try {
    const txt = fs.readFileSync(__dirname + '/data/ad_hosts', 'utf8');
    return txt.split('\n').map(l => l.trim().toLowerCase())
      .filter(l => l && !l.startsWith('#') && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(l));
  } catch { return []; }
}
const AD_HOSTS_LOCAL = loadAdHosts();

/** Construye (con caché 24 h) la lista de hosts lista para AdBlocker.kt. */
async function buildAdblockList() {
  const cached = cacheGet('adblock', TTL.adblock);
  if (cached) return cached;

  // Descarga de EasyList con la función request() ya existente:
  // ~2 MB de texto → maxBytes generoso (8 MB) y timeout largo (15 s).
  const res = await request(EASYLIST_URL, {
    timeoutMs: 15000,
    maxBytes: 8 * 1024 * 1024,
    headers: { 'Accept': 'text/plain,*/*' }
  });

  let hosts, source;
  if (res.ok && res.body && res.body.includes('||')) {
    /* v6.0 (G3): EasyList digerida + FUSIÓN con ad_hosts (Set dedup) */
    hosts = [...new Set([...digestEasyList(res.body), ...AD_HOSTS_LOCAL])].slice(0, ADBLOCK_MAX_HOSTS);
    source = 'easylist+ad_hosts(' + AD_HOSTS_LOCAL.length + ')';
    adblockDiskSet('hosts', hosts.slice(0, 20000));   // última lista buena
  } else {
    // v6.0 (G3) cadena de fallback: disco → ad_hosts → embebida
    const disk = adblockDiskGet('hosts');
    if (disk && disk.length > 100) { hosts = disk; source = 'disk-cache'; }
    else if (AD_HOSTS_LOCAL.length) { hosts = AD_HOSTS_LOCAL.slice(); source = 'ad_hosts'; }
    else { hosts = FALLBACK_ADBLOCK_HOSTS.slice(); source = 'fallback'; }
  }
  // Red de seguridad: nunca una respuesta vacía (siempre hay fallback).
  if (!hosts.length) { hosts = FALLBACK_ADBLOCK_HOSTS.slice(); source = 'fallback'; }

  const body = hosts.join('\n') + '\n';
  cacheSet('adblock', body);
  console.log(`[animax-server] /api/adblock lista: ${hosts.length} hosts (${source}, ${(body.length / 1024).toFixed(0)} KB)`);
  return body;
}

/* v6.0 (G4) · REGLAS URL para el mini-motor ABP de AdBlocker.kt —
   TEXTO PLANO con líneas `rule:host|tipo,tipo…`. Cadena con caché 24 h,
   persistencia en disco (misma estrategia que hosts) y cero respuesta
   rota: si EasyList no está disponible → lista vacía (los hosts y los
   selectores cosméticos siguen sirviendo igual). */
async function buildAdblockRulesList() {
  const cached = cacheGet('adblock-rules', TTL.adblock);
  if (cached) return cached;

  let rules = [];
  const res = await request(EASYLIST_URL, {
    timeoutMs: 15000,
    maxBytes: 8 * 1024 * 1024,
    headers: { 'Accept': 'text/plain,*/*' }
  });
  if (res.ok && res.body && res.body.includes('||')) {
    rules = digestEasyListRules(res.body);
    if (rules.length) adblockDiskSet('rules', rules);
  } else {
    const disk = adblockDiskGet('rules');
    if (Array.isArray(disk) && disk.length) rules = disk;   // última buena
  }
  const body = rules.join('\n') + (rules.length ? '\n' : '');
  cacheSet('adblock-rules', body);
  console.log(`[animax-server] /api/adblock/rules: ${rules.length} reglas URL`);
  return body;
}

/* v4.0 (Fase 6) · Fallback cosmético empaquetado (~20 selectores genéricos
   MUY comunes, todos CSS estándar válidos) si la descarga de EasyList falla. */
const FALLBACK_HIDE_RULES = [
  '##.adsbygoogle',
  '##.ad-banner',
  '##.ad-container',
  '##.ad-slot',
  '##.advertisement',
  '##.ad-wrapper',
  '##.ad-label',
  '##.ad-overlay',
  '##.ad-frame',
  '##.ad-placement',
  '##.ad-space',
  '##.advert',
  '##.advertise',
  '##.adsbox',
  '##.banner-ad',
  '##.popup-ads',
  '##.sponsor',
  '##.sponsored-content',
  '##.text-ad',
  '##[class*="adslot"]',
  '##iframe[src*="doubleclick"]',
  '##iframe[src*="googlesyndication"]'
];

/** v4.0 (Fase 6): construye (con caché 24 h) la lista de selectores de
    ocultación de elementos lista para inyectar en el WebView. */
async function buildAdblockHideList() {
  const cached = cacheGet('adblock-hide', TTL.adblock);
  if (cached) return cached;

  // Misma descarga de EasyList que buildAdblockList (caché aparte por cuerpo)
  const res = await request(EASYLIST_URL, {
    timeoutMs: 15000,
    maxBytes: 8 * 1024 * 1024,
    headers: { 'Accept': 'text/plain,*/*' }
  });

  let rules, source;
  if (res.ok && res.body && res.body.includes('##')) {
    rules = digestEasyListCosmetics(res.body);
    source = 'easylist';
    adblockDiskSet('hide', rules.slice(0, 1500));     // v6.0 (G3): última lista buena
  } else {
    const disk = adblockDiskGet('hide');               // v6.0 (G3): disco primero
    rules = (disk && disk.length > 5) ? disk : FALLBACK_HIDE_RULES.slice();
    source = (disk && disk.length > 5) ? 'disk-cache' : 'fallback';
  }
  // Red de seguridad: nunca una respuesta vacía (siempre hay fallback).
  if (!rules.length) { rules = FALLBACK_HIDE_RULES.slice(); source = 'fallback'; }

  const body = rules.join('\n') + '\n';
  cacheSet('adblock-hide', body);
  console.log(`[animax-server] /api/adblock/hide lista: ${rules.length} selectores (${source}, ${(body.length / 1024).toFixed(0)} KB)`);
  return body;
}

/* ══════════════════════════════════════════════════════════════════
   16bis. HISTORIAL DE REPRODUCCIÓN SINCRONIZADO (v3.0 · Fase 5, punto 2)
   ══════════════════════════════════════════════════════════════════
   Historial PRIVADO y SIN CUENTAS: el teléfono se identifica con un
   deviceId (UUID persistido en sus SharedPreferences) y el servidor le
   guarda un máximo de 500 entradas de visionado por dispositivo.

   PERSISTENCIA: Map en memoria + volcado best-effort al fichero
   animax-history.json junto al servidor (writeFileSync/readFileSync con
   try/catch, carga al arrancar si existe). OJO: en Render.com el disco es
   EFÍMERO — el fichero solo sobrevive mientras viva la instancia y se
   pierde en cada deploy/reinicio. El historial LOCAL del teléfono es la
   FUENTE PRINCIPAL; el servidor es solo respaldo/sincronización entre
   reinstalaciones/dispositivos. La API key se respeta igual que en el
   resto de endpoints (check global al inicio del createServer). */

const HISTORY_FILE = __dirname + '/animax-history.json';
const HISTORY_MAX_PER_DEVICE = 500;  // entradas guardadas por dispositivo
const HISTORY_MAX_PER_PUSH = 100;    // entradas aceptadas por petición POST

/** deviceId → Map("contentId|episodeId" → entrada de historial). */
const historyStore = new Map();

function historyKey(contentId, episodeId) {
  return String(contentId || '') + '|' + String(episodeId || '');
}

/** Carga best-effort al arrancar (si el fichero existe; en disco efímero no). */
function loadHistory() {
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8') || '{}');
    for (const [deviceId, entries] of Object.entries(data || {})) {
      const m = new Map();
      for (const e of (Array.isArray(entries) ? entries : [])) {
        if (e && e.contentId) m.set(historyKey(e.contentId, e.episodeId), e);
      }
      if (m.size) historyStore.set(String(deviceId), m);
    }
    console.log(`[animax-server] historial cargado: ${historyStore.size} dispositivo(s)`);
  } catch { /* sin fichero o disco efímero: se empieza vacío */ }
}

/** Volcado best-effort a disco (Render lo borra al reiniciar — es normal). */
function saveHistory() {
  try {
    const data = {};
    for (const [deviceId, m] of historyStore) data[deviceId] = [...m.values()];
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(data));
  } catch { /* best-effort: nunca rompe una petición por fallar el disco */ }
}

loadHistory();

/* ────────────────────────────────────────────────────────────────────
   16ter. CAPA v4.0 (Fase 1) — ESPEJO DE LA API DE SEEKEE 1.4.0
   Monta el contrato completo (47 endpoints) con rutas /api/v1/… y las
   mismas formas de respuesta (beans Gson del APK). Ver v4-api.js.
   ──────────────────────────────────────────────────────────────────── */
const createV4Api = require('./v4-api');
const feedback = require('./feedback');   // v4.0 (Fase 3): reputación de fuentes + bitácora
/* v6.0 (G2) · PROVEEDORES REALES DE EPISODIOS (allanime/hianime →
   fallback motor propio). createProviders usa las primitivas del ctx. */
const { createProviders } = require('./providers');
const providers = createProviders({ request, cacheGet, cacheSet, TTL });
const v4Ctx = {
  json, readBody, cacheGet, cacheSet, TTL,
  allSitesConfig, siteHealth, siteIsUsable, hostOf,
  hotTab, buildOptions, metaSearch, metaMatch,
  anilistQuery, buildAdblockList, buildAdblockHideList, VERSION, request, // buildAdblockHideList: v4.0 (Fase 6)
  absolutize, stripTags, RE,
  normalizeTitle, titleRank, heatFor,
  watchdog,   // v4.0 (Fase 2): estado de fuentes + rotación de dominios
  buildEpisodes, // v4.1 (FASE D0.5): para las fichas del hub (/hub/watch)
  /* v6.0 (G2) · proveedores reales + resolutores profundos para embeds */
  providers, resolveStream, deepResolveFarm, quickValidate,
  /* v7.0 (H2) · GATE HONESTO del Hub: hub.js lee la clave de aquí para
     decidir si una página propia abre (X-Api-Key / ?key=) o muestra la
     portada «Abre este contenido dentro de AniMax». */
  apiKey: API_KEY
  // (feedback.js se requiere directo en v4-api.js — Fase 3)
};
const v4Route = createV4Api(v4Ctx);
// v4.1 (FASE D0.5) · PÁGINAS PROPIAS UNIFICADAS (hub.js): el mismo ctx
// compartido — v4-api auto-inyecta ctx.seekeeSearch al crearse, así el
// hub reutiliza el motor de búsqueda agregado sin duplicar nada.
const createHub = require('./hub');
const hubRoute = createHub(v4Ctx);

/* 8.0.2 · CAPA NUBE (/api/cloud/*): fuentes vigentes + ServerFarm +
   blocklist de stream — la app se actualiza sola desde aquí. */
const cloud = buildCloud({ allSitesConfig, siteHealth, VERSION });

/* ══════════════════════════════════════════════════════════════════
   17. Servidor HTTP + rutas
   ══════════════════════════════════════════════════════════════════ */

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { if (data.length < 100000) data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const parsed = new url.URL(req.url, `http://localhost`);
  const path = parsed.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (API_KEY && (req.headers['x-api-key'] || '') !== API_KEY) {
    /* v7.0 (H2) · GATE HONESTO: las páginas propias del Hub NO devuelven
       401 JSON — hub.js muestra su portada «Abre este contenido dentro
       de AniMax» (espejo del token= de Loklok, sin engaños). La API JSON
       sigue cerrada con 401 como siempre. */
    const hubPage = path === '/hub' || path === '/hub/detail' ||
      path === '/hub/theater' || path === '/hub/watch' || path === '/hub/version';
    if (!hubPage) {
      return json(res, 401, { ok: false, error: 'api-key-required' });
    }
  }

  try {
    /* v4.0 (Fase 1) · Capa espejo de la API de Seekee: /api/v1/* y
       /api/report/web (feedback de fuentes). Devuelve false si la ruta
       no es suya → continúa el router clásico de abajo.
       v4.0 (Fase 21): /apk/* también la gestiona v4-api (descarga del
       binario de actualización in-app con Content-Length real). */
    if (path.startsWith('/api/v1/') || path === '/api/report/web' || path.startsWith('/apk/')) {
      const handled = await v4Route(req, res, path, parsed.searchParams, started);
      if (handled !== false) return;
      return json(res, 404, { ok: false, error: 'no-found:' + path });
    }

    /* v4.1 (FASE D0.5) · PÁGINAS PROPIAS UNIFICADAS: /hub, /hub/watch y
       /hub/version las sirve hub.js (HTML propio con puente AnimaxHub +
       window.quan, espejo del javascriptChannel de Seekee). */
    if (path === '/hub' || path.startsWith('/hub/')) {
      const handled = await hubRoute(req, res, path, parsed);
      if (handled) return;
      return json(res, 404, { ok: false, error: 'no-found:' + path });
    }

    if (path === '/api/ping' && req.method === 'GET') {
      return json(res, 200, {
        ok: true, server: 'animax-server', version: VERSION,
        uptime: Math.round((Date.now() - STARTED) / 1000) + 's',
        cache: cache.size, port: PORT,
        sites: { total: allSitesConfig().length, vivos: [...siteHealth.values()].filter(h => h.ok).length }
      });
    }

    /* /api/domains → equivalente a queryFreshDomainList de Seekee
       v4.0 (Fase 2): ahora con rotación — host VIGENTE, dominio previo,
       cuándo rotó y con qué fuente se descubrió el nuevo. */
    if (path === '/api/domains' && req.method === 'GET') {
      const sites = allSitesConfig();
      const wstat = watchdog ? watchdog.status() : null;
      const stById = new Map((wstat ? wstat.sources : []).map(s => [s.id, s]));
      return json(res, 200, {
        ok: true, version: VERSION,
        domains: sites.map(s => s.host),
        sites: sites.map(s => {
          const ws = stById.get(String(s.host).replace(/^www\./, '').split('.')[0]);
          return {
            host: s.host, lang: s.lang, kind: s.kind,
            alive: siteHealth.has(s.host) ? siteHealth.get(s.host).ok : null,
            ms: siteHealth.has(s.host) ? siteHealth.get(s.host).ms : null,
            previousDomain: ws ? ws.previousDomain : null,
            changedAt: ws ? ws.changedAt : null,
            discoverySource: ws ? ws.discoverySource : 'catalogo'
          };
        }),
        summary: wstat ? wstat.summary : null,
        note: 'Rotación real: ANIMAX_WATCHDOG_MIN (defecto 360) · desactivar: ANIMAX_WATCHDOG_OFF=1'
      });
    }

    if (path === '/api/search' && req.method === 'GET') {
      const q = (parsed.searchParams.get('q') || '').trim();
      if (!q) return json(res, 400, { ok: false, error: 'falta ?q=' });
      feedback.recordQuery(q);   // v4.0 (Fase 3): bitácora → relatedQueries/forecast
      const key = 'search:' + q.toLowerCase();
      let result = cacheGet(key, TTL.search);
      if (!result) {
        result = await buildOptions(q);
        const withDesc = await Promise.all(
          result.options.slice(0, 8).map(async opt => {
            const { description } = await fetchDescription(opt.pageUrl);
            return { ...opt, description };
          })
        );
        result.options = withDesc;
        cacheSet(key, result);
      }
      return json(res, 200, { ok: true, ...result, took: Date.now() - started + 'ms' });
    }

    if (path === '/api/episodes' && req.method === 'GET') {
      const pageUrl = (parsed.searchParams.get('pageUrl') || '').trim();
      if (!isHttp(pageUrl)) return json(res, 400, { ok: false, error: 'falta ?pageUrl=http…' });
      const key = 'eps:' + pageUrl;
      let result = cacheGet(key, TTL.eps);
      if (!result) { result = await buildEpisodes(pageUrl); cacheSet(key, result); }
      return json(res, 200, { ok: true, ...result, took: Date.now() - started + 'ms' });
    }

    if (path === '/api/resolve' && req.method === 'POST') {
      const body = await readBody(req);
      if (!isHttp(body.pageUrl || '')) return json(res, 400, { ok: false, error: 'falta pageUrl' });
      const key = 'res:' + (body.pageUrl || '') + '|' + (body.episodeUrl || '') + '|' + (body.episode || '');
      let result = cacheGet(key, TTL.resolve);
      if (!result) { result = await resolveStream(body); cacheSet(key, result); }
      return json(res, 200, { ok: true, ...result, took: Date.now() - started + 'ms' });
    }

    if (path === '/api/validate' && req.method === 'POST') {
      const body = await readBody(req);
      if (!isHttp(body.url || '')) return json(res, 400, { ok: false, error: 'falta url' });
      const valid = await quickValidate(body.url, body.referer || '');
      return json(res, 200, { ok: true, url: body.url, valid });
    }

    /* NOVEDAD v2.0 · Ranking popular estilo Seekee */
    if (path === '/api/hot' && req.method === 'GET') {
      const tab = (parsed.searchParams.get('tab') || 'anime').toLowerCase();
      const key = 'hot:' + tab;
      let items = cacheGet(key, TTL.hot);
      if (!items) { items = await hotTab(tab); cacheSet(key, items); }
      return json(res, 200, { ok: true, tab, items, took: Date.now() - started + 'ms' });
    }

    /* NOVEDAD v2.0 · Portada: las 4 pestañas en un solo JSON */
    if (path === '/api/home' && req.method === 'GET') {
      let home = cacheGet('home', TTL.home);
      if (!home) {
        const [anime, peliculas, series, minidramas] = await Promise.all([
          hotTab('anime'), hotTab('peliculas'), hotTab('series'), hotTab('minidramas')
        ]);
        home = { anime, peliculas, series, minidramas };
        cacheSet('home', home);
      }
      return json(res, 200, { ok: true, ...home, took: Date.now() - started + 'ms' });
    }

    /* NOVEDAD v2.0 · Sugerencias (relatedQueries de Seekee) */
    if (path === '/api/related' && req.method === 'GET') {
      const q = (parsed.searchParams.get('q') || '').trim();
      if (!q) return json(res, 400, { ok: false, error: 'falta ?q=' });
      const key = 'related:' + q.toLowerCase();
      let items = cacheGet(key, TTL.related);
      if (!items) {
        const mal = await metaSearch(q);
        items = mal.map(x => x.title).slice(0, 6);
        cacheSet(key, items);
      }
      return json(res, 200, { ok: true, query: q, suggestions: items });
    }

    /* NOVEDAD v3.0 · Fase 5 (punto 2) · HISTORIAL SINCRONIZADO — GET:
       entradas del dispositivo, ordenadas por timestamp DESC (máx 500). */
    if (path === '/api/history' && req.method === 'GET') {
      const deviceId = (parsed.searchParams.get('deviceId') || '').trim();
      if (!deviceId) return json(res, 400, { ok: false, error: 'falta ?deviceId=' });
      const m = historyStore.get(deviceId) || new Map();
      const entries = [...m.values()]
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, HISTORY_MAX_PER_DEVICE);
      return json(res, 200, { ok: true, deviceId, count: entries.length, entries });
    }

    /* NOVEDAD v3.0 · Fase 5 (punto 2) · HISTORIAL SINCRONIZADO — POST:
       merge (upsert por contentId+episodeId, gana el timestamp MAYOR).
       Máx 100 entradas por petición; responde {ok:true, merged, total}. */
    if (path === '/api/history' && req.method === 'POST') {
      const body = await readBody(req);
      const deviceId = String(body.deviceId || '').trim();
      if (!deviceId) return json(res, 400, { ok: false, error: 'falta deviceId' });
      const incoming = (Array.isArray(body.entries) ? body.entries : []).slice(0, HISTORY_MAX_PER_PUSH);
      if (!incoming.length) return json(res, 400, { ok: false, error: 'falta entries' });
      const m = historyStore.get(deviceId) || new Map();
      let merged = 0;
      for (const raw of incoming) {
        const e = raw || {};
        const contentId = String(e.contentId || '').trim();
        if (!contentId) continue;
        const key = historyKey(contentId, e.episodeId);
        const prev = m.get(key);
        // Upsert: solo sobreescribe si la entrada nueva es MÁS RECIENTE.
        if (!prev || Number(e.timestamp || 0) > Number(prev.timestamp || 0)) {
          m.set(key, {
            contentId: contentId,
            contentTitle: String(e.contentTitle || ''),
            episodeId: e.episodeId ? String(e.episodeId) : '',
            episodeLabel: String(e.episodeLabel || ''),
            positionMs: Math.max(0, Number(e.positionMs) || 0),
            durationMs: Math.max(0, Number(e.durationMs) || 0),
            timestamp: Number(e.timestamp) || Date.now()
          });
          merged++;
        }
      }
      // Recorte por dispositivo: si hay más de 500, fuera las más viejas.
      let final = m;
      if (m.size > HISTORY_MAX_PER_DEVICE) {
        final = new Map(
          [...m.entries()]
            .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0))
            .slice(0, HISTORY_MAX_PER_DEVICE)
        );
      }
      historyStore.set(deviceId, final);
      saveHistory();
      return json(res, 200, { ok: true, merged, total: final.size });
    }

    /* NOVEDAD v3.0 · Fase 5 (punto 2) · HISTORIAL SINCRONIZADO — DELETE:
       borra TODO el historial del dispositivo (p. ej. al limpiar local). */
    if (path === '/api/history' && req.method === 'DELETE') {
      const deviceId = (parsed.searchParams.get('deviceId') || '').trim();
      if (!deviceId) return json(res, 400, { ok: false, error: 'falta ?deviceId=' });
      historyStore.delete(deviceId);
      saveHistory();
      return json(res, 200, { ok: true, deleted: true });
    }

    /* NOVEDAD v3.0 · Fase 3-C: EasyList digerida por el servidor → lista
       de hosts para el AdBlocker del navegador. TEXTO PLANO (no JSON):
       un host por línea, igual que assets/browser/adblock_hosts.txt. */
    if (path === '/api/adblock' && req.method === 'GET') {
      const body = await buildAdblockList();
      const lines = body.trim() ? body.trim().split('\n').length : 0;
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'X-Blocks': String(lines),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      });
      return res.end(body);
    }

    /* NOVEDAD v4.0 (Fase 6): selectores de OCULTACIÓN de elementos
       (cosméticos) digeridos de EasyList → la app los inyecta en el
       WebView para que las cajas de anuncios desaparezcan del DOM.
       TEXTO PLANO: una regla EasyList por línea (`##selector` o
       `dominio.com##selector`). */
    if (path === '/api/adblock/hide' && req.method === 'GET') {
      const body = await buildAdblockHideList();
      const lines = body.trim() ? body.trim().split('\n').length : 0;
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'X-Blocks': String(lines),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      });
      return res.end(body);
    }

    /* v6.0 (G4) · REGLAS URL de EasyList para el mini-motor ABP de la
       app (AdBlocker.kt): texto plano `rule:host|tipo,tipo…`. Tercera
       pieza del bloqueo: hosts (red) + selectores (cosmético) + reglas
       por TIPO de recurso (scripts, imágenes…). */
    if (path === '/api/adblock/rules' && req.method === 'GET') {
      const body = await buildAdblockRulesList();
      const lines = body.trim() ? body.trim().split('\n').length : 0;
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'X-Blocks': String(lines),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      });
      return res.end(body);
    }

    /* NOTA v6.0 (G4): /api/v1/report/adblock vive en v4-api.js — TODO lo
       que empieza por /api/v1/ lo enruta esa capa (el router clásico no
       la ve; un 404 saldría antes de llegar aquí). */

    /* ════════════════════════════════════════════════════════════════
       8.0.2 · CAPA NUBE (/api/cloud/*) — la app se actualiza sola:
       fuentes tier-1 vigentes, ServerFarm y blocklist de STREAM.
       ════════════════════════════════════════════════════════════════ */
    {
      const handled = cloud.register(path, req, res, json);
      if (handled) return;
    }

    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>AniMax Server</title>
<style>body{background:#0d0d12;color:#eee;font-family:system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 16px}
h1{color:#ff5a3c}code{background:#1c1c26;padding:2px 6px;border-radius:6px}a{color:#ff8a3c}</style></head><body>
<h1>AniMax Server ${VERSION}</h1>
<p>Servidor privado multi-fuente — el teléfono pregunta, este servidor trabaja.</p>
<p style="color:#ff8a3c"><b>v4.0 · Capa espejo de la API de Seekee 1.4.0</b> — mismas rutas y formas de respuesta (beans) que <code>mobile-api.buscari.com</code>, sin anuncios ni telemetría:</p>
<ul>
<li><b>HOME server-driven</b> · <code>GET /api/v1/app/content/home/navigationBar</code> · <code>getSectionContentByPage</code> · <code>getSingle/MultipleAlbumDetail</code> · <code>getGuideImgList</code></li>
<li><b>Catálogo de sitios</b> · <code>GET /api/v1/app/content/website/navigationList</code> · <code>queryFreshDomainList</code> (dominios vigentes estilo Seekee)</li>
<li><b>FilmCenter</b> · <code>GET /api/v1/content/filmCenter/homepage</code> · <code>stream/types</code> · <code>stream/films</code> · <code>genres</code> · <code>genres/popular</code> · <code>genres/films</code> · <code>orderTypes</code> · <code>film/subPage</code></li>
<li><b>Búsqueda v2</b> · <code>POST|GET /api/v1/app/search/search</code> (web+contenido, <code>SearchResultPageData</code> con <b>sourceList</b> agregado por título y prioridad Latino→Castellano→Sub) · <code>GET /api/v1/search/relatedQueries?keyWord=</code> · <code>/api/v1/api/home/search/hot</code> (con <code>heatScore</code>) · <code>screening/list</code> · <code>category/list</code> · <b>🆕</b> <code>GET /api/v1/app/search/forecast?keyWord=</code> (predicción de texto)</li>
<li><b>Reproductor</b> · <code>GET /api/v1/tv/configuration/subtitles</code> (<code>DomainSubtitlesBean</code>)</li>
<li><b>Anti-anuncios</b> · <code>GET /api/v1/api/config/getAdBlockRule</code> · <code>v2/getAdBlockDomain</code></li>
<li><b>Config remota</b> · <code>GET /api/v1/config/javs/querySettings</code> (URL del script sniffer) · <code>GET /api/v1/config/sniffer.js</code> · <code>config/appUpdate/check</code></li>
<li><b>Recomendados</b> · <code>GET /api/v1/api/content/recommend/list</code></li>
<li><b>Reportes de fuentes</b> · <code>POST /api/report/web</code> {url, ok, reason} → re-priorización · <code>GET /api/report/web</code> resumen con reputación</li>
<li><b>🆕 Re-priorización automática (Fase 3)</b> — auto-reportes del propio servidor (resoluciones ✓/✗ y aciertos de búsqueda por fuente) + feedback de la app → el orden de resultados se recalcula solo. <code>GET /api/v1/config/sources/status</code> ahora incluye <code>search</code> y <code>penalty</code> por fuente</li>
<li><b>🆕 Watchdog de dominios (Fase 2)</b> · <code>GET /api/v1/config/sources/status</code> — salud por sitio, última verificación y rotaciones · <code>POST /api/v1/config/sources/refresh</code> — lanza un ciclo ya · <code>GET /api/domains</code> — dominios VIGENTES + rotación</li>
</ul>
<p>Rutas clásicas (compatibilidad AniMax 3.x):</p>
<ul>
<li><code>GET /api/ping</code> — estado + sitios vivos</li>
<li><code>GET /api/search?q=one piece</code> — opciones [Doblado]/[Sub] con metadatos</li>
<li><code>GET /api/episodes?pageUrl=…</code> — todos los episodios CON SU IDIOMA</li>
<li><code>POST /api/resolve</code> — {pageUrl, episode} → espejos validados (granja profunda)</li>
<li><code>GET /api/hot?tab=anime|peliculas|series|minidramas</code> — ranking popular 🔺</li>
<li><code>GET /api/home</code> — las 4 pestañas del ranking en un JSON</li>
<li><code>GET /api/related?q=…</code> — sugerencias de búsqueda</li>
<li><code>GET /api/domains</code> — sitios con su salud y rotación de dominios (Fase 2)</li>
<li><code>GET /api/adblock</code> — EasyList digerida a hosts (bloqueador del navegador) 🛡️</li>
<li><code>GET /api/adblock/hide</code> — selectores de ocultación de elementos (cosméticos, Fase 6) 🪄</li>
<li><code>GET /api/adblock/rules</code> — reglas URL por tipo de recurso (motor ABP-equivalente, G4) 🧩</li>
<li><code>POST /api/v1/report/adblock</code> — stats de bloqueos de la app (diagnóstico del dueño, G4) 📊</li>
<li><code>GET /api/history?deviceId=…</code> — historial de reproducción del dispositivo 🕘</li>
<li><code>POST /api/history</code> — {deviceId, entries} → merge (gana el timestamp mayor)</li>
<li><code>DELETE /api/history?deviceId=…</code> — borra el historial del dispositivo</li>
</ul>
<p>Prueba: <a href="/api/ping">/api/ping</a> · <a href="/api/hot">/api/hot</a></p></body></html>`);
    }

    return json(res, 404, { ok: false, error: 'no-found:' + path });
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[animax-server] v${VERSION} escuchando en puerto ${PORT}`);
  console.log(`[animax-server] API key: ${API_KEY ? 'activada' : 'abierta (uso personal)'}`);
  console.log(`[animax-server] Proxy: ${PROXY ? 'configurado' : 'no'}`);
  // Probador de salud: arranque + cada 25 min (dominios frescos, técnica Seekee).
  refreshHealth().catch(() => {});
  setInterval(() => refreshHealth().catch(() => {}), 25 * 60 * 1000);
  // v4.0 (Fase 2) · WATCHDOG: sondeo + descubrimiento + rotación de
  // dominios cada 6 h (ANIMAX_WATCHDOG_MIN para probar más rápido).
  if (watchdog) watchdog.start();
});
