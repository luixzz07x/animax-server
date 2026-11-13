// ─────────────────────────────────────────────────────────────
// ANIMAX · Lista CURADA de destacados ("no te quedas sin anime").
// Títulos de altísima demanda resueltos perezosamente a través del
// índice local y, si faltan, de búsqueda viva (cache 6 h).
// El fallback universal del reproductor garantiza que cualquier
// episodio de estos títulos siempre acabe resolviendo servidores.
// ─────────────────────────────────────────────────────────────

import { conCache } from "./cache";
import { leerIndice, indexarAnime } from "./indice";
import { buscarUnificado } from "./registro";
import { slugDeduplicado, mejorIdioma } from "./dedupe";
import { normalizarTitulo } from "./http";
import type { AnimeCard, Idioma, RespuestaAPI } from "./types";

export interface Curado {
  titulo: string;
  /** Slug global deduplicado (ded:…) al que navega la app al hacer click */
  slug: string;
  portada?: string;
  idioma: Idioma;
  totalEpisodios?: number;
  /** true si hay al menos una fuente viva con episodios */
  disponible: boolean;
}

interface DefCurado {
  titulo: string;
  /** Títulos alternativos para la búsqueda viva */
  alternativas?: string[];
  /** Forzar etiqueta LATINO (p. ej. Rent a Girlfriend) */
  forzarLatino?: boolean;
}

/** Títulos curados: los imprescindibles del anime (versión extendida). */
const TITULOS: DefCurado[] = [
  { titulo: "Rent a Girlfriend", alternativas: ["Kanojo, Okarishimasu", "Kanojo Okarishimasu"], forzarLatino: true },
  { titulo: "One Piece" },
  { titulo: "Naruto" },
  { titulo: "Naruto Shippuden", alternativas: ["Naruto: Shippuden"] },
  { titulo: "Dragon Ball" },
  { titulo: "Dragon Ball Z" },
  { titulo: "Dragon Ball Super" },
  { titulo: "Dragon Ball GT" },
  { titulo: "Attack on Titan", alternativas: ["Shingeki no Kyojin"] },
  { titulo: "Demon Slayer", alternativas: ["Kimetsu no Yaiba"] },
  { titulo: "Jujutsu Kaisen" },
  { titulo: "My Hero Academia", alternativas: ["Boku no Hero Academia"] },
  { titulo: "Bleach" },
  { titulo: "One Punch Man" },
  { titulo: "Sword Art Online" },
  { titulo: "Re:Zero", alternativas: ["Re:Zero kara Hajimeru Isekai Seikatsu"] },
  { titulo: "Spy x Family" },
  { titulo: "Chainsaw Man" },
  { titulo: "Tokyo Revengers" },
  { titulo: "Haikyuu", alternativas: ["Haikyu!!"] },
  { titulo: "Black Clover" },
  { titulo: "Bungou Stray Dogs" },
  { titulo: "That Time I Got Reincarnated as a Slime", alternativas: ["Tensei Shitara Slime Datta Ken"] },
  { titulo: "Steins;Gate" },
  { titulo: "Death Note" },
  { titulo: "Fullmetal Alchemist" },
  { titulo: "Vinland Saga" },
  { titulo: "Hunter x Hunter" },
  { titulo: "Tokyo Ghoul" },
  { titulo: "Blue Exorcist", alternativas: ["Ao no Exorcist"] },
  { titulo: "The Seven Deadly Sins", alternativas: ["Nanatsu no Taizai"] },
  { titulo: "Fairy Tail" },
  { titulo: "Konosuba", alternativas: ["Kono Subarashii Sekai ni Shukufuku wo"] },
  { titulo: "Overlord" },
  { titulo: "No Game No Life" },
  { titulo: "The Promised Neverland", alternativas: ["Yakusoku no Neverland"] },
  { titulo: "Dr. Stone" },
  { titulo: "Fire Force", alternativas: ["Enen no Shouboutai"] },
  { titulo: "Mob Psycho 100" },
  { titulo: "Toradora" },
  { titulo: "Clannad" },
  { titulo: "Your Lie in April", alternativas: ["Shigatsu wa Kimi no Uso"] },
  { titulo: "Horimiya" },
  { titulo: "Kaguya-sama: Love is War", alternativas: ["Kaguya-sama wa Kokurasetai"] },
  { titulo: "Dandadan" },
  { titulo: "Kaiju No. 8" },
  { titulo: "Solo Leveling" },
  { titulo: "The Eminence in Shadow", alternativas: ["Kage no Jitsuryokusha ni Naritakute"] },
  { titulo: "Mushoku Tensei" },
  { titulo: "The Rising of the Shield Hero", alternativas: ["Tate no Yuusha no Nariagari"] },
  { titulo: "Log Horizon" },
  { titulo: "Goblin Slayer" },
  { titulo: "Dororo" },
  { titulo: "Banana Fish" },
  { titulo: "Erased", alternativas: ["Boku dake ga Inai Machi"] },
  { titulo: "Parasyte", alternativas: ["Kiseijuu"] },
  { titulo: "Made in Abyss" },
  { titulo: "Cowboy Bebop" },
  { titulo: "Samurai Champloo" },
  { titulo: "Neon Genesis Evangelion", alternativas: ["Evangelion"] },
  { titulo: "Code Geass" },
  { titulo: "Gurren Lagann", alternativas: ["Tengen Toppa Gurren Lagann"] },
  { titulo: "Fate/Zero" },
  { titulo: "DanMachi", alternativas: ["Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka"] },
  { titulo: "Boruto" },
  { titulo: "Detective Conan" },
  { titulo: "Inuyasha" },
  { titulo: "Slam Dunk" },
  { titulo: "Kuroko no Basket" },
  { titulo: "Food Wars", alternativas: ["Shokugeki no Soma"] },
  { titulo: "Oshi no Ko" },
  { titulo: "Frieren", alternativas: ["Sousou no Frieren"] },
  { titulo: "Cyberpunk: Edgerunners" },
  { titulo: "Akame ga Kill" },
  { titulo: "Charlotte" },
  { titulo: "Angel Beats" },
  { titulo: "Anohana" },
  { titulo: "Violet Evergarden" },
];

