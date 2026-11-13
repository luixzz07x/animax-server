// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/cron/refresh — refresco manual del
// caché de portada (lo llama el cron interno cada 10 min y los
// keep-alives externos tipo cron-job.org en el plan free de Render).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { ultimosUnificados } from "../lib/animax/registro";
import { curadosUnificados } from "../datos/curados";
import { invalidar } from "../lib/animax/cache";
import { envolverAsync } from "./comun";

export const routerCron = Router();

/** Refresca el caché de portada y devuelve los tamaños resultantes. */
export async function refrescar(): Promise<{
  ok: boolean;
  episodios: number;
  populares: number;
  curados: number;
  ms: number;
}> {
  invalidar("ultimos");
  invalidar("curados");
  const r = await ultimosUnificados();
  const c = await curadosUnificados();
  return {
    ok: true,
    episodios: r.data?.episodios?.length ?? 0,
    populares: r.data?.populares?.length ?? 0,
    curados: c.data?.curados?.length ?? 0,
    ms: r.ms ?? 0,
  };
}

routerCron.get(
  "/api/v1/cron/refresh",
  envolverAsync(async (_req, res) => {
    res.json(await refrescar());
  })
);
routerCron.post(
  "/api/v1/cron/refresh",
  envolverAsync(async (_req, res) => {
    res.json(await refrescar());
  })
);

export default routerCron;
