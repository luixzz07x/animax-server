#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   ║  ANIMAX SERVER · Servidor privado de búsqueda (estilo Seekee)      ║
   ║  v1.0.0 — Node.js PURO, CERO dependencias                          ║
   ╚═════════════════════════════════════════════════════════════════════
   El teléfono lento ya NO busca: le pregunta a este servidor y este
   hace todo el trabajo pesado (abrir páginas, encontrar el video
   escondido, validar que sirva) y devuelve JSON listo para reproducir.

   Endpoints (todos devuelven JSON):
     GET  /api/ping                  → estado del servidor
     GET  /api/search?q=one piece    → opciones [Doblado]/[Sub] + descripción
     GET  /api/episodes?pageUrl=...  → lista COMPLETA de episodios (sin límite)
     POST /api/resolve {pageUrl,episodeUrl?,episode?}
                                      → servidores de video ordenados + headers
     POST /api/validate {url,referer}→ ¿este stream sirve?

   Configuración (variables de entorno, opcionales):
     PORT            puerto (default 3001; Render/Fly lo inyectan solos)
     ANIMAX_API_KEY  si se define, los clientes deben enviar X-Api-Key
   ══════════════════════════════════════════════════════════════════════ */

'use strict';

const VERSION = '1.0.0';
const PORT = Number(process.env.PORT || process.env.ANIMAX_PORT || 3001);
const API_KEY = process.env.ANIMAX_API_KEY || '';   // vacío = abierto (uso personal)
const STARTED = Date.now();

/* ══════════════════════════════════════════════════════════════════
   1. HTTP con redirecciones + timeouts (módulo https, sin fetch API
      para máxima compatibilidad con Node 14+ y Bun)
   ══════════════════════════════════════════════════════════════════ */

const https = require('https');
const http = require('http');
const url = require('url');

const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

/* UA de escritorio para los BUSCADORES (técnica Seekee): los motores de
   búsqueda sirven páginas completas (con resultados) a los navegadores de
   PC; a los móviles les dan versiones recortadas y a las IPs de datacenter
   les ponen desafños (DDG 202). Este UA lo usan SOLO los buscadores —
   las páginas de contenido siguen con su UA por sitio (whitelist). */
const ENGINE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* Whitelist de sitios que exigen UA de ESCRITORIO (port de la v2.0.1
   de AniMax, técnica extraída del APK de Seekee). */
const DESKTOP_HOSTS = [
  'playspelis.com', 'cuevana4br.com', '321moviesfree.com', 'solo-latino.com',
  'cuevana3.ch', 'cuevana.biz', 'cuevana.pro', 'pelisflix', 'repelis',
  'pelismedia', 'pluslatino', 'mitonicine', 'cinelatino'
];
const SEEKEE_DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

function hostOf(u) {
  try { return (new url.URL(u).hostname || '').toLowerCase(); } catch { return ''; }
}
function needsDesktopMode(u) {
  const h = hostOf(u);
  if (!h) return false;
  return DESKTOP_HOSTS.some(d => h === d || h.endsWith('.' + d));
}
function userAgentFor(u) {
  return needsDesktopMode(u) ? SEEKEE_DESKTOP_UA : BROWSER_UA;
}

/**
 * Petición HTTP con seguimiento de redirecciones (hasta 5 saltos),
 * tope de tiempo y límite de bytes. Devuelve
 * { ok, status, headers, body } o { ok:false, error }.
 */