function desdeEntrada(def: DefCurado, entrada: {
  portada: string | null;
  totalEpisodios: number;
  fuentes: { fuente: string; idioma: Idioma }[];
}): Curado {
  const mejor = mejorIdioma(entrada.fuentes);
  return {
    titulo: def.titulo,
    slug: slugDeduplicado(def.titulo),
    portada: entrada.portada || undefined,
    idioma: def.forzarLatino ? "latino" : mejor,
    totalEpisodios: entrada.totalEpisodios > 0 ? entrada.totalEpisodios : undefined,
    disponible: entrada.fuentes.length > 0,
  };
}

function desdeTarjeta(def: DefCurado, card: AnimeCard): Curado {
  return {
    titulo: def.titulo,
    slug: slugDeduplicado(def.titulo),
    portada: card.portada || undefined,
    idioma: def.forzarLatino ? "latino" : mejorIdioma(card.fuentes),
    totalEpisodios: card.totalEpisodios && card.totalEpisodios > 0 ? card.totalEpisodios : undefined,
    // La búsqueda fue EN VIVA: si devolvió fuentes, hay fuente viva
    disponible: card.fuentes.length > 0,
  };
}

/** Busca en vivo un título curado (con alternativas) y devuelve la mejor
 *  coincidencia EXACTA por título normalizado. */
async function buscarCurado(def: DefCurado): Promise<AnimeCard | null> {
  const consultas = [def.titulo, ...(def.alternativas ?? [])];
  for (const q of consultas) {
    const res = await buscarUnificado(q);
    const clave = normalizarTitulo(q);
    const exacta = (res.data?.resultados ?? []).find(
      (c) => normalizarTitulo(c.titulo) === clave
    );
    if (exacta && exacta.fuentes.length > 0) return exacta;
  }
  return null;
}

/** Ejecuta tareas con concurrencia limitada (evita saturar las fuentes). */
async function conConcurrencia<T, R>(
  items: T[],
  limite: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const salida: R[] = [];
  let i = 0;
  const trabajadores = Array.from({ length: Math.min(limite, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      salida[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(trabajadores);
  return salida;
}

/** GET /api/v1/curados — lista curada resuelta (índice + búsqueda viva
 *  perezosa, caché 6 h). */
export async function curadosUnificados(): Promise<
  RespuestaAPI<{ curados: Curado[] }>
> {
  const curados = await conCache("curados", "global", async () => {
    // Fase 1: resolver por el índice local (ultrarrápido, sin scraping)
    const pendientes: { idx: number; def: DefCurado }[] = [];
    const salida: Curado[] = new Array(TITULOS.length);

    for (let idx = 0; idx < TITULOS.length; idx++) {
      const def = TITULOS[idx];
      const entrada = await leerIndice(slugDeduplicado(def.titulo));
      if (entrada && entrada.fuentes.length > 0) {
        salida[idx] = desdeEntrada(def, entrada);
      } else {
        pendientes.push({ idx, def });
      }
    }

    // Fase 2: búsqueda viva (concurrente) solo para los que faltan
    await conConcurrencia(pendientes, 4, async ({ idx, def }) => {
      const card = await buscarCurado(def);
      if (card) {
        salida[idx] = desdeTarjeta(def, card);
        // Indexa la tarjeta bajo el TÍTULO CURADO (ded:{titulo curado})
        // aunque la fuente la conozca por otro nombre (p. ej. "Rent a
        // Girlfriend" = "Kanojo, Okarishimasu"): así el detalle y el
        // reproductor universal resuelven desde el slug del destacado.
        void indexarAnime({
          ...card,
          titulo: def.titulo,
          slug: slugDeduplicado(def.titulo),
        });
      } else {
        // Sin resolución ahora: se lista como no disponible (el fallback
        // universal del reproductor lo revivirá al hacer click).
        salida[idx] = {
          titulo: def.titulo,
          slug: slugDeduplicado(def.titulo),
          idioma: def.forzarLatino ? "latino" : "sub",
          disponible: false,
        };
      }
    });

    return { curados: salida.filter((c): c is Curado => Boolean(c)) };
  });
  return { ok: true, data: curados };
}

/** Calentamiento en background para el cron de 10 min. */
export function calentarCurados(): void {
  void curadosUnificados().catch(() => {
    /* silencioso */
  });
}
