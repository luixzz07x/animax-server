// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Middleware de seguridad (headers HTTP).
// Endurecimiento estándar de una API pública: sin sniffing, sin
// framing, sin referrer, sin powered-by y política de recursos
// cruzados abierta (el proxy de streaming sirve video a frontends
// de terceros).
// ─────────────────────────────────────────────────────────────

import type { RequestHandler } from "express";

export const middlewareSeguridad: RequestHandler = (_req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "SAMEORIGIN");
  res.header("Referrer-Policy", "no-referrer");
  res.header("Cross-Origin-Resource-Policy", "cross-origin");
  res.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  // La API solo sirve JSON y streams: sin caché de cliente sensible
  if (!_req.path.startsWith("/api/v1/stream")) {
    res.header("X-Robots-Tag", "noindex");
  }
  next();
};

export default middlewareSeguridad;
