// ─────────────────────────────────────────────────────────────
// ANIMAX · Scraper TioAnime (tioanime.com) — ESTRUCTURA VERIFICADA
//  - Portada:   .episode/.thumb a[href^=/ver/] → últimos eps
//  - Buscar:    /directorio?q={q} → article.anime .thumb a[href^=/anime/]
//  - Detalle:   /anime/{slug} → var anime_info, var episodes,
//               .genres a, sinopsis (.description/.text)
//  - Episodio:  /ver/{slug}-{n} → var videos = [["Mega", url], …]
// ─────────────────────────────────────────────────────────────

import * as cheerio from "cheerio";
import { obtenerHttp, absoluta } from "../http";
import type { AnimeCard, AnimeDetalle, EpisodioFeed, EpisodioItem, Scraper, ServidorVideo } from "../types";
import { cargar, clasificar, episodiosDeLista, nombreServidor, detectarTipo } from "./motor";

const ID = "tioanime";
const NOMBRE = "TioAnime";
const BASE = "https://tioanime.com";
const IDIOMA = "sub" as const;

async function buscar(q: string): Promise<AnimeCard[]> {
  const html = await obtenerHttp(`${BASE}/directorio?q=${encodeURIComponent(q)}`, { timeoutMs: 5000 });
  const $ = cargar(html ?? "");
  if (!$) return [];
  const salida: AnimeCard[] = [];
  const vistos = new Set<string>();
  $("article.anime, .anime").each((_, el) => {
    const nodo = $(el);
    const href = nodo.find("a[href^='/anime/']").first().attr("href");
    if (!href) return;
    const slugLocal = href.replace(/^\/anime\//, "").replace(/\/$/, "");
    if (!slugLocal || vistos.has(slugLocal)) return;
    const titulo = nodo.find("h3.title, .title").first().text().trim() || nodo.find("a").first().attr("title") || "";
    if (!titulo) return;
    const portada = absoluta(nodo.find("img").first().attr("src") || "", BASE);
    vistos.add(slugLocal);
    salida.push({
      titulo,
      slug: `${ID}~${slugLocal}`,
      portada,
      generos: [],
      idioma: IDIOMA,
      tipo: detectarTipo(slugLocal, titulo),
      fuentes: [{ fuente: ID, nombre: NOMBRE, slugLocal, url: absoluta(href, BASE), idioma: IDIOMA }],
    });
  });
  return salida;
}

async function obtenerUltimos(): Promise<EpisodioFeed[]> {
  const html = await obtenerHttp(`${BASE}/`, { timeoutMs: 5000 });
  const $ = cargar(html ?? "");
  if (!$) return [];
  const salida: EpisodioFeed[] = [];
  // Enlaces /ver/{slug}-{n} en portada
  $("a[href^='/ver/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/^\/ver\/([a-z0-9\-]+)-(\d{1,4})$/i);
    if (!m) return;
    const slugLocal = m[1];
    const numero = parseInt(m[2]);
    const nodo = $(el).closest("article, .thumb, li, div");
    const titulo =
      nodo.find("h3.title, .title").first().text().trim() ||
      nodo.find("img").first().attr("alt") ||
      "";
    const portada = absoluta(nodo.find("img").first().attr("src") || "", BASE);
    if (!titulo) return;
    if (salida.some((e) => e.slug === `${ID}~${slugLocal}` && e.numero === numero)) return;
    salida.push({
      titulo,
      slug: `${ID}~${slugLocal}`,
      portada,
      numero,
      idioma: IDIOMA,
      fuente: ID,
      nombreFuente: NOMBRE,
    });
  });
  return salida.slice(0, 24);
}

async function obtenerAnime(slugLocal: string): Promise<AnimeDetalle | null> {
  const html = await obtenerHttp(`${BASE}/anime/${slugLocal}`, { timeoutMs: 6000 });
  if (!html) return null;
  const $ = cargar(html ?? "");
  if (!$) return null;
  const titulo = $(".info h1, h1.title, .title").first().text().trim() || $("h3.title").first().text().trim();
  if (!titulo) return null;
  const sinopsis =
    $(".description, .sinopsis, .text p").first().text().trim() ||
    $('meta[property="og:description"]').attr("content") ||
    undefined;
  const generos: string[] = [];
  $(".genres a").each((_, el) => {
    const g = $(el).text().trim();
    if (g && g.length < 30) generos.push(g);
  });
  const portada = absoluta(
    $(".info img, .thumb img, aside img").first().attr("src") ||
      $('meta[property="og:image"]').attr("content") ||
      "",
    BASE
  );
  // var episodes = [5,4,3,2,1];
  const episodios: EpisodioItem[] = [];
  const m = html.match(/var\s+episodes\s*=\s*(\[[\d\s,]*\])\s*;/);
  if (m) {
    try {
      const nums = JSON.parse(m[1]) as number[];
      episodios.push(...episodiosDeLista(nums));
    } catch {
      /* silencioso */
    }
  }
  const tipo = detectarTipo(slugLocal, titulo) || $(".anime-type, .anime-type-peli").first().text().trim() || undefined;
  return {
    titulo,
    slug: `${ID}~${slugLocal}`,
    portada,
    sinopsis,
    generos,
    estado: episodios.length ? "En emisión" : "Desconocido",
    totalEpisodios: episodios.length,
    idioma: IDIOMA,
    tipo,
    fuentes: [{ fuente: ID, nombre: NOMBRE, slugLocal, url: `${BASE}/anime/${slugLocal}`, idioma: IDIOMA }],
    episodios,
  };
}

async function obtenerServidores(slugLocal: string, episodio: number): Promise<ServidorVideo[]> {
  const html = await obtenerHttp(`${BASE}/ver/${slugLocal}-${episodio}`, {
    timeoutMs: 6000,
    referer: `${BASE}/anime/${slugLocal}`,
  });
  if (!html) return [];
  const salida: ServidorVideo[] = [];
  // var videos = [["Mega","https://mega.nz/embed/...",0,0], ["YourUpload", "..."]]
  const m = html.match(/var\s+videos\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (m) {
    try {
      const arr = JSON.parse(m[1].replace(/,\s*\]/g, "]")) as unknown[][];
      for (const it of arr) {
        if (Array.isArray(it) && typeof it[1] === "string" && /^https?:\/\//.test(it[1])) {
          salida.push({
            servidor: nombreServidor(String(it[0] ?? ""), it[1]),
            tipo: clasificar(it[1]),
            url: it[1],
            resuelto: false,
            fuente: ID,
          });
        }
      }
    } catch {
      /* silencioso */
    }
  }
  return salida;
}

const scraper: Scraper = {
  id: ID,
  nombre: NOMBRE,
  baseUrl: BASE,
  idioma: IDIOMA,
  buscar,
  obtenerUltimos,
  obtenerAnime,
  obtenerServidores,
};

export default scraper;
