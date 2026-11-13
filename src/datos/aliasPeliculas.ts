// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Alias de PELÍCULAS (inglés ↔ español latino ↔
// romaji). Las películas tienen títulos de estreno distintos en
// Latinoamérica ("El Viaje de Chihiro") y las fuentes las
// catalogan con cualquiera de las tres variantes: estos alias
// hacen que una búsqueda en español encuentre el título inglés y
// viceversa. aliasDb.ts los incorpora a `expansionesBusqueda`,
// así que aplican a TODAS las búsquedas de todas las fuentes.
// ─────────────────────────────────────────────────────────────

import { normalizarTitulo } from "../lib/animax/http";

/** Alias por película: título normalizado ↔ variantes. */
const ALIAS_PELICULAS: Record<string, string[]> = {
  "your name": ["kimi no na wa", "el viaje de tu nombre"],
  "spirited away": ["el viaje de chihiro", "sen to chihiro no kamikakushi"],
  "a silent voice": ["koe no katachi", "una voz silenciosa"],
  "princess mononoke": ["la princesa mononoke", "mononoke hime"],
  "howls moving castle": ["el castillo ambulante", "howl no ugoku shiro"],
  "my neighbor totoro": ["mi vecino totoro", "tonari no totoro"],
  "grave of the fireflies": ["la tumba de las luciernagas", "hotaru no haka"],
  "weathering with you": ["tenki no ko", "el tiempo contigo"],
  "the girl who leapt through time": [
    "toki wo kakeru shoujo",
    "la chica que saltaba a traves del tiempo",
  ],
  "wolf children": ["los ninos lobo", "ookami kodomo no ame to yuki"],
  "5 centimeters per second": ["5 centimetros por segundo", "byousoku 5 cm"],
  "nausicaa of the valley of the wind": ["nausicaa del valle del viento", "kaze no tani no nausicaa"],
  "the tale of the princess kaguya": ["el cuento de la princesa kaguya", "kaguya hime no monogatari"],
  "ghost in the shell": ["el alma de la maquina", "kokaku kidotai"],
  "demon slayer mugen train": ["kimetsu no yaiba mugen ressha hen", "tren infinito"],
  "one piece film red": ["one piece film reddo", "film red"],
  "dragon ball super broly": ["dbs broly", "broly"],
  "dragon ball super super hero": ["dbs super hero", "super hero"],
  "akira": ["akira 1988"],
  "perfect blue": ["pafecto buru"],
  "paprika": ["papurika"],
  "suzume": ["suzume no tojimari", "suzume no tojimari 2022"],
  "tokyo godfathers": ["tokyo godfathers 2003"],
  "jujutsu kaisen 0": ["jujutsu kaisen zero", "jjk 0"],
  "redline": ["redline 2009", "red line"],
};

/** Todas las variantes conocidas de un título de película. */
export function aliasPelicula(titulo: string): string[] {
  const n = normalizarTitulo(titulo);
  if (!n) return [];
  const propias = ALIAS_PELICULAS[n] || [];
  // También la clave inversa: buscar por un alias devuelve el canónico.
  for (const [clave, alias] of Object.entries(ALIAS_PELICULAS)) {
    if (alias.includes(n) && !propias.includes(clave)) propias.push(clave);
  }
  return [...new Set(propias)];
}

/** ¿El término parece el título/alias de una película semilla? */
export function esAliasPelicula(termino: string): boolean {
  const n = normalizarTitulo(termino);
  if (!n) return false;
  if (ALIAS_PELICULAS[n]) return true;
  return Object.values(ALIAS_PELICULAS).some((alias) => alias.includes(n));
}

/** Pares clave→alias para integrar en aliasDb.EXTRA. */
export function paresAliasPeliculas(): Record<string, string[]> {
  return { ...ALIAS_PELICULAS };
}

/** Total de alias de películas (métrica de /api/v1/estado). */
export function totalAliasPeliculas(): number {
  return Object.values(ALIAS_PELICULAS).reduce((acc, v) => acc + v.length, 0);
}

export default aliasPelicula;
