// ─────────────────────────────────────────────────────────────
// ANIMAX · Cliente HTTP para scraping:
//  - Timeout duro por petición (AbortController)
//  - Headers rotatorios de navegador (anti-Cloudflare básico)
//  - Reintentos con backoff exponencial
//  - NUNCA lanza: devuelve null y el registro hace failover
// ─────────────────────────────────────────────────────────────

import { Agent, fetch as undiciFetch } from "undici";
import tuning from "./fuentes.json";
import { reescribirDominio } from "../../core/dominios";

const TUN = (tuning as unknown as { tuning: Record<string, number> }).tuning;

const agente = new Agent({
  // 256 KB de cabeceras: AnimeGratis devuelve CSP de ~20 KB y el fetch
  // nativo de Node lanza HeadersOverflowError (bun no, por eso los tests
  // directos con bun sí funcionaban). Render/VPS usan Node → mismo fix.
  maxHeaderSize: 262144,
  connections: 64,
  headersTimeout: 15_000,
  bodyTimeout: 20_000,
});

interface RespuestaHttpMin {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];

let uaIdx = 0;
/** UA rotatoria exportada (la usan los extractores para verificar links). */
export function siguienteUA(): string {
  uaIdx = (uaIdx + 1) % USER_AGENTS.length;
  return USER_AGENTS[uaIdx];
}

const reintentos = TUN.reintentosHttp ?? 2;

export interface OpcionesHttp {
  timeoutMs?: number;
  referer?: string;
  headers?: Record<string, string>;
  /** 0 = un solo intento (útil para endpoints que Cloudflare bloquea
   *  siempre: reintentar solo añade latencia). Por defecto tuning. */
  reintentos?: number;
}

async function intentoUnico(url: string, op: OpcionesHttp): Promise<RespuestaHttpMin | null> {
  // Dominio en caliente: si la fuente tiene un dominio activo distinto,
  // la URL se reescribe antes de salir (vigilante / POST /api/v1/dominios).
  const urlFinal = reescribirDominio(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), op.timeoutMs ?? 8000);
  try {
    const res = (await undiciFetch(urlFinal, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "follow",
      dispatcher: agente,
      headers: {
        "User-Agent": siguienteUA(),
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.6",
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        ...(op.referer ? { Referer: op.referer } : {}),
        ...(op.headers ?? {}),
      },
    })) as unknown as RespuestaHttpMin;
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** GET que nunca lanza. Devuelve el HTML/JSON crudo o null. */
export async function obtenerHttp(url: string, op: OpcionesHttp = {}): Promise<string | null> {
  const max = op.reintentos ?? reintentos;
  for (let i = 0; i <= max; i++) {
    const res = await intentoUnico(url, op);
    if (res) {
      try {
        return await res.text();
      } catch {
        return null;
      }
    }
    // backoff exponencial: 400ms · 800ms · 1600ms…
    await new Promise((r) => setTimeout(r, 400 * Math.pow(2, i)));
  }
  return null;
}

/** GET binario (para proxy de streaming). Nunca lanza. */
export async function obtenerStream(
  url: string,
  op: OpcionesHttp = {}
): Promise<{ res: RespuestaHttpMin } | null> {
  const res = await intentoUnico(url, { timeoutMs: 15000, ...op });
  return res ? { res } : null;
}

/** HEAD con timeout para medir latencia de servidores de video.
 *  Solo cuenta si el servidor responde OK (un 403 rápido = servidor roto). */
export async function latenciaMs(url: string, referer?: string): Promise<number | null> {
  const inicio = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: ctrl.signal,
      headers: {
        "User-Agent": siguienteUA(),
        ...(referer ? { Referer: referer } : {}),
      },
    });
    if (!res.ok) return null;
    return Date.now() - inicio;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Utilidades de normalización ──────────────────────────────

/** Normaliza un título para deduplicación entre fuentes. */
export function normalizarTitulo(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/\b(temporada|season|s)\s*(\d+)\b/g, " $2 ")
    .replace(/\b(tv|ova|ona|especial|movie|pelicula|movie|part)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrae el dominio de una URL. */
export function dominioDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Convierte URL relativa en absoluta respecto a la fuente. */
export function absoluta(url: string, base: string): string {
  if (!url) return "";
  try {
    return new URL(url, base.endsWith("/") ? base : base + "/").toString();
  } catch {
    return url;
  }
}
