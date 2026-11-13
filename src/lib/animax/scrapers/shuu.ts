// ANIMAX · Shuu.tv (shuu.tv) — sub. Estructura pública conocida:
// buscar /buscar?q=, detalle /anime/{slug}, cap /ver/{slug}/{n}.
import { fabricarScraper } from "./fabrica";
import type { Scraper } from "../types";

const scraper: Scraper = fabricarScraper({
  id: "shuu",
  nombre: "Shuu.tv",
  baseUrl: "https://shuu.tv",
  idioma: "sub",
  rutaBuscar: (q) => `https://shuu.tv/buscar?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://shuu.tv/",
  rutaAnime: (slug) => `https://shuu.tv/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://shuu.tv/ver/${slug}/${ep}`,
  selectores: { tarjeta: ".tt, article, .card", imagen: "img", enlace: "a" },
});

export default scraper;
