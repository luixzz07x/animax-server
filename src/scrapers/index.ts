// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Índice de scrapers: reexporta los 12 originales de
// src/lib/animax/scrapers y los 8 nuevos de v5 (22 fuentes).
// El registro (src/lib/animax/registro.ts) importa desde aquí.
// ─────────────────────────────────────────────────────────────

import type { Scraper } from "../lib/animax/types";

// ── Originales (motor compartido con la web) ──────────────────
export { default as animeflv } from "../lib/animax/scrapers/animeflv";
export { default as tioanime } from "../lib/animax/scrapers/tioanime";
export { default as animefenix } from "../lib/animax/scrapers/animefenix";
export { default as monoschinos } from "../lib/animax/scrapers/monoschinos";
export { default as jkanime } from "../lib/animax/scrapers/jkanime";
export { default as animeblix } from "../lib/animax/scrapers/animeblix";
export { default as shuu } from "../lib/animax/scrapers/shuu";
export { default as animegratis } from "../lib/animax/scrapers/animegratis";
export { default as animelatinohd } from "../lib/animax/scrapers/animelatinohd";
export { default as animemovil } from "../lib/animax/scrapers/animemovil";
export { default as animeonline } from "../lib/animax/scrapers/animeonline";
export { default as animedlatino } from "../lib/animax/scrapers/animedlatino";

// ── Nuevas de v5 ──────────────────────────────────────────────
export { default as animeid } from "./animeid";
export { default as animeyt } from "./animeyt";
export { default as animeleyend } from "./animeleyend";
export { default as otakstv } from "./otakstv";
export { default as animetwilight } from "./animetwilight";
export { default as animeplus } from "./animeplus";
export { default as animenova } from "./animenova";
export { default as animebuka } from "./animebuka";

import animeid from "./animeid";
import animeyt from "./animeyt";
import animeleyend from "./animeleyend";
import otakstv from "./otakstv";
import animetwilight from "./animetwilight";
import animeplus from "./animeplus";
import animenova from "./animenova";
import animebuka from "./animebuka";

/** Los 8 scrapers añadidos en v5, por orden de registro en fuentes.json. */
export const NUEVAS_V5: Scraper[] = [
  animeid,
  animeyt,
  animeleyend,
  otakstv,
  animetwilight,
  animeplus,
  animenova,
  animebuka,
];
