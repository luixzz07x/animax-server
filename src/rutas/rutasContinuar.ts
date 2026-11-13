// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Router /api/v1/continuar — "continuar viendo" e
// historial por usuario (memoria con TTL 30 días + poda por
// tamaño). Motor: src/modulos/gestionContinuarViendo.ts.
// El usuario se identifica con ?usuario=… (o cabecera x-usuario).
//   POST /api/v1/continuar?usuario= {slug,titulo,episodio,…}
//   GET  /api/v1/continuar?usuario=&limite=20
//   GET  /api/v1/historial?usuario=&pagina=1&limite=30
//   GET  /api/v1/continuar/:slug?usuario=  → progreso de un anime
//   DELETE /api/v1/continuar/:slug?usuario=
//   POST /api/v1/continuar/reiniciar?usuario= → borra TODO
// ─────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from "express";
import {
  marcarProgreso,
  continuarViendo,
  historial,
  olvidar,
  reiniciar,
  progresoDe,
  resumenContinuar,
} from "../modulos/gestionContinuarViendo";
import { envolverAsync } from "./comun";
import type { Idioma } from "../lib/animax/types";

export const routerContinuar = Router();

function usuarioDe(req: Request): string | null {
  const crudo = (req.query.usuario as string) || (req.headers["x-usuario"] as string | undefined) || "";
  const u = crudo.trim();
  if (!u || u.length < 2 || u.length > 64) return null;
  return u.replace(/[^\w@.\-:]/g, "").slice(0, 64);
}

function requerirUsuario(req: Request, res: Response): string | null {
  const usuario = usuarioDe(req);
  if (!usuario) {
    res.status(400).json({ ok: false, error: "usuario requerido: ?usuario=… (2..64 caracteres)" });
    return null;
  }
  return usuario;
}

routerContinuar.post(
  "/api/v1/continuar",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const slug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
    const titulo = typeof req.body?.titulo === "string" ? req.body.titulo.trim() : "";
    const episodio = Number(req.body?.episodio);
    if (!slug || !titulo || !Number.isFinite(episodio) || episodio < 1) {
      res.status(400).json({ ok: false, error: "body requerido: { slug, titulo, episodio ≥ 1 }" });
      return;
    }
    const totalEpisodios = Number(req.body?.totalEpisodios);
    const idiomaCrudo = typeof req.body?.idioma === "string" ? req.body.idioma : "";
    const idioma: Idioma | undefined =
      idiomaCrudo === "latino" || idiomaCrudo === "sub" || idiomaCrudo === "dual"
        ? (idiomaCrudo as Idioma)
        : undefined;
    const progreso = marcarProgreso(usuario, {
      titulo,
      slug,
      portada: typeof req.body?.portada === "string" ? req.body.portada : "",
      episodio: Math.floor(episodio),
      totalEpisodios: Number.isFinite(totalEpisodios) && totalEpisodios > 0 ? Math.floor(totalEpisodios) : undefined,
      idioma,
      enEmision: req.body?.enEmision === true || req.body?.enEmision === "true",
    });
    res.json({ ok: true, data: { usuario, progreso } });
  })
);

routerContinuar.get(
  "/api/v1/continuar",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const limite = parseInt((req.query.limite as string) || "20", 10);
    const pendientes = continuarViendo(usuario, {
      limite: Number.isFinite(limite) ? limite : 20,
    });
    res.json({
      ok: true,
      data: { usuario, total: pendientes.length, pendientes },
      resumen: resumenContinuar(),
    });
  })
);

routerContinuar.get(
  "/api/v1/historial",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const pagina = parseInt((req.query.pagina as string) || "1", 10);
    const limite = parseInt((req.query.limite as string) || "30", 10);
    const h = historial(usuario, {
      pagina: Number.isFinite(pagina) ? pagina : 1,
      limite: Number.isFinite(limite) ? limite : 30,
    });
    res.json({ ok: true, data: { usuario, ...h } });
  })
);

routerContinuar.get(
  "/api/v1/continuar/:slug",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const progreso = progresoDe(usuario, req.params.slug);
    if (!progreso) {
      res.status(404).json({ ok: false, error: "sin progreso para ese anime" });
      return;
    }
    res.json({ ok: true, data: { usuario, progreso } });
  })
);

routerContinuar.delete(
  "/api/v1/continuar/:slug",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const borrado = olvidar(usuario, req.params.slug);
    if (!borrado) {
      res.status(404).json({ ok: false, error: "sin progreso para ese anime" });
      return;
    }
    res.json({ ok: true, data: { usuario, olvidado: req.params.slug } });
  })
);

routerContinuar.post(
  "/api/v1/continuar/reiniciar",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const borrado = reiniciar(usuario);
    res.json({ ok: true, data: { usuario, reiniciado: borrado } });
  })
);

export default routerContinuar;
