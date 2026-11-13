// ─────────────────────────────────────────────────────────────
// ANIMAX · Índice LIVIANO para el servidor standalone (Render).
// Misma interfaz que indice.ts (Prisma) pero en memoria + archivo
// JSON persistente: cero dependencias de base de datos externa.
// Al migrar a MongoDB/PostgreSQL basta reemplazar este módulo.
// ─────────────────────────────────────────────────────────────

import { slugDeduplicado } from "./dedupe";
import type { AnimeCard, AnimeDetalle, AnimeFuenteRef, Idioma } from "./types";
import * as fs from "fs";
import * as path from "path";

export interface EntradaIndice {
  slug: string;
  titulo: string;
  portada: string | null;
  sinopsis: string | null;
  generos: string[];
  estado: string | null;
  totalEpisodios: number;
  idioma: Idioma;
  tipo?: string;
  fuentes: AnimeFuenteRef[];
}

interface EpisodioRecienteFila {
  titulo: string;
  slug: string;
  portada: string | null;
  numero: number;
  fuente: string;
  idioma: Idioma;
  registrado: number;
}

const ARCHIVO = path.join(process.cwd(), "animax-indice.json");

interface EstadoIndice {
  animes: Record<string, EntradaIndice>;
  episodios: EpisodioRecienteFila[];
}

let estado: EstadoIndice = { animes: {}, episodios: [] };
let sucio = false;
let cargado = false;

function cargar(): void {
  if (cargado) return;
  cargado = true;
  try {
    if (fs.existsSync(ARCHIVO)) {
      estado = JSON.parse(fs.readFileSync(ARCHIVO, "utf8")) as EstadoIndice;
    }
  } catch {
    estado = { animes: {}, episodios: [] };
  }
  // Persistencia cada 60 s (best-effort, nunca lanza)
  const t = setInterval(() => {
    if (!sucio) return;
    sucio = false;
    try {
      fs.writeFileSync(ARCHIVO, JSON.stringify(estado));
    } catch {
      /* silencioso */
    }
  }, 60000);
  if (typeof t.unref === "function") t.unref();
}

function idiomaDe(s: string): Idioma {
  if (s === "latino" || s === "sub" || s === "dual") return s;
  return "sub";
}

/** Indexa (upsert) una tarjeta. Nunca lanza. */
export async function indexarAnime(tarjeta: AnimeCard): Promise<void> {
  cargar();
  try {
    const slug = tarjeta.slug.startsWith("ded:") ? tarjeta.slug : slugDeduplicado(tarjeta.titulo);
    const prev = estado.animes[slug];
    const entrada: EntradaIndice = {
      slug,
      titulo: tarjeta.titulo,
      portada: tarjeta.portada || prev?.portada || null,
      sinopsis: tarjeta.sinopsis || prev?.sinopsis || null,
      generos: tarjeta.generos?.length ? tarjeta.generos : prev?.generos || [],
      estado: tarjeta.estado || prev?.estado || null,
      totalEpisodios: Math.max(tarjeta.totalEpisodios ?? 0, prev?.totalEpisodios ?? 0),
      idioma: tarjeta.idioma,
      fuentes: prev?.fuentes || [],
    };
    const existentes = new Set(entrada.fuentes.map((f) => `${f.fuente}:${f.slugLocal}`));
    for (const f of tarjeta.fuentes) {
      if (!existentes.has(`${f.fuente}:${f.slugLocal}`)) {
        entrada.fuentes.push(f);
        existentes.add(`${f.fuente}:${f.slugLocal}`);
      }
    }
    estado.animes[slug] = entrada;
    sucio = true;
  } catch {
    /* silencioso */
  }
}

/** Indexa en lote sin bloquear. */
export function indexarTarjetas(tarjetas: AnimeCard[]): void {
  void (async () => {
    for (const t of tarjetas) await indexarAnime(t);
  })();
}

/** Busca en el índice por slug deduplicado. */
export async function leerIndice(slug: string): Promise<EntradaIndice | null> {
  cargar();
  return estado.animes[slug] || null;
}

/** Catálogo del índice: filtra por idioma y/o género. */
export async function catalogoIndice(op: {
  idioma?: Idioma;
  genero?: string;
  tipo?: string;
  limite?: number;
}): Promise<EntradaIndice[]> {
  cargar();
  let entradas = Object.values(estado.animes);
  if (op.idioma && op.idioma !== "sub") {
    entradas = entradas.filter((e) => e.idioma === op.idioma || e.idioma === "dual");
  }
  if (op.genero) {
    const g = op.genero.toLowerCase();
    entradas = entradas.filter((e) => e.generos.some((x) => x.toLowerCase().includes(g)));
  }
  if (op.tipo) {
    const t = op.tipo.toLowerCase();
    entradas = entradas.filter(
      (e) => (e.tipo || "").toLowerCase() === t || (t === "pelicula" && /pelicula|movie|film/i.test(e.tipo || ""))
    );
  }
  return entradas.slice(0, op.limite ?? 60);
}

/** Géneros disponibles con conteo. */
export async function generosIndice(): Promise<{ nombre: string; total: number }[]> {
  cargar();
  const conteo = new Map<string, number>();
  for (const e of Object.values(estado.animes)) {
    for (const g of e.generos) {
      const g2 = g.trim();
      if (g2) conteo.set(g2, (conteo.get(g2) || 0) + 1);
    }
  }
  return [...conteo.entries()].map(([nombre, total]) => ({ nombre, total })).sort((a, b) => b.total - a.total);
}

/** Registra episodios recientes (job cron cada 10 min). */
export async function registrarEpisodios(
  episodios: { titulo: string; slug: string; portada?: string; numero: number; fuente: string; idioma: Idioma }[]
): Promise<void> {
  cargar();
  try {
    const vistos = new Set(estado.episodios.map((e) => `${e.slug}#${e.numero}#${e.fuente}`));
    for (const e of episodios) {
      const k = `${e.slug}#${e.numero}#${e.fuente}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      estado.episodios.push({ ...e, portada: e.portada || null, registrado: Date.now() });
    }
    estado.episodios.sort((a, b) => b.registrado - a.registrado);
    estado.episodios = estado.episodios.slice(0, 300);
    sucio = true;
  } catch {
    /* silencioso */
  }
}

/** Índice → tarjeta para respuesta de API. */
export function entradaATarjeta(e: EntradaIndice): AnimeCard {
  return {
    titulo: e.titulo,
    slug: e.slug,
    portada: e.portada || "",
    sinopsis: e.sinopsis || undefined,
    generos: e.generos,
    estado: e.estado || undefined,
    totalEpisodios: e.totalEpisodios,
    idioma: e.idioma,
    fuentes: e.fuentes,
  };
}

/** Merge de un detalle scrapeado con el índice (por si hay más fuentes). */
export async function enriquecerConIndice(detalle: AnimeDetalle): Promise<AnimeDetalle> {
  const entrada = await leerIndice(slugDeduplicado(detalle.titulo));
  if (!entrada) return detalle;
  const existentes = new Set(detalle.fuentes.map((f) => `${f.fuente}:${f.slugLocal}`));
  const extra = entrada.fuentes.filter((f) => !existentes.has(`${f.fuente}:${f.slugLocal}`));
  return {
    ...detalle,
    generos: detalle.generos.length ? detalle.generos : entrada.generos,
    sinopsis: detalle.sinopsis || entrada.sinopsis || undefined,
    fuentes: [...detalle.fuentes, ...extra],
  };
}
