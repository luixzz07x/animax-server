// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/servidores/:slug/:ep — servidores
// del episodio con link directo EXTRAÍDO y VERIFICADO, idioma
// (latino primero) y streamUrl apuntando al proxy propio.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { servidoresUnificados } from "../lib/animax/registro";
import { cacheHeader, envolverAsync } from "./comun";

export const routerServidores = Router();

routerServidores.get(
  "/api/v1/servidores/:slug/:ep",
  cacheHeader(3600),
  envolverAsync(async (req, res) => {
    const ep = parseInt(req.params.ep, 10);
    if (Number.isNaN(ep) || ep < 1) {
      res.status(400).json({ ok: false, error: "episodio inválido" });
      return;
    }
    const r = await servidoresUnificados(req.params.slug, ep);
    if (!r.ok) {
      res.status(404).json(r);
      return;
    }
    res.json(r);
  })
);

export default routerServidores;
