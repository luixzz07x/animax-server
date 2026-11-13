// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · LISTAS PERSONALIZADAS de usuario (favoritos,
// "viendo después" y listas propias con nombre). CRUD completo
// EN MEMORIA + persistencia a archivo JSON en data/ (best-effort,
// igual que los dominios y el índice: si el FS es read-only, como
// en el plan free de Render tras un restart, todo sigue funcionando
// en memoria). Límites por usuario: 20 listas · 300 items/lista.
// ─────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";

export interface ItemLista {
  slug: string;
  titulo: string;
  portada: string;
  anadido: number; // epoch ms
  nota?: string; // comentario corto del usuario
}

export interface ListaUsuario {
  nombre: string; // identificador (minúsculas, sin espacios raros)
  titulo: string; // etiqueta legible
  creada: number;
  items: ItemLista[];
}

export interface UsuarioListas {
  usuario: string;
  listas: Map<string, ListaUsuario>; // nombre → lista
  ultimoAcceso: number;
}

const DIR_DATOS = path.join(process.cwd(), "data");
const ARCHIVO = path.join(DIR_DATOS, "listas-usuarios.json");
const MAX_LISTAS = 20;
const MAX_ITEMS = 300;

const usuarios = new Map<string, UsuarioListas>();

// ── Persistencia best-effort ───────────────────────────────────

interface Serializada {
  usuarios: {
    usuario: string;
    listas: ListaUsuario[];
    ultimoAcceso: number;
  }[];
}

function cargar(): void {
  try {
    if (!fs.existsSync(ARCHIVO)) return;
    const data = JSON.parse(fs.readFileSync(ARCHIVO, "utf8")) as Serializada;
    for (const u of data.usuarios || []) {
      const listas = new Map<string, ListaUsuario>();
      for (const l of u.listas || []) {
        if (l && typeof l.nombre === "string" && Array.isArray(l.items)) {
          listas.set(l.nombre, l);
        }
      }
      usuarios.set(u.usuario, {
        usuario: u.usuario,
        listas,
        ultimoAcceso: u.ultimoAcceso || Date.now(),
      });
    }
  } catch {
    /* sin persistencia válida: se arranca limpio */
  }
}

let temporizador: ReturnType<typeof setInterval> | null = null;

function persistir(): void {
  try {
    if (!fs.existsSync(DIR_DATOS)) fs.mkdirSync(DIR_DATOS, { recursive: true });
    const data: Serializada = {
      usuarios: [...usuarios.values()].map((u) => ({
        usuario: u.usuario,
        listas: [...u.listas.values()],
        ultimoAcceso: u.ultimoAcceso,
      })),
    };
    fs.writeFileSync(ARCHIVO, JSON.stringify(data));
  } catch {
    /* best-effort: FS read-only (plan free de Render tras restart) */
  }
}

/** Arranca el guardado periódico (lo llama el router al montarse). */
export function iniciarPersistencia(): void {
  if (temporizador) return;
  cargar();
  temporizador = setInterval(() => persistir(), 60000);
  if (typeof temporizador.unref === "function") temporizador.unref();
}

function usuarioDe(usuario: string): UsuarioListas {
  let u = usuarios.get(usuario);
  if (!u) {
    u = { usuario, listas: new Map(), ultimoAcceso: Date.now() };
    usuarios.set(usuario, u);
  }
  u.ultimoAcceso = Date.now();
  return u;
}

function normalizarNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ── CRUD ──────────────────────────────────────────────────────

/** Crea una lista (nombres reservados favoritos y ver-despues se
 *  garantizan con su título legible). */
export function crearLista(
  usuario: string,
  nombre: string,
  titulo?: string
): ListaUsuario | { error: string } {
  const u = usuarioDe(usuario);
  const n = normalizarNombre(nombre);
  if (!n) return { error: "nombre de lista inválido" };
  if (u.listas.size >= MAX_LISTAS && !u.listas.has(n)) {
    return { error: `máximo ${MAX_LISTAS} listas por usuario` };
  }
  const existente = u.listas.get(n);
  if (existente) return existente;
  const lista: ListaUsuario = {
    nombre: n,
    titulo: titulo?.trim().slice(0, 60) || n,
    creada: Date.now(),
    items: [],
  };
  u.listas.set(n, lista);
  return lista;
}

