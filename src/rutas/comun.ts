// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Utilidades comunes de los routers.
//  - cacheHeader: cabecera Cache-Control pública por ruta.
//  - envolverAsync: handlers async seguros (reexportado).
// ─────────────────────────────────────────────────────────────

import type { RequestHandler } from "express";
import { envolverAsync } from "../middleware/errores";

/** Cabecera Cache-Control pública con TTL en segundos. */
export function cacheHeader(seg: number): RequestHandler {
  return (_req, res, next) => {
    res.header("Cache-Control", `public, max-age=${seg}`);
    next();
  };
}

export { envolverAsync };
