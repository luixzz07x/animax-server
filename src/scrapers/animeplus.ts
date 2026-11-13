// ANIMAX v5 · AnimePlus (animeplus.vc) — SUB.
// Mirror de AnimeFLV con el mismo layout (directorio /directory,
// fichas /anime/{slug}, capítulos /ver/{slug}/{ep} y servidores
// embebidos con data-src base64 — el escáner genérico del motor
// los decodifica y los extraedores resuelven el link directo).
import { fabricarScraper } from "../lib/animax/scrapers/fabrica";
import type { Scraper } from "../lib/animax/types";

const scraper: Scraper = fabricarScraper({
  id: "animeplus",
  nombre: "AnimePlus",
  baseUrl: "https://animeplus.vc",
  idioma: "sub",
  rutaBuscar: (q) => `https://animeplus.vc/browse?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://animeplus.vc/",
  rutaAnime: (slug) => `https://animeplus.vc/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://animeplus.vc/ver/${slug}/${ep}`,
  selectores: {
    tarjeta: "article, .card, .anime, li[class*=anime]",
    titulo: "h3, .title, a",
    imagen: "img",
    enlace: "a",
  },
});

export default scraper;
