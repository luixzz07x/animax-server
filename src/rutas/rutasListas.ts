// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Router /api/v1/listas — listas personalizadas de
// usuario (favoritos, "viendo después" y listas propias) con CRUD
// en memoria + persistencia JSON en data/. Motor:
// src/modulos/listasUsuario.ts.
// El usuario se identifica con ?usuario=… (o cabecera x-usuario).
//   GET    /api/v1/listas?usuario=            → todas sus listas
//   POST   /api/v1/listas?usuario= {nombre,titulo?}
//   GET    /api/v1/listas/:nombre?usuario=    → una lista + items
//   DELETE /api/v1/listas/:nombre?usuario=    → borra la lista
//   POST   /api/v1/listas/:nombre/items?usuario= {slug,titulo,…}
//   DELETE /api/v1/listas/:nombre/items/:slug?usuario=
//   POST   /api/v1/listas/mover?usuario= {de,a,slug}
// ─────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from "express";
import {
  crearLista,
  agregarALista,
  quitarDeLista,
  eliminarLista,
  obtenerLista,
  listasDe,
  moverEntreListas,
  iniciarPersistencia,
  resumenListas,
  guardarAhora,
  type ListaUsuario,
} from "../modulos/listasUsuario";
import { envolverAsync } from "./comun";

export const routerListas = Router();

// La persistencia se arranca al montar el router (carga inicial
// + guardado cada 60 s).
iniciarPersistencia();

/** Usuario de la petición: ?usuario= o cabecera x-usuario. */
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

routerListas.get(
  "/api/v1/listas",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const listas: ListaUsuario[] = listasDe(usuario);
    res.json({
      ok: true,
      data: {
        usuario,
        total: listas.length,
        listas: listas.map((l) => ({
          nombre: l.nombre,
          titulo: l.titulo,
          items: l.items.length,
          creada: l.creada,
        })),
      },
      resumen: resumenListas(),
    });
  })
);

routerListas.post(
  "/api/v1/listas",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const nombre = typeof req.body?.nombre === "string" ? req.body.nombre : "";
    const titulo = typeof req.body?.titulo === "string" ? req.body.titulo : undefined;
    if (!nombre || nombre.trim().length < 2) {
      res.status(400).json({ ok: false, error: "body requerido: { nombre } (2+ caracteres)" });
      return;
    }
    const r = crearLista(usuario, nombre, titulo);
    if ("error" in r) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    guardarAhora();
    res.json({ ok: true, data: { lista: r } });
  })
);

routerListas.get(
  "/api/v1/listas/:nombre",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const lista = obtenerLista(usuario, req.params.nombre);
    if (!lista) {
      res.status(404).json({ ok: false, error: "lista inexistente" });
      return;
    }
    res.json({
      ok: true,
      data: {
        usuario,
        lista: {
          nombre: lista.nombre,
          titulo: lista.titulo,
          creada: lista.creada,
          items: [...lista.items].sort((a, b) => b.anadido - a.anadido),
        },
      },
    });
  })
);

routerListas.delete(
  "/api/v1/listas/:nombre",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const nombre = req.params.nombre;
    if (nombre === "favoritos" || nombre === "ver-despues") {
      res.status(400).json({ ok: false, error: "las listas favoritos y ver-despues no se pueden borrar (usa los items)" });
      return;
    }
    const borrada = eliminarLista(usuario, nombre);
    if (!borrada) {
      res.status(404).json({ ok: false, error: "lista inexistente" });
      return;
    }
    guardarAhora();
    res.json({ ok: true, data: { usuario, borrada } });
  })
);

routerListas.post(
  "/api/v1/listas/:nombre/items",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const slug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
    const titulo = typeof req.body?.titulo === "string" ? req.body.titulo.trim() : "";
    const portada = typeof req.body?.portada === "string" ? req.body.portada : "";
    const nota = typeof req.body?.nota === "string" ? req.body.nota : undefined;
    if (!slug || !titulo) {
      res.status(400).json({ ok: false, error: "body requerido: { slug, titulo }" });
      return;
    }
    const r = agregarALista(usuario, req.params.nombre, { slug, titulo, portada, nota });
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    const lista = obtenerLista(usuario, req.params.nombre);
    guardarAhora();
    res.json({
      ok: true,
      data: { usuario, lista: lista?.nombre, items: lista?.items.length ?? 0 },
    });
  })
);

routerListas.delete(
  "/api/v1/listas/:nombre/items/:slug",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const quitado = quitarDeLista(usuario, req.params.nombre, req.params.slug);
    if (!quitado) {
      res.status(404).json({ ok: false, error: "el anime no está en esa lista (o la lista no existe)" });
      return;
    }
    guardarAhora();
    res.json({ ok: true, data: { usuario, quitado: req.params.slug } });
  })
);

routerListas.post(
  "/api/v1/listas/mover",
  envolverAsync(async (req, res) => {
    const usuario = requerirUsuario(req, res);
    if (!usuario) return;
    const de = typeof req.body?.de === "string" ? req.body.de : "";
    const a = typeof req.body?.a === "string" ? req.body.a : "";
    const slug = typeof req.body?.slug === "string" ? req.body.slug : "";
    if (!de || !a || !slug) {
      res.status(400).json({ ok: false, error: "body requerido: { de, a, slug }" });
      return;
    }
    const r = moverEntreListas(usuario, de, a, slug);
    if (!r.ok) {
      res.status(400).json({ ok: false, error: r.error });
      return;
    }
    guardarAhora();
    res.json({ ok: true, data: { usuario, movidoDe: de, hacia: a, slug } });
  })
);

export default routerListas;
