'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · FASE 4 — ENRIQUECIMIENTO DEL CATÁLOGO
   ═════════════════════════════════════════════════════════════════════
   El filmCenter de Seekee NO es solo anime: sus pestañas Películas y
   Series traen cine y series de ACCIÓN REAL, con pósters y sinopsis
   ricos. Para replicarlo SIN clavar ninguna API key pública en el
   código (regla del plan maestro: "sin API keys públicas fijas"):

     · Jikan (MyAnimeList, SIN key) → enriquece las fichas de anime:
       tráiler de YouTube, estudios, puntuación MAL, origen (manga/
       novela/original) y sinopsis larga. Best-effort con timeout:
       si Jikan no responde (p. ej. sandbox), el catálogo funciona
       igual — solo sin el extra.
     · TMDB (OPCIONAL, key por variable de entorno ANIMAX_TMDB_KEY)
       → con key, las pestañas Películas y Series del filmCenter
       muestran CINE Y SERIES REALES (no solo películas/series de
       anime de AniList): pósters HD, años, sinopsis, votación.
       Sin key → AniList como hasta ahora (todo sigue funcionando).

   Todo lo que sale de aquí tiene la MISMA FORMA que los metadatos
   de AniList (salida de alMap de v4-api.js), para que toTheater()/
   toAlbum() los pinten sin cambios.
   ═════════════════════════════════════════════════════════════════════ */

const https = require('https');

