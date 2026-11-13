// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Manejo centralizado de errores.
//  - envolverAsync: convierte un handler async en uno seguro para
//    Express 4 (que no captura promesas rechazadas solo).
//  - noEncontrado: 404 JSON para /api (la app móvil lee JSON siempre).
//  - manejadorErrores: catch-all con traza de la petición; nunca
//    deja caer la conexión sin cuerpo JSON.
// ─────────────────────────────────────────────────────────────

import type { ErrorRequestHandler, RequestHandler, NextFunction, Request, Response } from "express";
import { emitir } from "../core/eventos";

/** Envoltorio de handlers async con try/catch garantizado. */
export function envolverAsync<T extends RequestHandler>(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch((e: unknown) => next(e));
  };
}

/** 404 de API: cualquier /api/* desconocido responde JSON. */
export const noEncontrado: RequestHandler = (req, res) => {
  res.status(404).json({
    ok: false,
    error: "endpoint no encontrado",
    ruta: req.originalUrl,
    documentacion: "GET /api/v1 → lista de endpoints",
  });
};

/** Catch-all: nunca lanza, siempre JSON + traza. */
export const manejadorErrores: ErrorRequestHandler = (err, req, res, _next) => {
  const mensaje = err instanceof Error ? err.message : String(err);
  const traza = req.idTraza || "-";
  emitir("peticion-error", {
    id: traza,
    metodo: req.method,
    ruta: req.originalUrl || req.url,
    estado: 500,
    ms: 0,
    ip: req.ip,
  });
  // Errores de JSON malformado en el body (POST /api/v1/dominios…)
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ ok: false, error: "JSON del body inválido", traza });
    return;
  }
  console.log(`[error] [${traza}] ${req.method} ${req.originalUrl}: ${mensaje}`);
  if (!res.headersSent) {
    res.status(500).json({ ok: false, error: "error interno del servidor", detalle: mensaje, traza });
  } else {
    res.end();
  }
};

export default { noEncontrado, manejadorErrores, envolverAsync };
