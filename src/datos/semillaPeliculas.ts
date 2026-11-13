// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Semilla de PELÍCULAS de anime (~25 títulos reales
// con sus nombres conocidos en Latinoamérica, idioma, año y
// géneros). Se fusiona con la semilla de series en
// semillaCatalogo.ts para que /api/v1/catalogo?tipo=pelicula
// arranque vivo incluso con el índice frío (deploy nuevo).
// Portada: placeholder local; la app la sustituye al resolver la
// primera fuente viva (fallback universal por título).
// ─────────────────────────────────────────────────────────────

import { slugDeduplicado } from "../lib/animax/dedupe";
import { normalizarTitulo } from "../lib/animax/http";
import { resolverIdioma } from "../core/idioma";
import type { AnimeCard, Idioma } from "../lib/animax/types";
import type { SemillaAnime } from "./semillaCatalogo";

export interface SemillaPelicula extends SemillaAnime {
  /** Año de estreno real (para recomendaciones y tops por década). */
  anio: number;
  /** Estudio (informativo, para tops). */
  estudio?: string;
}

const PORTADA_SEMILLA = "/img/placeholder_poster.png";

/** Las 25 películas imprescindibles (nombres reales en latino). */
const PELICULAS: SemillaPelicula[] = [
  { titulo: "Spirited Away", tituloLatino: "El Viaje de Chihiro", idioma: "dual", generos: ["fantasia", "aventura", "sobrenatural"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2001, estudio: "Ghibli", sinopsis: "Chihiro debe trabajar en un balneario de espíritus para rescatar a sus padres." },
  { titulo: "Your Name", tituloLatino: "Kimi no Na wa", idioma: "dual", generos: ["romance", "drama", "sobrenatural"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2016, estudio: "CoMix Wave", sinopsis: "Dos adolescentes descubren que intercambian cuerpos mientras duermen." },
  { titulo: "A Silent Voice", tituloLatino: "Koe no Katachi", idioma: "dual", generos: ["romance", "drama", "escolares"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2016, estudio: "Kyoto Animation", sinopsis: "Un ex-acosador busca redimirse con la compañera sorda que atormentó." },
  { titulo: "Akira", idioma: "dual", generos: ["ciencia-ficcion", "accion", "drama"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 1988, estudio: "TMS", sinopsis: "Neo-Tokio 2019: Tetsuo despierta poderes psíquicos incontrolables." },
  { titulo: "Ghost in the Shell", tituloLatino: "Ghost in the Shell: El Alma de la Máquina", idioma: "dual", generos: ["ciencia-ficcion", "accion", "psicologico"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 1995, estudio: "Production I.G", sinopsis: "La mayor Motoko Kusanagi persigue a un hacker de mentallas." },
  { titulo: "Princess Mononoke", tituloLatino: "La Princesa Mononoke", idioma: "dual", generos: ["fantasia", "accion", "aventura"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 1997, estudio: "Ghibli", sinopsis: "Ashitaka se interpone entre los dioses del bosque y el mundo industrial." },
  { titulo: "Howl's Moving Castle", tituloLatino: "El Castillo Ambulante", idioma: "dual", generos: ["fantasia", "romance", "aventura"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2004, estudio: "Ghibli", sinopsis: "La hechicera Sophie rejuvenece el corazón del mago Howl." },
  { titulo: "My Neighbor Totoro", tituloLatino: "Mi Vecino Totoro", idioma: "dual", generos: ["fantasia", "comedia", "familia"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 1988, estudio: "Ghibli", sinopsis: "Dos hermanas conocen a los espíritus del bosque de su nueva casa." },
  { titulo: "Grave of the Fireflies", tituloLatino: "La Tumba de las Luciérnagas", idioma: "sub", generos: ["drama", "historico"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 1988, estudio: "Ghibli", sinopsis: "Dos hermanos sobreviven al bombardeo de Kobe en 1945." },
  { titulo: "Weathering with You", tituloLatino: "Tenki no Ko", idioma: "dual", generos: ["romance", "drama", "fantasia"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2019, estudio: "CoMix Wave", sinopsis: "Un chico que puede detener la lluvia cambia el clima de Tokio." },
  { titulo: "Demon Slayer: Mugen Train", tituloLatino: "Kimetsu no Yaiba: Mugen Ressha-hen", idioma: "dual", generos: ["accion", "sobrenatural", "shounen"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2020, estudio: "ufotable", sinopsis: "Los cazadores se enfrentan al demonio del tren infinito." },
  { titulo: "Jujutsu Kaisen 0", idioma: "dual", generos: ["accion", "sobrenatural", "shounen"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2021, estudio: "MAPPA", sinopsis: "Yuta Okkotsu entra a la escuela de hechicería por su amiga maldita." },
  { titulo: "One Piece Film: Red", tituloLatino: "One Piece: Film Red", idioma: "dual", generos: ["accion", "aventura", "shounen"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2022, estudio: "Toei", sinopsis: "Los Sombrero de Paja asisten al concierto de la diva Uta." },
  { titulo: "One Piece: Stampede", idioma: "dual", generos: ["accion", "aventura", "shounen"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2019, estudio: "Toei", sinopsis: "Una cacería de tesoros reúne a los piratas más peligrosos del mundo." },
  { titulo: "Dragon Ball Super: Broly", idioma: "dual", generos: ["accion", "ciencia-ficcion", "shounen"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2018, estudio: "Toei", sinopsis: "Goku y Vegeta se enfrentan al saiyajin legendario Broly." },
  { titulo: "Dragon Ball Super: Super Hero", idioma: "dual", generos: ["accion", "ciencia-ficcion", "shounen"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2022, estudio: "Toei", sinopsis: "El Ejército Red Ribbon regresa con androides superiores." },
  { titulo: "Suzume", tituloLatino: "Suzume no Tojimari", idioma: "dual", generos: ["fantasia", "aventura", "drama"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2022, estudio: "CoMix Wave", sinopsis: "Suzume cierra las puertas que liberan desastres por todo Japón." },
  { titulo: "Perfect Blue", idioma: "sub", generos: ["psicologico", "thriller", "misterio"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 1997, estudio: "Madhouse", sinopsis: "Una idol acosada pierde la frontera entre realidad y actuación." },
  { titulo: "Paprika", idioma: "sub", generos: ["ciencia-ficcion", "psicologico", "misterio"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2006, estudio: "Madhouse", sinopsis: "Un dispositivo que comparte sueños es robado del laboratorio." },
  { titulo: "Tokyo Godfathers", idioma: "sub", generos: ["comedia", "drama"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2003, estudio: "Madhouse", sinopsis: "Tres vagabundos encuentran una bebé en Navidad." },
  { titulo: "The Girl Who Leapt Through Time", tituloLatino: "La Chica que Saltaba a Través del Tiempo", idioma: "dual", generos: ["ciencia-ficcion", "romance", "drama"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2006, estudio: "Madhouse", sinopsis: "Makoto descubre que puede saltar atrás en el tiempo." },
  { titulo: "Wolf Children", tituloLatino: "Los Niños Lobo", idioma: "dual", generos: ["drama", "fantasia", "familia"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2012, estudio: "Studio Chizu", sinopsis: "Hana cría sola a sus dos hijos mitad hombre lobo." },
  { titulo: "5 Centimeters per Second", tituloLatino: "5 Centímetros por Segundo", idioma: "sub", generos: ["romance", "drama"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2007, estudio: "CoMix Wave", sinopsis: "La distancia que separa a Takaki de Akari a lo largo de los años." },
  { titulo: "Nausicaa of the Valley of the Wind", tituloLatino: "Nausicaä del Valle del Viento", idioma: "dual", generos: ["fantasia", "aventura", "ciencia-ficcion"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 1984, estudio: "Ghibli", sinopsis: "La princesa Nausicaä une a humanos y la naturaleza del futuro." },
  { titulo: "The Tale of the Princess Kaguya", tituloLatino: "El Cuento de la Princesa Kaguya", idioma: "sub", generos: ["fantasia", "drama", "historico"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2013, estudio: "Ghibli", sinopsis: "Una niña nacida de un bambú crece entre la corte de Japón." },
  { titulo: "Redline", idioma: "sub", generos: ["accion", "ciencia-ficcion", "deportes"], totalEpisodios: 1, tipo: "pelicula", estado: "finalizado", anio: 2009, estudio: "Madhouse", sinopsis: "La carrera ilegal más peligrosa de la galaxia." },
];

/** Índice de año por título normalizado (para recomendaciones/tops). */
const ANIO: Record<string, number> = Object.fromEntries(
  PELICULAS.map((p) => [normalizarTitulo(p.titulo), p.anio])
);

/** Año de una película semilla (o null si no consta). */
export function anioDePelicula(titulo: string): number | null {
  return ANIO[normalizarTitulo(titulo)] ?? null;
}

/** La película semilla de un slug deduplicado concreto. */
export function peliculaPorSlug(slug: string): SemillaPelicula | null {
  if (!slug.startsWith("ded:")) return null;
  const n = slug.slice(4);
  return (
    PELICULAS.find((p) => normalizarTitulo(p.titulo) === n) ||
    PELICULAS.find((p) => p.tituloLatino && normalizarTitulo(p.tituloLatino) === n) ||
    null
  );
}

/** Convierte una película semilla en tarjeta del catálogo. */
export function tarjetaPelicula(p: SemillaPelicula): AnimeCard {
  return {
    titulo: p.titulo,
    slug: slugDeduplicado(p.titulo),
    portada: PORTADA_SEMILLA,
    sinopsis: p.sinopsis,
    generos: p.generos,
    estado: p.estado,
    totalEpisodios: p.totalEpisodios,
    idioma: resolverIdioma([{ fuente: "animegratis", idioma: p.idioma as Idioma }]),
    tipo: "pelicula",
    fuentes: [],
  };
}

/** Catálogo de películas semilla con filtros (arranque en frío). */
export function catalogoPeliculasSemilla(op: {
  idioma?: "latino" | "sub";
  genero?: string;
  limite?: number;
}): AnimeCard[] {
  let lista = PELICULAS;
  if (op.idioma === "latino") {
    lista = lista.filter((p) => p.idioma === "latino" || p.idioma === "dual");
  } else if (op.idioma === "sub") {
    lista = lista.filter((p) => p.idioma === "sub" || p.idioma === "dual");
  }
  if (op.genero) {
    const g = op.genero.toLowerCase();
    lista = lista.filter((p) => p.generos.some((x) => x.toLowerCase().includes(g)));
  }
  return lista.slice(0, op.limite ?? 30).map(tarjetaPelicula);
}

/** Películas semilla que coinciden con una búsqueda. */
export function buscarPeliculaSemilla(q: string): AnimeCard[] {
  if (!q || q.trim().length < 2) return [];
  const nq = normalizarTitulo(q);
  if (!nq) return [];
  return PELICULAS.filter((p) => {
    const t = normalizarTitulo(p.titulo);
    const tl = p.tituloLatino ? normalizarTitulo(p.tituloLatino) : "";
    return t.includes(nq) || (tl && tl.includes(nq));
  }).map(tarjetaPelicula);
}

/** Todas las películas semilla (con año, para tops por década). */
export function peliculasSemilla(): SemillaPelicula[] {
  return [...PELICULAS];
}

/** Resumen para /api/v1/estado. */
export function resumenPeliculas(): {
  total: number;
  decadas: { decada: string; total: number }[];
} {
  const decadas = new Map<string, number>();
  for (const p of PELICULAS) {
    const d = `${Math.floor(p.anio / 10) * 10}s`;
    decadas.set(d, (decadas.get(d) || 0) + 1);
  }
  return {
    total: PELICULAS.length,
    decadas: [...decadas.entries()]
      .map(([decada, total]) => ({ decada, total }))
      .sort((a, b) => b.total - a.total),
  };
}

export default PELICULAS;
