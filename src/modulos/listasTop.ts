// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · TOPS con paginación: mejor valorados, más vistos,
// por género y por década. El corpus es el catálogo unificado
// (índice vivo + semilla offline) y las "vistas" se aproximan con
// la frecuencia de aparición en el feed de últimos episodios (los
// animes que más fuentes emiten y más episodios frescos sueltan),
// como hace la portada con su sección populares.
//   GET /api/v1/top/valorados?pagina=1&limite=20
//   GET /api/v1/top/vistos
//   GET /api/v1/top/genero?genero=accion
//   GET /api/v1/top/decada?decada=1990s
// ─────────────────────────────────────────────────────────────

import { conCache } from "../lib/animax/cache";
import { normalizarTitulo } from "../lib/animax/http";
import { catalogoIndice, entradaATarjeta } from "../lib/animax/indice";
import { catalogoSemilla } from "../datos/semillaCatalogo";
import { ultimosUnificados } from "../lib/animax/registro";
import { priorizarLatino, bonificacionLatino } from "../core/idioma";
import { anioConocido, decadaDe } from "./aniosAnime";
import type { AnimeCard, Idioma } from "../lib/animax/types";

/** Valoraciones curadas (nota media de la comunidad, 0..10). */
const VALORACIONES: Record<string, number> = {
  "fullmetal alchemist": 9.2,
  "attack on titan": 9.1,
  "steinsgate": 9.1,
  "death note": 9.0,
  "hunter x hunter": 9.0,
  "code geass": 8.9,
  "cowboy bebop": 8.9,
  "mob psycho 100": 8.8,
  "neon genesis evangelion": 8.8,
  "vinland saga": 8.8,
  "your name": 8.8,
  "a silent voice": 8.8,
  "spirited away": 8.8,
  "frieren": 8.8,
  "spy x family": 8.7,
  "haikyuu": 8.7,
  "demon slayer": 8.6,
  "one punch man": 8.6,
  "jujutsu kaisen": 8.6,
  "my hero academia": 8.4,
  "one piece": 8.4,
  "dragon ball z": 8.4,
  "chainsaw man": 8.5,
  "dandadan": 8.5,
  "toradora": 8.3,
  "konosuba": 8.3,
  "bleach": 8.2,
  "naruto": 8.2,
  "naruto shippuden": 8.3,
  "tokyo ghoul": 7.9,
  "sword art online": 7.5,
  "rezero": 8.4,
  "black clover": 8.0,
  "dr stone": 8.2,
  "fire force": 8.0,
  "blue lock": 8.0,
  "solo leveling": 8.2,
  "kaguya sama love is war": 8.6,
  "horimiya": 8.3,
  "oshi no ko": 8.7,
  "tokyo revengers": 8.0,
  "no game no life": 8.2,
  "overlord": 7.9,
  "cyberpunk edgerunners": 8.6,
  "kaiju no 8": 8.1,
  "grave of the fireflies": 8.9,
  "princess mononoke": 8.8,
  "akira": 8.7,
  "ghost in the shell": 8.6,
  "perfect blue": 8.6,
  "paprika": 8.4,
  "wolf children": 8.6,
  "wolf children ame to yuki": 8.6,
  "wolf children ookami kodomo no ame to yuki": 8.6,
  "5 centimeters per second": 8.2,
  "the girl who leapt through time": 8.4,
  "tokyo godfathers": 8.3,
  "redline": 8.3,
  "the tale of the princess kaguya": 8.6,
  "nausicaa of the valley of the wind": 8.6,
  "howls moving castle": 8.7,
  "my neighbor totoro": 8.7,
  "weathering with you": 8.5,
  "suzume": 8.0,
  "demon slayer mugen train": 8.5,
  "jujutsu kaisen 0": 8.3,
  "one piece film red": 8.1,
  "one piece stampede": 8.0,
  "dragon ball super broly": 8.3,
  "dragon ball super super hero": 7.9,
};

export interface EntradaTop {
  titulo: string;
  slug: string;
  portada: string;
  generos: string[];
  tipo: string;
  idioma: Idioma;
  anio: number | null;
  /** Métrica del top (valoración o vistas-normalizadas). */
  metrica: number;
  /** Etiqueta legible de la métrica ("9.1/10" o "x N fuentes"). */
  etiqueta: string;
}

export type TipoTop = "valorados" | "vistos" | "genero" | "decada";

export interface PaginaTop {
  tipo: TipoTop;
  filtro?: string;
  pagina: number;
  limite: number;
  total: number;
  paginas: number;
  resultados: EntradaTop[];
}

interface CorpusTop {
  lista: EntradaTop[];
  porSlug: Map<string, EntradaTop>;
}

function valoracionDe(titulo: string): number | null {
  const n = normalizarTitulo(titulo);
  return VALORACIONES[n] ?? null;
}

/** Corpus unificado con valoración (semilla + índice), cacheado 10 min. */
async function corpusTops(): Promise<CorpusTop> {
  return conCache<CorpusTop>("tops", "corpus", async () => {
    const porSlug = new Map<string, EntradaTop>();
    const añadir = (t: AnimeCard): void => {
      if (porSlug.has(t.slug)) return;
      porSlug.set(t.slug, {
        titulo: t.titulo,
        slug: t.slug,
        portada: t.portada,
        generos: t.generos || [],
        tipo: (t.tipo || "").toLowerCase(),
        idioma: t.idioma,
        anio: anioConocido(t.titulo),
        metrica: valoracionDe(t.titulo) ?? 7,
        etiqueta: `${(valoracionDe(t.titulo) ?? 7).toFixed(1)}/10`,
      });
    };
    for (const e of await catalogoIndice({ limite: 1000 })) añadir(entradaATarjeta(e));
    for (const s of catalogoSemilla({ limite: 200 })) añadir(s);
    return { porSlug, lista: [...porSlug.values()] };
  });
}

