// ANIMAX v5 · AnimeLeyend (anime-leyend.net) — DUAL (latino + sub).
// Ficha /anime/{slug} con selector de idioma (lat/sub) por episodio:
// el escáner genérico marca cada servidor y el registro etiqueta el
// idioma según el grupo "dual", así los servidores latinos ganan
// prioridad en el orden final del reproductor universal.
import { fabricarScraper } from "../lib/animax/scrapers/fabrica";
import type { Scraper } from "../lib/animax/types";

const scraper: Scraper = fabricarScraper({
  id: "animeleyend",
  nombre: "AnimeLeyend",
  baseUrl: "https://anime-leyend.net",
  idioma: "dual",
  rutaBuscar: (q) => `https://anime-leyend.net/buscar?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://anime-leyend.net/",
  rutaAnime: (slug) => `https://anime-leyend.net/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://anime-leyend.net/ver/${slug}/${ep}`,
  selectores: {
    tarjeta: "article, .card, .anime, li[class*=anime]",
    titulo: "h3, .title, a",
    imagen: "img",
    enlace: "a",
  },
});

export default scraper;
