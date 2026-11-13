// ANIMAX v5 · AnimeBuka (animebuka.com) — SUB.
// Sitio con estructura WordPress (posts de episodio): fichas
// /anime/{slug}/, capítulos /{slug}-{ep}/ (patrón AnimeBlix). El
// motor genérico cubre búsqueda y feed; el detalle extrae
// episodios de los href tipo /{slug}-{n}/.
import { fabricarScraper } from "../lib/animax/scrapers/fabrica";
import type { Scraper } from "../lib/animax/types";

const scraper: Scraper = fabricarScraper({
  id: "animebuka",
  nombre: "AnimeBuka",
  baseUrl: "https://animebuka.com",
  idioma: "sub",
  rutaBuscar: (q) => `https://animebuka.com/?s=${encodeURIComponent(q)}`,
  rutaUltimos: "https://animebuka.com/",
  rutaAnime: (slug) => `https://animebuka.com/anime/${slug}/`,
  rutaEpisodio: (slug, ep) => `https://animebuka.com/${slug}-${ep}/`,
  selectores: {
    tarjeta: "article, .card, .anime, li[class*=anime]",
    titulo: "h2, h3, .title, a",
    imagen: "img",
    enlace: "a",
  },
});

export default scraper;
