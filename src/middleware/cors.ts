// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Middleware CORS.
// La app móvil (Android) y cualquier frontend web consumen la API
// desde cualquier origen: CORS totalmente abierto, exponiendo los
// headers de streaming (Range/Content-Range) que el reproductor
// propio necesita para hacer seek.
// ─────────────────────────────────────────────────────────────

import type { RequestHandler } from "express";

export const middlewareCors: RequestHandler = (_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Range");
  res.header(
    "Access-Control-Expose-Headers",
    "Content-Range, Accept-Ranges, Content-Length, Content-Type"
  );
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
};

export default middlewareCors;
