// ─────────────────────────────────────────────────────────────
// ANIMAX · AnimeGratis (animegratis.net) — scraper DEDICADO.
// VERIFICADO contra el HTML real del sitio (Astro SSR):
//  · Portada: sección "Nuevos Episodios" → /anime/{base}/episodio-{n}
//  · Directorio /directorio (470+ páginas) → catálogo para búsqueda
//    local (la ruta /buscar la bloquea Cloudflare para bots).
//  · Detalle /anime/{slug}: a.episode-link + data-total-episodes +
//    géneros en /directorio/genero/{slug}.
//  · Episodio /anime/{base}/episodio-{n}: <script id="player-ui-data">
//    JSON con groups {ja, cast, lat} → cada servidor lleva su IDIOMA
//    (lat = audio LATINO, ja = japonés subtitulado).
// Los servidores incluyen MP4UPLOAD / STREAMTAPE / YOURUPLOAD /
// MEGA / VOE / HLS(zilla) — con extracción directa en el backend.
// ─────────────────────────────────────────────────────────────

import * as cheerio from "cheerio";
import { obtenerHttp, absoluta, type OpcionesHttp } from "../http";
import { indexarTarjetas } from "../indice";
import { clasificar, nombreServidor } from "./motor";
import type {
  AnimeCard,
  AnimeDetalle,
  EpisodioFeed,
  EpisodioItem,
  Scraper,
  ServidorVideo,
} from "../types";

const ID = "animegratis";
const NOMBRE = "AnimeGratis";
const BASE = "https://animegratis.net";
/** Espejo alternativo (el dominio .net a veces filtra por región/CF:
 *  si falla se reintenta TODO contra el espejo .org). */
const ESPEJO = "https://animegratis.org";

/** GET con failover de dominio: .net → espejo .org → .net con reintentos.
 *  Nunca lanza; devuelve el HTML o null. */
async function obtenerAG(url: string, op: OpcionesHttp = {}): Promise<string | null> {
  const aceptable = (h: string | null): string | null =>
    h && h.length > 3000 && !/acceso restringido|just a moment|success!</i.test(h.slice(0, 4000)) ? h : null;
  const primario = aceptable(await obtenerHttp(url, { ...op, reintentos: 0 }));
  if (primario) return primario;
  if (url.startsWith(BASE)) {
    const espejoUrl = ESPEJO + url.slice(BASE.length);
    const alterna = aceptable(await obtenerHttp(espejoUrl, { ...op, reintentos: 0 }));
    if (alterna) return alterna;
  }
  // último intento contra el dominio original con reintentos/backoff
  return aceptable(await obtenerHttp(url, op));
}

/** El anime vive en /anime/{slug} (a veces con sufijo -anime) y los
 *  episodios en /anime/{slugSinSufijoAnime}/episodio-{n}. */
function slugBase(slugLocal: string): string {
  return slugLocal.replace(/-anime$/, "");
}

