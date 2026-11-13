// ─────────────────────────────────────────────────────────────
// ANIMAX · Caché TTL en memoria (interfaz compatible con Redis:
// al migrar a VPS basta reemplazar obtener/guardar por ioredis).
// Incluye deduplicación de peticiones en vuelo (in-flight memo):
// si 10 usuarios buscan lo mismo a la vez, solo 1 scraping.
// ─────────────────────────────────────────────────────────────

import tuning from "./fuentes.json";

const TUN = (tuning as unknown as { tuning: Record<string, number> }).tuning;

interface EntradaCache {
  v: unknown;
  exp: number;
}

const almacen = new Map<string, EntradaCache>();
const enVuelo = new Map<string, Promise<unknown>>();

// Contadores de hits/fallos para /api/v1/estado (v5)
let hits = 0;
let fallos = 0;

function ttl(namespace: string): number {
  switch (namespace) {
    case "buscar":
      return (TUN.cacheBuscarTtlSeg || 3600) * 1000;
    case "ultimos":
      return (TUN.cacheUltimosTtlSeg || 600) * 1000;
    case "detalle":
    case "servidores":
      return (TUN.cacheDetalleTtlSeg || 21600) * 1000;
    case "extractor":
      return (TUN.cacheServidoresTtlSeg || 21600) * 1000;
    case "generos":
      return 24 * 3600 * 1000;
    case "curados":
      return 6 * 3600 * 1000; // lista curada de destacados
    case "cattipo":
      return 3600 * 1000; // catálogo por tipo (p.ej. pelicula): 1 h
    default:
      return 600 * 1000;
  }
}

export function obtener<T>(namespace: string, clave: string): T | null {
  const k = `${namespace}:${clave}`;
  const e = almacen.get(k);
  if (!e) {
    fallos++;
    return null;
  }
  if (Date.now() > e.exp) {
    almacen.delete(k);
    fallos++;
    return null;
  }
  hits++;
  return e.v as T;
}

export function guardar(namespace: string, clave: string, valor: unknown): void {
  almacen.set(`${namespace}:${clave}`, { v: valor, exp: Date.now() + ttl(namespace) });
  // Limpieza oportunista para que el Map no crezca sin límite
  if (almacen.size > 5000) {
    const ahora = Date.now();
    for (const [k, e] of almacen) {
      if (ahora > e.exp) almacen.delete(k);
    }
  }
}

/** Envuelve una operación con caché + deduplicación en vuelo. */
export async function conCache<T>(
  namespace: string,
  clave: string,
  fn: () => Promise<T>
): Promise<T> {
  const hit = obtener<T>(namespace, clave);
  if (hit !== null) return hit;
  const k = `${namespace}:${clave}`;
  const pend = enVuelo.get(k);
  if (pend) return pend as Promise<T>;
  const p = (async () => {
    try {
      const v = await fn();
      guardar(namespace, clave, v);
      return v;
    } finally {
      enVuelo.delete(k);
    }
  })();
  enVuelo.set(k, p);
  return p;
}

export function invalidar(namespace: string, clave?: string): void {
  if (clave !== undefined) almacen.delete(`${namespace}:${clave}`);
  else for (const k of [...almacen.keys()]) if (k.startsWith(`${namespace}:`)) almacen.delete(k);
}

export function estadisticas(): {
  entradas: number;
  enVuelo: number;
  hits: number;
  fallos: number;
} {
  return { entradas: almacen.size, enVuelo: enVuelo.size, hits, fallos };
}

/** Entradas por namespace (v5: métricas de /api/v1/estado). */
export function estadisticasPorNamespace(): { namespace: string; entradas: number }[] {
  const conteo = new Map<string, number>();
  for (const k of almacen.keys()) {
    const ns = k.split(":")[0];
    conteo.set(ns, (conteo.get(ns) || 0) + 1);
  }
  return [...conteo.entries()]
    .map(([namespace, entradas]) => ({ namespace, entradas }))
    .sort((a, b) => b.entradas - a.entradas);
}
