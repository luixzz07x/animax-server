// ─────────────────────────────────────────────────────────────
// ANIMAX · Scraper AnimeFLV (animeflv.st) — ESTRUCTURA VERIFICADA
//  - Portada:   .ht_grid_1_5 → últimos episodios (posts WP)
//  - Sidebar:   .sidebar-cat-item → populares
//  - Buscar:    /?s={q}  (WP search, resultados en main o sidebar)
//  - Detalle:   /anime/{slug} → .anime-title, .anime-synopsis p,
//               .genre-tag, JSON .animeflv-episodes-data
//  - Episodio:  /{slug}-{n} → botones .server_btn con data-src
//               en BASE64 (HLS/Voe/Byse/MP4Upload) + app_type Sub/Dub
// ─────────────────────────────────────────────────────────────

import * as cheerio from "cheerio";
import { obtenerHttp, absoluta } from "../http";
import type { AnimeCard, AnimeDetalle, EpisodioFeed, EpisodioItem, Scraper, ServidorVideo } from "../types";
import { cargar, clasificar, nombreServidor, slugDeUrl, detectarTipo } from "./motor";

const ID = "animeflv";
const NOMBRE = "AnimeFLV";
const BASE = "https://animeflv.st";
const IDIOMA = "sub" as const;

function slugDeUrlAnime(url: string): string | null {
  const m = url.match(/\/anime\/([a-z0-9\-]+)\/?$/i);
  return m ? m[1] : null;
}

function slugLocalDePost(url: string): { slug: string; ep: number } | null {
  // Solo enlaces de episodio reales ("-episodio-N", "-ep-N", "-capitulo-N")
  const m = url.match(/\/([a-z0-9\-]+)-(?:episodio|ep|capitulo)-(\d{1,4})\/?$/i);
  if (m) return { slug: m[1], ep: parseInt(m[2]) };
  return null;
}

async function buscar(q: string): Promise<AnimeCard[]> {
  const html = await obtenerHttp(`${BASE}/?s=${encodeURIComponent(q)}`, { timeoutMs: 4000 });
  const $ = cargar(html ?? "");
  if (!$) return [];
  const salida: AnimeCard[] = [];
  const vistos = new Set<string>();
  // Resultados principales (si hay) + sidebar (presente siempre)
  $("article, .ht_grid_1_5, .sidebar-cat-item").each((_, el) => {
    const nodo = $(el);
    const href = nodo.find("a[href*='/anime/']").first().attr("href") || "";
    if (!href) return;
    const slugLocal = slugDeUrl(absoluta(href, BASE));
    if (!slugLocal || vistos.has(slugLocal)) return;
    const titulo =
      nodo.find(".Title, .anime-title, h2, h3").first().text().trim() ||
      nodo.find("a[href*='/anime/']").first().attr("title") ||
      "";
    const portada = absoluta(
      nodo.find("img").first().attr("src") || nodo.find("img").first().attr("data-src") || "",
      BASE
    );
    if (!titulo) return;
    vistos.add(slugLocal);
    salida.push({
      titulo,
      slug: `${ID}~${slugLocal}`,
      portada,
      generos: [],
      idioma: IDIOMA,
      tipo: detectarTipo(slugLocal, titulo),
      fuentes: [{ fuente: ID, nombre: NOMBRE, slugLocal, idioma: IDIOMA }],
    });
  });
  return salida;
}