/** Garantiza las listas base (favoritos / ver-despues). */
function listaBase(u: UsuarioListas, nombre: "favoritos" | "ver-despues"): ListaUsuario {
  const existente = u.listas.get(nombre);
  if (existente) return existente;
  const lista: ListaUsuario = {
    nombre,
    titulo: nombre === "favoritos" ? "Favoritos" : "Viendo después",
    creada: Date.now(),
    items: [],
  };
  u.listas.set(nombre, lista);
  return lista;
}

/** Añade un anime a una lista (la crea si no existe). */
export function agregarALista(
  usuario: string,
  nombre: string,
  item: { slug: string; titulo: string; portada?: string; nota?: string }
): { ok: boolean; error?: string } {
  const u = usuarioDe(usuario);
  const n = normalizarNombre(nombre);
  if (!n) return { ok: false, error: "nombre de lista inválido" };
  if (!item.slug || !item.titulo) return { ok: false, error: "slug y titulo requeridos" };
  let lista = u.listas.get(n);
  if (!lista && (n === "favoritos" || n === "ver-despues")) lista = listaBase(u, n);
  if (!lista) lista = crearLista(usuario, n) as ListaUsuario;
  if (!("items" in lista)) return { ok: false, error: "no se pudo crear la lista" };
  if (lista.items.some((i) => i.slug === item.slug)) {
    return { ok: false, error: "ya está en la lista" };
  }
  if (lista.items.length >= MAX_ITEMS) {
    return { ok: false, error: `máximo ${MAX_ITEMS} items por lista` };
  }
  lista.items.push({
    slug: item.slug,
    titulo: item.titulo,
    portada: item.portada || "",
    anadido: Date.now(),
    nota: item.nota?.slice(0, 140),
  });
  return { ok: true };
}

/** Quita un anime de una lista. */
export function quitarDeLista(usuario: string, nombre: string, slug: string): boolean {
  const u = usuarios.get(usuario);
  if (!u) return false;
  const lista = u.listas.get(normalizarNombre(nombre));
  if (!lista) return false;
  const antes = lista.items.length;
  lista.items = lista.items.filter((i) => i.slug !== slug);
  return lista.items.length < antes;
}

/** Elimina una lista completa (las base no se pueden borrar). */
export function eliminarLista(usuario: string, nombre: string): boolean {
  const u = usuarios.get(usuario);
  if (!u) return false;
  const n = normalizarNombre(nombre);
  if (n === "favoritos" || n === "ver-despues") return false;
  return u.listas.delete(n);
}

/** Una lista concreta. */
export function obtenerLista(usuario: string, nombre: string): ListaUsuario | null {
  const u = usuarios.get(usuario);
  if (!u) return null;
  return u.listas.get(normalizarNombre(nombre)) ?? null;
}

/** Todas las listas del usuario (garantiza favoritos/ver-despues). */
export function listasDe(usuario: string): ListaUsuario[] {
  const u = usuarioDe(usuario);
  listaBase(u, "favoritos");
  listaBase(u, "ver-despues");
  return [...u.listas.values()].sort((a, b) => b.creada - a.creada);
}

/** Mueve un anime de una lista a otra (p. ej. a "viendo después"). */
export function moverEntreListas(
  usuario: string,
  de: string,
  a: string,
  slug: string
): { ok: boolean; error?: string } {
  const origen = obtenerLista(usuario, de);
  if (!origen) return { ok: false, error: "lista origen inexistente" };
  const item = origen.items.find((i) => i.slug === slug);
  if (!item) return { ok: false, error: "el anime no está en la lista origen" };
  const r = agregarALista(usuario, a, {
    slug: item.slug,
    titulo: item.titulo,
    portada: item.portada,
    nota: item.nota,
  });
  if (!r.ok) return r;
  quitarDeLista(usuario, de, slug);
  return { ok: true };
}

/** Resumen para /api/v1/estado. */
export function resumenListas(): {
  usuarios: number;
  listas: number;
  items: number;
  persistencia: string;
} {
  let listas = 0;
  let items = 0;
  for (const u of usuarios.values()) {
    listas += u.listas.size;
    for (const l of u.listas.values()) items += l.items.length;
  }
  return {
    usuarios: usuarios.size,
    listas,
    items,
    persistencia: ARCHIVO,
  };
}

/** Fuerza un guardado manual (lo llama la API admin). */
export function guardarAhora(): void {
  persistir();
}

export default listasDe;