/** Limpia un género: quita emojis/badges ("⚔️ Acción" → "Acción"). */
function limpiarGenero(g: string): string {
  return g
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B50}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]/gu, "")
    .replace(/^[\s·|•✦★◈]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Limpia el texto de las tarjetas de "Nuevos Episodios":
 *  "Nuevo Ep 6 11 nov Kikansha no Mahou…" → "Kikansha no Mahou…". */
function limpiarTituloFeed(t: string): string {
  return t
    .replace(/^\s*Nuevo\s*/i, "")
    .replace(/Ep\s*\d+\s*/i, "")
    .replace(/\b\d{1,2}\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Título válido (descarta badges de estado y enlaces de navegación). */
function esTituloValido(t: string): boolean {
  const limpio = t.replace(/\s+/g, " ").trim();
  if (limpio.length < 2 || limpio.length > 120) return false;
  // badges de ranking/película ("98 🎬 Película") y navegación
  if (/^[\d\s]*[🎬⭐🔥▶◆]|^[\d\s]*(top|película|pelicula)\b/i.test(limpio)) return false;
  if (/^(pr[oó]ximamente|temp|nuevo|ver\s|explorar|directorio|horario|manga|blog|top\b|vip|descargas|dmca|registro|login|perfil|inicio|tutorial|generos|g[eé]neros|ayuda|legal|notificaciones|anime\s+gratis$|animegratis|portada\s)/i.test(limpio))
    return false;
  if (/^[\d\s./-]+$/.test(limpio)) return false;
  if (!/[a-zA-ZÀ-ÿ]/.test(limpio)) return false;
  return true;
}

// ── Directorio (catálogo para búsqueda local, cacheado 6 h) ──

interface DirTarjeta {
  titulo: string;
  slugLocal: string;
  portada: string;
}

let dirCache: { expira: number; tarjetas: DirTarjeta[] } | null = null;
let dirPromesa: Promise<DirTarjeta[]> | null = null;
const DIR_TTL = 6 * 3600 * 1000;

function extraerDirectorio(html: string): DirTarjeta[] {
  if (!html || html.length < 200) return [];
  const $ = cheerio.load(html);
  // Por slug recogemos el MEJOR título disponible: el texto plano del
  // ancla del título (las tarjetas de /top traen 3 anchors: "1"|"título"|"Ver anime")
  // y como respaldo el alt de la portada ("Portada del anime X — Top N").
  const porSlug = new Map<string, { titulo?: string; portada?: string }>();
  $("a[href^='/anime/']").each((_, el) => {
    const a = $(el);
    const href = a.attr("href") || "";
    if (/\/episodio-\d+/.test(href)) return;
    const m = href.match(/^\/anime\/([a-z0-9-]+)\/?$/i);
    if (!m) return;
    const slugLocal = m[1];
    const ent = porSlug.get(slugLocal) || {};
    const texto = (a.text() || "").replace(/\s+/g, " ").trim();
    if (!ent.titulo && esTituloValido(texto) && !/^Ver\s/i.test(texto)) ent.titulo = texto;
    if (!ent.titulo) {
      const alt = (a.find("img").attr("alt") || "").replace(/\s+/g, " ").trim();
      const altLimpio = alt
        .replace(/^Portada (del anime|de)\s+/i, "")
        .replace(/\s*[—-]\s*(Top|Película)\s*\d*\s*$/i, "")
        .trim();
      if (altLimpio && esTituloValido(altLimpio)) ent.titulo = altLimpio;
    }
    if (!ent.portada) {
      const img = a.find("img").attr("src") || a.find("img").attr("data-src") || "";
      ent.portada = absoluta(img, BASE);
    }
    porSlug.set(slugLocal, ent);
  });
  const salida: DirTarjeta[] = [];
  for (const [slugLocal, ent] of porSlug) {
    if (ent.titulo) salida.push({ titulo: ent.titulo, slugLocal, portada: ent.portada || "" });
  }
  return salida;
}

async function cargarDirectorio(): Promise<DirTarjeta[]> {
  if (dirCache && Date.now() < dirCache.expira) return dirCache.tarjetas;
  if (dirPromesa) return dirPromesa;
  dirPromesa = (async () => {
    // Directorio páginas 1..4 (~150 fichas) + /top (100 clásicos:
    // One Piece, Naruto…) — todo en paralelo
    const rutas = [1, 2, 3, 4].map((p) => `${BASE}/directorio${p > 1 ? `?page=${p}` : ""}`);
    rutas.push(`${BASE}/top`);
    const paginas = await Promise.all(
      rutas.map(async (r) => {
        const html = await obtenerAG(r, { timeoutMs: 9000 });
        return extraerDirectorio(html ?? "");
      })
    );
    const tarjetas: DirTarjeta[] = [];
    const vistos = new Set<string>();
    for (const pagina of paginas) {
      for (const t of pagina) {
        if (!vistos.has(t.slugLocal)) {
          vistos.add(t.slugLocal);
          tarjetas.push(t);
        }
      }
    }
    if (tarjetas.length > 0) dirCache = { expira: Date.now() + DIR_TTL, tarjetas };
    // Indexa el directorio en la BD (catálogo /latino con clásicos:
    // One Piece, Shingeki…) — fire and forget, nunca bloquea
    try {
      indexarTarjetas(
        tarjetas.map((t) => ({
          titulo: t.titulo,
          slug: `${ID}~${t.slugLocal}`,
          portada: t.portada,
          generos: [],
          idioma: "dual" as const,
          fuentes: [{ fuente: ID, nombre: NOMBRE, slugLocal: t.slugLocal, idioma: "dual" as const }],
        }))
      );
    } catch {
      /* silencioso */
    }
    return tarjetas;
  })();
  try {
    return await dirPromesa;
  } finally {
    dirPromesa = null;
  }
}

/** Búsqueda nativa del sitio (JSON): /api/animes/search?q=&limit=.
 *  Cloudflare la bloquea desde algunos hosts (p. ej. este sandbox),
 *  pero funciona desde VPS/regiones normales → primero se intenta.
 *  UN SOLO intento (sin reintentos): si está bloqueada, caemos al directorio. */
async function buscarApi(q: string): Promise<AnimeCard[] | null> {
  // La API JSON es una respuesta corta: no se filtra por tamaño — solo HTTP directo
  const html = await obtenerHttp(
    `${BASE}/api/animes/search?q=${encodeURIComponent(q)}&limit=14`,
    { timeoutMs: 3500, reintentos: 0, headers: { Accept: "application/json", Referer: `${BASE}/` } }
  );
  if (!html || !html.trimStart().startsWith("{")) return null;
  try {
    const data = JSON.parse(html) as { animes?: Record<string, unknown>[] };
    const lista = data.animes || [];
    if (!Array.isArray(lista) || lista.length === 0) return [];
    const salida: AnimeCard[] = [];
    for (const item of lista) {
      const registro = item as Record<string, string>;
      const slugLocal =
        registro.slug || registro.slug_url || registro.url_slug || "";
      const titulo = registro.title || registro.name || registro.nombre || "";
      if (!slugLocal || !titulo) continue;
      const portada = absoluta(
        registro.cover || registro.image || registro.portada || registro.thumbnail || "",
        BASE
      );
      salida.push({
        titulo,
        slug: `${ID}~${slugLocal.replace(/^-\/?/, "")}`,
        portada,
        generos: [],
        idioma: "dual",
        fuentes: [
          { fuente: ID, nombre: NOMBRE, slugLocal: slugLocal.replace(/^-\/?/, ""), idioma: "dual" },
        ],
      });
    }
    return salida;
  } catch {
    return null;
  }
}

/** Búsqueda: 1) API JSON nativa del sitio; 2) directorio cacheado
 *  (local, Cloudflare no filtra /directorio). */
async function buscarDirectorio(q: string): Promise<AnimeCard[]> {
  const qn = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 1) API nativa (rápida y completa; puede estar CF-bloqueada)
  const porApi = await buscarApi(q);
  if (porApi !== null) return porApi;

  // 2) Directorio local cacheado
  let tarjetas = dirCache && Date.now() < dirCache.expira ? dirCache.tarjetas : [];
  if (tarjetas.length === 0) {
    // calentar en background; esperar como mucho 1 s la primera vez
    const p = cargarDirectorio();
    try {
      tarjetas = await Promise.race([
        p,
        new Promise<DirTarjeta[]>((r) => setTimeout(() => r([]), 1000)),
      ]);
    } catch {
      tarjetas = [];
    }
  }
  const salida: AnimeCard[] = [];
  for (const t of tarjetas) {
    const tn = t.titulo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!tn.includes(qn)) continue;
    salida.push({
      titulo: t.titulo,
      slug: `${ID}~${t.slugLocal}`,
      portada: t.portada,
      generos: [],
      idioma: "dual",
      fuentes: [{ fuente: ID, nombre: NOMBRE, slugLocal: t.slugLocal, idioma: "dual" }],
    });
    if (salida.length >= 14) break;
  }
  return salida;
}

// ── Últimos episodios (portada) ───────────────────────────────

async function obtenerUltimos(): Promise<EpisodioFeed[]> {
  const html = await obtenerAG(`${BASE}/`, { timeoutMs: 6000 });
  if (!html) return [];
  const $ = cheerio.load(html);
  const salida: EpisodioFeed[] = [];
  const vistos = new Set<string>();
  $("a[href*='/episodio-']").each((_, el) => {
    const a = $(el);
    const href = a.attr("href") || "";
    const m = href.match(/^\/anime\/([a-z0-9-]+)\/episodio-(\d{1,4})\/?$/i);
    if (!m) return;
    const slugLocal = m[1];
    const numero = parseInt(m[2], 10);
    const clave = `${slugLocal}#${numero}`;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    const titulo = limpiarTituloFeed(a.text());
    if (!esTituloValido(titulo)) return;
    let portada = a.find("img").attr("src") || a.find("img").attr("data-src") || "";
    portada = absoluta(portada, BASE);
    salida.push({
      titulo,
      slug: `${ID}~${slugLocal}`,
      portada,
      numero,
      idioma: "dual",
      fuente: ID,
      nombreFuente: NOMBRE,
    });
    if (salida.length >= 24) return;
  });
  // Calienta el directorio para búsquedas (fire and forget)
  void cargarDirectorio();
  return salida;
}

// ── Detalle del anime ────────────────────────────────────────

/** La ficha vive en /anime/{slug}-anime (a veces también sin sufijo,
 *  que responde 403 para bots). Probamos ambas, primero la canónica. */
async function fetchPaginaAnime(slugLocal: string): Promise<string | null> {
  const candidatos = slugLocal.endsWith("-anime")
    ? [`${BASE}/anime/${slugLocal}`]
    : [`${BASE}/anime/${slugLocal}-anime`, `${BASE}/anime/${slugLocal}`];
  for (const c of candidatos) {
    const html = await obtenerAG(c, { timeoutMs: 7000 });
    if (html && html.length > 5000 && !/acceso restringido|just a moment/i.test(html.slice(0, 4000))) {
      return html;
    }
  }
  return null;
}

async function obtenerAnime(slugLocal: string): Promise<AnimeDetalle | null> {
  const html = await fetchPaginaAnime(slugLocal);
  if (!html || html.length < 200) return null;
  const $ = cheerio.load(html);

  const titulo =
    ($("h1").first().text() || "").replace(/\s+/g, " ").trim() ||
    ($('meta[property="og:title"]').attr("content") || "").split(" | ")[0].trim();
  if (!titulo) return null;

  const portada = absoluta(
    $("img[data-fallback*='cdn.animegratis.net']").first().attr("src") ||
      $("img[src*='cdn.animegratis.net']").first().attr("src") ||
      $('meta[property="og:image"]').attr("content") ||
      "",
    BASE
  );

  const sinopsis =
    ($('[class*=sinopsis], [class*=synopsis], [class*=description], [class*=story]').first().text() || "")
      .replace(/\s+/g, " ")
      .trim() ||
    ($('meta[name="description"]').attr("content") || "").trim() ||
    undefined;

  const generos: string[] = [];
  const vistosG = new Set<string>();
  $("a[href^='/directorio/genero/']").each((_, el) => {
    const g = limpiarGenero($(el).text() || "");
    if (g && g.length > 2 && g.length < 28 && !vistosG.has(g.toLowerCase())) {
      vistosG.add(g.toLowerCase());
      generos.push(g.charAt(0).toUpperCase() + g.slice(1));
    }
  });

  // Episodios: a.episode-link → /anime/{base}/episodio-{n}
  const numeros = new Set<number>();
  $("a[href*='/episodio-']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/episodio-(\d{1,4})\/?$/i);
    if (m) numeros.add(parseInt(m[1], 10));
  });
  $("[data-episode]").each((_, el) => {
    const v = $(el).attr("data-episode") || "";
    if (/^\d{1,4}$/.test(v)) numeros.add(parseInt(v, 10));
  });
  const totalAtrib = parseInt($("[data-total-episodes]").first().attr("data-total-episodes") || "0", 10);

  const textoEstado = $("body").text();
  const estado =
    /serie completa|finalizado/i.test(textoEstado)
      ? "Finalizado"
      : /en emisi/i.test(textoEstado)
        ? "En emisión"
        : undefined;

  const episodios: EpisodioItem[] = [...numeros].sort((a, b) => a - b).map((numero) => ({ numero }));

  // Idioma REAL del anime detectado en su ficha: AnimeGratis marca en el
  // título/meta "anime en latino y castellano" SOLO cuando lleva doblaje.
  // Así un anime con doblaje nunca vuelve a etiquetarse como sub puro.
  const tieneLatino =
    /\ben\s+latino\b|audio\s+latino/i.test(html) ||
    /"lat"\s*:/.test(html.match(/<script id="player-ui-data[^>]*>[\s\S]*?<\/script>/)?.[0] ?? "");
  const idioma: "dual" | "sub" = tieneLatino ? "dual" : "sub";

  return {
    titulo,
    slug: `${ID}~${slugLocal}`,
    portada,
    sinopsis,
    generos: generos.slice(0, 12),
    estado,
    totalEpisodios: episodios.length || totalAtrib || 0,
    idioma,
    fuentes: [{ fuente: ID, nombre: NOMBRE, slugLocal, url: `${BASE}/anime/${slugLocal}`, idioma }],
    episodios,
  };
}

// ── Servidores del episodio (player-ui-data JSON) ────────────

interface PlayerData {
  defaultLang?: string;
  groups?: Record<string, { key: string; name: string; players: { name: string; url: string; external?: boolean }[] }[]>;
}

async function obtenerServidores(slugLocal: string, episodio: number): Promise<ServidorVideo[]> {
  const base = slugBase(slugLocal);
  const urlEp = `${BASE}/anime/${base}/episodio-${episodio}`;
  const html = await obtenerAG(urlEp, {
    timeoutMs: 8000,
    referer: `${BASE}/anime/${base}`,
  });
  if (!html) {
    // fallback: con sufijo -anime (algunas series lo llevan en el path)
    const alt = await obtenerAG(`${BASE}/anime/${slugLocal}/episodio-${episodio}`, {
      timeoutMs: 8000,
      referer: `${BASE}/anime/${slugLocal}`,
    });
    return extraerServidoresDeHtml(alt ?? "");
  }
  return extraerServidoresDeHtml(html);
}

function extraerServidoresDeHtml(html: string): ServidorVideo[] {
  if (!html) return [];
  const m = html.match(
    /<script id="player-ui-data" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) return [];
  let data: PlayerData;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const grupos = data.groups || {};
  const salida: ServidorVideo[] = [];
  const vistos = new Set<string>();

  // Orden: lat (latino) primero, luego cast, luego ja (sub)
  const ordenIdioma: [string, "latino" | "sub"][] = [
    ["lat", "latino"],
    ["cast", "sub"],
    ["ja", "sub"],
  ];
  for (const [grupo, idioma] of ordenIdioma) {
    for (const g of grupos[grupo] || []) {
      for (const p of g.players || []) {
        if (!p.url || !/^https?:\/\//.test(p.url)) continue;
        if (vistos.has(p.url)) continue;
        vistos.add(p.url);
        const servidor = nombreServidor((p.name || g.name || "").toUpperCase(), p.url);
        salida.push({
          servidor,
          tipo: clasificar(p.url),
          url: p.url,
          resuelto: false,
          idioma,
          fuente: ID,
        });
      }
    }
  }
  return salida;
}

const scraper: Scraper = {
  id: ID,
  nombre: NOMBRE,
  baseUrl: BASE,
  idioma: "dual",
  buscar: buscarDirectorio,
  obtenerUltimos,
  obtenerAnime,
  obtenerServidores,
};

export default scraper;
