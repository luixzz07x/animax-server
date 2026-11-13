// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Semilla de catálogo OFFLINE (~40 títulos populares
// con sus títulos latinos conocidos). Propósito: arranque en frío.
// Con el índice vacío (deploy nuevo / disco limpio) el catálogo
// y la búsqueda no devuelven "0 animes": se muestran las semillas
// y el fallback universal del registro las revive en vivo (el
// detalle y los servidores re-buscan por título en las fuentes).
// Portada: placeholder local de public/img (la app lo sustituye
// al resolver la primera fuente viva).
// ─────────────────────────────────────────────────────────────

import { slugDeduplicado } from "../lib/animax/dedupe";
import { normalizarTitulo } from "../lib/animax/http";
import { resolverIdioma } from "../core/idioma";
import type { AnimeCard, Idioma } from "../lib/animax/types";
import { peliculasSemilla } from "./semillaPeliculas";

export interface SemillaAnime {
  titulo: string;
  /** Título conocido en Latinoamérica (para mostrar/búsqueda). */
  tituloLatino?: string;
  idioma: Idioma;
  generos: string[];
  totalEpisodios: number;
  tipo?: "tv" | "pelicula" | "ova";
  estado?: string;
  sinopsis?: string;
}

/** Los imprescindibles: shonen clásico + modernos (las PELÍCULAS
 *  de semillaPeliculas.ts se fusionan debajo: ~48 series + 26 pelis). */
