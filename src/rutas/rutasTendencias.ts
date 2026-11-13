// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Router /api/v1/tendencias — tendencias de búsqueda
// por ventana temporal con decaimiento exponencial (motor en
// src/modulos/tendencias.ts, alimentado por el bus de eventos).
//   GET /api/v1/tendencias?ventana=24&limite=20
// ventana: horas 1..168 (por defecto 24; 168 = semana completa)
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { tendencias, ultimasBusquedas } from "../modulos/tendencias";
import { cacheHeader, envolverAsync } from "./comun";

export const routerTendencias = Router();

routerTendencias.get(
  "/api/v1/tendencias",
  cacheHeader(120),
  envolverAsync(async (req, res) => {
    const ventana = parseInt((req.query.ventana as string) || "24", 10);
    const limite = parseInt((req.query.limite as string) || "20", 10);
    const r = await tendencias({
      ventanaHoras: Number.isFinite(ventana) ? ventana : 24,
      limite: Number.isFinite(limite) ? limite : 20,
    });
    res.json({ ok: true, data: r });
  })
);

/** Últimas búsquedas crudas (para el panel de administración). */
routerTendencias.get(
  "/api/v1/tendencias/busquedas",
  envolverAsync(async (_req, res) => {
    res.json({ ok: true, data: { busquedas: ultimasBusquedas(30) } });
  })
);

export default routerTendencias;
