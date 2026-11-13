// ANIMAX · AnimeFenix (animefenix.tv) — sub. Estructura pública conocida:
// buscar /animes?q=, listado .list-animes article, detalle /anime/{slug}
// con .sinfo/.sinopsis, episodios .epl a[data-number], cap /ver/{slug}-{n}
// con #servers .scontent buttons (data-video / data-src).
import { fabricarScraper } from "./fabrica";
import type { Scraper } from "../types";

const scraper: Scraper = fabricarScraper({
  id: "animefenix",
  nombre: "AnimeFenix",
  baseUrl: "https://animefenix.tv",
  idioma: "sub",
  rutaBuscar: (q) => `https://animefenix.tv/animes?fecha=estrenos&q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://animefenix.tv/",
  rutaAnime: (slug) => `https://animefenix.tv/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://animefenix.tv/ver/${slug}-${ep}`,
  selectores: { tarjeta: ".list-animes article, .col-item", imagen: "img", enlace: "a" },
  extraerEpisodios: (html) => {
    const nums = new Set<number>();
    for (const m of html.matchAll(/data-number="(\d{1,4})"/g)) nums.add(parseInt(m[1]));
    for (const m of html.matchAll(/href="[^"]*\/ver\/[a-z0-9\-]+-(\d{1,4})\/?"/gi)) nums.add(parseInt(m[1]));
    return [...nums].filter((n) => n > 0 && n < 5000);
  },
});

export default scraper;
