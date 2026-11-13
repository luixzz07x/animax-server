// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · CONTINUAR VIENDO (historial en memoria con TTL y
// poda por tamaño). Cada "usuario" (id de cliente, API key o
// perfil de la app móvil) tiene su línea de tiempo de episodios:
//   · marcarProgreso → upsert del anime en cabeza del historial
//   · continuarViendo → los N que no terminó, más reciente primero
//   · historial → el registro completo paginado
// Límites de memoria (diseñado para el plan free de Render):
//   · 30 días de TTL por entrada
//   · máx. 120 animes activos por usuario (poda FIFO)
//   · máx. 400 usuarios (poda LRU global)
// ─────────────────────────────────────────────────────────────

import type { Idioma } from "../lib/animax/types";

export interface ProgresoUsuario {
  titulo: string;
  slug: string;
  portada: string;
  /** Último episodio visto. */
  episodio: number;
  /** Total de episodios declarado por las fuentes (si se conoce). */
  totalEpisodios?: number;
  idioma?: Idioma;
  /** ¿Sigue en emisión / pendiente de terminar? */
  enEmision?: boolean;
  actualizado: number; // epoch ms
  /** epoch ms en que caduca (TTL). */
  expira: number;
}

interface Usuario {
  porSlug: Map<string, ProgresoUsuario>; // slug → progreso (orden = uso)
  ultimoAcceso: number;
}

const TTL_MS = 30 * 24 * 3600 * 1000; // 30 días
const MAX_POR_USUARIO = 120;
const MAX_USUARIOS = 400;

const usuarios = new Map<string, Usuario>();

function usuarioDe(id: string): Usuario {
  let u = usuarios.get(id);
  if (!u) {
    u = { porSlug: new Map(), ultimoAcceso: Date.now() };
    usuarios.set(id, u);
    podarUsuarios();
  }
  u.ultimoAcceso = Date.now();
  return u;
}

/** Poda global LRU: si hay demasiados usuarios, se van los más viejos. */
function podarUsuarios(): void {
  if (usuarios.size <= MAX_USUARIOS) return;
  const ordenados = [...usuarios.entries()].sort((a, b) => a[1].ultimoAcceso - b[1].ultimoAcceso);
  const aEliminar = usuarios.size - MAX_USUARIOS;
  for (let i = 0; i < aEliminar; i++) {
    const [id] = ordenados[i];
    usuarios.delete(id);
  }
}

/** Elimina las entradas caducadas de un usuario (poda por TTL). */
function podarExpirados(u: Usuario): void {
  const ahora = Date.now();
  for (const [slug, p] of u.porSlug) {
    if (ahora > p.expira) u.porSlug.delete(slug);
  }
}

/** Poda por tamaño: se queda con los MAX_POR_USUARIO más recientes. */
function podarPorTamano(u: Usuario): void {
  if (u.porSlug.size <= MAX_POR_USUARIO) return;
  const ordenados = [...u.porSlug.entries()].sort((a, b) => b[1].actualizado - a[1].actualizado);
  const aEliminar = u.porSlug.size - MAX_POR_USUARIO;
  for (let i = 0; i < aEliminar; i++) {
    const [slug] = ordenados[ordenados.length - 1 - i];
    u.porSlug.delete(slug);
  }
}

/** Marca/actualiza el progreso de un anime para un usuario. */
export function marcarProgreso(
  usuario: string,
  progreso: Omit<ProgresoUsuario, "actualizado" | "expira"> & { actualizado?: number }
): ProgresoUsuario {
  const u = usuarioDe(usuario);
  const ahora = progreso.actualizado ?? Date.now();
  const entrada: ProgresoUsuario = {
    titulo: progreso.titulo,
    slug: progreso.slug,
    portada: progreso.portada,
    episodio: Math.max(1, Math.floor(progreso.episodio || 1)),
    totalEpisodios: progreso.totalEpisodios,
    idioma: progreso.idioma,
    enEmision: progreso.enEmision,
    actualizado: ahora,
    expira: ahora + TTL_MS,
  };
  // upsert conservando posición de "más usado" (delete+set lo reordena)
  u.porSlug.delete(entrada.slug);
  u.porSlug.set(entrada.slug, entrada);
  podarExpirados(u);
  podarPorTamano(u);
  return { ...entrada };
}

/** "Continuar viendo": pendientes (no terminados), más reciente primero. */
export function continuarViendo(
  usuario: string,
  op: { limite?: number } = {}
): ProgresoUsuario[] {
  const u = usuarios.get(usuario);
  if (!u) return [];
  podarExpirados(u);
  const limite = Math.min(Math.max(op.limite ?? 20, 1), 100);
  return [...u.porSlug.values()]
    .filter((p) => {
      const terminado = p.totalEpisodios !== undefined && p.episodio >= p.totalEpisodios;
      return !terminado;
    })
    .sort((a, b) => b.actualizado - a.actualizado)
    .slice(0, limite);
}

/** Historial completo (incluye terminados), paginado. */
export function historial(
  usuario: string,
  op: { pagina?: number; limite?: number } = {}
): { pagina: number; limite: number; total: number; resultados: ProgresoUsuario[] } {
  const u = usuarios.get(usuario);
  const limite = Math.min(Math.max(op.limite ?? 30, 1), 100);
  const pagina = Math.max(1, Math.floor(op.pagina ?? 1));
  if (!u) return { pagina, limite, total: 0, resultados: [] };
  podarExpirados(u);
  const lista = [...u.porSlug.values()].sort((a, b) => b.actualizado - a.actualizado);
  const inicio = (pagina - 1) * limite;
  return {
    pagina,
    limite,
    total: lista.length,
    resultados: lista.slice(inicio, inicio + limite),
  };
}

/** Borra un anime del historial de un usuario. */
export function olvidar(usuario: string, slug: string): boolean {
  const u = usuarios.get(usuario);
  if (!u) return false;
  return u.porSlug.delete(slug);
}

/** Borra TODO el historial de un usuario. */
export function reiniciar(usuario: string): boolean {
  return usuarios.delete(usuario);
}

/** Un progreso concreto (para retomar exactamente donde iba). */
export function progresoDe(usuario: string, slug: string): ProgresoUsuario | null {
  return usuarios.get(usuario)?.porSlug.get(slug) ?? null;
}

/** Resumen para /api/v1/estado (uso de memoria del módulo). */
export function resumenContinuar(): {
  usuarios: number;
  entradas: number;
  ttlDias: number;
  maxPorUsuario: number;
} {
  let entradas = 0;
  for (const u of usuarios.values()) entradas += u.porSlug.size;
  return {
    usuarios: usuarios.size,
    entradas,
    ttlDias: Math.round(TTL_MS / (24 * 3600 * 1000)),
    maxPorUsuario: MAX_POR_USUARIO,
  };
}

export default marcarProgreso;
