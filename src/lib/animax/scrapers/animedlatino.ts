// ANIMAX · AnimeDLatino (animedlatino.com) — dual (latino y sub).
import { fabricarScraper } from "./fabrica";
import type { Scraper } from "../types";

const scraper: Scraper = fabricarScraper({
  id: "animedlatino",
  nombre: "AnimeDLatino",
  baseUrl: "https://animedlatino.com",
  idioma: "dual",
  rutaBuscar: (q) => `https://animedlatino.com/buscar?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://animedlatino.com/",
  rutaAnime: (slug) => `https://animedlatino.com/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://animedlatino.com/ver/${slug}/${ep}`,
  selectores: { tarjeta: "article, .card, .anime", imagen: "img", enlace: "a" },
});

export default scraper;
