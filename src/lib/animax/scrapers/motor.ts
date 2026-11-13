// ─────────────────────────────────────────────────────────────
// ANIMAX · Motor genérico de scraping defensivo.
// Sirve de base a las fuentes cuya estructura no está verificada
// desde este entorno (el sandbox no llega a todos los dominios).
// Estrategia: selectores amplios + heurísticas de tarjetas de
// anime (imagen + enlace + texto), fallo silencioso (→ []).
// Los scrapers específicos (AnimeFLV, TioAnime…) extienden esto.
// ─────────────────────────────────────────────────────────────

import * as cheerio from "cheerio";
import { obtenerHttp, absoluta } from "../http";
import type {
  AnimeCard,
  AnimeDetalle,
  AnimeFuenteRef,
  EpisodioFeed,
  EpisodioItem,
  Idioma,
  Scraper,
  ServidorVideo,
} from "../types";

export interface MotorConfig {
  id: string;
  nombre: string;
  baseUrl: string;
  idioma: Idioma;
  /** Rutas de la fuente */
  rutas: {
    ultimos?: string;
    buscar?: (q: string) => string | null;
    anime: (slug: string) => string;
    episodio: (slug: string, ep: number) => string;
  };
  /** Selectores de tarjetas en listados/buscador */
  selectores?: {
    tarjeta?: string;
    titulo?: string;
    imagen?: string;
    enlace?: string;
    episodioNum?: string;
  };
}

/** Detecta tarjetas de anime en cualquier listado con heurística. */
export function extraerTarjetas(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  cfg: { tarjeta?: string; titulo?: string; imagen?: string; enlace?: string }
): { titulo: string; url: string; portada: string; episodioNum?: number }[] {
  const salida: { titulo: string; url: string; portada: string; episodioNum?: number }[] = [];
  const sel = cfg.tarjeta || "article, .card, .anime, li[class*=anime], .col-item";
  $(sel).each((_, el) => {
    const nodo = $(el);
    const enlace = nodo.find(cfg.enlace || "a[href]").first();
    const href = enlace.attr("href") || nodo.find("a[href]").first().attr("href");
    if (!href) return;
    const url = absoluta(href, baseUrl);
    // Solo rutas de anime/episodio, no de navegación
    if (!/\/(anime|ver|animes|directorio|episodio|category)/i.test(url)) return;
    const titulo =
      (cfg.titulo ? nodo.find(cfg.titulo).first().text() : "") ||
      enlace.attr("title") ||
      enlace.text() ||
      nodo.find("h1,h2,h3,h4,.title").first().text();
    const limpio = titulo.replace(/\s+/g, " ").trim();
    if (!limpio || limpio.length < 2 || limpio.length > 150) return;
    // Descarta badges/navegación ("PRÓXIMAMENTE", "TEMP", "Directorio"…)
    if (
      /^(pr[oó]ximamente|temp|nuevo\b|ver\s|explorar|directorio|horario|manga|blog|top\b|vip|descargas|dmca|registro|login|perfil|inicio|tutorial|g[eé]neros|ayuda|legal|notificaciones|continuar viendo|ver historial)/i.test(
        limpio
      ) ||
      !/[a-zA-ZÀ-ÿ]/.test(limpio)
    )
      return;
    let portada =
      (cfg.imagen ? nodo.find(cfg.imagen).first().attr("src") : "") ||
      nodo.find("img").first().attr("src") ||
      nodo.find("img").first().attr("data-src") ||
      nodo.find("img").first().attr("data-lazy-src") ||
      "";
    portada = absoluta(portada, baseUrl);
    const mEp = nodo
      .find(".episode, .ep, .episodio, [class*=episode], [class*=cap]")
      .first()
      .text()
      .match(/(\d{1,4})/);
    salida.push({ titulo: limpio, url, portada, episodioNum: mEp ? parseInt(mEp[1]) : undefined });
  });
  return salida;
}

/** Detecta slugs tipo "/anime/{slug}" en una URL. */
export function slugDeUrl(url: string): string | null {
  const m = url.match(/\/(?:anime|animes|ver)?\/?([a-z0-9\-]+(?:-\d+)?)(?:-episodio-\d+|\/\d+)?\/?$/i);
  if (m && m[1] && m[1].length > 2) return m[1].replace(/\/$/, "");
  return null;
}

