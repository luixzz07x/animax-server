// ─────────────────────────────────────────────────────────────
// ANIMAX v5.2-FIX · Router /api/v1/ultimos — últimos episodios de las
// 22 fuentes (caché 10 min renovado por el cron interno).
//
// FIX RENDER: si el feed llega VACÍO (arranque frío / fuentes bloqueadas
// por Cloudflare en el datacenter), se sirve la SEMILLA OFFLINE como
// populares y se marca semilla:true — la app nunca se queda en blanco.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { ultimosUnificados } from "../lib/animax/registro";
import { catalogoSemilla } from "../datos/semillaCatalogo";
import { cacheHeader, envolverAsync } from "./comun";

export const routerUltimos = Router();

routerUltimos.get(
  "/api/v1/ultimos",
  cacheHeader(120),
  envolverAsync(async (_req, res) => {
    const r = await ultimosUnificados();
    const episodios = r.data?.episodios ?? [];
    const populares = r.data?.populares ?? [];

    // FIX: catálogo vacío → semilla offline inmediata (no esperar a que
    // el health-check marque 3 caídas: en Render el arranque es lento).
    if (episodios.length === 0 && populares.length === 0) {
      const semilla = catalogoSemilla({ limite: 40 });
      res.json({
        ...r,
        data: { episodios: [], populares: semilla },
        semilla: true,
        aviso: "fuentes calentando o bloqueadas: catálogo offline temporal",
      });
      return;
    }
    res.json(r);
  })
);

export default routerUltimos;
