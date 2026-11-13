// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Años de estreno conocidos (series + especiales).
// El índice unificado no guarda el año (las fuentes lo esconden en
// la sinopsis o no lo traen), pero recomendaciones ("similares")
// y tops por década lo necesitan: aquí vive la tabla curada de
// estrenos de las series más populares, consultada por título
// normalizado. Las películas traen su año propio en
// src/datos/semillaPeliculas.ts.
// ─────────────────────────────────────────────────────────────

import { normalizarTitulo } from "../lib/animax/http";
import { anioDePelicula } from "../datos/semillaPeliculas";

/** Título normalizado → año de estreno. */
const ANIOS_SERIES: Record<string, number> = {
  "one piece": 1999,
  "naruto": 2002,
  "naruto shippuden": 2007,
  "dragon ball": 1986,
  "dragon ball z": 1989,
  "dragon ball gt": 1996,
  "dragon ball super": 2015,
  "rent a girlfriend": 2020,
  "attack on titan": 2013,
  "demon slayer": 2019,
  "jujutsu kaisen": 2020,
  "my hero academia": 2016,
  "bleach": 2004,
  "one punch man": 2015,
  "sword art online": 2012,
  "rezero": 2016,
  "spy x family": 2022,
  "chainsaw man": 2022,
  "tokyo revengers": 2021,
  "haikyuu": 2014,
  "black clover": 2017,
  "blue lock": 2022,
  "solo leveling": 2024,
  "frieren": 2023,
  "dandadan": 2024,
  "kaiju no 8": 2024,
  "mob psycho 100": 2016,
  "death note": 2006,
  "fullmetal alchemist": 2003,
  "hunter x hunter": 2011,
  "tokyo ghoul": 2014,
  "vinland saga": 2019,
  "code geass": 2006,
  "neon genesis evangelion": 1995,
  "steinsgate": 2011,
  "konosuba": 2016,
  "overlord": 2015,
  "no game no life": 2014,
  "dr stone": 2019,
  "fire force": 2019,
  "toradora": 2008,
  "horimiya": 2021,
  "oshi no ko": 2023,
  "kaguya sama love is war": 2019,
  "cyberpunk edgerunners": 2022,
  "cowboy bebop": 1998,
};

/** Año de estreno de un título (serie o película), si se conoce. */
export function anioConocido(titulo: string): number | null {
  const n = normalizarTitulo(titulo);
  if (!n) return null;
  if (ANIOS_SERIES[n] !== undefined) return ANIOS_SERIES[n];
  return anioDePelicula(titulo);
}

/** Década de un año: 1988 → "1980s". */
export function decadaDe(anio: number): string {
  return `${Math.floor(anio / 10) * 10}s`;
}

/** Década de un título (o null si no consta su año). */
export function decadaDeTitulo(titulo: string): string | null {
  const anio = anioConocido(titulo);
  return anio === null ? null : decadaDe(anio);
}

/** Cercanía de dos años como factor 0..1 (1 = mismo año). */
export function cercaniaAnios(a: number, b: number): number {
  const d = Math.abs(a - b);
  if (d === 0) return 1;
  if (d <= 2) return 0.8;
  if (d <= 5) return 0.5;
  if (d <= 10) return 0.25;
  return 0;
}

/** Tabla completa (para /api/v1/estado y depuración). */
export function tablaAnios(): Record<string, number> {
  return { ...ANIOS_SERIES };
}

export default anioConocido;
