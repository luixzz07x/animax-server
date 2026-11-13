// ANIMAX · AnimeMovil (animemovil.com) — audio latino.
import { fabricarScraper } from "./fabrica";
import type { Scraper } from "../types";

const scraper: Scraper = fabricarScraper({
  id: "animemovil",
  nombre: "AnimeMovil",
  baseUrl: "https://www.animemovil.com",
  idioma: "latino",
  rutaBuscar: (q) => `https://www.animemovil.com/buscar?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://www.animemovil.com/",
  rutaAnime: (slug) => `https://www.animemovil.com/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://www.animemovil.com/ver/${slug}/${ep}`,
  selectores: { tarjeta: "article, .card, .anime", imagen: "img", enlace: "a" },
});

export default scraper;
