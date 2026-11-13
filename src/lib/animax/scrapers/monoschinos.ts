// ANIMAX · MonosChinos (monoschinos.com) — dual (latino+sub).
// Estructura pública conocida: buscar /ver-animes?buscar={q},
// detalle /anime/{slug}, cap /ver/{slug}-episodio-{n} con #servers
// (botones que montan iframes con URL codificada).
import { fabricarScraper } from "./fabrica";
import type { Scraper } from "../types";

const scraper: Scraper = fabricarScraper({
  id: "monoschinos",
  nombre: "MonosChinos",
  baseUrl: "https://monoschinos.com",
  idioma: "dual",
  rutaBuscar: (q) => `https://monoschinos.com/ver-animes?buscar=${encodeURIComponent(q)}`,
  rutaUltimos: "https://monoschinos.com/",
  rutaAnime: (slug) => `https://monoschinos.com/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://monoschinos.com/ver/${slug}-episodio-${ep}`,
  selectores: { tarjeta: ".col-item, article, .card", imagen: "img", enlace: "a" },
  extraerEpisodios: (html) => {
    const nums = new Set<number>();
    for (const m of html.matchAll(/href="[^"]*-episodio-(\d{1,4})\/?"/gi)) nums.add(parseInt(m[1]));
    for (const m of html.matchAll(/href="[^"]*\/ver\/[a-z0-9\-]+-(\d{1,4})\/?"/gi)) nums.add(parseInt(m[1]));
    return [...nums].filter((n) => n > 0 && n < 5000);
  },
});

export default scraper;
