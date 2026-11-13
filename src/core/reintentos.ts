// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Reintentos con backoff exponencial (genérico).
// El cliente HTTP ya aplica reintentos internamente; este módulo
// expone la misma política como abstracción reutilizable para
// vigilante, salud de fuentes y extractores.
// ─────────────────────────────────────────────────────────────

import ajustesJson from "../config/ajustes.json";

interface AjustesReintentos {
  reintentos: {
    baseBackoffMs: number;
    maxBackoffMs: number;
    intentos: number;
  };
}

const AJ = (ajustesJson as unknown as AjustesReintentos).reintentos;

export interface OpcionesReintentos {
  /** Número de reintentos DESPUÉS del primer intento (0 = un intento). */
  intentos?: number;
  /** Base del backoff exponencial (ms). */
  baseMs?: number;
  /** Techo del backoff (ms). */
  maxMs?: number;
}

/** Pausa asíncrona simple. */
export function pausa(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Backoff del intento n (0-based): base * 2^n, con techo. */
export function backoffMs(intento: number, baseMs?: number, maxMs?: number): number {
  const base = baseMs ?? AJ.baseBackoffMs ?? 400;
  const max = maxMs ?? AJ.maxBackoffMs ?? 3200;
  return Math.min(base * Math.pow(2, Math.max(0, intento)), max);
}

/**
 * Ejecuta `fn` con reintentos y backoff exponencial.
 *  - `fn` devuelve `null`/lanza cuando el intento FALLÓ y merece reintento.
 *  - El resultado no-null se devuelve inmediatamente.
 *  - Tras agotar los intentos devuelve null (nunca lanza).
 */
export async function conReintentos<T>(
  fn: (intento: number) => Promise<T | null>,
  op: OpcionesReintentos = {}
): Promise<T | null> {
  const max = op.intentos ?? AJ.intentos ?? 2;
  for (let i = 0; i <= max; i++) {
    try {
      const valor = await fn(i);
      if (valor !== null && valor !== undefined) return valor;
    } catch {
      /* el intento falló: backoff y siguiente */
    }
    if (i < max) await pausa(backoffMs(i, op.baseMs, op.maxMs));
  }
  return null;
}

/** Igual que conReintentos pero propaga el último error si todo falla. */
export async function conReintentosEstricto<T>(
  fn: (intento: number) => Promise<T>,
  op: OpcionesReintentos = {}
): Promise<T> {
  const max = op.intentos ?? AJ.intentos ?? 2;
  let ultimoError: unknown = new Error("sin intentos");
  for (let i = 0; i <= max; i++) {
    try {
      return await fn(i);
    } catch (e) {
      ultimoError = e;
      if (i < max) await pausa(backoffMs(i, op.baseMs, op.maxMs));
    }
  }
  throw ultimoError;
}
