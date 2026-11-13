// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/buscar — búsqueda unificada en las
// 22 fuentes con alias (inglés ↔ romaji ↔ siglas) y prioridad
// latino. Fallback offline: si NINGUNA fuente viva responde (todas
// caídas/arranque frío) se devuelve la semilla local que coincida,
// marcada como offline para que la app la muestre igualmente.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { buscarUnificado } from "../lib/animax/registro";
import { buscarSemilla } from "../datos/semillaCatalogo";
import { cacheHeader, envolverAsync } from "./comun";

export const routerBuscar = Router();

routerBuscar.get(
  "/api/v1/buscar",
  cacheHeader(600),
  envolverAsync(async (req, res) => {
    const q = (req.query.q as string) || "";
    if (!q || q.trim().length < 2) {
      res.json({ ok: true, data: { resultados: [] }, ms: 0 });
      return;
    }
    const r = await buscarUnificado(q);
    const resultados = r.data?.resultados ?? [];

    // Arranque frío / fuentes caídas: la semilla mantiene la app viva
    if (resultados.length === 0 && (r.fuentesFallidas?.length ?? 0) >= 3) {
      const semilla = buscarSemilla(q);
      if (semilla.length > 0) {
        res.json({ ...r, data: { resultados: semilla }, semilla: true });
        return;
      }
    }
    res.json(r);
  })
);

export default routerBuscar;
