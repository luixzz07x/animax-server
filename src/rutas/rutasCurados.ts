// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/curados — lista curada de
// destacados ("no te quedas sin anime"), resuelta perezosamente
// a través del índice + búsqueda viva (caché 6 h).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { curadosUnificados } from "../datos/curados";
import { cacheHeader, envolverAsync } from "./comun";

export const routerCurados = Router();

routerCurados.get(
  "/api/v1/curados",
  cacheHeader(600),
  envolverAsync(async (_req, res) => {
    const r = await curadosUnificados();
    res.json(r);
  })
);

export default routerCurados;
