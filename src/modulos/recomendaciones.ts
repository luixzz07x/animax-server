// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · MOTOR DE RECOMENDACIONES ("similares").
// Dado un anime (slug deduplicado), puntúa el resto del catálogo
// unificado (índice en disco + semilla offline) con:
//   · DISTANCIA JACCARD sobre los géneros (0..1)
//   · bonus por mismo tipo (tv/pelicula/ova)
//   · bonus por cercanía de año de estreno (tabla curada)
//   · prioridad latino en el orden final
// El corpus se cachea 10 min (namespace propio de caché) para no
// reconstruirlo en cada petición. Endpoint:
//   GET /api/v1/recomendaciones/{slug}?limite=12
// ─────────────────────────────────────────────────────────────

import { conCache } from "../lib/animax/cache";
import { normalizarTitulo } from "../lib/animax/http";
import { catalogoIndice, entradaATarjeta } from "../lib/animax/indice";
import { catalogoSemilla } from "../datos/semillaCatalogo";
import { anioConocido, cercaniaAnios } from "./aniosAnime";
import { preferenciaIdioma } from "../core/idioma";
import type { AnimeCard, Idioma } from "../lib/animax/types";

/** Entrada del corpus de recomendaciones. */
export interface EntradaCorpus {
  titulo: string;
  slug: string;
  portada: string;
  generos: string[];
  tipo: string;
  idioma: Idioma;
  anio: number | null;
}

interface Corpus {
  porSlug: Map<string, EntradaCorpus>;
  lista: EntradaCorpus[];
}

/** Género normalizado para comparar (sin acentos/espacios). */
function generoNormal(g: string): string {
  return normalizarTitulo(g).replace(/\s/g, "");
}

/** Distancia JACCARD entre dos conjuntos de géneros (0..1). */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a.map(generoNormal));
  const sb = new Set(b.map(generoNormal));
  let interseccion = 0;
  for (const g of sa) if (sb.has(g)) interseccion++;
  const union = sa.size + sb.size - interseccion;
  return union === 0 ? 0 : interseccion / union;
}

function tarjetaACorpus(t: AnimeCard): EntradaCorpus {
  return {
    titulo: t.titulo,
    slug: t.slug,
    portada: t.portada,
    generos: t.generos || [],
    tipo: (t.tipo || "").toLowerCase(),
    idioma: t.idioma,
    anio: anioConocido(t.titulo),
  };
}

/** Construye (con caché 10 min) el corpus unificado índice+semilla. */
export async function corpusRecomendaciones(): Promise<Corpus> {
  return conCache<Corpus>("recomendaciones", "corpus", async () => {
    const porSlug = new Map<string, EntradaCorpus>();
    // 1) Índice vivo (todo lo scrapeado hasta ahora)
    const entradas = await catalogoIndice({ limite: 1000 });
    for (const e of entradas) {
      const c = tarjetaACorpus(entradaATarjeta(e));
      if (!porSlug.has(c.slug)) porSlug.set(c.slug, c);
    }
    // 2) Semilla offline (arranque en frío: catálogo nunca vacío)
    for (const t of catalogoSemilla({ limite: 200 })) {
      if (!porSlug.has(t.slug)) porSlug.set(t.slug, tarjetaACorpus(t));
    }
    return { porSlug, lista: [...porSlug.values()] };
  });
}

export interface Recomendacion {
  titulo: string;
  slug: string;
  portada: string;
  generos: string[];
  tipo: string;
  idioma: Idioma;
  anio: number | null;
  /** Puntuación 0..1 (mayor = más similar). */
  puntuacion: number;
  /** Por qué se recomienda (para UI). */
  razones: string[];
}

export interface RespuestaSimilares {
  base: {
    titulo: string;
    slug: string;
    generos: string[];
    tipo: string;
    anio: number | null;
  } | null;
  similares: Recomendacion[];
  corpusTotal: number;
}

/** Similares de un anime por géneros/año/tipo (distancia Jaccard). */
export async function similares(
  slug: string,
  op: { limite?: number; idioma?: "latino" | "sub" } = {}
): Promise<RespuestaSimilares> {
  const limite = Math.min(Math.max(op.limite ?? 12, 1), 40);
  const corpus = await corpusRecomendaciones();
  const base = corpus.porSlug.get(slug) || null;

  // Sin base conocida: se recomienda lo popular del mismo corpus
  // (catálogo priorizado latino) para que la UI nunca salga vacía.
  if (!base) {
    const fallback = corpus.lista
      .slice()
      .sort((a, b) => preferenciaIdioma(a.idioma) - preferenciaIdioma(b.idioma))
      .slice(0, limite)
      .map<Recomendacion>((c) => ({
        titulo: c.titulo,
        slug: c.slug,
        portada: c.portada,
        generos: c.generos,
        tipo: c.tipo,
        idioma: c.idioma,
        anio: c.anio,
        puntuacion: 0,
        razones: ["entrada desconocida: catálogo priorizado latino"],
      }));
    return { base: null, similares: fallback, corpusTotal: corpus.lista.length };
  }

  const candidatos: Recomendacion[] = [];
  for (const c of corpus.lista) {
    if (c.slug === base.slug) continue;
    if (op.idioma && c.idioma !== op.idioma && c.idioma !== "dual") continue;

    const jac = jaccard(base.generos, c.generos);
    const tipoIgual = base.tipo !== "" && base.tipo === c.tipo;
    let anioTerm = 0.075; // neutral si algún año es desconocido
    if (base.anio !== null && c.anio !== null) {
      anioTerm = cercaniaAnios(base.anio, c.anio) * 0.15;
    }
    const puntuacion = jac * 0.7 + (tipoIgual ? 0.15 : 0) + anioTerm;
    if (puntuacion <= 0.05 && jac === 0) continue; // nada en común

    const razones: string[] = [];
    const comunes = base.generos.filter((g) =>
      c.generos.some((g2) => generoNormal(g2) === generoNormal(g))
    );
    if (comunes.length > 0) razones.push(`comparte ${comunes.length} género(s): ${comunes.slice(0, 3).join(", ")}`);
    if (tipoIgual) razones.push(`mismo tipo (${base.tipo || "tv"})`);
    if (base.anio !== null && c.anio !== null) {
      const d = Math.abs(base.anio - c.anio);
      if (d <= 2) razones.push(`estrenos casi juntos (${c.anio} ≈ ${base.anio})`);
      else razones.push(`estreno ${c.anio}`);
    }
    candidatos.push({
      titulo: c.titulo,
      slug: c.slug,
      portada: c.portada,
      generos: c.generos,
      tipo: c.tipo,
      idioma: c.idioma,
      anio: c.anio,
      puntuacion,
      razones,
    });
  }

  // Orden: puntuación y, en empate, prioridad latino (latino→dual→sub).
  candidatos.sort(
    (a, b) =>
      b.puntuacion - a.puntuacion ||
      preferenciaIdioma(a.idioma) - preferenciaIdioma(b.idioma)
  );

  return {
    base: {
      titulo: base.titulo,
      slug: base.slug,
      generos: base.generos,
      tipo: base.tipo,
      anio: base.anio,
    },
    similares: candidatos.slice(0, limite),
    corpusTotal: corpus.lista.length,
  };
}

export default similares;