async function obtenerUltimos(): Promise<EpisodioFeed[]> {
  const html = await obtenerHttp(`${BASE}/`, { timeoutMs: 5000 });
  const $ = cargar(html ?? "");
  if (!$) return [];
  const salida: EpisodioFeed[] = [];
  // Sección "últimos episodios" de animeflv.st: div.Episode → a[href]="/{slug}-episodio-{n}"
  $(".Episode, .ht_grid_1_5").each((_, el) => {
    const nodo = $(el);
    const href = nodo.find("a[href]").first().attr("href") || "";
    const post = slugLocalDePost(absoluta(href, BASE));
    if (!post) return;
    const titulo = nodo
      .find(".Title, h2.entry-title, .entry-title")
      .first()
      .text()
      .replace(/\s*Episodio\s*\d+\s*$/i, "")
      .trim();
    const portada = absoluta(nodo.find("img").first().attr("src") || "", BASE);
    const epMatch = nodo.find("p span, .ep-number").first().text().match(/\d+/);
    const numero = epMatch ? parseInt(epMatch[0]) : post.ep;
    if (!titulo) return;
    salida.push({
      titulo,
      slug: `${ID}~${post.slug}`,
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
  const html = await obtenerHttp(`${BASE}/anime/${slugLocal}/`, { timeoutMs: 6000 });
  const $ = cargar(html ?? "");
  if (!$) return null;
  const titulo = $(".anime-title").first().text().trim();
  if (!titulo) return null;
  const sinopsis = $(".anime-synopsis p").first().text().trim();
  const generos: string[] = [];
  $(".genre-tag").each((_, el) => {
    const g = $(el).text().trim();
    if (g) generos.push(g);
  });
  const portada = absoluta($(".poster-image img, .anime-poster img, aside img").first().attr("src") || "", BASE);
  // Episodios desde el JSON embebido
  let episodios: EpisodioItem[] = [];
  const $json = $("script.animeflv-episodes-data");
  if ($json.length) {
    try {
      const data = JSON.parse($json.first().text()) as { number: number }[];
      episodios = data.map((e) => ({ numero: e.number }));
    } catch {
      /* silencioso */
    }
  }
  if (episodios.length === 0) {
    // Fallback: enlaces "-episodio-N" en el HTML
    const nums = new Set<number>();
    $("a[href*='episodio-']").each((_, el) => {
      const m = ($(el).attr("href") || "").match(/episodio-(\d+)/);
      if (m) nums.add(parseInt(m[1]));
    });
    episodios = [...nums].sort((a, b) => a - b).map((numero) => ({ numero }));
  }
  const total = $(".anime-rating").length ? episodios.length : episodios.length;
  return {
    titulo,
    slug: `${ID}~${slugLocal}`,
    portada,
    sinopsis: sinopsis || undefined,
    generos,
    estado: episodios.length > 0 ? "En emisión" : "Próximamente",
    totalEpisodios: total,
    idioma: IDIOMA,
    tipo: detectarTipo(slugLocal, titulo) || $(".Type").first().text().trim() || undefined,
    fuentes: [{ fuente: ID, nombre: NOMBRE, slugLocal, url: `${BASE}/anime/${slugLocal}/`, idioma: IDIOMA }],
    episodios,
  };
}

async function obtenerServidores(slugLocal: string, episodio: number): Promise<ServidorVideo[]> {
  const urlEp = `${BASE}/${slugLocal}-episodio-${episodio}/`;
  const html = await obtenerHttp(urlEp, { timeoutMs: 6000, referer: `${BASE}/anime/${slugLocal}/` });
  if (!html) return [];
  const $ = cargar(html);
  if (!$) return [];
  const salida: ServidorVideo[] = [];
  const vistos = new Set<string>();
  // Botones de servidor: data-src (base64) + app_type (Sub/Dub) + tooltip-text (nombre)
  $("button[data-src], .server_btn[data-src]").each((_, el) => {
    const nodo = $(el);
    let url = nodo.attr("data-src") || "";
    try {
      url = Buffer.from(url, "base64").toString("utf8");
    } catch {
      return;
    }
    if (!/^https?:\/\//.test(url) || vistos.has(url)) return;
    vistos.add(url);
    const nombreBoton = nodo.closest(".button-container").find(".tooltip-text").first().text().trim();
    const tipoApp = (nodo.attr("app_type") || "Sub").toLowerCase();
    salida.push({
      servidor: nombreServidor(nombreBoton, url),
      tipo: clasificar(url),
      url,
      resuelto: false,
      idioma: tipoApp.includes("dub") || tipoApp.includes("lat") ? "latino" : "sub",
      fuente: ID,
    });
  });
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
