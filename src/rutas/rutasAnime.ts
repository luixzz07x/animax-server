// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/anime/:slug — detalle + episodios.
// Fusión multi-fuente con PRIORIDAD LATINO en las fuentes (la
// primera es la que el botón "Reproducir" prueba primero).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { detalleUnificado } from "../lib/animax/registro";
import { cacheHeader, envolverAsync } from "./comun";

export const routerAnime = Router();

routerAnime.get(
  "/api/v1/anime/:slug",
  cacheHeader(3600),
  envolverAsync(async (req, res) => {
    const r = await detalleUnificado(req.params.slug);
    if (!r.ok) {
      res.status(404).json(r);
      return;
    }
    res.json(r);
  })
);

export default routerAnime;
