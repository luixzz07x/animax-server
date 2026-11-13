// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/catalogo — catálogo por idioma
// (latino/sub) y género, con SEMILLA OFFLINE de arranque: si el
// índice aún está frío (deploy nuevo), se muestran los ~48
// títulos semilla para que la app nunca arranque vacía.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { catalogo } from "../lib/animax/registro";
import { catalogoSemilla, resumenSemilla } from "../datos/semillaCatalogo";
import { cacheHeader, envolverAsync } from "./comun";

export const routerCatalogo = Router();

routerCatalogo.get(
  "/api/v1/catalogo",
  cacheHeader(600),
  envolverAsync(async (req, res) => {
    const idiomaParam = req.query.idioma as string | undefined;
    const idioma =
      idiomaParam === "latino" ? "latino" : idiomaParam === "sub" ? "sub" : undefined;
    const genero = (req.query.genero as string) || undefined;
    const tipo = (req.query.tipo as string) || undefined;
    if (idiomaParam && !idioma) {
      res.status(400).json({ ok: false, error: "idioma inválido (latino|sub)" });
      return;
    }
    const r = await catalogo({ idioma, genero, tipo });
    let resultados = r.data?.resultados ?? [];

    // ARRANQUE EN FRÍO: catálogo vivo vacío → semilla offline
    // (v5.1 incluye las 26 películas de semillaPeliculas.ts; con
    // ?tipo=pelicula la semilla también se filtra por tipo).
    let esSemilla = false;
    if (resultados.length < 8) {
      const semilla = catalogoSemilla({ idioma, genero, tipo, limite: 48 });
      // La semilla solo aporta títulos que el índice NO tenga ya
      const conocidos = new Set(resultados.map((t) => t.slug));
      const extra = semilla.filter((t) => !conocidos.has(t.slug));
      if (extra.length > 0) {
        resultados = [...resultados, ...extra];
        esSemilla = true;
      }
    }
    res.json({
      ...r,
      data: { resultados },
      ...(esSemilla ? { semilla: true, semillaInfo: resumenSemilla() } : {}),
    });
  })
);

export default routerCatalogo;
