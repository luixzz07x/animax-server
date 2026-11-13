// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Base de alias de búsqueda (extensión del alias.ts
// original). Añade siglas frecuentes de la comunidad (AOT, MHA,
// JJK, DBZ…) y el mapeo INVERSO romaji → inglés, para que buscar
// por "shingeki no kyojin" también encuentre "Attack on Titan" en
// las fuentes que lo catalogan en inglés. El registro importa
// `expansionesBusqueda` desde aquí, así que los alias nuevos
// aplican a TODAS las búsquedas de todas las fuentes.
// ─────────────────────────────────────────────────────────────

import { expansionesBusqueda as expansionesOriginal } from "../lib/animax/alias";
import { normalizarTitulo } from "../lib/animax/http";
import { paresAliasPeliculas } from "./aliasPeliculas";

/** Siglas de la comunidad → título canonical de las fuentes. */
const SIGLAS: Record<string, string> = {
  aot: "shingeki no kyojin",
  snk: "shingeki no kyojin",
  mha: "boku no hero academia",
  bnha: "boku no hero academia",
  jjk: "jujutsu kaisen",
  csm: "chainsaw man",
  kny: "kimetsu no yaiba",
  sxf: "spy x family",
  opm: "one punch man",
  dbz: "dragon ball z",
  dbs: "dragon ball super",
  dbgt: "dragon ball gt",
  sao: "sword art online",
  ngt: "neon genesis evangelion",
  fma: "fullmetal alchemist",
  hxh: "hunter x hunter",
  oshinoko: "oshi no ko",
  tengoku: "tensei shitara slime datta ken",
  slime: "tensei shitara slime datta ken",
  gotoubun: "gotoubun no hanayome",
  kaguya: "kaguya sama wa kokurasetai",
  dressup: "sono bisque doll wa koi wo suru",
  frieren: "sousou no frieren",
  shieldhero: "tate no yuusha no nariagari",
  drrr: "durarara",
  nhk: "welcome to the nhk",
  oregairu: "yahari ore no seishun love come wa machigatteiru",
  wtnk: "yahari ore no seishun love come wa machigatteiru",
};

/** Alias adicionales v5: claves normalizadas → variantes. */
const EXTRA: Record<string, string[]> = {
  "rent a girlfriend": ["kanojo okarishimasu", "kanojo okarishimasu 2nd season"],
  "one piece": ["wanpisu"],
  "naruto": ["naruto shippuden"],
  "dragon ball": ["dragons ball"],
  "dandadan": ["dan dan dan"],
  "kaiju no 8": ["kaiju 8"],
  "solo leveling": ["na honjaman level up", "ore dake level up na ken"],
  "the apothecary diaries": ["kusuriya no hitorigoto"],
  "bocchi the rock": ["bocchi za rokku"],
  "horimiya": ["horimiya piece"],
  "frieren": ["sousou no frieren", "frieren beyond journeys end"],
  "hunter x hunter": ["hunterxhunter"],
  "code geass": ["code geass lelouch of the rebellion"],
  "gintama": ["gintama shirogane no tamashii"],
  "blue lock": ["bluelock"],
  "tokyo revengers": ["toukyou revengers"],
  "mob psycho 100": ["mob saiko 100"],
};

// v5.1: los alias de PELÍCULAS se fusionan con los de series, así que
// buscar "El Viaje de Chihiro" también lanza "Spirited Away" (y
// viceversa) en todas las fuentes.
Object.assign(EXTRA, paresAliasPeliculas());

const MAX_TERMINOS = 4;

/** Consulta → [consulta, alias1, alias2…] (máx. 4 términos). */
export function expansionesBusqueda(q: string): string[] {
  const base = expansionesOriginal(q);
  const salida = [...base];
  const nq = normalizarTitulo(q);
  if (nq) {
    // 1) sigla exacta → título canonical
    const sigla = SIGLAS[nq];
    if (sigla && !salida.includes(sigla)) salida.push(sigla);
    // 2) alias extra por contenido
    for (const [clave, alias] of Object.entries(EXTRA)) {
      const coincide =
        nq === clave ||
        (nq.length >= 5 && clave.length >= 5 && (nq.includes(clave) || clave.includes(nq)));
      if (!coincide) continue;
      for (const a of alias) {
        if (!salida.includes(a) && a !== nq) salida.push(a);
        if (salida.length >= MAX_TERMINOS) break;
      }
      if (salida.length >= MAX_TERMINOS) break;
    }
  }
  return salida.slice(0, MAX_TERMINOS);
}

/** Alias conocidos de un título (para mostrar "también conocido como"). */
export function aliasDe(titulo: string): string[] {
  const n = normalizarTitulo(titulo);
  if (!n) return [];
  const salida: string[] = [];
  for (const [clave, alias] of Object.entries(EXTRA)) {
    if (clave === n) salida.push(...alias);
  }
  for (const [sigla, canonico] of Object.entries(SIGLAS)) {
    if (sigla === n) salida.push(canonico);
  }
  return [...new Set(salida)];
}

/** Registra un alias NUEVO en caliente (p. ej. desde un endpoint admin). */
export function registrarAlias(clave: string, alias: string): void {
  const k = normalizarTitulo(clave);
  const a = normalizarTitulo(alias);
  if (!k || !a || k === a) return;
  EXTRA[k] = [...new Set([...(EXTRA[k] || []), a])];
}

/** Total de alias configurados (métrica de /api/v1/estado). */
export function totalAlias(): number {
  return (
    Object.keys(SIGLAS).length +
    Object.values(EXTRA).reduce((acc, v) => acc + v.length, 0)
  );
}