/** Detecta el tipo de entrada (pelicula / ova) a partir de URLs,
 *  slugs o títulos ("...-pelicula-...", "/peliculas/...", "Pelicula"). */
export function detectarTipo(...partes: (string | undefined | null)[]): string | undefined {
  const t = partes.filter((p): p is string => Boolean(p)).join(" ").toLowerCase();
  if (!t) return undefined;
  if (/pelicula|película|\bmovie\b|\bfilm\b/.test(t)) return "pelicula";
  if (/\bova\b/.test(t)) return "ova";
  return undefined;
}

/** Escanea una página de episodio buscando servidores embebidos. */
export function extraerServidoresGenericos(
  html: string,
  baseUrl: string
): ServidorVideo[] {
  const $ = cheerio.load(html);
  const salida: ServidorVideo[] = [];
  const vistos = new Set<string>();

  const push = (servidor: string, url: string, tipo: ServidorVideo["tipo"]) => {
    if (!url || vistos.has(url)) return;
    vistos.add(url);
    salida.push({ servidor, tipo, url, resuelto: false, fuente: "" });
  };

  // 1) data-src / data-video en base64 (patrón AnimeFLV.st y clones)
  $("[data-src],[data-video]").each((_, el) => {
    const v = $(el).attr("data-src") || $(el).attr("data-video") || "";
    let url = v;
    if (/^[A-Za-z0-9+/=_\-]+$/.test(v) && !/^https?/.test(v)) {
      try {
        url = Buffer.from(v, "base64").toString("utf8");
      } catch {
        url = v;
      }
    }
    if (/^https?:\/\//.test(url)) {
      const nombre = nombreServidor($(el).text().trim(), url);
      push(nombre, url, clasificar(url));
    }
  });

  // 2) iframes con reproductores conocidos
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (/^https?:\/\//.test(src)) push(nombreServidor("", src), src, clasificar(src));
  });

  // 3) variables JS tipo TioAnime: var videos = [["Mega","https://..."]]
  const mVars = html.match(/(?:var|const)\s+videos?\s*=\s*(\[\s*\[[\s\S]*?\]\s*\])\s*;/);
  if (mVars) {
    try {
      const arr = JSON.parse(mVars[1].replace(/'/g, '"').replace(/,\s*\]/g, "]"));
      for (const it of arr) {
        if (Array.isArray(it) && typeof it[1] === "string" && /^https?:\/\//.test(it[1])) {
          push(nombreServidor(String(it[0] || ""), it[1]), it[1], clasificar(it[1]));
        }
      }
    } catch {
      /* silencioso */
    }
  }

  // 4) enlaces de descarga directa (.mp4 / .m3u8 / mega / 1fichier)
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (/\.m3u8(\?|#|$)/.test(href)) push("HLS", absoluta(href, baseUrl), "m3u8");
    else if (/\.mp4(\?|#|$)/.test(href)) push("MP4", absoluta(href, baseUrl), "mp4");
    else if (/mega\.nz|1fichier|transfer\.it/i.test(href))
      push(nombreDescarga(href), href, "external");
  });

  return salida;
}

function nombreDescarga(url: string): string {
  if (/mega\.nz/i.test(url)) return "Mega";
  if (/1fichier/i.test(url)) return "1Fichier";
  if (/transfer\.it/i.test(url)) return "TransferIt";
  return "Descarga";
}

/** Nombre legible del servidor a partir del texto del botón o del dominio. */
export function nombreServidor(texto: string, url: string): string {
  const t = texto.toLowerCase();
  if (t.includes("mp4upload") || /mp4upload/i.test(url)) return "Mp4Upload";
  if (t.includes("streamtape") || /streamtape|stape\.net/i.test(url)) return "StreamTape";
  if (t.includes("dood") || /dood(\.to|stream|\.com)|ds2play/i.test(url)) return "Doodstream";
  if (t.includes("yourupload") || /yourupload/i.test(url)) return "YourUpload";
  if (t.includes("voe") || /voe\.|voe-/i.test(url)) return "Voe";
  if (t.includes("ok") || /ok\.ru|odnoklassniki/i.test(url)) return "Ok.ru";
  if (t.includes("mega") || /mega\.nz/i.test(url)) return "Mega";
  if (/m3u8|zill[ao]|stream/i.test(url) && /\.m3u8/.test(url)) return "HLS";
  if (t.includes("hls") || /m3u8/i.test(url)) return "HLS";
  if (t.includes("byse") || /byse/i.test(url)) return "Byse";
  if (t.includes("streamwish") || /sfastwish|hgcloud|embedwish|streamwish/i.test(url)) return "StreamWish";
  if (t.includes("upnshare") || /uns\.bio/i.test(url)) return "UpnShare";
  if (t.includes("netu") || /hqq\.(to|tv)/i.test(url)) return "Netu";
  if (t.includes("mailru") || /mail\.ru/i.test(url)) return "MailRu";
  if (/fembed|streamsb|vidmoly|filemoon|mixdrop|streamlare|uqload/i.test(url))
    return url.match(/(fembed|streamsb|vidmoly|filemoon|mixdrop|streamlare|uqload)/i)?.[1] || "Servidor";
  // Último recurso: nombre legible desde el dominio (p. ej. ryderjet.com → Ryderjet)
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/\.(com|to|net|tv|sx|io|cc|xyz)$/i, "");
    const dom = host.split(".")[0];
    if (dom && dom.length > 2 && /^[a-z\-]+$/i.test(dom)) {
      return dom.charAt(0).toUpperCase() + dom.slice(1);
    }
  } catch {
    /* sin URL válida */
  }
  return texto.slice(0, 24) || "Servidor";
}

