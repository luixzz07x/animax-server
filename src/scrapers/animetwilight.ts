// ANIMAX v5 · AnimeTwilight (animetwilight.com) — DUAL (latino + sub).
// Estructura tipo AnimeFLV clone: /directorio para el listado,
// fichas /anime/{slug} con sinopsis y géneros, episodios
// /ver/{slug}/{ep} con servidores en iframes + data-video.
import { fabricarScraper } from "../lib/animax/scrapers/fabrica";
import type { Scraper } from "../lib/animax/types";

const scraper: Scraper = fabricarScraper({
  id: "animetwilight",
  nombre: "AnimeTwilight",
  baseUrl: "https://animetwilight.com",
  idioma: "dual",
  rutaBuscar: (q) => `https://animetwilight.com/browse?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://animetwilight.com/",
  rutaAnime: (slug) => `https://animetwilight.com/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://animetwilight.com/ver/${slug}/${ep}`,
  selectores: {
    tarjeta: "article, .card, .anime, li[class*=anime], .col-item",
    titulo: "h3, .title, a",
    imagen: "img",
    enlace: "a",
  },
});

export default scraper;
