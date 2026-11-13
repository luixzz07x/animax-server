// ─────────────────────────────────────────────────────────────
// ANIMAX · Deduplicación multi-fuente.
// "Jujutsu Kaisen" en 6 fuentes → UNA tarjeta con 6 referencias.
// Clave: título normalizado (sin acentos/puntuación/season-suffix).
// ─────────────────────────────────────────────────────────────

import tuningJson from "./fuentes.json";
import { normalizarTitulo } from "./http";
import type { AnimeCard, AnimeFuenteRef, EpisodioFeed, Idioma } from "./types";

const CFG = tuningJson as unknown as {
  fuentes: { id: string; grupo: string }[];
};

/** Grupo de idioma de cada fuente según fuentes.json:
 *  "latino" (solo latino) · "dual" (latino+sub) · "sub" (solo sub). */
const GRUPO: Record<string, string> = Object.fromEntries(
  CFG.fuentes.map((f) => [f.id, f.grupo])
);

export function slugDeduplicado(titulo: string): string {
  return `ded:${normalizarTitulo(titulo)}`;
}

/** Grupo de fuentes.json de una fuente ("latino" | "dual" | "sub"). */
export function grupoDeFuente(idFuente: string): string {
  return GRUPO[idFuente] || "sub";
}

/** Idioma efectivo de una referencia de fuente: combina lo que declara el
 *  scraper con el GRUPO de fuentes.json (animeflv/tioanime/monoschinos son
 *  grupo "dual" = llevan latino Y sub; los grupos "latino" llevan doblaje). */
export function idiomaEfectivoRef(f: { fuente: string; idioma: Idioma }): Idioma {
  const grupo = GRUPO[f.fuente];
  if (f.idioma === "latino") return "latino";
  if (f.idioma === "dual" || grupo === "dual") return "dual";
  if (grupo === "latino") return "latino";
  return "sub";
}

/** Mejor idioma de un anime a partir de sus fuentes: "latino" si alguna
 *  fuente del grupo latino lo lleva, "dual" si además hay sub, si no "sub".
 *  Esto corrige el bug del idioma tomado de la primera/última fuente. */
export function mejorIdioma(refs: { fuente: string; idioma: Idioma }[]): Idioma {
  let tieneLatino = false;
  let tieneSub = false;
  for (const f of refs) {
    const efi = idiomaEfectivoRef(f);
    if (efi === "latino") tieneLatino = true;
    else if (efi === "dual") {
      tieneLatino = true;
      tieneSub = true;
    } else tieneSub = true;
  }
  if (tieneLatino && tieneSub) return "dual";
  if (tieneLatino) return "latino";
  return "sub";
}

/** Fusiona una lista de tarjetas provenientes de varias fuentes. */
export function deduplicar(tarjetas: AnimeCard[]): AnimeCard[] {
  const mapa = new Map<string, AnimeCard>();
  for (const t of tarjetas) {
    if (!t.titulo || !t.fuentes?.length) continue;
    const clave = normalizarTitulo(t.titulo);
    if (!clave) continue;
    const prev = mapa.get(clave);
    if (!prev) {
      mapa.set(clave, {
        ...t,
        slug: slugDeduplicado(t.titulo),
        idioma: t.idioma,
        fuentes: [...t.fuentes],
      });
      continue;
    }
    // Fusionar fuentes (sin duplicar la misma fuente+slugLocal)
    const existentes = new Set(prev.fuentes.map((f) => `${f.fuente}:${f.slugLocal}`));
    for (const f of t.fuentes) {
      if (!existentes.has(`${f.fuente}:${f.slugLocal}`)) {
        prev.fuentes.push(f);
        existentes.add(`${f.fuente}:${f.slugLocal}`);
      }
    }
    prev.idioma = mejorIdioma(prev.fuentes);
    prev.tipo = prev.tipo || t.tipo;
    prev.sinopsis = prev.sinopsis || t.sinopsis;
    prev.generos = prev.generos.length ? prev.generos : t.generos;
    prev.estado = prev.estado || t.estado;
    prev.totalEpisodios = Math.max(prev.totalEpisodios ?? 0, t.totalEpisodios ?? 0);
    prev.portada = prev.portada || t.portada;
    prev.episodioReciente = Math.max(prev.episodioReciente ?? 0, t.episodioReciente ?? 0);
  }
  return [...mapa.values()];
}

/** Ordena resultados por relevancia de la búsqueda (incluye las fuentes).
 *  `alias` = términos equivalentes (p. ej. "kanojo okarishimasu" cuando
 *  el usuario buscó "rent a girlfriend"): la coincidencia con cualquiera
 *  de ellos puntúa igual que la original. */
export function ordenarPorRelevancia(
  q: string,
  tarjetas: AnimeCard[],
  alias: string[] = []
): AnimeCard[] {
  const qn = normalizarTitulo(q);
  const claves = [qn, ...alias.map(normalizarTitulo)].filter(Boolean);
  const puntuar = (t: AnimeCard): number => {
    const tn = normalizarTitulo(t.titulo);
    let p = 0;
    for (const c of claves) {
      if (tn === c) {
        p += 100;
        break;
      }
      if (tn.startsWith(c)) {
        p = Math.max(p, 60);
        break;
      }
      if (tn.includes(c)) p = Math.max(p, 30);
    }
    p += Math.min(t.fuentes.length, 6) * 2; // más fuentes = más relevante
    // PRIORIDAD LATINO: lo doblado/dual siempre por delante del sub puro
    if (t.idioma === "latino") p += 30;
    else if (t.idioma === "dual") p += 18;
    return p;
  };
  return [...tarjetas].sort((a, b) => puntuar(b) - puntuar(a));
}

/** Ordena tarjetas con PRIORIDAD LATINO (latino > dual > sub) y, dentro de
 *  cada grupo, mantiene el orden relativo previo (estable). */
export function ordenarPorIdioma<T extends { idioma: Idioma }>(lista: T[]): T[] {
  const pref = (i: Idioma) => (i === "latino" ? 0 : i === "dual" ? 1 : 2);
  return [...lista].sort((a, b) => pref(a.idioma) - pref(b.idioma));
}

/** Deduplica también el feed de episodios (mismo anime en 2 fuentes) y
 *  ordena LATINO primero (dentro de cada grupo mantiene el orden original). */
export function deduplicarFeed(feed: EpisodioFeed[]): EpisodioFeed[] {
  const mapa = new Map<string, EpisodioFeed>();
  for (const e of feed) {
    const clave = `${normalizarTitulo(e.titulo)}#${e.numero}`;
    if (!mapa.has(clave)) mapa.set(clave, e);
  }
  return ordenarPorIdioma([...mapa.values()]);
}

export function refFuente(nombre: string, ref: AnimeFuenteRef): string {
  return `${nombre}·${ref.fuente}`;
}