/** Clasifica una URL de servidor. */
export function clasificar(url: string): ServidorVideo["tipo"] {
  if (/\.m3u8(\?|$)/i.test(url) || /\/m3u8\//i.test(url)) return "m3u8";
  if (/\.mp4(\?|$)/i.test(url)) return "mp4";
  if (/mega\.nz|1fichier|transfer\.it/i.test(url)) return "external";
  return "embed";
}

/** Fabrica un AnimeCard mínimo a partir de datos sueltos. */
export function tarjetaDesde(
  fuente: string,
  nombre: string,
  idioma: Idioma,
  titulo: string,
  slugLocal: string,
  portada: string,
  extra?: Partial<AnimeCard>
): AnimeCard {
  return {
    titulo,
    slug: `${fuente}~${slugLocal}`,
    portada,
    generos: [],
    idioma,
    fuentes: [{ fuente, nombre, slugLocal, idioma }],
    ...extra,
  };
}

/** Fabrica un feed de episodio. */
export function feedDesde(
  fuente: string,
  nombre: string,
  idioma: Idioma,
  titulo: string,
  slugLocal: string,
  portada: string,
  numero: number,
  fecha?: string
): EpisodioFeed {
  return {
    titulo,
    slug: `${fuente}~${slugLocal}`,
    portada,
    numero,
    idioma,
    fuente,
    nombreFuente: nombre,
    fecha,
  };
}

/** Detalle vacío utilitario. */
export function detalleVacio(
  fuente: string,
  nombre: string,
  idioma: Idioma,
  titulo: string,
  slugLocal: string,
  portada: string
): AnimeDetalle {
  return {
    titulo,
    slug: `${fuente}~${slugLocal}`,
    portada,
    generos: [],
    totalEpisodios: 0,
    idioma,
    fuentes: [{ fuente, nombre, slugLocal, idioma }],
    episodios: [],
  };
}

export function episodiosDeLista(numeros: number[]): EpisodioItem[] {
  return [...new Set(numeros)].sort((a, b) => a - b).map((numero) => ({ numero }));
}

/** Carga $ de cheerio de forma segura. Rechaza páginas de bloqueo
 *  (Cloudflare "Just a moment", "Acceso restringido"…): esos HTML
 *  si pasaran producirían tarjetas basura → animes "no disponibles". */
export function cargar(html: string): cheerio.CheerioAPI | null {
  if (!html || html.length < 50) return null;
  if (
    /just a moment|acceso restringido|acceso no disponible|challenge-platform|cf-chl|attention required|__CF\$cv\$params|verifying you are human/i.test(
      html.slice(0, 4000)
    )
  ) {
    return null;
  }
  try {
    return cheerio.load(html);
  } catch {
    return null;
  }
}
