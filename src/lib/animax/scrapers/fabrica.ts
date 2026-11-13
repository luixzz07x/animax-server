// ─────────────────────────────────────────────────────────────
// ANIMAX · Fábrica de scrapers basada en el motor genérico.
// Cada fuente del grupo no-verificado se define con configuración
// (rutas + selectores) y recibe automáticamente:
//  - búsqueda con rutas propias o búsqueda por listado
//  - últimos episodios por heurística de tarjetas
//  - detalle por heurística de página de anime
//  - servidores por escáner genérico (iframes/data-src/vars JS)
// Si la fuente no responde (cambio de dominio, Cloudflare), el
// registro la omite en silencio (failover) — nunca rompe la API.
// ─────────────────────────────────────────────────────────────

import { obtenerHttp, absoluta } from "../http";
import type {
  AnimeCard,
  AnimeDetalle,
  EpisodioFeed,
  EpisodioItem,
  Idioma,
  Scraper,
  ServidorVideo,
} from "../types";
import { cargar, clasificar, detectarTipo, extraerServidoresGenericos, extraerTarjetas, nombreServidor, slugDeUrl } from "./motor";

export interface FuenteDefinicion {
  id: string;
  nombre: string;
  baseUrl: string;
  idioma: Idioma;
  /** Ruta del buscador. Si null: se lista la portada y se filtra. */
  rutaBuscar?: (q: string) => string;
  rutaUltimos?: string;
  rutaAnime: (slug: string) => string;
  rutaEpisodio: (slug: string, ep: number) => string;
  selectores?: {
    tarjeta?: string;
    titulo?: string;
    imagen?: string;
    enlace?: string;
  };
  /** Extractor de episodios custom (opcional) */
  extraerEpisodios?: (html: string) => number[];
}

export function fabricarScraper(def: FuenteDefinicion): Scraper {
  const ID = def.id;
  const NOMBRE = def.nombre;
  const BASE = def.baseUrl;

  async function buscar(q: string): Promise<AnimeCard[]> {
    if (!def.rutaBuscar) return [];
    const html = await obtenerHttp(def.rutaBuscar(q), { timeoutMs: 4500 });
    const $ = cargar(html ?? "");
    if (!$) return [];
    const tarjetas = extraerTarjetas($, BASE, def.selectores || {});
    const salida: AnimeCard[] = [];
    const qn = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const vistos = new Set<string>();
    for (const t of tarjetas) {
      const slugLocal = slugDeUrl(t.url);
      if (!slugLocal || vistos.has(slugLocal)) continue;
      // coincide con la búsqueda (tolerante a acentos)
      const tn = t.titulo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!tn.includes(qn)) continue;
      vistos.add(slugLocal);
      salida.push({
        titulo: t.titulo,
        slug: `${ID}~${slugLocal}`,
        portada: t.portada,
        generos: [],
        idioma: def.idioma,
        tipo: detectarTipo(slugLocal, t.titulo, t.url),
        fuentes: [{ fuente: ID, nombre: NOMBRE, slugLocal, url: t.url, idioma: def.idioma }],
        episodioReciente: t.episodioNum,
      });
    }
    return salida.slice(0, 12);
  }

  async function obtenerUltimos(): Promise<EpisodioFeed[]> {
    const html = await obtenerHttp(def.rutaUltimos || BASE, { timeoutMs: 5000 });
    const $ = cargar(html ?? "");
    if (!$) return [];
    const tarjetas = extraerTarjetas($, BASE, def.selectores || {});
    const salida: EpisodioFeed[] = [];
    for (const t of tarjetas) {
      const slugLocal = slugDeUrl(t.url);
      if (!slugLocal || !t.episodioNum) continue;
      if (salida.length >= 20) break;
      salida.push({
        titulo: t.titulo,
        slug: `${ID}~${slugLocal}`,
        portada: t.portada,
        numero: t.episodioNum,
        idioma: def.idioma,
        fuente: ID,
        nombreFuente: NOMBRE,
      });
    }
    return salida;
  }

  async function obtenerAnime(slugLocal: string): Promise<AnimeDetalle | null> {
    const html = await obtenerHttp(def.rutaAnime(slugLocal), { timeoutMs: 7000 });
    const $ = cargar(html ?? "");
    if (!$) return null;
    const titulo =
      $("h1").first().text().trim() ||
      $('meta[property="og:title"]').attr("content")?.split(" - ")[0] ||
      "";
    if (!titulo) return null;
    const sinopsis =
      $(".sinopsis, .description, .synopsis, .story, [class*=sinopsis], [class*=synopsis]").first().text().trim() ||
      $('meta[property="og:description"]').attr("content") ||
      undefined;
    const generos: string[] = [];
    $("[class*=genre] a, .genres a, .generos a, [class*=genero] a").each((_, el) => {
      const g = $(el).text().trim();
      if (g && g.length > 1 && g.length < 28 && !/\d{4}/.test(g)) generos.push(g);
    });
    const portada = absoluta(
      $("img[src*=portada], img[src*=cover], .cover img, .poster img, article img, img").first().attr("src") ||
        $('meta[property="og:image"]').attr("content") ||
        "",
      BASE
    );
    let episodios: EpisodioItem[] = [];
    if (def.extraerEpisodios) {
      episodios = def.extraerEpisodios(html ?? "").map((numero) => ({ numero }));
    } else {
      const nums = new Set<number>();
      // patrones /ver/...-{n} o ...-episodio-{n} o /{n}
      for (const m of (html ?? "").matchAll(/href="[^"]*\/(?:ver|watch)?\/?[a-z0-9\-]+(?:-episodio|-ep)?-(\d{1,4})\/?"/gi)) {
        nums.add(parseInt(m[1]));
      }
      // data numbers en listas
      const $2 = $;
      $2("[data-number], .epl a, [class*=episode] a, [class*=episodio] li").each((_, el) => {
        const n = ($(el).attr("data-number") || $(el).text().trim()).match(/^(\d{1,4})/);
        if (n) nums.add(parseInt(n[1]));
      });
      episodios = [...nums].sort((a, b) => a - b).map((numero) => ({ numero }));
    }
    return {
      titulo,
      slug: `${ID}~${slugLocal}`,
      portada,
      sinopsis,
      generos: [...new Set(generos)].slice(0, 12),
      estado: undefined,
      totalEpisodios: episodios.length,
      idioma: def.idioma,
      tipo: detectarTipo(slugLocal, titulo, def.rutaAnime(slugLocal)),
      fuentes: [{ fuente: ID, nombre: NOMBRE, slugLocal, url: def.rutaAnime(slugLocal), idioma: def.idioma }],
      episodios,
    };
  }

  async function obtenerServidores(slugLocal: string, episodio: number): Promise<ServidorVideo[]> {
    const html = await obtenerHttp(def.rutaEpisodio(slugLocal, episodio), {
      timeoutMs: 7000,
      referer: def.rutaAnime(slugLocal),
    });
    const servidores = extraerServidoresGenericos(html ?? "", BASE);
    for (const s of servidores) {
      s.fuente = ID;
      // Nombre desde URL si el genérico devolvió texto vacío
      if (!s.servidor) s.servidor = nombreServidor("", s.url);
    }
    return servidores.filter((s) => s.tipo !== "external" || /mega|fichier|transfer/i.test(s.url));
  }

  return {
    id: ID,
    nombre: NOMBRE,
    baseUrl: BASE,
    idioma: def.idioma,
    buscar,
    obtenerUltimos,
    obtenerAnime,
    obtenerServidores,
  };
}

export { clasificar };