const SERIES: SemillaAnime[] = [
  { titulo: "One Piece", tituloLatino: "One Piece: Los Piratas de Sombrero de Paja", idioma: "dual", generos: ["accion", "aventura", "fantasia", "shounen"], totalEpisodios: 1100, tipo: "tv", estado: "en emision" },
  { titulo: "Naruto", idioma: "dual", generos: ["accion", "aventura", "shounen"], totalEpisodios: 220, tipo: "tv", estado: "finalizado" },
  { titulo: "Naruto Shippuden", idioma: "dual", generos: ["accion", "aventura", "shounen"], totalEpisodios: 500, tipo: "tv", estado: "finalizado" },
  { titulo: "Dragon Ball", idioma: "dual", generos: ["accion", "aventura", "shounen"], totalEpisodios: 153, tipo: "tv", estado: "finalizado" },
  { titulo: "Dragon Ball Z", idioma: "dual", generos: ["accion", "aventura", "shounen"], totalEpisodios: 291, tipo: "tv", estado: "finalizado" },
  { titulo: "Dragon Ball Super", idioma: "dual", generos: ["accion", "aventura", "shounen"], totalEpisodios: 131, tipo: "tv", estado: "finalizado" },
  { titulo: "Dragon Ball GT", idioma: "dual", generos: ["accion", "aventura", "shounen"], totalEpisodios: 64, tipo: "tv", estado: "finalizado" },
  { titulo: "Rent a Girlfriend", tituloLatino: "Kanojo, Okarishimasu", idioma: "latino", generos: ["romance", "comedia", "escolares"], totalEpisodios: 37, tipo: "tv", estado: "finalizado" },
  { titulo: "Attack on Titan", tituloLatino: "Shingeki no Kyojin", idioma: "dual", generos: ["accion", "drama", "fantasia", "sobrenatural"], totalEpisodios: 89, tipo: "tv", estado: "finalizado" },
  { titulo: "Demon Slayer", tituloLatino: "Kimetsu no Yaiba", idioma: "dual", generos: ["accion", "sobrenatural", "historico"], totalEpisodios: 55, tipo: "tv", estado: "en emision" },
  { titulo: "Jujutsu Kaisen", idioma: "dual", generos: ["accion", "sobrenatural", "shounen"], totalEpisodios: 47, tipo: "tv", estado: "en emision" },
  { titulo: "My Hero Academia", tituloLatino: "Boku no Hero Academia", idioma: "dual", generos: ["accion", "escolares", "shounen"], totalEpisodios: 138, tipo: "tv", estado: "en emision" },
  { titulo: "Bleach", idioma: "dual", generos: ["accion", "sobrenatural", "shounen"], totalEpisodios: 366, tipo: "tv", estado: "finalizado" },
  { titulo: "One Punch Man", idioma: "dual", generos: ["accion", "comedia", "sobrenatural"], totalEpisodios: 24, tipo: "tv", estado: "en emision" },
  { titulo: "Sword Art Online", idioma: "dual", generos: ["accion", "romance", "ciencia-ficcion", "isekai"], totalEpisodios: 96, tipo: "tv", estado: "finalizado" },
  { titulo: "Re:Zero", idioma: "dual", generos: ["drama", "fantasia", "isekai", "psicologico"], totalEpisodios: 50, tipo: "tv", estado: "en emision" },
  { titulo: "Spy x Family", idioma: "dual", generos: ["comedia", "accion", "escolares"], totalEpisodios: 37, tipo: "tv", estado: "en emision" },
  { titulo: "Chainsaw Man", idioma: "dual", generos: ["accion", "sobrenatural", "shounen"], totalEpisodios: 12, tipo: "tv", estado: "en emision" },
  { titulo: "Tokyo Revengers", idioma: "dual", generos: ["drama", "romance", "sobrenatural", "thriller"], totalEpisodios: 50, tipo: "tv", estado: "en emision" },
  { titulo: "Haikyuu", idioma: "dual", generos: ["deportes", "comedia", "escolares"], totalEpisodios: 85, tipo: "tv", estado: "finalizado" },
  { titulo: "Black Clover", idioma: "dual", generos: ["accion", "fantasia", "shounen"], totalEpisodios: 170, tipo: "tv", estado: "en emision" },
  { titulo: "Blue Lock", idioma: "dual", generos: ["deportes", "drama", "shounen"], totalEpisodios: 38, tipo: "tv", estado: "en emision" },
  { titulo: "Solo Leveling", idioma: "dual", generos: ["accion", "fantasia", "sobrenatural"], totalEpisodios: 25, tipo: "tv", estado: "en emision" },
  { titulo: "Frieren", tituloLatino: "Sousou no Frieren", idioma: "dual", generos: ["aventura", "drama", "fantasia"], totalEpisodios: 28, tipo: "tv", estado: "en emision" },
  { titulo: "Dandadan", idioma: "dual", generos: ["accion", "comedia", "sobrenatural"], totalEpisodios: 12, tipo: "tv", estado: "en emision" },
  { titulo: "Kaiju No. 8", idioma: "dual", generos: ["accion", "ciencia-ficcion", "shounen"], totalEpisodios: 12, tipo: "tv", estado: "en emision" },
  { titulo: "Mob Psycho 100", idioma: "dual", generos: ["accion", "comedia", "sobrenatural"], totalEpisodios: 37, tipo: "tv", estado: "finalizado" },
  { titulo: "Death Note", idioma: "dual", generos: ["misterio", "psicologico", "thriller", "sobrenatural"], totalEpisodios: 37, tipo: "tv", estado: "finalizado" },
  { titulo: "Fullmetal Alchemist", idioma: "dual", generos: ["accion", "aventura", "drama", "fantasia"], totalEpisodios: 64, tipo: "tv", estado: "finalizado" },
  { titulo: "Hunter x Hunter", idioma: "dual", generos: ["aventura", "fantasia", "shounen"], totalEpisodios: 148, tipo: "tv", estado: "hiatus" },
  { titulo: "Tokyo Ghoul", idioma: "dual", generos: ["accion", "horror", "sobrenatural", "psicologico"], totalEpisodios: 48, tipo: "tv", estado: "finalizado" },
  { titulo: "Vinland Saga", idioma: "dual", generos: ["accion", "aventura", "drama", "historico"], totalEpisodios: 48, tipo: "tv", estado: "en emision" },
  { titulo: "Code Geass", idioma: "dual", generos: ["accion", "drama", "ciencia-ficcion", "mecha"], totalEpisodios: 50, tipo: "tv", estado: "finalizado" },
  { titulo: "Neon Genesis Evangelion", idioma: "dual", generos: ["drama", "ciencia-ficcion", "mecha", "psicologico"], totalEpisodios: 26, tipo: "tv", estado: "finalizado" },
  { titulo: "Steins;Gate", idioma: "dual", generos: ["drama", "ciencia-ficcion", "thriller"], totalEpisodios: 24, tipo: "tv", estado: "finalizado" },
  { titulo: "Konosuba", idioma: "dual", generos: ["comedia", "fantasia", "isekai"], totalEpisodios: 22, tipo: "tv", estado: "en emision" },
  { titulo: "Overlord", idioma: "dual", generos: ["accion", "fantasia", "isekai"], totalEpisodios: 47, tipo: "tv", estado: "finalizado" },
  { titulo: "No Game No Life", idioma: "dual", generos: ["fantasia", "juego", "isekai"], totalEpisodios: 11, tipo: "tv", estado: "finalizado" },
  { titulo: "Dr. Stone", idioma: "dual", generos: ["ciencia-ficcion", "aventura", "shounen"], totalEpisodios: 47, tipo: "tv", estado: "finalizado" },
  { titulo: "Fire Force", tituloLatino: "Enen no Shouboutai", idioma: "dual", generos: ["accion", "sobrenatural", "shounen"], totalEpisodios: 48, tipo: "tv", estado: "finalizado" },
  { titulo: "Toradora", idioma: "dual", generos: ["romance", "comedia", "escolares"], totalEpisodios: 25, tipo: "tv", estado: "finalizado" },
  { titulo: "Horimiya", idioma: "dual", generos: ["romance", "comedia", "escolares"], totalEpisodios: 13, tipo: "tv", estado: "finalizado" },
  { titulo: "Oshi no Ko", idioma: "dual", generos: ["drama", "misterio", "psicologico"], totalEpisodios: 24, tipo: "tv", estado: "en emision" },
  { titulo: "Kaguya-sama: Love is War", idioma: "dual", generos: ["romance", "comedia", "escolares"], totalEpisodios: 37, tipo: "tv", estado: "finalizado" },
  { titulo: "Cyberpunk: Edgerunners", idioma: "dual", generos: ["ciencia-ficcion", "drama", "accion"], totalEpisodios: 10, tipo: "tv", estado: "finalizado" },
  { titulo: "Cowboy Bebop", idioma: "dual", generos: ["accion", "ciencia-ficcion", "drama", "espacial"], totalEpisodios: 26, tipo: "tv", estado: "finalizado" },
  // Your Name y A Silent Voice viven ahora en semillaPeliculas.ts con su año
];

