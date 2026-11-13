// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Router /api/v1/programacion — calendario de
// emisión semanal (lunes→domingo) global, por fuente, y vista
// "todas las fuentes". Motor: src/modulos/programacionSemanal.ts.
//   GET /api/v1/programacion            → calendario global
//   GET /api/v1/programacion?fuente=xx  → solo esa fuente
//   GET /api/v1/programacion/fuentes    → una vista por fuente
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { programacionSemanal, programacionPorFuente } from "../modulos/programacionSemanal";
import { cacheHeader, envolverAsync } from "./comun";

export const routerProgramacion = Router();

routerProgramacion.get(
  "/api/v1/programacion",
  cacheHeader(300),
  envolverAsync(async (req, res) => {
    const fuente = (req.query.fuente as string) || undefined;
    const r = await programacionSemanal({ fuente });
    res.json({
      ok: true,
      data: r,
      ...(fuente ? { fuente } : {}),
    });
  })
);

routerProgramacion.get(
  "/api/v1/programacion/fuentes",
  cacheHeader(300),
  envolverAsync(async (_req, res) => {
    const vistas = await programacionPorFuente();
    res.json({
      ok: true,
      data: {
        fuentes: vistas.map((v) => ({ fuente: v.fuente, nombre: v.nombre, animes: v.animes })),
        vistas,
      },
    });
  })
);

export default routerProgramacion;
