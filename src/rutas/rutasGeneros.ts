// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/generos — géneros disponibles con
// conteo (índice local + lista base curada del agregador).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { conCache } from "../lib/animax/cache";
import { generosIndice } from "../lib/animax/indice";
import { cacheHeader, envolverAsync } from "./comun";

export const routerGeneros = Router();

const GENEROS_BASE = [
  "accion", "aventura", "comedia", "drama", "fantasia", "ciencia-ficcion", "misterio",
  "romance", "sobrenatural", "thriller", "deportes", "escolares", "isekai", "mecha",
  "militar", "musica", "psicologico", "slice-of-life", "espacial", "historico",
  "horror", "seinen", "shounen", "shoujo", "josei", "kodomo",
];

routerGeneros.get(
  "/api/v1/generos",
  cacheHeader(3600),
  envolverAsync(async (_req, res) => {
    const data = await conCache("generos", "lista", async () => {
      const delIndice = await generosIndice();
      const mapa = new Map<string, number>();
      for (const g of GENEROS_BASE) mapa.set(g, 0);
      for (const g of delIndice) {
        const clave = g.nombre.toLowerCase().replace(/[^a-zñ]+/g, "-").replace(/^-|-$/g, "");
        mapa.set(clave, Math.max(mapa.get(clave) || 0, g.total));
      }
      return {
        generos: [...mapa.entries()]
          .map(([nombre, total]) => ({ nombre, total }))
          .sort((a, b) => b.total - a.total),
      };
    });
    res.json({ ok: true, data });
  })
);

export default routerGeneros;
