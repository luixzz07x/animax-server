// ANIMAX · AnimeBlix (animeblix.com) — sub. Sitio WordPress.
import { fabricarScraper } from "./fabrica";
import type { Scraper } from "../types";

const scraper: Scraper = fabricarScraper({
  id: "animeblix",
  nombre: "AnimeBlix",
  baseUrl: "https://animeblix.com",
  idioma: "sub",
  rutaBuscar: (q) => `https://animeblix.com/?s=${encodeURIComponent(q)}`,
  rutaUltimos: "https://animeblix.com/",
  rutaAnime: (slug) => `https://animeblix.com/anime/${slug}/`,
  rutaEpisodio: (slug, ep) => `https://animeblix.com/${slug}-${ep}/`,
  selectores: { tarjeta: "article, .card", imagen: "img", enlace: "a" },
});

export default scraper;
