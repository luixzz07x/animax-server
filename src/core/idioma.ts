// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Resolución de idioma con PRIORIDAD LATINO.
// Regla de negocio del agregador: si CUALQUIER fuente del grupo
// latino (o dual) tiene el anime, el resultado unificado se marca
// "latino" y se ordena por delante del sub puro. Este módulo
// centraliza esa regla para catálogos, detalles y ordenaciones.
// ─────────────────────────────────────────────────────────────

import fuentesJson from "../config/fuentes.json";
import type { Idioma } from "../lib/animax/types";

interface FuenteCfg {
  id: string;
  idioma: string;
  grupo: string;
}

const FUENTES = (fuentesJson as unknown as { fuentes: FuenteCfg[] }).fuentes;

const GRUPO: Record<string, string> = Object.fromEntries(
  FUENTES.map((f) => [f.id, f.grupo])
);

/** Grupo de una fuente: "latino" | "dual" | "sub". */
export function grupoDe(fuenteId: string): "latino" | "dual" | "sub" {
  const g = GRUPO[fuenteId];
  if (g === "latino" || g === "dual") return g;
  return "sub";
}

/** true si la fuente lleva audio latino (grupo latino o dual). */
export function llevaLatino(fuenteId: string): boolean {
  return grupoDe(fuenteId) !== "sub";
}

export interface RefIdioma {
  fuente: string;
  idioma: Idioma;
}

/**
 * Idioma unificado de un anime a partir de sus fuentes:
 *  - si CUALQUIER fuente del GRUPO LATINO lo tiene → "latino"
 *  - si además hay una fuente sub → "dual"
 *  - si no → "sub"
 */
export function resolverIdioma(refs: RefIdioma[]): Idioma {
  let tieneLatino = false;
  let tieneSub = false;
  for (const r of refs) {
    const grupo = GRUPO[r.fuente];
    const efectivo = r.idioma === "latino" ? "latino" : grupo === "latino" ? "latino" : r.idioma === "dual" || grupo === "dual" ? "dual" : "sub";
    if (efectivo === "latino") tieneLatino = true;
    else if (efectivo === "dual") {
      tieneLatino = true;
      tieneSub = true;
    } else tieneSub = true;
  }
  if (tieneLatino && tieneSub) return "dual";
  if (tieneLatino) return "latino";
  return "sub";
}

/** Preferencia numérica de idioma (latino=0, dual=1, sub=2). */
export function preferenciaIdioma(i: Idioma): number {
  return i === "latino" ? 0 : i === "dual" ? 1 : 2;
}

/**
 * Ordena una lista con PRIORIDAD LATINO: primero "latino", luego
 * "dual", luego "sub". El orden relativo dentro de cada grupo se
 * mantiene (ordenación estable).
 */
export function priorizarLatino<T extends { idioma: Idioma }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => preferenciaIdioma(a.idioma) - preferenciaIdioma(b.idioma));
}

/** Prioriza también las FUENTES de un anime (para el orden del
 *  "Reproducir": la fuente latina se prueba primero). */
export function priorizarFuentes<T extends RefIdioma>(fuentes: T[]): T[] {
  return [...fuentes].sort((a, b) => {
    const ea = efectivoDe(a);
    const eb = efectivoDe(b);
    return preferenciaIdioma(ea) - preferenciaIdioma(eb);
  });
}

/** Idioma efectivo de una ref: combina lo que declara con su grupo. */
export function efectivoDe(r: RefIdioma): Idioma {
  const grupo = GRUPO[r.fuente];
  if (r.idioma === "latino") return "latino";
  if (r.idioma === "dual" || grupo === "dual") return "dual";
  if (grupo === "latino") return "latino";
  return "sub";
}

/** Etiqueta legible del idioma para UI. */
export function etiquetaIdioma(i: Idioma): string {
  if (i === "latino") return "Audio Latino";
  if (i === "dual") return "Latino + Sub";
  return "Subtitulado";
}

/** Puntuación de idioma para mezclar en rankings de relevancia:
 *  latino +30 · dual +18 · sub +0. */
export function bonificacionLatino(i: Idioma): number {
  return i === "latino" ? 30 : i === "dual" ? 18 : 0;
}
