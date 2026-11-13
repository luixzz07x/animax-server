// ─────────────────────────────────────────────────────────────
// ANIMAX · Alias de búsqueda (inglés ↔ romaji).
// Las fuentes hispanas catalogan por título romaji; si el usuario
// busca "Rent a Girlfriend" nada contiene esa cadena y la búsqueda
// devolvía 0 resultados. Este módulo expande la consulta a sus
// títulos equivalentes y la API las busca TODAS en paralelo.
// ─────────────────────────────────────────────────────────────

import { normalizarTitulo } from "./http";

/** Claves y valores ya normalizados (minúsculas, sin acentos/puntuación). */
const ALIAS: Record<string, string[]> = {
  "rent a girlfriend": ["kanojo okarishimasu"],
  "attack on titan": ["shingeki no kyojin"],
  "demon slayer": ["kimetsu no yaiba"],
  "my hero academia": ["boku no hero academia"],
  "hero academia": ["boku no hero academia"],
  "the seven deadly sins": ["nanatsu no taizai"],
  "seven deadly sins": ["nanatsu no taizai"],
  "that time i got reincarnated as a slime": ["tensei shitara slime datta ken"],
  "reincarnated as a slime": ["tensei shitara slime datta ken"],
  "the promised neverland": ["yakusoku no neverland"],
  "promised neverland": ["yakusoku no neverland"],
  "the rising of the shield hero": ["tate no yuusha no nariagari"],
  "shield hero": ["tate no yuusha no nariagari"],
  "the eminence in shadow": ["kage no jitsuryokusha ni naritakute"],
  "your lie in april": ["shigatsu wa kimi no uso"],
  "a silent voice": ["koe no katachi"],
  "your name": ["kimi no na wa"],
  "weathering with you": ["tenki no ko"],
  "i want to eat your pancreas": ["kimi no suizou wo tabetai"],
  "food wars": ["shokugeki no soma"],
  "blue exorcist": ["ao no exorcist"],
  "erased": ["boku dake ga inai machi"],
  "parasyte": ["kiseijuu"],
  "fire force": ["enen no shouboutai"],
  "konosuba": ["kono subarashii sekai ni shukufuku wo"],
  "gurren lagann": ["tengen toppa gurren lagann"],
  "kaguya sama love is war": ["kaguya sama wa kokurasetai"],
  "kaguya sama": ["kaguya sama wa kokurasetai"],
  "frieren": ["sousou no frieren"],
  "danmachi": ["dungeon ni deai wo motomeru no wa machigatteiru darou ka"],
  "haikyuu": ["haikyu"],
  "haikyu": ["haikyuu"],
  "the quintessential quintuplets": ["gotoubun no hanayome"],
  "quintessential quintuplets": ["gotoubun no hanayome"],
  "my dress up darling": ["sono bisque doll wa koi wo suru"],
  "dress up darling": ["sono bisque doll wa koi wo suru"],
  "the angel next door spoils me rotten": ["otonari no tenshi sama"],
  "angel next door": ["otonari no tenshi sama"],
  "call of the night": ["yofukashi no uta"],
  "the apothecary diaries": ["kusuriya no hitorigoto"],
  "apothecary diaries": ["kusuriya no hitorigoto"],
  "the saint magic power is omnipotent": ["seijo no maryoku wa bannou desu"],
  "spy x family": ["spy family"],
  "one punch man": ["wanpanman"],
  "mob psycho 100": ["mob psycho 100"],
  "steins gate": ["steins gate"],
  "re zero": ["re zero kara hajimeru isekai seikatsu"],
  "rezero": ["re zero kara hajimeru isekai seikatsu"],
  "dr stone": ["doctor stone"],
  "tokyo revengers": ["tokyo revengers"],
  "jujutsu kaisen": ["jujutsu kaisen"],
  "chainsaw man": ["chainsaw man"],
  "blue lock": ["blue lock"],
  "solo leveling": ["solo leveling"],
  "the hidden dungeon only i can enter": ["kage no jitsuryokusha ni naritakute"],
  "bocchi the rock": ["bocchi the rock"],
  "horimiya": ["horimiya"],
  "toradora": ["toradora"],
  "banana fish": ["banana fish"],
  "violet evergarden": ["violet evergarden"],
  "vinland saga": ["vinland saga"],
  "hunter x hunter": ["hunter x hunter"],
  "fullmetal alchemist": ["fullmetal alchemist brotherhood"],
  "tokyo ghoul": ["tokyo ghoul"],
  "code geass": ["code geass"],
  "death note": ["death note"],
  "one piece": ["one piece"],
  "naruto": ["naruto"],
  "dragon ball": ["dragon ball"],
};

/** Devuelve la consulta original + alias aplicables (máx. 2 alias).
 *  La coincidencia es por contenido normalizado: "rent a girlfriend
 *  season 2" también dispara el alias de "rent a girlfriend". */
export function expansionesBusqueda(q: string): string[] {
  const nq = normalizarTitulo(q);
  if (!nq) return [q];
  const salida: string[] = [q];
  for (const [clave, alias] of Object.entries(ALIAS)) {
    const coincide =
    nq === clave ||
      (nq.length >= 5 && clave.length >= 5 && (nq.includes(clave) || clave.includes(nq)));
    if (!coincide) continue;
    for (const a of alias) {
      if (a !== nq && !salida.includes(a)) salida.push(a);
    }
    if (salida.length >= 3) break;
  }
  return salida;
}
