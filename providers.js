'use strict';
/* ═══════════════════════════════════════════════════════════════════
   AniMax Server v6.0 · G2 — PROVEEDORES REALES DE EPISODIOS
   ═══════════════════════════════════════════════════════════════════
   Cadena de proveedores "el teléfono pregunta, el servidor responde":

     1) allanime  → API GraphQL pública (catálogo + episodios + fuentes)
     2) hianime   → endpoints ajax públicos (episodios + servidores)
     3) (fallback) motor de caza propio de index.js — SIN CAMBIOS

   Código 100% original de AniMax: usa endpoints públicos documentados,
   tolera fallos (Cloudflare, dominio caído, JSON raro) y degrada al
   motor clásico. Ningún proveedor es obligatorio: si todos fallan,
   /api/v1/app/episode/list responde ok:false y la app usa su
   extractor local del WebView (G2b).

   Contrato para la app (G2b):
     GET  /api/v1/app/episode/list?q={titulo}&episode={n}&lang={latino|castellano|sub|any}
     POST /api/v1/app/episode/resolve  { provider, showId, episode, lang }
   ═══════════════════════════════════════════════════════════════════ */

const ALLANIME_API = 'https://api.allanime.day/api';
const ALLANIME_REFERER = 'https://allanime.to/';
const HIANIME_BASE = 'https://hianime.to';
const HIANIME_REFERER = 'https://hianime.to/';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* Salud por proveedor (visible en /api/v1/config/sources/status). */
const health = new Map(); // name → { ok, ts, ms, lastError, hits, misses }
function mark(name, ok, ms, lastError) {
  const prev = health.get(name) || { hits: 0, misses: 0 };
  health.set(name, {
    ok, ts: Date.now(), ms: ms || 0,
    lastError: lastError || null,
    hits: prev.hits + (ok ? 1 : 0),
    misses: prev.misses + (ok ? 0 : 1),
  });
}
function providerStatus() {
  const out = {};
  for (const [k, v] of health.entries()) out[k] = { ...v, ageMin: Math.round((Date.now() - v.ts) / 60000) };
  return out;
}

/* ── Utilidades ──────────────────────────────────────────────────── */
function pickLang(raw, wanted) {
  if (!wanted || wanted === 'any') return true;
  if (wanted === 'latino') return /latino|es-419|espa/i.test(raw);
  if (wanted === 'castellano') return /castellano|es-es/i.test(raw);
  if (wanted === 'sub') return /sub|vostfr|jp/i.test(raw);
  return true;
}