function request(target, options = {}) {
  return new Promise((resolve) => {
    let redirectsLeft = 5;
    const maxBytes = options.maxBytes || 2 * 1024 * 1024;
    const timeoutMs = options.timeoutMs || 9000;
    const startedAt = Date.now();

    const attempt = (current) => {
      if (redirectsLeft < 0) return resolve({ ok: false, error: 'too-many-redirects' });
      let parsed;
      try { parsed = new url.URL(current); } catch { return resolve({ ok: false, error: 'bad-url' }); }
      const mod = parsed.protocol === 'http:' ? http : https;
      const req = mod.request(current, {
        method: options.method || 'GET',
        // Cabeceras gigantes (cookies de anuncios de +19KB) hacen que el
        // parser muera con "Header overflow" (límite por defecto: 16KB).
        maxHeaderSize: 1048576,
        headers: options.bare
          // MODO MOTOR (Bing): headers mínimos estilo curl — UA + Accept */*.
          // Descubierto a base de pruebas: desde IPs de datacenter, Bing
          // sirve páginas vacías (b_no) si ve Accept-Language/accesorios.
          ? {
              'User-Agent': options.userAgent || userAgentFor(current),
              'Accept': '*/*'
            }
          : {
              'User-Agent': options.userAgent || userAgentFor(current),
              'Accept': options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'es-ES,es;q=0.9,en;q=0.6',
              ...(options.headers || {})
            },
        timeout: timeoutMs
      }, (res) => {
        const status = res.statusCode || 0;
        // Redirección → seguir el Location.
        if (status >= 301 && status <= 308 && res.headers.location) {
          res.resume();
          redirectsLeft--;
          let next = res.headers.location;
          if (next.startsWith('//')) next = parsed.origin + next;
          else if (next.startsWith('/')) next = parsed.origin + next;
          else if (!/^https?:/i.test(next)) {
            try { next = new url.URL(next, current).href; } catch { return resolve({ ok: false, error: 'bad-redirect' }); }
          }
          return attempt(next);
        }
        if (options.onlyHead) { res.resume(); return resolve({ ok: status < 400, status, headers: res.headers, body: '' }); }
        const chunks = []; let total = 0; let aborted = false;
        res.on('data', (c) => {
          if (total + c.length > maxBytes) { if (!aborted) { aborted = true; req.destroy(); } return; }
          total += c.length; chunks.push(c);
        });
        res.on('end', () => resolve({
          ok: status >= 200 && status < 400,
          status,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          ms: Date.now() - startedAt
        }));
        res.on('error', () => resolve({ ok: false, error: 'stream-error' }));
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', () => resolve({ ok: false, error: 'network' }));
      req.end();
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
   2. Utilidades de HTML (port exacto del cazador Kotlin de AniMax)
   ══════════════════════════════════════════════════════════════════ */

const RE = {
  // La extensión debe terminar en frontera (fin, ?, comilla, espacio, /…):
  // sin el lookahead, "https://www.mp4upload.com" se truncaba a "https://www.mp4".
  DIRECT_VIDEO: /https?:\/\/[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+\.(?:mp4|m4v|mkv|webm|flv|m3u8|mpd)(?=$|\?|["'\s\/\\<>)])(?:\?[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]*)?/gi,
  IFRAME: /<iframe[^>]+src=["']([^"']+)["']/gi,
  ANCHOR: /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  META_DESC: /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  OG_DESC: /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
  AD_HINT: /(doubleclick|googlesyndication|googleadservices|adservice|adsrvr|adnxs|criteo|taboola|outbrain|popads|popcash|propellerads)/i,
  PLAYER_HINT: /(player|embed|stream|watch|video|ver|episod|episode)/i,
  DDG_LINK: /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
  BING_LINK: /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
  EP_NUM: /(?:episodio|episodios|episode|cap[ií]tulo|capitulo|cap)[\s_-]*(\d{1,4})/i,
  EP_HREF: /\/(?:episodio|episodios|episode|capitulo|cap[ií]tulo|cap|ep)[\s_-]*(\d{1,4})/i
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
  const s = htmlUnescape(src.trim());
  if (/^https?:/i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  try { return new url.URL(s, base).href; } catch { return null; }
}
function looksLikeAd(u) { return RE.AD_HINT.test(u); }
function isHttp(u) { return /^https?:/i.test(u); }

/* ══════════════════════════════════════════════════════════════════
   3. Granja de servidores (mini versión: nombres + fiabilidad)
   ══════════════════════════════════════════════════════════════════ */

const FARM = [
  ['OkRu', ['ok.ru', 'odnoklassniki'], 50],
  ['YourUpload', ['yourupload'], 48],
  ['Streamtape', ['streamtape', 'strcloud', 'streamta.pe', 'stape.fun'], 46],
  ['DoodStream', ['dood', 'dsvplay', 'doodstream', 'dooood'], 45],
  ['Mp4Upload', ['mp4upload'], 44],
  ['MixDrop', ['mixdrop', 'mixdrp'], 42],
  ['StreamSB', ['streamsb', 'ssbstream', 'sbplay'], 40],
  ['Vidmoly', ['vidmoly', 'molystream'], 38],
  ['Uqload', ['uqload', 'uqwatch'], 36],
  ['Voe', ['voe.sx', 'voeunblk', 'brookethoughi'], 34],
  ['StreamWish', ['streamwish', 'wishfast', 'swhoi'], 33],
  ['Filemoon', ['filemoon', 'moonplayer'], 32],
  ['Vidhide', ['vidhide', 'vidhidy', 'smoothpre'], 31],
  ['JeniusPlay', ['jenius'], 30],
  ['LuluStream', ['luluvdo', 'lulustream'], 29],
  ['Highload', ['highload'], 28],
  ['KissKh', ['kisskh'], 23],
  ['Vidlox', ['vidlox'], 23],
  ['Aniwatch', ['aniwatch', 'hianime'], 22],
  ['Upstream', ['upstream'], 22],
  ['VidFast', ['vidfast'], 21],
  ['VidSrc', ['vidsrc'], 18],
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

/* ══════════════════════════════════════════════════════════════════
   4. Búsqueda web (Bing → DuckDuckGo), port del cazador
      Bing va PRIMERO: DDG bloquea IPs de datacenter (202) y en Render
      viviremos en un datacenter. Con UA de escritorio Bing sirve la
      página completa (b_algo) y los enlaces /ck/a se decodifican.
   ══════════════════════════════════════════════════════════════════ */

/** Decodifica los enlaces de redirección de Bing: 
 *  https://www.bing.com/ck/a?!&&p=…&u=a1<base64url del destino> */
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

async function searchWeb(query, maxHits = 14) {
  const q = encodeURIComponent(query);
  const hits = [];

  // ── Motor 1: Bing (UA escritorio → página completa) ──────────────
  const bing = await request(`https://www.bing.com/search?q=${q}&setlang=es&count=20`, {
    userAgent: ENGINE_UA, bare: true
  });
  if (bing.ok && bing.body) {
    let m; RE.BING_LINK.lastIndex = 0;
    while ((m = RE.BING_LINK.exec(bing.body)) !== null) {
      let link = htmlUnescape(m[1]);
      if (hostOf(link).includes('bing.com')) link = decodeBingLink(link); // /ck/a → destino real
      const title = stripTags(m[2]);
      if (isHttp(link) && title && !looksLikeAd(link)) hits.push({ title, url: link });
    }
  }
  if (hits.length) return dedupeHits(hits).slice(0, maxHits);

  // ── Motor 2: DuckDuckGo lite (a veces bloquea datacenters con 202) ─
  const ddg = await request(`https://html.duckduckgo.com/html/?q=${q}&kl=es-es`, { userAgent: ENGINE_UA, bare: true });
  if (ddg.ok && ddg.status !== 202 && ddg.body) {   // 202 = desafño/bloqueo
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
   5. Escaneo de página: streams directos + iframes de players
   ══════════════════════════════════════════════════════════════════ */

function extractFromHtml(html, pageUrl) {
  const found = new Map();
  // a) Streams directos (también dentro de scripts JSON).
  let m; RE.DIRECT_VIDEO.lastIndex = 0;
  while ((m = RE.DIRECT_VIDEO.exec(html)) !== null) {
    let u = m[0].replace(/\\\//g, '/').replace(/\\u002[Ff]/g, '/').replace(/[\\"']+$/, '');
    if (u.length > 600 || !isHttp(u) || looksLikeAd(u)) continue;
    const ext = (u.match(/\.(mp4|m4v|mkv|webm|flv|m3u8|mpd)/i) || [])[1];
    const label = ext === 'm3u8' ? 'HLS directo (m3u8)'
      : ext === 'mpd' ? 'DASH directo (mpd)'
      : 'Video directo (.' + (ext || 'video') + ')';
    // Un "/embed/" es una página de reproductor, no un stream directo.
    const embedish = /\/embed\/|\/player\/|\/watch\//.test(u);
    if (!found.has(u)) found.set(u, {
      url: u, label: embedish ? 'Reproductor (' + hostOf(u) + ')' : label,
      isIframe: embedish, referer: pageUrl
    });
  }
  // b) Iframes de reproductores embebidos.
  RE.IFRAME.lastIndex = 0;
  while ((m = RE.IFRAME.exec(html)) !== null) {
    const abs = absolutize(m[1], pageUrl);
    if (!abs || !isHttp(abs) || looksLikeAd(abs) || abs.length > 600) continue;
    const h = hostOf(abs);
    if (RE.PLAYER_HINT.test(abs) || h.includes('embed')) {
      if (!found.has(abs)) found.set(abs, { url: abs, label: 'Reproductor (' + h + ')', isIframe: true, referer: pageUrl });
    }
  }
  return [...found.values()];
}

/* ══════════════════════════════════════════════════════════════════
   6. Clasificación de idioma + agrupación estilo Seekee
      "[Doblado] One Piece" · "[Sub] One Piece" · "[Castellano] …"
   ══════════════════════════════════════════════════════════════════ */

const DUB_WORDS = /(latino|latina|doblado|doblada|castellano|espa[nñ]ol|espanol|audio\s*es|dub)/i;
const SUB_WORDS = /(sub|subtitulado|subtitulada|subs|raw|sub\s*es)/i;

function classifyLang(text) {
  const t = String(text || '');
  if (/(sub\s*espa[nñ]ol|subtitulado|sub latino|sub)/i.test(t) && !/doblado|latino/i.test(t)) return 'sub';
  if (SUB_WORDS.test(t) && !DUB_WORDS.test(t)) return 'sub';
  if (DUB_WORDS.test(t)) return 'latino';
  return 'sub'; // por defecto en estos sitios casi todo es subtitulado
}
const LANG_TAG = {
  latino: '[Doblado]',
  sub: '[Sub]',
  castellano: '[Castellano]'
};

/** Quita números de episodio y basura para normalizar el título. */
function normalizeTitle(t) {
  return String(t || '')
    .replace(/[|·—–]\s*.*$/, '')           // "One Piece | Anime FLV" → "One Piece"
    .replace(/\s*\(\d{4}\)\s*$/, '')       // año
    .replace(RE.EP_NUM, '')
    .replace(/ver\s+|online\s+|gratis\s+|completa\s+|descargar\s+/gi, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Agrupa hits en OPCIONES estilo Seekee: una por (título, idioma). */
async function buildOptions(query) {
  const rounds = await Promise.all([
    searchWeb(`ver ${query} latino online`),
    searchWeb(`ver ${query} sub español`),
    searchWeb(`${query} episodio`),
    searchWeb(`${query} anime online gratis`),
    searchWeb(`ver ${query} capítulos español`),
    searchWeb(query)
  ]);
  const all = dedupeHits(rounds.flat());

  const groups = new Map(); // clave: titleNorm|lang
  for (const hit of all) {
    const h = hostOf(hit.url);
    if (!h || looksLikeAd(hit.url)) continue;
    // Solo páginas de contenido (no foros/redes).
    if (/forum|reddit|wikipedia|facebook|twitter|youtube\.com$|\.edu\b/i.test(h)) continue;
    const titleNorm = normalizeTitle(hit.title);
    if (!titleNorm || titleNorm.length < 3) continue;
    // Debe contener TODAS las palabras significativas (≥3 letras) del
    // query: con una sola palabra pasaba basura como "OneDrive" para
    // "one piece".
    const qWords = normalizeTitle(query).split(' ').filter(w => w.length >= 3);
    if (qWords.length && !qWords.every(w => titleNorm.includes(w))) continue;
    const lang = classifyLang(hit.title + ' ' + hit.url);
    const key = titleNorm.slice(0, 40) + '|' + lang;
    if (!groups.has(key)) {
      groups.set(key, {
        title: cleanDisplayTitle(hit.title, query),
        lang,
        pageUrl: hit.url,
        host: h,
        hitTitle: hit.title
      });
    }
  }
  // Orden: [Doblado] primero (preferencia del usuario), luego [Sub].
  // Los sitios "guía/catálogo" (JustWatch, Crunchyroll…) van AL FINAL:
  // no tienen video reproducible, solo te dicen dónde comprar/ver legal.
  const order = { latino: 0, castellano: 1, sub: 2 };
  const GUIDE_HOSTS = /(justwatch|crunchyroll|betaseries|myanimeguru|filmaffinity|decider|wherecanistream|culturaalicante|episodate|thetvdb|imdb\.com|trakt\.tv|netflix\.com|primevideo|disneyplus|hbo\.com|apple\.com\/tv|facebook\.com|tiktok)/i;
  const options = [...groups.values()]
    .sort((a, b) => {
      const ga = GUIDE_HOSTS.test(a.host) ? 1 : 0, gb = GUIDE_HOSTS.test(b.host) ? 1 : 0;
      if (ga !== gb) return ga - gb;                       // guías al final
      return (order[a.lang] ?? 3) - (order[b.lang] ?? 3);  // doblado antes
    })
    .slice(0, 12)
    .map((g, i) => ({
      id: 'op' + i + '-' + Buffer.from(g.pageUrl).toString('base64').slice(0, 10),
      label: (LANG_TAG[g.lang] || '[Sub]') + ' ' + g.title,
      lang: g.lang,
      title: g.title,
      host: g.host,
      pageUrl: g.pageUrl
    }));
  return { query, options, scanned: all.length };
}

function cleanDisplayTitle(raw, query) {
  let t = String(raw || '');
  t = t.replace(/\s*[|·—–]\s*.*$/, '');
  t = t.replace(/ver\s+|online\s+|gratis\s+|completa\s+/gi, ' ');
  t = t.replace(RE.EP_NUM, '');
  t = t.replace(/\(.*?\)/g, ' ');
  // Capitalizar como el query si es posible.
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

/** Descripción de la página (meta description en ESPAÑOL, auténtica). */
async function fetchDescription(pageUrl) {
  const html = await fetchHtml(pageUrl);
  if (!html) return { description: '' };
  const meta = html.match(RE.META_DESC) || html.match(RE.OG_DESC);
  let description = meta ? htmlUnescape(meta[1]).trim() : '';
  if (description.length > 260) description = description.slice(0, 257) + '…';
  return { description };
}

/* ══════════════════════════════════════════════════════════════════
   7. Lista COMPLETA de episodios de una página (sin límite de 12)
   ══════════════════════════════════════════════════════════════════ */

async function buildEpisodes(pageUrl) {
  const html = await fetchHtml(pageUrl);
  if (!html) return { episodes: [], error: 'no-page' };
  const byNumber = new Map();
  let m; RE.ANCHOR.lastIndex = 0;
  while ((m = RE.ANCHOR.exec(html)) !== null) {
    const abs = absolutize(m[1], pageUrl);
    if (!abs || !isHttp(abs) || looksLikeAd(abs)) continue;
    if (hostOf(abs) !== hostOf(pageUrl)) continue; // enlaces internos
    const text = stripTags(m[2]);
    const combined = text + ' ' + abs;
    let n = null;
    let mm = combined.match(RE.EP_NUM);
    if (mm) n = parseInt(mm[1], 10);
    if (n == null) { mm = abs.match(RE.EP_HREF); if (mm) n = parseInt(mm[1], 10); }
    if (n == null || n < 1 || n > 2000) continue;
    if (!byNumber.has(n)) byNumber.set(n, { n, url: abs, text: text.slice(0, 80) });
  }
  // Si la página es un HUB sin episodios listados (paginación), buscar
  // enlaces "temporadas/capítulos" internos y escanear UNA más.
  let episodes = [...byNumber.values()].sort((a, b) => a.n - b.n);
  if (episodes.length < 3) {
    const hubLinks = [];
    RE.ANCHOR.lastIndex = 0;
    while ((m = RE.ANCHOR.exec(html)) !== null) {
      const abs = absolutize(m[1], pageUrl);
      if (!abs || !isHttp(abs) || hostOf(abs) !== hostOf(pageUrl)) continue;
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
  // ── SÍNTESIS DE RANGO COMPLETO ─────────────────────────────────────
  // Si el sitio usa URL uniforme (/episodio-N) pero la página solo lista
  // los recientes (ej: 25 enlaces con números hasta 1180), generamos
  // TODOS los episodios 1..maxN con el patrón detectado. Así el usuario
  // ve la lista COMPLETA (sin límite de 12 ni de "los que salgan").
  if (byNumber.size >= 3) {
    const eps = [...byNumber.values()].sort((a, b) => a.n - b.n);
    const maxN = eps[eps.length - 1].n;
    if (maxN > byNumber.size + 5) {  // lista dispersa → vale la pena sintetizar
      // Plantilla: tomar la URL del primer episodio y sustituir SU número
      // (la última secuencia de dígitos) por {N}.
      const firstUrl = eps[0].url;
      const lastDigit = firstUrl.match(/\d{1,4}(?!.*\d)/);
      if (lastDigit) {
        const idx = firstUrl.lastIndexOf(lastDigit[0]);
        const template = firstUrl.slice(0, idx) + '{N}' + firstUrl.slice(idx + lastDigit[0].length);
        // Verificar la plantilla contra otros 3 episodios reales.
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
  return { episodes, total: episodes.length, page: pageUrl };
}

/* ══════════════════════════════════════════════════════════════════
   8. RESOLVE: página → episodio → iframes → stream directo VALIDADO
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

async function resolveStream({ pageUrl, episodeUrl, episode }) {
  const notes = [];
  let target = episodeUrl || pageUrl;

  // Paso 1: si pidieron un episodio y no vino URL, buscarlo en la página.
  if (episode && !episodeUrl) {
    const list = await buildEpisodes(pageUrl);
    const found = list.episodes.find(e => e.n === episode);
    if (found) target = found.url;
    else notes.push(`episodio ${episode} no listado (${list.total} encontrados)`);
  }

  // Paso 2: escanear la página objetivo.
  const html = await fetchHtml(target);
  if (!html) return { mirrors: [], best: null, scanned: 0, notes: ['página no accesible: ' + target] };
  let candidates = extractFromHtml(html, target);
  let scanned = 1;

  // Paso 3: profundizar en iframes (1 nivel) — ahí viven los streams.
  const iframes = candidates.filter(c => c.isIframe).slice(0, 6);
  for (const fr of iframes) {
    const innerHtml = await fetchHtml(fr.url, target);
    if (!innerHtml) continue;
    scanned++;
    for (const found of extractFromHtml(innerHtml, fr.url)) {
      if (!candidates.some(c => c.url === found.url)) {
        candidates.push({ ...found, referer: fr.url, deep: true });
      }
    }
  }

  // Paso 4: ordenar (directos primero, por fiabilidad de la granja).
  candidates.sort((a, b) => {
    const ia = a.isIframe ? 1 : 0, ib = b.isIframe ? 1 : 0;
    if (ia !== ib) return ia - ib;
    return farmScore(b.url) - farmScore(a.url);
  });
  candidates = candidates.slice(0, 40);

  // Paso 5: VALIDAR los 10 primeros directos (Range 0-0).
  const toValidate = candidates.filter(c => !c.isIframe).slice(0, 10);
  const verdicts = await Promise.all(toValidate.map(c => quickValidate(c.url, c.referer).then(v => [c, v])));
  for (const [c, v] of verdicts) c.validated = v;

  const ordered = [
    ...candidates.filter(c => c.validated === true),
    ...candidates.filter(c => !c.isIframe && c.validated !== true),
    ...candidates.filter(c => c.isIframe)
  ];

  const mirrors = ordered.map(c => ({
    url: c.url,
    label: `${farmName(c.url)} · ${c.label}`,
    isIframe: c.isIframe,
    server: farmName(c.url),
    validated: c.validated === true,
    headers: {
      'User-Agent': userAgentFor(c.url),
      ...(c.referer ? { Referer: c.referer } : {})
    }
  }));

  return {
    mirrors,
    best: mirrors[0] || null,
    scanned,
    notes,
    target
  };
}

/* ══════════════════════════════════════════════════════════════════
   9. Caché en memoria (TTL 10 min) — el teléfono lento agradece
   ══════════════════════════════════════════════════════════════════ */

const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 200;
function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() - e.t > CACHE_TTL) { cache.delete(k); return null; }
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
   10. Servidor HTTP + rutas
   ══════════════════════════════════════════════════════════════════ */

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
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

  // CORS preflight
  if (req.method === 'OPTIONS') return json(res, 204, {});

  // API key (opcional)
  if (API_KEY && (req.headers['x-api-key'] || '') !== API_KEY) {
    return json(res, 401, { ok: false, error: 'api-key-required' });
  }

  try {
    /* ── GET /api/ping ─────────────────────────────────────────── */
    if (path === '/api/ping' && req.method === 'GET') {
      return json(res, 200, {
        ok: true, server: 'animax-server', version: VERSION,
        uptime: Math.round((Date.now() - STARTED) / 1000) + 's',
        cache: cache.size, port: PORT
      });
    }

    /* ── GET /api/search?q=…  → opciones [Doblado]/[Sub] ────────── */
    if (path === '/api/search' && req.method === 'GET') {
      const q = (parsed.searchParams.get('q') || '').trim();
      if (!q) return json(res, 400, { ok: false, error: 'falta ?q=' });
      const key = 'search:' + q.toLowerCase();
      let result = cacheGet(key);
      if (!result) {
        result = await buildOptions(q);
        // Descripciones en español desde la propia página (meta description).
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

    /* ── GET /api/episodes?pageUrl=… → lista COMPLETA ──────────── */
    if (path === '/api/episodes' && req.method === 'GET') {
      const pageUrl = (parsed.searchParams.get('pageUrl') || '').trim();
      if (!isHttp(pageUrl)) return json(res, 400, { ok: false, error: 'falta ?pageUrl=http…' });
      const key = 'eps:' + pageUrl;
      let result = cacheGet(key);
      if (!result) { result = await buildEpisodes(pageUrl); cacheSet(key, result); }
      return json(res, 200, { ok: true, ...result, took: Date.now() - started + 'ms' });
    }

    /* ── POST /api/resolve {pageUrl, episodeUrl?, episode?} ─────── */
    if (path === '/api/resolve' && req.method === 'POST') {
      const body = await readBody(req);
      if (!isHttp(body.pageUrl || '')) return json(res, 400, { ok: false, error: 'falta pageUrl' });
      const key = 'res:' + (body.pageUrl || '') + '|' + (body.episodeUrl || '') + '|' + (body.episode || '');
      let result = cacheGet(key);
      if (!result) { result = await resolveStream(body); cacheSet(key, result); }
      return json(res, 200, { ok: true, ...result, took: Date.now() - started + 'ms' });
    }

    /* ── POST /api/validate {url, referer?} ────────────────────── */
    if (path === '/api/validate' && req.method === 'POST') {
      const body = await readBody(req);
      if (!isHttp(body.url || '')) return json(res, 400, { ok: false, error: 'falta url' });
      const valid = await quickValidate(body.url, body.referer || '');
      return json(res, 200, { ok: true, url: body.url, valid });
    }

    /* ── Raíz: mini panel ──────────────────────────────────────── */
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>AniMax Server</title>
<style>body{background:#0a0e1f;color:#cfe3ff;font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px}
h1{color:#4da3ff}code{background:#141b36;padding:2px 6px;border-radius:6px}a{color:#4da3ff}</style></head><body>
<h1>🛰️ AniMax Server ${VERSION}</h1>
<p>Servidor privado de búsqueda — el teléfono pregunta, este servidor trabaja.</p>
<ul>
<li><code>GET /api/ping</code> — estado</li>
<li><code>GET /api/search?q=one piece</code> — opciones [Doblado]/[Sub] con descripción</li>
<li><code>GET /api/episodes?pageUrl=…</code> — todos los episodios (sin límite)</li>
<li><code>POST /api/resolve</code> — {pageUrl, episode} → servidores listos</li>
<li><code>POST /api/validate</code> — {url, referer} → ¿sirve?</li>
</ul>
<p>Prueba: <a href="/api/ping">/api/ping</a></p></body></html>`);
    }

    return json(res, 404, { ok: false, error: 'no-found:' + path });
  } catch (err) {
    return json(res, 500, { ok: false, error: String(err && err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[animax-server] v${VERSION} escuchando en puerto ${PORT}`);
  console.log(`[animax-server] API key: ${API_KEY ? 'activada' : 'abierta (uso personal)'}`);
});
