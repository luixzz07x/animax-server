// ANIMAX v5 · AnimeID (animeid.tv) — audio LATINO.
// Sitio clásico de anime doblado: directorio /directorio, fichas
// /anime/{slug}, episodios /ver/{slug}/{ep}. El buscador responde
// a /buscar?q= con tarjetas estándar; si cambia de tema, el motor
// genérico (selectores amplios + heurística de tarjetas) sigue
// extrayendo y si el dominio cae el registro omite la fuente
// (failover silencioso + dominios alternativos .to/.xyz).
import { fabricarScraper } from "../lib/animax/scrapers/fabrica";
import { obtenerHttp } from "../lib/animax/http";
import { cargar, extraerTarjetas, slugDeUrl, detectarTipo } from "../lib/animax/scrapers/motor";
import type { AnimeCard, Scraper } from "../lib/animax/types";

const BASE = "https://animeid.tv";
const ID = "animeid";
const NOMBRE = "AnimeID";
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
    tarjeta: "article, .card, .anime-item, li[class*=anime]",
    titulo: "h3, .title, a",
    imagen: "img",
    enlace: "a",
  },
});

const scraper: Scraper = {
  ...base,
  // AnimeID también filtra por letra en /directorio?q=: se usa como
  // segunda vía cuando el buscador genérico no devuelve nada.
  async buscar(q: string): Promise<AnimeCard[]> {
    const propias = await base.buscar(q);
    if (propias.length > 0) return propias;
    const html = await obtenerHttp(`${BASE}/directorio?q=${encodeURIComponent(q)}`, {
      timeoutMs: 4500,
    });
    const $ = cargar(html ?? "");
    if (!$) return [];
    const tarjetas = extraerTarjetas($, BASE, {
      tarjeta: "article, .card, li[class*=anime]",
      imagen: "img",
      enlace: "a",
    });
    const qn = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const salida: AnimeCard[] = [];
    for (const t of tarjetas) {
      const slugLocal = slugDeUrl(t.url);
      if (!slugLocal) continue;
      const tn = t.titulo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!tn.includes(qn)) continue;
      salida.push({
        titulo: t.titulo,
        slug: `${ID}~${slugLocal}`,
        portada: t.portada,
        generos: [],
        idioma: IDIOMA,
        tipo: detectarTipo(slugLocal, t.titulo, t.url),
        fuentes: [
          { fuente: ID, nombre: NOMBRE, slugLocal, url: t.url, idioma: IDIOMA },
        ],
      });
    }
    return salida.slice(0, 12);
  },
};

export default scraper;
