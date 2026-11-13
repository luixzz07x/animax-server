// ANIMAX v5 · AnimeNova (animenova.org) — SUB.
// Agregador de episodios con portada tipo grid: fichas
// /anime/{slug}, capítulos /watch/{slug}/{ep}. El buscador nativo
// está en /search?q=; el motor genérico extrae las tarjetas y si
// el sitio cae el vigilante prueba .tv antes de declararlo muerto.
import { fabricarScraper } from "../lib/animax/scrapers/fabrica";
import type { Scraper } from "../lib/animax/types";

const scraper: Scraper = fabricarScraper({
  id: "animenova",
  nombre: "AnimeNova",
  baseUrl: "https://www.animenova.org",
  idioma: "sub",
  rutaBuscar: (q) => `https://www.animenova.org/search?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://www.animenova.org/",
  rutaAnime: (slug) => `https://www.animenova.org/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://www.animenova.org/watch/${slug}/${ep}`,
  selectores: {
    tarjeta: "article, .card, .anime, li[class*=anime], .col-item",
    titulo: "h3, .title, a",
    imagen: "img",
    enlace: "a",
  },
});

export default scraper;
