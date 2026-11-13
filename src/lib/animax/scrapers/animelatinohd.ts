// ANIMAX · AnimeLatinoHD (animelatinohd.com) — audio latino.
// Listado principal en /latinos (catálogo doblado).
import { fabricarScraper } from "./fabrica";
import type { Scraper } from "../types";

const scraper: Scraper = fabricarScraper({
  id: "animelatinohd",
  nombre: "AnimeLatinoHD",
  baseUrl: "https://www.animelatinohd.com",
  idioma: "latino",
  rutaBuscar: (q) => `https://www.animelatinohd.com/latinos?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://www.animelatinohd.com/",
  rutaAnime: (slug) => `https://www.animelatinohd.com/latino/${slug}`,
  rutaEpisodio: (slug, ep) => `https://www.animelatinohd.com/ver/${slug}/${ep}`,
  selectores: { tarjeta: "article, .card, .anime", imagen: "img", enlace: "a" },
});

export default scraper;
