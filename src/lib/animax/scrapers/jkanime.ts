// ANIMAX · JkAnime (jkanime.net) — sub. Cloudflare 403 detectado:
// el cliente HTTP rota UA y reintenta con backoff; si sigue fallando,
// el registro omite la fuente (failover silencioso).
// Endpoints conocidos: API JSON /api/search/?value={q}, listado /,
// detalle /anime/{slug}/, cap /{slug}/{ep}/ con iframes de servidores.
import { fabricarScraper } from "./fabrica";
import { obtenerHttp } from "../http";
import type { AnimeCard, Scraper } from "../types";

const BASE = "https://jkanime.net";
const ID = "jkanime";
const NOMBRE = "JkAnime";
const IDIOMA = "sub" as const;

const base = fabricarScraper({
  id: ID,
  nombre: NOMBRE,
  baseUrl: BASE,
  idioma: IDIOMA,
  rutaBuscar: (q) => `${BASE}/anime/?q=${encodeURIComponent(q)}`,
  rutaUltimos: BASE,
  rutaAnime: (slug) => `${BASE}/anime/${slug}/`,
  rutaEpisodio: (slug, ep) => `${BASE}/${slug}/${ep}/`,
  selectores: { tarjeta: ".content-section .col-item, article", imagen: "img", enlace: "a" },
});

const scraper: Scraper = {
  ...base,
  // JkAnime expone API JSON de búsqueda: la usamos primero, HTML como fallback
  async buscar(q: string): Promise<AnimeCard[]> {
    const json = await obtenerHttp(`${BASE}/api/search/?value=${encodeURIComponent(q)}`, {
      timeoutMs: 4500,
      headers: { Accept: "application/json" },
    });
    if (json) {
      try {
        const data = JSON.parse(json) as {
          resultados?: { title?: string; slug?: string; image?: string; synopsis?: string; genres?: string[]; state?: string; types?: string }[];
          search?: { title?: string; slug?: string; image?: string; synopsis?: string; genres?: string[]; state?: string }[];
        };
        const items = data.resultados || data.search || [];
        const salida: AnimeCard[] = [];
        for (const it of items.slice(0, 12)) {
          if (!it.slug || !it.title) continue;
          salida.push({
            titulo: it.title,
            slug: `${ID}~${it.slug}`,
            portada: it.image || "",
            sinopsis: it.synopsis,
            generos: it.genres || [],
            estado: it.state,
            idioma: IDIOMA,
            fuentes: [{ fuente: ID, nombre: NOMBRE, slugLocal: it.slug, url: `${BASE}/anime/${it.slug}/`, idioma: IDIOMA }],
          });
        }
        if (salida.length > 0) return salida;
      } catch {
        /* fallback al HTML */
      }
    }
    return base.buscar(q);
  },
};

export default scraper;