function normTitle(t) {
  return String(t || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function titleScore(candidate, wanted) {
  const a = normTitle(candidate), b = normTitle(wanted);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.9;
  return a.includes(b) || b.includes(a) ? 0.75 : 0;
}

/* Decodificación del truco "clock" de AllAnime (público): si la URL
   viene ofuscada con '-' inicial, cada carácter va desplazado +1. */
function decodeAllAnimeSource(src) {
  const s = String(src || '');
  if (!s) return '';
  if (!s.startsWith('-')) return s;
  let out = '';
  for (let i = 1; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) + 1);
  return /^https?:\/\//i.test(out) ? out : '';
}

/* ════════════════════════════════════════════════════════════════════
   PROVEEDOR 1 · AllAnime (GraphQL público)
   ════════════════════════════════════════════════════════════════════ */
async function allanimeSearch(httpGet, query) {
  const vars = {
    search: { allowAdult: false, allowUnknown: false, query: String(query || '') },
    limit: 12, page: 1,
    translationType: 'sub', countryOrigin: 'ALL',
  };
  const qs =
    'variables=' + encodeURIComponent(JSON.stringify(vars)) +
    '&query=' + encodeURIComponent(
      'query($search:SearchInput,$limit:Int,$page:Int,$translationType:VwTranslationType,$countryOrigin:VwCountryOrigin){' +
      'shows(search:$search,limit:$limit,page:$page,translationType:$translationType,countryOrigin:$countryOrigin){' +
      'edges{_id name thumbnail season year __typename}}}'
    );
  const res = await httpGet(ALLANIME_API + '?' + qs, {
    timeoutMs: 12000, maxBytes: 1024 * 1024,
    headers: { 'User-Agent': UA, 'Referer': ALLANIME_REFERER, 'Accept': 'application/json' },
  });
  if (!res.ok || !res.body) throw new Error('allanime-search http ' + (res.status || '—'));
  const data = JSON.parse(res.body);
  const edges = (data && data.data && data.data.shows && data.data.shows.edges) || [];
  return edges
    .filter(e => e && e._id && e.name)
    .map(e => ({
      provider: 'allanime',
      showId: e._id,
      title: e.name,
      year: e.year || null,
      thumbnail: e.thumbnail || null,
      score: titleScore(e.name, query),
    }))
    .sort((a, b) => b.score - a.score);
}

async function allanimeEpisodes(httpGet, showId) {
  const qs =
    'variables=' + encodeURIComponent(JSON.stringify({ showId: String(showId) })) +
    '&query=' + encodeURIComponent(
      'query($showId:String!){showEpisodes(showId:$showId){notes episodeString episodeNum}}'
    );
  const res = await httpGet(ALLANIME_API + '?' + qs, {
    timeoutMs: 12000, maxBytes: 2 * 1024 * 1024,
    headers: { 'User-Agent': UA, 'Referer': ALLANIME_REFERER, 'Accept': 'application/json' },
  });
  if (!res.ok || !res.body) throw new Error('allanime-eps http ' + (res.status || '—'));
  const data = JSON.parse(res.body);
  let list = [];
  const se = data && data.data && data.data.showEpisodes;
  if (Array.isArray(se)) list = se;
  else if (se && Array.isArray(se.episodes)) list = se.episodes;
  return list
    .map(e => ({
      episode: Number(e.episodeNum || e.episodeString || 0) || 0,
      label: String(e.episodeString || e.episodeNum || ''),
      raw: e.episodeString || String(e.episodeNum || ''),
    }))
    .filter(e => e.episode > 0);
}

async function allanimeSources(httpGet, showId, episode, lang) {
  const vars = {
    showId: String(showId),
    episode: String(episode),
    translationType: (lang === 'dub') ? 'dub' : 'sub',
    episodeLang: (lang === 'dub') ? 'eng' : 'sub',
  };
  const qs =
    'variables=' + encodeURIComponent(JSON.stringify(vars)) +
    '&query=' + encodeURIComponent(
      'query($showId:String!,$episode:String!,$translationType:VwTranslationType!,$episodeLang:VwEpisodeLang!){' +
      'episode(showId:$showId,episode:$episode,translationType:$translationType,episodeLang:$episodeLang){' +
      'sourceUrls{sourceName sourceUrl type}}}'
    );
  const res = await httpGet(ALLANIME_API + '?' + qs, {
    timeoutMs: 12000, maxBytes: 2 * 1024 * 1024,
    headers: { 'User-Agent': UA, 'Referer': ALLANIME_REFERER, 'Accept': 'application/json' },
  });
  if (!res.ok || !res.body) throw new Error('allanime-src http ' + (res.status || '—'));
  const data = JSON.parse(res.body);
  const urls = (data && data.data && data.data.episode && data.data.episode.sourceUrls) || [];
  const out = [];
  for (const su of urls) {
    const dec = decodeAllAnimeSource(su && su.sourceUrl);
    if (!dec || !/^https?:\/\//i.test(dec)) continue;
    out.push({
      provider: 'allanime',
      server: String((su && su.sourceName) || 'allanime'),
      url: dec,
      type: /\.m3u8(\?|$)/i.test(dec) ? 'hls' : (/\.mp4(\?|$)/i.test(dec) ? 'mp4' : 'embed'),
      lang: (vars.translationType === 'dub') ? 'sub-dub' : 'sub',
      referer: ALLANIME_REFERER,
    });
  }
  return out;
}

/* ════════════════════════════════════════════════════════════════════
   PROVEEDOR 2 · Hianime (endpoints ajax públicos)
   ════════════════════════════════════════════════════════════════════ */
async function hianimeSearch(httpGet, query) {
  const res = await httpGet(HIANIME_BASE + '/ajax/search/suggest?keyword=' + encodeURIComponent(query), {
    timeoutMs: 12000, maxBytes: 1024 * 1024,
    headers: { 'User-Agent': UA, 'Referer': HIANIME_REFERER, 'Accept': 'application/json' },
  });
  if (!res.ok || !res.body) throw new Error('hianime-search http ' + (res.status || '—'));
  const data = JSON.parse(res.body);
  const items = (data && data.data && data.data.list && data.data.list.items) || [];
  return items
    .filter(i => i && i.id)
    .map(i => ({
      provider: 'hianime',
      showId: i.id,
      title: i.name || i.jname || '',
      year: null,
      thumbnail: i.poster || null,
      score: Math.max(titleScore(i.name || '', query), titleScore(i.jname || '', query) * 0.95),
    }))
    .sort((a, b) => b.score - a.score);
}

async function hianimeEpisodes(httpGet, showId) {
  const res = await httpGet(HIANIME_BASE + '/ajax/v2/episode/list/' + encodeURIComponent(showId), {
    timeoutMs: 12000, maxBytes: 2 * 1024 * 1024,
    headers: { 'User-Agent': UA, 'Referer': HIANIME_REFERER, 'Accept': 'application/json' },
  });
  if (!res.ok || !res.body) throw new Error('hianime-eps http ' + (res.status || '—'));
  const data = JSON.parse(res.body);
  const html = String((data && data.html) || '');
  const out = [];
  const RE_ITEM = /data-id="(\d+)"[\s\S]{0,400}?data-number="(\d+)"[\s\S]{0,400}?title="([^"]*)"/g;
  let m;
  while ((m = RE_ITEM.exec(html)) !== null) {
    out.push({ episode: Number(m[2]) || 0, label: m[3] || ('Ep ' + m[2]), raw: m[1] /* data-id servidor maestro */ });
  }
  return out;
}

