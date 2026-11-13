// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/ultimos — últimos episodios de las
// 22 fuentes (caché 10 min renovado por el cron interno).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { ultimosUnificados } from "../lib/animax/registro";
import { cacheHeader, envolverAsync } from "./comun";

export const routerUltimos = Router();

routerUltimos.get(
  "/api/v1/ultimos",
  cacheHeader(120),
  envolverAsync(async (_req, res) => {
    const r = await ultimosUnificados();
    res.json(r);
  })
);

export default routerUltimos;