/** Veces que cada título aparece en el feed de últimos episodios. */
async function vistasFeed(): Promise<Map<string, number>> {
  const r = await ultimosUnificados();
  const conteo = new Map<string, number>();
  for (const e of r.data?.episodios ?? []) {
    const n = normalizarTitulo(e.titulo);
    if (!n) continue;
    conteo.set(n, (conteo.get(n) || 0) + 1);
  }
  return conteo;
}

function paginar(
  tipo: TipoTop,
  filtro: string | undefined,
  lista: EntradaTop[],
  pagina: number,
  limite: number
): PaginaTop {
  const pag = Math.max(1, Math.floor(pagina));
  const lim = Math.min(Math.max(limite, 1), 50);
  const total = lista.length;
  const inicio = (pag - 1) * lim;
  return {
    tipo,
    filtro,
    pagina: pag,
    limite: lim,
    total,
    paginas: Math.max(1, Math.ceil(total / lim)),
    resultados: lista.slice(inicio, inicio + lim),
  };
}

/** Top MEJOR VALORADOS (valoración curada; lo desconocido queda fuera). */
export async function topValorados(
  op: { pagina?: number; limite?: number; idioma?: "latino" | "sub" } = {}
): Promise<PaginaTop> {
  const corpus = await corpusTops();
  let lista = corpus.lista.filter((e) => valoracionDe(e.titulo) !== null);
  if (op.idioma) lista = lista.filter((e) => e.idioma === op.idioma || e.idioma === "dual");
  lista = priorizarLatino(lista).sort((a, b) => b.metrica - a.metrica);
  return paginar("valorados", undefined, lista, op.pagina ?? 1, op.limite ?? 20);
}

/** Top MÁS VISTOS (frecuencia en el feed + nº de fuentes + bonus latino). */
export async function topVistos(
  op: { pagina?: number; limite?: number; idioma?: "latino" | "sub" } = {}
): Promise<PaginaTop> {
  const [corpus, vistas] = await Promise.all([corpusTops(), vistasFeed()]);
  let lista = corpus.lista.map((e) => {
    const vistasTitulo = vistas.get(normalizarTitulo(e.titulo)) || 0;
    // métrica compuesta: apariciones en feed + valoración suave + latino
    const metrica =
      vistasTitulo * 10 + (valoracionDe(e.titulo) ?? 5) + bonificacionLatino(e.idioma);
    return { ...e, metrica, etiqueta: vistasTitulo > 0 ? `en emisión activa (${vistasTitulo})` : `${(valoracionDe(e.titulo) ?? 5).toFixed(1)}/10` };
  });
  if (op.idioma) lista = lista.filter((e) => e.idioma === op.idioma || e.idioma === "dual");
  lista.sort((a, b) => b.metrica - a.metrica);
  return paginar("vistos", undefined, lista, op.pagina ?? 1, op.limite ?? 20);
}

/** Top POR GÉNERO (valoración; sin valoración conocida entra al final
 *  ordenado por vistas/fuentes para que el catálogo frío no quede vacío). */
export async function topGenero(
  genero: string,
  op: { pagina?: number; limite?: number; idioma?: "latino" | "sub" } = {}
): Promise<PaginaTop> {
  const corpus = await corpusTops();
  const g = genero.toLowerCase().trim();
  let lista = corpus.lista.filter((e) =>
    e.generos.some((x) => normalizarTitulo(x).includes(normalizarTitulo(g)))
  );
  if (op.idioma) lista = lista.filter((e) => e.idioma === op.idioma || e.idioma === "dual");
  lista = priorizarLatino(lista).sort((a, b) => {
    const va = valoracionDe(a.titulo) ?? -1;
    const vb = valoracionDe(b.titulo) ?? -1;
    return vb - va; // sin valorar (-1) al final
  });
  return paginar("genero", g, lista, op.pagina ?? 1, op.limite ?? 20);
}

/** Top POR DÉCADA (necesita año conocido: tabla curada + películas). */
export async function topDecada(
  decada: string,
  op: { pagina?: number; limite?: number; idioma?: "latino" | "sub" } = {}
): Promise<PaginaTop> {
  const corpus = await corpusTops();
  // "1990", "1990s" o "90" → década
  const m = decada.match(/^(\d{2,4})s?$/);
  const base = m ? parseInt(m[1], 10) : 0;
  const anioDecada = base < 100 ? 1900 + base : base;
  const etiqueta = decadaDe(anioDecada);
  let lista = corpus.lista.filter((e) => e.anio !== null && decadaDe(e.anio) === etiqueta);
  if (op.idioma) lista = lista.filter((e) => e.idioma === op.idioma || e.idioma === "dual");
  lista = priorizarLatino(lista).sort((a, b) => (b.metrica ?? 0) - (a.metrica ?? 0));
  return paginar("decada", etiqueta, lista, op.pagina ?? 1, op.limite ?? 20);
}

/** Décadas disponibles con conteo (para la UI del top). */
export async function decadasDisponibles(): Promise<{ decada: string; total: number }[]> {
  const corpus = await corpusTops();
  const conteo = new Map<string, number>();
  for (const e of corpus.lista) {
    if (e.anio === null) continue;
    const d = decadaDe(e.anio);
    conteo.set(d, (conteo.get(d) || 0) + 1);
  }
  return [...conteo.entries()]
    .map(([decada, total]) => ({ decada, total }))
    .sort((a, b) => a.decada.localeCompare(b.decada));
}

export default topValorados;