/** Semilla completa: series + películas (con año para tops/recomendaciones). */
const SEMILLA: SemillaAnime[] = [...SERIES, ...peliculasSemilla()];

const PORTADA_SEMILLA = "/img/placeholder_poster.png";

/** Convierte una semilla en tarjeta del catálogo (fuentes vacías:
 *  se llenan en vivo con el fallback universal al abrir el detalle). */
export function tarjetaSemilla(s: SemillaAnime): AnimeCard {
  return {
    titulo: s.titulo,
    slug: slugDeduplicado(s.titulo),
    portada: PORTADA_SEMILLA,
    sinopsis: s.sinopsis,
    generos: s.generos,
    estado: s.estado,
    totalEpisodios: s.totalEpisodios,
    idioma: resolverIdioma([{ fuente: "animegratis", idioma: s.idioma }]),
    tipo: s.tipo,
    fuentes: [],
  };
}

/** Semillas que coinciden con una búsqueda (por título o título latino). */
export function buscarSemilla(q: string): AnimeCard[] {
  if (!q || q.trim().length < 2) return [];
  const nq = normalizarTitulo(q);
  if (!nq) return [];
  return SEMILLA.filter((s) => {
    const t = normalizarTitulo(s.titulo);
    const tl = s.tituloLatino ? normalizarTitulo(s.tituloLatino) : "";
    return t.includes(nq) || (tl && tl.includes(nq));
  }).map(tarjetaSemilla);
}

/** Catálogo semilla con filtro de idioma/género/tipo (arranque en frío). */
export function catalogoSemilla(op: {
  idioma?: "latino" | "sub";
  genero?: string;
  tipo?: string;
  limite?: number;
}): AnimeCard[] {
  let lista = SEMILLA;
  if (op.idioma === "latino") {
    lista = lista.filter((s) => s.idioma === "latino" || s.idioma === "dual");
  } else if (op.idioma === "sub") {
    lista = lista.filter((s) => s.idioma === "sub" || s.idioma === "dual");
  }
  if (op.genero) {
    const g = op.genero.toLowerCase();
    lista = lista.filter((s) => s.generos.some((x) => x.toLowerCase().includes(g)));
  }
  if (op.tipo) {
    const t = op.tipo.toLowerCase();
    lista = lista.filter(
      (s) => (s.tipo || "").toLowerCase() === t || (t === "pelicula" && /pelicula|movie|film/i.test(s.tipo || ""))
    );
  }
  return lista.slice(0, op.limite ?? 60).map(tarjetaSemilla);
}

/** La semilla de un slug deduplicado concreto (para el detalle offline). */
export function semillaPorSlug(slug: string): SemillaAnime | null {
  if (!slug.startsWith("ded:")) return null;
  const n = slug.slice(4);
  return (
    SEMILLA.find((s) => normalizarTitulo(s.titulo) === n) ||
    SEMILLA.find((s) => s.tituloLatino && normalizarTitulo(s.tituloLatino) === n) ||
    null
  );
}

/** Total de semillas y géneros únicos (para /api/v1/estado). */
export function resumenSemilla(): { total: number; generos: number } {
  const generos = new Set<string>();
  for (const s of SEMILLA) for (const g of s.generos) generos.add(g);
  return { total: SEMILLA.length, generos: generos.size };
}
