// ─────────────────────────────────────────────────────────────
// ANIMAX · Tipos unificados (contrato de datos de TODAS las fuentes)
// ─────────────────────────────────────────────────────────────

export type Idioma = "latino" | "sub" | "dual";

/** Tarjeta de anime (resultados de búsqueda, carruseles, catálogos) */
export interface AnimeCard {
  titulo: string;
  /** Slug global: `ded:{tituloNormalizado}` para entradas deduplicadas,
   *  o `{fuenteId}~{slugLocal}` para una entrada de una sola fuente. */
  slug: string;
  portada: string;
  sinopsis?: string;
  generos: string[];
  estado?: string;
  totalEpisodios?: number;
  /** Idioma(s) disponible(s) tras deduplicar */
  idioma: Idioma;
  /** Fuentes donde existe este anime (1 si no está duplicado) */
  fuentes: AnimeFuenteRef[];
  episodioReciente?: number;
  tipo?: string;
}

/** Referencia a una fuente concreta dentro de un anime deduplicado */
export interface AnimeFuenteRef {
  fuente: string;
  nombre: string;
  slugLocal: string;
  url?: string;
  idioma: Idioma;
}

/** Episodio en la lista de un anime */
export interface EpisodioItem {
  numero: number;
  titulo?: string;
  fecha?: string;
}

/** Detalle completo del anime (GET /api/v1/anime/{slug}) */
export interface AnimeDetalle {
  titulo: string;
  slug: string;
  portada: string;
  sinopsis?: string;
  generos: string[];
  estado?: string;
  totalEpisodios: number;
  idioma: Idioma;
  tipo?: string;
  fuentes: AnimeFuenteRef[];
  episodios: EpisodioItem[];
}

/** Episodio del feed de "últimos" (portada /ultimos) */
export interface EpisodioFeed {
  titulo: string;
  slug: string;
  portada: string;
  numero: number;
  idioma: Idioma;
  fuente: string;
  nombreFuente: string;
  fecha?: string;
}

/** Servidor de video de un episodio (GET /api/v1/servidores/{slug}/{ep}) */
export interface ServidorVideo {
  servidor: string;
  /** mp4 | m3u8 | embed (requiere extractor) | external (descarga) */
  tipo: "mp4" | "m3u8" | "embed" | "external";
  /** URL original (embed o directa) */
  url: string;
  /** URL lista para el reproductor (a través del proxy, ya resuelta) */
  streamUrl?: string;
  /** true si ya se extrajo el link directo */
  resuelto: boolean;
  idioma?: "latino" | "sub";
  /** Latencia de verificación en ms (link comprobado antes de ofrecerse) */
  ms?: number;
  fuente: string;
  /** Nombre legible de la fuente de la que viene (fallback universal) */
  nombreFuente?: string;
}

/** Interfaz OBLIGATORIA de cada módulo scraper */
export interface Scraper {
  id: string;
  nombre: string;
  baseUrl: string;
  idioma: Idioma;
  buscar(q: string): Promise<AnimeCard[]>;
  obtenerUltimos(): Promise<EpisodioFeed[]>;
  obtenerAnime(slugLocal: string): Promise<AnimeDetalle | null>;
  obtenerServidores(slugLocal: string, episodio: number): Promise<ServidorVideo[]>;
}

export interface RespuestaAPI<T> {
  ok: boolean;
  data?: T;
  error?: string;
  fuentesOk?: string[];
  fuentesFallidas?: string[];
  ms?: number;
  cacheado?: boolean;
}