/* ── HTTP GET JSON propio (autocontenido, estilo watchdog.js) ─────── */
function httpJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      timeout: timeoutMs || 8000,
      headers: { 'Accept': 'application/json', 'User-Agent': 'AniMax-Server/4.0' }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);      // 401/404/429/5xx → sin extra
      }
      let b = '';
      res.on('data', c => { if (b.length < 1048576) b += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/* ════════════════════════════════════════════════════════════════════
   JIKAN (MyAnimeList) — sin API key, límite 3 req/s
   Caché en memoria con CACHÉ NEGATIVA (si Jikan no responde, no lo
   volvemos a intentar durante un rato: el catálogo no puede quedar
   colgado esperando un extra).
   ════════════════════════════════════════════════════════════════════ */
const JIKAN_TTL = 12 * 60 * 60 * 1000;   // hit: 12 h
const JIKAN_NEG_TTL = 30 * 60 * 1000;    // fallo: 30 min sin reintentar
const jikanCache = new Map();            // título → {t, data|null}

/** Busca la ficha MAL de un título →
 *  { malId, malScore, trailer, studios, source, synopsis } | null. */
async function jikanByTitle(title) {
  const key = String(title || '').trim().toLowerCase();
  if (!key || key.length > 120) return null;
  const hit = jikanCache.get(key);
  if (hit) {
    const ttl = hit.data ? JIKAN_TTL : JIKAN_NEG_TTL;
    if (Date.now() - hit.t < ttl) return hit.data;
  }
  const data = await httpJson(
    'https://api.jikan.moe/v4/anime?q=' + encodeURIComponent(key) + '&limit=1&sfw=true',
    7000
  );
  let out = null;
  const a = data && data.data && data.data[0];
  if (a && a.mal_id) {
    out = {
      malId: a.mal_id,
      malScore: a.score || null,
      trailer: (a.trailer && (a.trailer.url || a.trailer.embed_url)) || '',
      studios: (a.studios || []).map(s => s.name).filter(Boolean).slice(0, 3),
      source: a.source || '',
      synopsis: String(a.synopsis || '').replace(/<[^>]*>/g, '').slice(0, 700)
    };
    // solo si de verdad ES la misma obra (Jikan hace fuzzy: "naruto"
    // puede devolver "Boruto") — comparamos título normalizado.
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const want = norm(key);
    const got = norm(a.title);
    const alt = (a.titles || []).some(t => norm(t.title) === want);
    if (got !== want && !alt && !got.includes(want) && !want.includes(got)) out = null;
  }
  jikanCache.set(key, { t: Date.now(), data: out });
  return out;
}

/* ════════════════════════════════════════════════════════════════════
   TMDB — OPCIONAL por ANIMAX_TMDB_KEY (nada de keys públicas fijas).
   Con key: Películas/Series de verdad (acción real) para el filmCenter.
   ════════════════════════════════════════════════════════════════════ */
function tmdbEnabled() { return !!process.env.ANIMAX_TMDB_KEY; }

const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_LANG = 'es-MX';               // sinopsis en español latino

/* Nuestros géneros (códigos AniList en inglés) → ids TMDB.
   movie y tv usan ids distintos. Los que no existen en TMDB (Slice of
   Life, Mecha…) se ignoran en el filtro. */
const TMDB_GENRES = {
  movie: {
    'Action': 28, 'Adventure': 12, 'Comedy': 35, 'Drama': 18, 'Fantasy': 14,
    'Horror': 27, 'Music': 10402, 'Mystery': 9648, 'Romance': 10749,
    'Sci-Fi': 878, 'Thriller': 53, 'War': 10752, 'Crime': 80,
    'Animation': 16, 'Family': 10751, 'History': 36, 'Western': 37
  },
  tv: {
    'Action': 10759, 'Adventure': 10759, 'Comedy': 35, 'Drama': 18,
    'Fantasy': 10765, 'Horror': 9648, 'Music': 10402, 'Mystery': 9648,
    'Romance': 10764, 'Sci-Fi': 10765, 'Thriller': 10759, 'War': 10768,
    'Crime': 80, 'Animation': 16, 'Family': 10751, 'History': 18,
    'Western': 37, 'Reality': 10764, 'Soap': 18
  }
};

/* Órdenes → sort_by de TMDB (con vote_count mínimo para no sacar basura). */
const TMDB_SORTS = {
  trending: { by: 'popularity.desc', vc: 100 },
  newest: { by: 'primary_release_date.desc', vc: 20, tv: 'first_air_date.desc' },
  rating: { by: 'vote_average.desc', vc: 300 },
  popularity: { by: 'popularity.desc', vc: 100 }
};

const TMDB_COUNTRY = { JP: 'jp', KR: 'kr', CN: 'zh', TW: 'tw', US: 'en', MX: 'es' };

/** Descubre películas/series TMDB → { list (forma alMap), lastPage, total }. */
async function tmdbDiscover(kind, opts) {
  if (!tmdbEnabled()) return { list: [], lastPage: 1, total: 0 };
  const {
    page = 1, perPage = 20, genre = null, sort = 'trending',
    year = null, country = null
  } = opts || {};
  const gmap = TMDB_GENRES[kind] || {};
  const genreId = genre && gmap[genre] ? gmap[genre] : null;
  const s = TMDB_SORTS[sort] || TMDB_SORTS.trending;
  const sortBy = kind === 'tv' && s.tv ? s.tv : s.by;

  const params = new URLSearchParams({
    api_key: process.env.ANIMAX_TMDB_KEY,
    language: TMDB_LANG,
    sort_by: sortBy,
    'vote_count.gte': String(s.vc),
    'vote_average.gte': '5.5',
    include_adult: 'false',
    page: String(Math.min(Math.max(1, page), 500)),
    timezone: 'America/Bogota'
  });
  if (genreId) params.set('with_genres', String(genreId));
  if (year) params.set(kind === 'movie' ? 'primary_release_year' : 'first_air_date_year', String(year));
  if (country && TMDB_COUNTRY[country.toUpperCase()]) {
    params.set('with_original_language', TMDB_COUNTRY[country.toUpperCase()]);
  }

  const data = await httpJson(`${TMDB_API}/discover/${kind}?` + params.toString(), 8000);
  const pageData = data && data.results ? data.results : [];
  return {
    list: pageData.map(e => tmdbMap(e, kind)).filter(Boolean),
    lastPage: Math.min(Number(data && data.total_pages) || 1, 500),
    total: Number(data && data.total_results) || 0
  };
}

/** Detalle TMDB por id (ficha completa: sinopsis, temporadas…). */
async function tmdbDetail(kind, tmdbId) {
  if (!tmdbEnabled()) return null;
  const data = await httpJson(
    `${TMDB_API}/${kind}/${tmdbId}` +
    `?api_key=${process.env.ANIMAX_TMDB_KEY}&language=${TMDB_LANG}`,
    8000
  );
  if (!data || !data.id) return null;
  const meta = tmdbMap(data, kind);
  if (!meta) return null;
  if (Array.isArray(data.genres)) meta.genres = data.genres.map(g => g.name);
  if (kind === 'tv' && data.number_of_seasons) meta.seasons = data.number_of_seasons;
  return meta;
}

/* Entrada TMDB → forma alMap (misma que AniList) para toTheater(). */
function tmdbMap(e, kind) {
  const img = p => p ? ('https://image.tmdb.org/t/p/w780' + p) : '';
  const big = p => p ? ('https://image.tmdb.org/t/p/w1280' + p) : '';
  const title = e.title || e.name || '';
  if (!title) return null;
  const date = e.release_date || e.first_air_date || '';
  const year = Number(String(date).slice(0, 4)) || 0;
  return {
    id: `tmdb-${kind}-${e.id}`,
    title,
    alt: (e.original_title && e.original_title !== title) ? [e.original_title] : [],
    image: img(e.poster_path),
    banner: big(e.backdrop_path),
    year,
    endYear: year,
    format: kind === 'movie' ? 'MOVIE' : 'TV',
    episodes: kind === 'tv' ? (e.number_of_episodes || 0) : 0,
    duration: 0,
    rated: e.adult ? 'TV-MA' : 'TV-14',
    genres: [],                    // el discover no los trae; detail sí
    score: e.vote_average ? Math.round(e.vote_average * 10) / 10 : 0,
    popularity: e.popularity || 0,
    country: e.original_language ? String(e.original_language).toUpperCase() : '',
    synopsis: String(e.overview || '').slice(0, 300)
  };
}

module.exports = { jikanByTitle, tmdbEnabled, tmdbDiscover, tmdbDetail, _httpJson: httpJson };