async function hianimeSources(httpGet, showId, episode, lang) {
  // 1) lista de episodios → data-id del episodio pedido
  const eps = await hianimeEpisodes(httpGet, showId);
  const ep = eps.find(e => e.episode === Number(episode)) || null;
  if (!ep) throw new Error('hianime: episodio ' + episode + ' no encontrado (' + eps.length + ' eps)');
  // 2) servidores del episodio (sub/dub)
  const resSv = await httpGet(HIANIME_BASE + '/ajax/v2/episode/servers?episodeId=' + encodeURIComponent(ep.raw), {
    timeoutMs: 12000, maxBytes: 1024 * 1024,
    headers: { 'User-Agent': UA, 'Referer': HIANIME_REFERER, 'Accept': 'application/json' },
  });
  if (!resSv.ok || !resSv.body) throw new Error('hianime-servers http ' + (resSv.status || '—'));
  const sv = JSON.parse(resSv.body);
  const svHtml = String((sv && sv.html) || '');
  const RE_SV = /data-server-id="([\w-]+)"[^>]*data-type="(\w+)"/g;
  const wantedTypes = (lang === 'dub') ? ['dub'] : (lang === 'sub') ? ['sub'] : ['sub', 'dub'];
  const servers = [];
  let m2;
  while ((m2 = RE_SV.exec(svHtml)) !== null) {
    if (wantedTypes.includes(m2[2])) servers.push({ id: m2[1], type: m2[2] });
  }
  if (!servers.length) throw new Error('hianime: sin servidores ' + wantedTypes.join('/'));
  // 3) fuente por servidor (máx 4 para no pasarse de tiempo)
  const out = [];
  for (const s of servers.slice(0, 4)) {
    try {
      const resSrc = await httpGet(HIANIME_BASE + '/ajax/v2/episode/sources?id=' + encodeURIComponent(s.id), {
        timeoutMs: 10000, maxBytes: 512 * 1024,
        headers: { 'User-Agent': UA, 'Referer': HIANIME_REFERER, 'Accept': 'application/json' },
      });
      if (!resSrc.ok || !resSrc.body) continue;
      const sj = JSON.parse(resSrc.body);
      const link = String((sj && (sj.link || (sj.sources && sj.sources[0] && sj.sources[0].file))) || '');
      if (!/^https?:\/\//i.test(link)) continue;
      out.push({
        provider: 'hianime',
        server: s.type + '-' + s.id,
        url: link,
        type: /\.m3u8(\?|$)/i.test(link) ? 'hls' : (/\.mp4(\?|$)/i.test(link) ? 'mp4' : 'embed'),
        lang: s.type,
        referer: HIANIME_REFERER,
      });
    } catch (_) { /* servidor individual roto → siguiente */ }
  }
  if (!out.length) throw new Error('hianime: sin fuentes reproducibles');
  return out;
}

/* ════════════════════════════════════════════════════════════════════
   FÁBRICA — createProviders(ctx)
   ctx: { request, cacheGet, cacheSet, TTL } de index.js
   ════════════════════════════════════════════════════════════════════ */
function createProviders(ctx) {
  const { request, cacheGet, cacheSet, TTL } = ctx;

  const enabled = () =>
    (process.env.ANIMAX_PROVIDERS || 'allanime,hianime')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  async function searchShow(query) {
    const key = 'prov:search:' + String(query).toLowerCase();
    const hit = cacheGet(key, TTL.search || 600000);
    if (hit) return hit;
    const list = [];
    for (const name of enabled()) {
      const t0 = Date.now();
      try {
        if (name === 'allanime') list.push(...await allanimeSearch(request, query));
        else if (name === 'hianime') list.push(...await hianimeSearch(request, query));
        mark(name, true, Date.now() - t0);
      } catch (e) {
        mark(name, false, Date.now() - t0, String(e && e.message || e).slice(0, 140));
      }
    }
    if (list.length) cacheSet(key, list);
    return list;
  }

  async function episodesOf(showId) {
    const key = 'prov:eps:' + showId;
    const hit = cacheGet(key, TTL.eps || 3600000);
    if (hit && hit.length) return hit;
    const provider = String(showId).startsWith('hianime:') ? 'hianime'
      : String(showId).startsWith('allanime:') ? 'allanime' : null;
    // showId admitido: "provider:id" o id crudo (se intenta en orden)
    const attempts = provider
      ? [{ name: provider, id: showId.split(':').slice(1).join(':') }]
      : enabled().map(name => ({ name, id: showId }));
    for (const a of attempts) {
      const t0 = Date.now();
      try {
        let list;
        if (a.name === 'allanime') list = await allanimeEpisodes(request, a.id);
        else if (a.name === 'hianime') list = await hianimeEpisodes(request, a.id);
        else continue;
        mark(a.name, true, Date.now() - t0);
        if (list.length) { cacheSet(key, list); return list; }
      } catch (e) {
        mark(a.name, false, Date.now() - t0, String(e && e.message || e).slice(0, 140));
      }
    }
    return [];
  }

  /* streamsOf(showRef, episode, lang) → fuentes; showRef = "provider:id"
     o id crudo (búsqueda por score ya hecha arriba). */
  async function streamsOf(showRef, episode, lang) {
    const parts = String(showRef || '').split(':');
    const prov = parts.length > 1 ? parts[0] : null;
    const id = parts.length > 1 ? parts.slice(1).join(':') : showRef;
    const names = prov ? [prov] : enabled();
    const errors = [];
    for (const name of names) {
      const t0 = Date.now();
      try {
        let src;
        if (name === 'allanime') src = await allanimeSources(request, id, episode, lang);
        else if (name === 'hianime') src = await hianimeSources(request, id, episode, lang);
        else continue;
        mark(name, true, Date.now() - t0);
        if (src.length) return { sources: src, errors };
        errors.push(name + ': 0 fuentes');
      } catch (e) {
        mark(name, false, Date.now() - t0, String(e && e.message || e).slice(0, 140));
        errors.push(name + ': ' + String(e && e.message || e).slice(0, 140));
      }
    }
    return { sources: [], errors };
  }

  return {
    enabled, searchShow, episodesOf, streamsOf,
    status: providerStatus,
    pickBest: (candidates) => (candidates || []).find(c => c.score >= 0.75) || (candidates || [])[0] || null,
  };
}

module.exports = { createProviders, providerStatus, UA };
