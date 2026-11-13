// ANIMAX v5 · OtaksTV (otak.tv) — audio LATINO.
// Directorio por orden alfabético en /directorio, fichas /anime/{slug},
// episodios /ver/{slug}/{ep}. El feed de portada mezcla novedades y
// "próximamente": la heurística del motor genérico descarta las
// tarjetas de navegación y los badges, y el buscador usa su
// endpoint propio /buscar?q=.
import { fabricarScraper } from "../lib/animax/scrapers/fabrica";
import { obtenerHttp } from "../lib/animax/http";
import { cargar, extraerTarjetas, slugDeUrl, feedDesde } from "../lib/animax/scrapers/motor";
import type { EpisodioFeed, Scraper } from "../lib/animax/types";

const BASE = "https://otak.tv";
const ID = "otakstv";
const NOMBRE = "OtaksTV";
const IDIOMA = "latino" as const;

const base = fabricarScraper({
  id: ID,
  nombre: NOMBRE,
  baseUrl: BASE,
  idioma: IDIOMA,
  rutaBuscar: (q) => `${BASE}/buscar?q=${encodeURIComponent(q)}`,
  rutaUltimos: `${BASE}/ultimos-episodios`,
  rutaAnime: (slug) => `${BASE}/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `${BASE}/ver/${slug}/${ep}`,
  selectores: {
    tarjeta: "article, .card, .anime, li[class*=anime]",
    titulo: "h3, .title, a",
    imagen: "img",
    enlace: "a",
  },
});

const scraper: Scraper = {
  ...base,
  // El listado de "últimos" de OtaksTV a veces no marca el número de
  // episodio en la tarjeta: se extrae del enlace /ver/{slug}/{n} y si
  // sigue sin aparecer se deduce 1 (el feed exige un número válido).
  async obtenerUltimos(): Promise<EpisodioFeed[]> {
    const propias = await base.obtenerUltimos();
    if (propias.length > 0) return propias;
    const html = await obtenerHttp(`${BASE}/directorio`, { timeoutMs: 5000 });
    const $ = cargar(html ?? "");
    if (!$) return [];
    const tarjetas = extraerTarjetas($, BASE, {
      tarjeta: "article, .card, li[class*=anime]",
      imagen: "img",
      enlace: "a",
    });
    const salida: EpisodioFeed[] = [];
    for (const t of tarjetas) {
      const m = t.url.match(/\/(?:ver|watch)\/([a-z0-9\-]+)\/(\d{1,4})/i);
      if (!m) continue;
      salida.push(feedDesde(ID, NOMBRE, IDIOMA, t.titulo, m[1], t.portada, parseInt(m[2])));
      if (salida.length >= 20) break;
    }
    return salida;
  },
};

export default scraper;
