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
  | "cache-invalidada";

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

/** Log por consola de los eventos clave (estilo del server original). */
suscribir("fuente-fallo", (c) => {
  console.log(`[salud] ${c.fuente} falló${c.detalle ? ` (${c.detalle})` : ""}`);
});
suscribir("dominio-cambiado", (c) => {
  console.log(`[dominios] ${c.fuente}: ${c.anterior} → ${c.nuevo} (${c.motivo})`);
});
suscribir("extractor-fallo", (c) => {
  console.log(`[extractores] ${c.extractor} no pudo resolver ${c.url.slice(0, 80)}`);
});
