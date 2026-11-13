// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · FÁBRICA DE EXTRACTORES (reproductor universal).
// Encadena los 12 extractores individuales POR PRIORIDAD:
//   Mp4Upload → YourUpload → StreamTape → Doodstream → Voe →
//   Ok.ru → HLS → StreamWish → FileMoon → VidMoly → StreamSB → Mega
// REGLA DE ORO: NUNCA devuelve "reproductor propio no soportado".
//  1. Si la URL ya es .mp4/.m3u8 → directa (0 peticiones).
//  2. Se prueba el extractor cuyo patrón case (en orden de
//     prioridad de src/config/ajustes.json); si falla, SIGUE con
//     el siguiente (failover silencioso).
//  3. Escáner genérico final: cualquier .mp4/.m3u8 del HTML.
//  4. ÚLTIMO RECURSO: devuelve el propio embed con tipo "proxy"
//     (el proxy lo sirve tal cual — jamás un error al usuario).
// ─────────────────────────────────────────────────────────────

import ajustesJson from "../config/ajustes.json";
import { obtenerHttp } from "../lib/animax/http";
import { emitir } from "../core/eventos";
import type { ExtractorVideo, ResultadoExtraccion, TipoVideo } from "./tipos";

import mp4upload from "./mp4upload";
import yourupload from "./yourupload";
import streamtape from "./streamtape";
import doodstream from "./doodstream";
import voe from "./voe";
import okru from "./okru";
import m3u8 from "./m3u8";
import streamwish from "./streamwish";
import filemoon from "./filemoon";
import vidmoly from "./vidmoly";
import streamsb from "./streamsb";
import mega from "./mega";
// v5.1: MixDrop, Upstream y FileLions (con desempaquetador de packer)
import mixdrop from "./mixdrop";
import upstream from "./upstream";
import filelions from "./filelions";

interface AjustesExtractores {
  extractores: { prioridad: string[] };
}

const ORDEN_CFG = (ajustesJson as unknown as AjustesExtractores).extractores.prioridad;

/** Todos los extractores (uno por servidor de video). Los v5.1
 *  (mixdrop/upstream/filelions) entran ANTES del último recurso:
 *  se prueban en la cadena por prioridad y si fallan sigue el
 *  escáner genérico + el proxy directo. */
const TODOS: ExtractorVideo[] = [
  mp4upload,
  yourupload,
  streamtape,
  doodstream,
  voe,
  okru,
  m3u8,
  streamwish,
  filemoon,
  vidmoly,
  streamsb,
  mixdrop,
  upstream,
  filelions,
  mega,
];

/** Prioridad efectiva: la de ajustes.json si está listada, si no la del módulo. */
function prioridadEfectiva(e: ExtractorVideo): number {
  const idx = ORDEN_CFG.indexOf(e.id);
  return idx >= 0 ? idx : e.prioridad;
}

/** Cadena ordenada por prioridad (menor primero). */
export const CADENA: ExtractorVideo[] = [...TODOS].sort(
  (a, b) => prioridadEfectiva(a) - prioridadEfectiva(b)
);

/** Escáner genérico final: busca .mp4/.m3u8 en CUALQUIER HTML. */
async function extraerGenerico(url: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(url, { timeoutMs: 6000, referer: url, reintentos: 0 });
  if (!html) return null;
  const patrones: RegExp[] = [
    /(?:file|src|url|source)\s*[:=]\s*["'](https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)(?:\?[^"'\s\\]*)?)["']/i,
    /["'](https?:\/\/[^"'\s\\]+\.m3u8(?:\?[^"'\s\\]*)?)["']/,
    /["'](https?:\/\/[^"'\s\\]+\.mp4(?:\?[^"'\s\\]*)?)["']/,
  ];
  for (const p of patrones) {
    const m = html.match(p);
    if (m && m[1] && /^https?:\/\//.test(m[1])) {
      // Evita devolver recursos de la página que no son video
      if (/\.(?:js|css|png|jpe?g|gif|svg|woff)(\?|$)/i.test(m[1])) continue;
      if (/\/(?:embed|player)\//i.test(m[1]) && !/\.(?:m3u8|mp4)(\?|$)/i.test(m[1])) continue;
      const tipo: TipoVideo = /\.m3u8(\?|$)/i.test(m[1]) ? "m3u8" : "mp4";
      return { urlDirecta: m[1], tipo, headers: { Referer: url } };
    }
  }
  return null;
}

