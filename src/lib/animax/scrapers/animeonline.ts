// ANIMAX · AnimeOnline (animeonline.ninja) — audio latino.
import { fabricarScraper } from "./fabrica";
import type { Scraper } from "../types";

const scraper: Scraper = fabricarScraper({
  id: "animeonline",
  nombre: "AnimeOnline",
  baseUrl: "https://animeonline.ninja",
  idioma: "latino",
  rutaBuscar: (q) => `https://animeonline.ninja/buscar?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://animeonline.ninja/",
  rutaAnime: (slug) => `https://animeonline.ninja/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://animeonline.ninja/ver/${slug}/${ep}`,
  selectores: { tarjeta: "article, .card, .anime", imagen: "img", enlace: "a" },
});

export default scraper;
