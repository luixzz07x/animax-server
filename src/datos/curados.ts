// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Reexportación de la lista curada de destacados
// (src/lib/animax/curados.ts) + resumen para /api/v1/estado.
// ─────────────────────────────────────────────────────────────

export {
  curadosUnificados,
  calentarCurados,
  type Curado,
} from "../lib/animax/curados";

import { curadosUnificados } from "../lib/animax/curados";

/** Resumen ligero de la lista curada (sin calentar la caché si está fría). */
export async function resumenCurados(): Promise<{
  total: number;
  disponibles: number;
  ms: number;
}> {
  const r = await curadosUnificados();
  const curados = r.data?.curados ?? [];
  return {
    total: curados.length,
    disponibles: curados.filter((c) => c.disponible).length,
    ms: r.ms ?? 0,
  };
}
