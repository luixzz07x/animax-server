// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Middleware de límites (rate-limit en memoria).
// Ventana deslizante por IP: protege las 22 fuentes de un abuso
// (bots, scrapers de terceros) sin afectar a la app móvil.
//  - API general: ~240 req/min por IP
//  - Proxy de streaming: ~720 req/min (un HLS son decenas de
//    segmentos por episodio; el límite laxo evita cortar el video)
// Sin dependencias: dos Maps y un timer de limpieza.
// ─────────────────────────────────────────────────────────────

import type { RequestHandler } from "express";
import ajustesJson from "../config/ajustes.json";

interface AjustesLimites {
  limites: {
    ventanaMs: number;
    maxPorVentana: number;
    maxPorVentanaStream: number;
  };
}

const AJ = (ajustesJson as unknown as AjustesLimites).limites;

export interface OpcionesLimites {
  ventanaMs?: number;
  max?: number;
  /** true = no eximir health/estado/stream (para el limitador laxo del proxy). */
  sinExenciones?: boolean;
}

/** Fabrica un limitador con ventana deslizante por IP. */
export function middlewareLimites(op: OpcionesLimites = {}): RequestHandler {
  const ventanaMs = op.ventanaMs ?? AJ.ventanaMs ?? 60000;
  const max = op.max ?? AJ.maxPorVentana ?? 240;
  const marcas = new Map<string, number[]>();

  // Limpieza periódica de IPs inactivas (evita fuga de memoria)
  const t = setInterval(() => {
    const corte = Date.now() - ventanaMs;
    for (const [ip, marcas2] of marcas) {
      const vivas = marcas2.filter((m) => m > corte);
      if (vivas.length === 0) marcas.delete(ip);
      else if (vivas.length !== marcas2.length) marcas.set(ip, vivas);
    }
  }, Math.max(ventanaMs, 30000));
  if (typeof t.unref === "function") t.unref();

  return (req, res, next) => {
    if (req.method === "OPTIONS") {
      next();
      return;
    }
    if (!op.sinExenciones) {
      // El healthcheck raíz siempre pasa (lo usa Render para despertar) y
      // el proxy de streaming tiene SU limitador laxo (limitesStream).
      if (
        req.path === "/" ||
        req.path === "/api/v1/salud" ||
        req.path === "/api/v1/estado" ||
        req.path.startsWith("/api/v1/stream")
      ) {
        next();
        return;
      }
    }
    const ip = req.ip || req.socket.remoteAddress || "desconocida";
    const ahora = Date.now();
    const previas = (marcas.get(ip) || []).filter((m) => m > ahora - ventanaMs);
    if (previas.length >= max) {
      const reintentar = Math.ceil((ventanaMs - (ahora - previas[0])) / 1000);
      res.status(429).json({
        ok: false,
        error: `demasiadas peticiones: máximo ${max}/${Math.round(ventanaMs / 1000)}s`,
        reintentarEnSeg: Math.max(1, reintentar),
      });
      res.header("Retry-After", String(Math.max(1, reintentar)));
      return;
    }
    previas.push(ahora);
    marcas.set(ip, previas);
    res.header("X-RateLimit-Limit", String(max));
    res.header("X-RateLimit-Restantes", String(max - previas.length));
    next();
  };
}

/** Limitador para la API general (montado en index.ts). */
export const limitesApi: RequestHandler = middlewareLimites();

/** Limitador laxo para el proxy de streaming (segmentos HLS). */
export const limitesStream: RequestHandler = middlewareLimites({
  max: AJ.maxPorVentanaStream ?? 720,
  sinExenciones: true,
});

export default limitesApi;
