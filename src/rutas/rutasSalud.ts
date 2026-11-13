// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router de SALUD.
//  - GET /            → healthcheck raíz (lo usa Render) + endpoints
//  - GET /api/v1/salud → estado de CADA fuente: circuito breaker,
//    fallos consecutivos, latencia, dominio activo y grupo
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { instantaneaSalud, resumenSalud } from "../core/salud";
import { totalAlias } from "../datos/aliasDb";
import { envolverAsync } from "./comun";

export const routerSalud = Router();

routerSalud.get(
  "/",
  envolverAsync(async (_req, res) => {
    res.json({
      ok: true,
      servicio: "ANIMAX API v5.1",
      uptime: Math.floor(process.uptime()),
      fuentes: resumenSalud(),
      alias: totalAlias(),
      endpoints: [
        "/api/v1/ultimos",
        "/api/v1/buscar?q=",
        "/api/v1/anime/{slug}",
        "/api/v1/servidores/{slug}/{ep}",
        "/api/v1/stream?url=",
        "/api/v1/generos",
        "/api/v1/catalogo?idioma=&genero=&tipo=",
        "/api/v1/curados",
        "/api/v1/tendencias?ventana=&limite=",
        "/api/v1/programacion?fuente=",
        "/api/v1/recomendaciones/{slug}",
        "/api/v1/top/{valorados|vistos|genero|decada}",
        "/api/v1/continuar?usuario=",
        "/api/v1/historial?usuario=",
        "/api/v1/listas?usuario=",
        "/api/v1/salud",
        "/api/v1/estado",
        "/api/v1/dominios",
        "/api/v1/cron/refresh",
        "/api/v1/admin/estado",
        "/api/v1/metricas · /metrics",
        "/panel",
      ],
      documentacion: "GET /api/v1 → esta lista · docs/API.md",
    });
  })
);

routerSalud.get(
  "/api/v1/salud",
  envolverAsync(async (_req, res) => {
    const fuentes = instantaneaSalud();
    const resumen = resumenSalud();
    res.json({
      ok: true,
      resumen,
      fuentes,
      circuito: {
        leyenda: {
          cerrado: "funcionando con normalidad",
          abierto: "caída: se omite hasta el enfriamiento",
          semiabierto: "en prueba tras el enfriamiento",
        },
      },
    });
  })
);

export default routerSalud;
