// ANIMAX v5 · AnimeYT (animeyt.tv) — audio LATINO.
// Clone hispano del clásico AnimeYT: listado de episodios en
// /ultimos, fichas /anime/{slug}, reproductor /ver/{slug}/{ep}.
// Generado con el motor genérico (heuristic de tarjetas + escáner
// de iframes/data-video en la página del episodio). Si el sitio
// muere, el vigilante conmuta a .to/.cc y el registro hace
// failover silencioso.
import { fabricarScraper } from "../lib/animax/scrapers/fabrica";
import type { Scraper } from "../lib/animax/types";

const scraper: Scraper = fabricarScraper({
  id: "animeyt",
  nombre: "AnimeYT",
  baseUrl: "https://animeyt.tv",
  idioma: "latino",
  rutaBuscar: (q) => `https://animeyt.tv/buscar?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://animeyt.tv/ultimos",
  rutaAnime: (slug) => `https://animeyt.tv/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://animeyt.tv/ver/${slug}/${ep}`,
  selectores: {
    tarjeta: "article, .card, .anime, li[class*=anime], .col-item",
    titulo: "h3, .title, a",
    imagen: "img",
    enlace: "a",
  },
});

export default scraper;
