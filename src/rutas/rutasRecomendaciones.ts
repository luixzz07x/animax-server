// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Router /api/v1/recomendaciones/{slug} — motor de
// "similares" por géneros/año/tipo con distancia Jaccard sobre el
// catálogo unificado (índice + semilla). Motor:
// src/modulos/recomendaciones.ts.
//   GET /api/v1/recomendaciones/{slug}?limite=12&idioma=latino
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { similares } from "../modulos/recomendaciones";
import { cacheHeader, envolverAsync } from "./comun";

export const routerRecomendaciones = Router();

routerRecomendaciones.get(
  "/api/v1/recomendaciones/:slug",
  cacheHeader(300),
  envolverAsync(async (req, res) => {
    const slug = req.params.slug;
    if (!slug || slug.length < 3) {
      res.status(400).json({ ok: false, error: "slug requerido (ded:{titulo} o {fuente}~{slug})" });
      return;
    }
    const limite = parseInt((req.query.limite as string) || "12", 10);
    const idiomaParam = (req.query.idioma as string) || undefined;
    const idioma =
      idiomaParam === "latino" ? "latino" : idiomaParam === "sub" ? "sub" : undefined;
    const r = await similares(slug, {
      limite: Number.isFinite(limite) ? limite : 12,
      idioma,
    });
    res.json({ ok: true, data: r });
  })
);

export default routerRecomendaciones;
