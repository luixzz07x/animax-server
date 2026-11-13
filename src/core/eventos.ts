// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Bus de eventos interno (métricas y observabilidad).
// Todas las piezas del server emiten aquí: middleware de registro
// (peticiones), salud (fuentes ok/fallo), extractores (ok/fallo),
// dominios (cambio en caliente), cache (invalidaciones)…
// /api/v1/estado expone los contadores acumulados.
// ─────────────────────────────────────────────────────────────

import { EventEmitter } from "events";

export type NombreEvento =
  | "peticion"
  | "peticion-error"
  | "fuente-ok"
  | "fuente-fallo"
  | "fuente-omitida"
  | "dominio-cambiado"
  | "dominio-restaurado"
  | "extractor-ok"
  | "extractor-fallo"
  | "cache-invalidada"
  | "ciclo-salud";

export interface CargaPeticion {
  id: string;
  metodo: string;
  ruta: string;
  estado: number;
  ms: number;
  ip?: string;
}

export interface CargaFuente {
  fuente: string;
  detalle?: string;
  ms?: number;
}

export interface CargaExtractor {
  extractor: string;
  url: string;
  ms?: number;
}

export interface CargaDominio {
  fuente: string;
  anterior: string;
  nuevo: string;
  motivo: "manual" | "vigilante";
}

/** FIX v5.2: resumen agregado de un ciclo de salud (una línea de log). */
export interface CargaCicloSalud {
  total: number;
  vivas: number;
  bloqueadas: number;
  muertas: number;
  ms: number;
}

export type Cargas = {
  peticion: CargaPeticion;
  "peticion-error": CargaPeticion;
  "fuente-ok": CargaFuente;
  "fuente-fallo": CargaFuente;
  "fuente-omitida": CargaFuente;
  "dominio-cambiado": CargaDominio;
  "dominio-restaurado": CargaDominio;
  "extractor-ok": CargaExtractor;
  "extractor-fallo": CargaExtractor;
  "cache-invalidada": { namespace: string };
  "ciclo-salud": CargaCicloSalud;
};

const emisor = new EventEmitter();
emisor.setMaxListeners(100);

// ── Contadores acumulados (no caducan; se reinician con el proceso) ──
const contadores = new Map<NombreEvento, number>();
const ARRANQUE = Date.now();

function incrementar(nombre: NombreEvento): void {
  contadores.set(nombre, (contadores.get(nombre) || 0) + 1);
}

/** Emite un evento y contabiliza la métrica. */
export function emitir<K extends keyof Cargas>(
  nombre: K,
  carga: Cargas[K]
): void {
  incrementar(nombre);
  emisor.emit(nombre, carga);
}

/** Suscripción interna (middleware, vigilante, logging…). */
export function suscribir<K extends keyof Cargas>(
  nombre: K,
  manejador: (carga: Cargas[K]) => void
): void {
  emisor.on(nombre, manejador as (carga: unknown) => void);
}

/** Suscripción de un solo disparo. */
export function suscribirUnaVez<K extends keyof Cargas>(
  nombre: K,
  manejador: (carga: Cargas[K]) => void
): void {
  emisor.once(nombre, manejador as (carga: unknown) => void);
}

/** Últimas peticiones registradas (buffer circular de 200). */
const recientes: CargaPeticion[] = [];
const MAX_RECIENTES = 200;

suscribir("peticion", (p) => {
  recientes.push(p);
  if (recientes.length > MAX_RECIENTES) recientes.shift();
});

export function peticionesRecientes(): CargaPeticion[] {
  return [...recientes];
}

export interface InstantaneaMetricas {
  arranque: number;
  uptimeSeg: number;
  contadores: Record<string, number>;
}

/** Instantánea de métricas para /api/v1/estado. */
export function instantanea(): InstantaneaMetricas {
  return {
    arranque: ARRANQUE,
    uptimeSeg: Math.floor((Date.now() - ARRANQUE) / 1000),
    contadores: Object.fromEntries([...contadores.entries()].map(([k, v]) => [k, v])),
  };
}

/** Log por consola de los eventos clave — ANTI-SPAM (FIX v5.2):
 *  - "fuente-fallo": solo se loguea la TRANSICIÓN a circuito abierto o
 *    como máximo una vez por fuente cada 10 min (antes: 20 líneas/ciclo
 *    ×3 sistemas = cientos de líneas que ahogaban los logs de Render).
 *  - "ciclo-salud": resumen agregado de una línea por ciclo de salud. */
const ultimoLogFallo = new Map<string, number>();
const INTERVALO_LOG_FALLO_MS = 10 * 60 * 1000;

suscribir("fuente-fallo", (c) => {
  const transicion = (c.detalle || "").includes("circuito");
  const previo = ultimoLogFallo.get(c.fuente) ?? 0;
  if (transicion || Date.now() - previo > INTERVALO_LOG_FALLO_MS) {
    if (transicion) {
      console.log(`[salud] ${c.fuente}: CIRCUITO ABIERTO (omita ~2 min)${c.detalle ? ` · ${c.detalle}` : ""}`);
    } else {
      console.log(`[salud] ${c.fuente} falló${c.detalle ? ` (${c.detalle})` : ""}`);
    }
    ultimoLogFallo.set(c.fuente, Date.now());
  }
});
suscribir("ciclo-salud", (c) => {
  console.log(
    `[salud] ciclo: ${c.total} fuentes · ${c.vivas} vivas · ${c.bloqueadas} bloqueadas(CF) · ${c.muertas} sin respuesta (${c.ms}ms)`
  );
});
suscribir("dominio-cambiado", (c) => {
  console.log(`[dominios] ${c.fuente}: ${c.anterior} → ${c.nuevo} (${c.motivo})`);
});
suscribir("dominio-restaurado", (c) => {
  console.log(`[dominios] ${c.fuente}: restaurado a ${c.nuevo} (${c.motivo})`);
});
suscribir("extractor-fallo", (c) => {
  console.log(`[extractores] ${c.extractor} no pudo resolver ${c.url.slice(0, 80)}`);
});
