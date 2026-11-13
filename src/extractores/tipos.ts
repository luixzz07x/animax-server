// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Contrato común de los extractores de video.
// Cada servidor de video tiene SU archivo (mp4upload.ts, voe.ts…)
// y devuelve siempre esta forma. La fábrica los encadena por
// prioridad y NUNCA se rinde: si todos fallan devuelve el propio
// embed a través del proxy (tipo "proxy").
// ─────────────────────────────────────────────────────────────

/** Cómo reproduce el reproductor propio el resultado:
 *  - "mp4"  → URL directa progressive (.mp4), proxy con Range
 *  - "m3u8" → playlist HLS, el proxy reescribe los segmentos
 *  - "proxy"→ el embed se sirve TAL CUAL vía /api/v1/stream
 *             (último recurso: el reproductor decide qué hacer) */
export type TipoVideo = "mp4" | "m3u8" | "proxy";

export interface ResultadoExtraccion {
  /** Link listo para /api/v1/stream (directo o embed). */
  urlDirecta: string;
  tipo: TipoVideo;
  /** Etiqueta de calidad si se detecta (720p, 1080p…). */
  calidad?: string;
  /** Headers extra que el proxy debe mandar (Referer del embed…). */
  headers?: Record<string, string>;
}

/** Interfaz que implementa cada extractor. */
export interface ExtractorVideo {
  /** Identificador interno (coincide con ajustes.json → extractores.prioridad). */
  id: string;
  /** Nombre legible (docs, /api/v1/estado). */
  nombre: string;
  /** RegExp que casa con las URLs que este extractor sabe resolver. */
  patron: RegExp;
  /** Menor = se prueba antes (ajustes.json → extractores.prioridad). */
  prioridad: number;
  /** Extrae el link directo. null = "yo no pude, prueba el siguiente". */
  extraer(url: string): Promise<ResultadoExtraccion | null>;
}

/** Detecta la calidad de una URL/etiqueta (720p, 1080p, 4K…). */
export function detectarCalidad(texto: string): string | undefined {
  const m = texto.match(/(2160p|1440p|1080p|720p|480p|360p|4k|hd|full\s?hd)/i);
  return m ? m[1].toLowerCase().replace(/\s/g, "") : undefined;
}