export interface TrazadoExtraccion {
  intentos: string[];
  extractorFinal: string;
  ms: number;
}

/** Última extracción con su trazado (para /api/v1/estado). */
let ultimoTrazado: TrazadoExtraccion | null = null;

/**
 * Resuelve una URL de servidor de video a algo reproducible.
 * NUNCA devuelve null (ver cabecera). Devuelve el resultado y, en
 * `trazado`, qué extractores se probaron.
 */
export async function extraerVideo(
  url: string,
  trazar = true
): Promise<{ resultado: ResultadoExtraccion; trazado?: TrazadoExtraccion }> {
  const inicio = Date.now();
  const intentos: string[] = [];

  // 0) Link ya directo
  if (/\.mp4(\?|#|$)/i.test(url)) {
    return { resultado: { urlDirecta: url, tipo: "mp4" } };
  }
  if (/\.m3u8(\?|#|$)/i.test(url) || /\/m3u8\//i.test(url)) {
    return { resultado: { urlDirecta: url, tipo: "m3u8" } };
  }

  // 1) Extractor cuyo patrón case (orden por prioridad)
  for (const extractor of CADENA) {
    if (!extractor.patron.test(url)) continue;
    intentos.push(extractor.id);
    try {
      const r = await extractor.extraer(url);
      if (r) {
        emitir("extractor-ok", { extractor: extractor.id, url, ms: Date.now() - inicio });
        const trazado: TrazadoExtraccion = {
          intentos,
          extractorFinal: extractor.id,
          ms: Date.now() - inicio,
        };
        if (trazar) ultimoTrazado = trazado;
        return { resultado: r, trazado };
      }
    } catch {
      /* failover al siguiente extractor */
    }
  }

  // 2) Escáner genérico (cualquier .mp4/.m3u8 en el HTML)
  intentos.push("generico");
  const generico = await extraerGenerico(url).catch(() => null);
  if (generico) {
    emitir("extractor-ok", { extractor: "generico", url, ms: Date.now() - inicio });
    const trazado: TrazadoExtraccion = {
      intentos,
      extractorFinal: "generico",
      ms: Date.now() - inicio,
    };
    if (trazar) ultimoTrazado = trazado;
    return { resultado: generico, trazado };
  }

  // 3) ÚLTIMO RECURSO: el propio embed por el proxy. Jamás error.
  emitir("extractor-fallo", { extractor: "fabrica", url, ms: Date.now() - inicio });
  const trazado: TrazadoExtraccion = {
    intentos,
    extractorFinal: "proxy-directo",
    ms: Date.now() - inicio,
  };
  if (trazar) ultimoTrazado = trazado;
  return {
    resultado: { urlDirecta: url, tipo: "proxy", headers: { Referer: url } },
    trazado,
  };
}

/** Igual que extraerVideo pero devuelve null si acaba en "proxy"
 *  (útil donde se exige link directo verificado: servidores API). */
export async function extraerDirectoV5(url: string): Promise<ResultadoExtraccion | null> {
  const { resultado } = await extraerVideo(url);
  return resultado.tipo === "proxy" ? null : resultado;
}

/** Inventario para /api/v1/estado y docs. */
export function listaExtractores(): {
  id: string;
  nombre: string;
  prioridad: number;
  patron: string;
}[] {
  return CADENA.map((e) => ({
    id: e.id,
    nombre: e.nombre,
    prioridad: prioridadEfectiva(e),
    patron: e.patron.source.slice(0, 60),
  }));
}

/** Última traza de extracción (diagnóstico). */
export function trazadoUltimo(): TrazadoExtraccion | null {
  return ultimoTrazado;
}

export type { ExtractorVideo, ResultadoExtraccion, TipoVideo } from "./tipos";
