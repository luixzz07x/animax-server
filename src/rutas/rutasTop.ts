// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Router /api/v1/top/{tipo} — tops con paginación:
// mejor valorados, más vistos, por género y por década. Motor:
// src/modulos/listasTop.ts (corpus = índice + semilla; valoración
// curada; "vistos" = frecuencia en el feed de últimos episodios).
//   GET /api/v1/top/valorados?pagina=1&limite=20&idioma=latino
//   GET /api/v1/top/vistos
//   GET /api/v1/top/genero?genero=accion
//   GET /api/v1/top/decada?decada=1990s
//   GET /api/v1/top/decadas → décadas disponibles con conteo
//   GET /api/v1/top         → resumen de tops disponibles
// ─────────────────────────────────────────────────────────────

import { Router, type Request } from "express";
import { topValorados, topVistos, topGenero, topDecada, decadasDisponibles } from "../modulos/listasTop";
import { cacheHeader, envolverAsync } from "./comun";

export const routerTop = Router();

function leerPagina(req: Request): number {
  const p = parseInt(String(req.query.pagina || "1"), 10);
  return Number.isFinite(p) ? p : 1;
}

function leerLimite(req: Request): number {
  const l = parseInt(String(req.query.limite || "20"), 10);
  return Number.isFinite(l) ? l : 20;
}

function leerIdioma(req: Request): "latino" | "sub" | undefined {
  const i = String(req.query.idioma || "");
  if (i === "latino") return "latino";
  if (i === "sub") return "sub";
  return undefined;
}

routerTop.get(
  "/api/v1/top",
  cacheHeader(300),
  envolverAsync(async (_req, res) => {
    const decadas = await decadasDisponibles();
    res.json({
      ok: true,
      data: {
        tops: [
          "valorados",
          "vistos",
          "genero (requiere ?genero=)",
          "decada (requiere ?decada=)",
        ],
        decadas,
        ejemplo: "/api/v1/top/valorados?pagina=1&limite=20",
      },
    });
  })
);

routerTop.get(
  "/api/v1/top/valorados",
  cacheHeader(300),
  envolverAsync(async (req, res) => {
    const r = await topValorados({
      pagina: leerPagina(req),
      limite: leerLimite(req),
      idioma: leerIdioma(req),
    });
    res.json({ ok: true, data: r });
  })
);

routerTop.get(
  "/api/v1/top/vistos",
  cacheHeader(120),
  envolverAsync(async (req, res) => {
    const r = await topVistos({
      pagina: leerPagina(req),
      limite: leerLimite(req),
      idioma: leerIdioma(req),
    });
    res.json({ ok: true, data: r });
  })
);

routerTop.get(
  "/api/v1/top/genero",
  cacheHeader(300),
  envolverAsync(async (req, res) => {
    const genero = (req.query.genero as string) || "";
    if (!genero || genero.trim().length < 3) {
      res.status(400).json({ ok: false, error: "parámetro genero requerido (p. ej. ?genero=accion)" });
      return;
    }
    const r = await topGenero(genero, {
      pagina: leerPagina(req),
      limite: leerLimite(req),
      idioma: leerIdioma(req),
    });
    res.json({ ok: true, data: r });
  })
);

routerTop.get(
  "/api/v1/top/decada",
  cacheHeader(300),
  envolverAsync(async (req, res) => {
    const decada = (req.query.decada as string) || "";
    if (!decada || !/^\d{2,4}s?$/.test(decada.trim())) {
      res.status(400).json({ ok: false, error: "parámetro decada requerido (p. ej. ?decada=1990s o ?decada=90)" });
      return;
    }
    const r = await topDecada(decada, {
      pagina: leerPagina(req),
      limite: leerLimite(req),
      idioma: leerIdioma(req),
    });
    res.json({ ok: true, data: r });
  })
);

routerTop.get(
  "/api/v1/top/decadas",
  cacheHeader(300),
  envolverAsync(async (_req, res) => {
    const decadas = await decadasDisponibles();
    res.json({ ok: true, data: { decadas } });
  })
);

export default routerTop;
