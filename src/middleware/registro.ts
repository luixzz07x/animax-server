// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Middleware de logging por petición.
// Cada request recibe un ID corto (traza) y se registran método,
// ruta, estado y duración. Todo alimenta el bus de eventos
// (/api/v1/estado expone contadores + últimas 200 peticiones).
// ─────────────────────────────────────────────────────────────

import { randomUUID } from "crypto";
import type { RequestHandler } from "express";
import { emitir, peticionesRecientes } from "../core/eventos";

declare module "express-serve-static-core" {
  interface Request {
    /** Traza corta de la petición (8 hex). */
    idTraza?: string;
    /** Momento (epoch ms) en el que entró la petición. */
    inicioPeticion?: number;
  }
}

/** ID corto legible: primeras 8 posiciones del UUID. */
function nuevoIdTraza(): string {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

export const middlewareRegistro: RequestHandler = (req, res, next) => {
  req.idTraza = nuevoIdTraza();
  req.inicioPeticion = Date.now();
  res.header("X-Request-Id", req.idTraza);

  res.on("finish", () => {
    const ms = Date.now() - (req.inicioPeticion ?? Date.now());
    const carga = {
      id: req.idTraza || "-",
      metodo: req.method,
      ruta: req.originalUrl || req.url,
      estado: res.statusCode,
      ms,
      ip: req.ip,
    };
    if (res.statusCode >= 500) {
      emitir("peticion-error", carga);
      console.log(`[http] ${carga.metodo} ${carga.ruta} → ${carga.estado} (${ms}ms) [${carga.id}] ✗`);
    } else if (process.env.LOG_HTTP !== "0") {
      emitir("peticion", carga);
      console.log(`[http] ${carga.metodo} ${carga.ruta} → ${carga.estado} (${ms}ms) [${carga.id}]`);
    }
  });

  next();
};

/** Últimas peticiones (alias para /api/v1/estado). */
export function ultimasPeticiones(): ReturnType<typeof peticionesRecientes> {
  return peticionesRecientes();
}

export default middlewareRegistro;
