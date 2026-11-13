// ─────────────────────────────────────────────────────────────
// ANIMAX · Extractores de video (reproductor universal).
// Extraen el link DIRECTO (.mp4 / .m3u8) de los reproductores
// embebidos, bajo demanda (cuando el usuario abre el episodio).
//
// POLÍTICA "nunca servidor propio":
//  1. Se resuelve CADA servidor crudo a un link directo.
//  2. Se VERIFICA el link (HEAD / GET con Range para mp4, playlist +
//     primer segmento para m3u8) con su Referer.
//  3. Los servidores que no se pueden extraer o cuya verificación
//     falla se DESCARTAN: jamás se ofrece un servidor no reproducible.
//
// VERIFICADOS desde el entorno de desarrollo:
//  · Mp4Upload  → URL directa .mp4 en el HTML del embed
//  · YourUpload → "file: 'https://…/video.mp4'" en el embed
//  · HLS (m3u8) → playlist público (zilla-networks etc.)
// MEJOR ESFUERZO (algoritmos públicos conocidos):
//  · StreamTape (patrón robotlink) · Doodstream (pass_md5 + MD5)
//  · Ok.ru (data-options)          · Voe (regexes múltiples)
//  · Familia StreamWish/FileMoon/Uqload/MixDrop/VidMoly…
//  · Extractor GENÉRICO de último recurso (regex de .mp4/.m3u8)
// ─────────────────────────────────────────────────────────────

import { createHash } from "crypto";
import tuningJson from "./fuentes.json";
import { obtenerHttp, latenciaMs, siguienteUA } from "./http";

const TUN = (tuningJson as unknown as { tuning: { prioridadServidores?: string[]; timeoutExtractorMs?: number } }).tuning;
const PRIORIDAD: string[] = TUN.prioridadServidores || [
  "mp4upload",
  "yourupload",
  "streamtape",
  "doodstream",
  "voe",
  "okru",
  "m3u8",
  "mega",
];
const TIMEOUT = TUN.timeoutExtractorMs ?? 6000;

import type { ServidorVideo } from "./types";

export function urlProxy(url: string, referer?: string, raw?: boolean): string {
  const u = encodeURIComponent(url);
  const r = referer ? `&ref=${encodeURIComponent(referer)}` : "";
  const w = raw ? "&raw=1" : "";
  return `/api/v1/stream?url=${u}${r}${w}`;
}

// ── Extractores por dominio ─────────────────────────────────

async function extraerMp4Upload(embed: string): Promise<{ url: string; tipo: "mp4" } | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  // URL directa: https://a3.mp4upload.com:183/d/…/video.mp4 (verificado)
  const m = html.match(/https?:\/\/[a-z0-9.\-]*mp4upload\.com:\d+\/d\/[a-z0-9]+\/video\.mp4[^"'\s]*/i);
  if (m) return { url: m[0], tipo: "mp4" };
  const m2 = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
  if (m2 && !/mp4upload\.com\/(player|embed)/.test(m2[0])) return { url: m2[0], tipo: "mp4" };
  return null;
}

async function extraerYourUpload(embed: string): Promise<{ url: string; tipo: "mp4" } | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  const m = html.match(/file:\s*['"]([^'"]+)['"]/);
  if (m && /\.mp4/i.test(m[1])) return { url: m[1], tipo: "mp4" };
  const m2 = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
  return m2 ? { url: m2[0], tipo: "mp4" } : null;
}

async function extraerStreamTape(embed: string): Promise<{ url: string; tipo: "mp4" } | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  // Patrón público: robotlink con basura en los primeros ~20 caracteres
  const m = html.match(/robotlink[^=]*=\s*['"]([^'"]{25,})['"]/);
  if (m) {
    const crudo = m[1];
    const url = `https:${crudo.substring(20, crudo.length - 2)}`;
    if (/get_video|\.mp4/.test(url)) return { url: url.replace(/[\s"']+$/, ""), tipo: "mp4" };
  }
  // Fallback: cualquier link get_video
  const m2 = html.match(/https?:\/\/[^"'\s]*get_video\?[^"'\s]*/);
  return m2 ? { url: m2[0], tipo: "mp4" } : null;
}

async function extraerDood(embed: string): Promise<{ url: string; tipo: "mp4" } | null> {
  // Normalizamos el dominio de descarga (doodstream cambia TLD a menudo)
  const mHost = embed.match(/https?:\/\/([^/]+)\/e\/([a-z0-9]+)/i);
  if (!mHost) return null;
  const [, host, id] = mHost;
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  const mPass = html.match(/\/pass_md5\/([^'"\/]+)/);
  if (mPass) {
    const token = createHash("md5")
      .update(mPass[1] + Date.now().toString())
      .digest("hex");
    const mCdn = html.match(/window\.\w+\s*=\s*['"]([^'"]+)['"]/);
    const cdn = mCdn ? mCdn[1] : `https://${host}`;
    const url = `${cdn.replace(/\/$/, "")}/${token}?token=${mPass[1]}&expiry=${Date.now()}`;
    return { url, tipo: "mp4" };
  }
  return null;
}

async function extraerOkRu(embed: string): Promise<{ url: string; tipo: "mp4" | "m3u8" } | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  const m = html.match(/data-options="([^"]+)"/);
  if (m) {
    try {
      const decodificado = decodeURIComponent(m[1]).replace(/\\"/g, '"');
      const mUrl = decodificado.match(/"movie"\s*:\s*\{[^}]*"src"\s*:\s*"([^"]+)"/);
      if (mUrl) return { url: mUrl[1], tipo: /\.m3u8/.test(mUrl[1]) ? "m3u8" : "mp4" };
    } catch {
      /* silencioso */
    }
  }
  const m2 = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
  if (m2) return { url: m2[0], tipo: "m3u8" };
  const m3 = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
  return m3 ? { url: m3[0], tipo: "mp4" } : null;
}

async function extraerVoe(embed: string): Promise<{ url: string; tipo: "mp4" | "m3u8" } | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  // Voe monta el enlace directo en JS con promesas; probamos patrones conocidos
  const patrones = [
    /https?:\/\/[^"'\s]+\.mp4[^"'\s]*/,
    /https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/,
    /'(https?:\/\/[^']+chunklist[^']+)'/,
    /"(https?:\/\/[^"]+playlist\.m3u8[^"]*)"/,
  ];
  for (const p of patrones) {
    const m = html.match(p);
    if (m && !/voe\.[a-z]+\/e\//.test(m[0])) {
      return { url: m[0], tipo: /\.m3u8/.test(m[0]) || /playlist|chunklist/.test(m[0]) ? "m3u8" : "mp4" };
    }
  }
  return null;
}

/** Familia StreamWish (sfastwish · hgcloud · embedwish · bysekoze ·
 *  filemoon · ryderjet · byselapuix…): el embed monta sources con el
 *  .m3u8/.mp4 final. Mejor esfuerzo por regex (sin ejecutar JS). */
async function extraerStreamWish(embed: string): Promise<{ url: string; tipo: "mp4" | "m3u8" } | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  const patrones = [
    /sources"?\s*:?\s*\[[\s\S]{0,200}?"?file"?\s*:\s*["']([^"']+)["']/,
    /file\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/,
    /(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)\?[^"'\s\\]*)/,
    /(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4))(?=["'\s\\]|$)/,
  ];
  for (const p of patrones) {
    const m = html.match(p);
    if (m && m[1] && /^https?:\/\//.test(m[1])) {
      return { url: m[1], tipo: /\.m3u8(\?|$)/i.test(m[1]) ? "m3u8" : "mp4" };
    }
  }
  return null;
}

/** Player HLS zilla-networks (usado por AnimeGratis y JkAnime):
 *  /play/{id} → página con el m3u8 final en JS. */
async function extraerZilla(embed: string): Promise<{ url: string; tipo: "mp4" | "m3u8" } | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  const m =
    html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) ||
    html.match(/file\s*[:=]\s*["'](https?:\/\/[^"']+)["']/);
  if (m && m[1] && /^https?:\/\//.test(m[1])) {
    return { url: m[1], tipo: /\.m3u8|playlist/i.test(m[1]) ? "m3u8" : "mp4" };
  }
  return null;
}

/** Extractor GENÉRICO de último recurso para cualquier host con embed
 *  HTML estático: busca el .mp4/.m3u8 final en la página (players tipo
 *  jwplayer/videojs "setup({sources:[{file:…}]})"). Si no aparece,
 *  el servidor se DESCARTA (nunca se ofrece un embed sin resolver). */
async function extraerGenerico(embed: string): Promise<{ url: string; tipo: "mp4" | "m3u8" } | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed, reintentos: 0 });
  if (!html) return null;
  const patrones = [
    /(?:file|src|url|source)\s*[:=]\s*["'](https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)(?:\?[^"'\s\\]*)?)["']/i,
    /["'](https?:\/\/[^"'\s\\]+\.m3u8(?:\?[^"'\s\\]*)?)["']/,
    /["'](https?:\/\/[^"'\s\\]+\.mp4(?:\?[^"'\s\\]*)?)["']/,
  ];
  for (const p of patrones) {
    const m = html.match(p);
    if (m && m[1] && /^https?:\/\//.test(m[1])) {
      // evita devolver el propio embed o recursos de la página
      if (/\.(?:js|css|png|jpe?g|gif|svg|woff)(\?|$)/i.test(m[1])) continue;
      if (/\/(?:embed|player)\//i.test(m[1]) && !/\.(?:m3u8|mp4)(\?|$)/i.test(m[1])) continue;
      return { url: m[1], tipo: /\.m3u8(\?|$)/i.test(m[1]) ? "m3u8" : "mp4" };
    }
  }
  return null;
}

const EXTRACTORES: { patron: RegExp; fn: (url: string) => Promise<{ url: string; tipo: "mp4" | "m3u8" } | null> }[] = [
  { patron: /mp4upload\.com/i, fn: extraerMp4Upload },
  { patron: /yourupload\.com|vidcache\.net/i, fn: extraerYourUpload },
  { patron: /streamtape|stape\.net/i, fn: extraerStreamTape },
  { patron: /dood(stream|\.to|\.com|\.sx)|ds2play|d0000d/i, fn: extraerDood },
  { patron: /ok\.ru|odnoklassniki|mail\.ru/i, fn: extraerOkRu },
  { patron: /voe\.[a-z]+|voe-/i, fn: extraerVoe },
  // familia StreamWish (clones con el mismo player JS)
  {
    patron: /sfastwish|hgcloud|embedwish|bysekoze|byselapuix|ryderjet|filemoon|streamwish|uqload|mixdrop|vidmoly|streamlare|streamsb|fembed|mxdrop|sendvid|vidhide|luluvid|savefiles|hglink|listeamed|burstcloud|kwik/i,
    fn: extraerStreamWish,
  },
  { patron: /zilla-networks\.com|jkplayer\/um/i, fn: extraerZilla },
  // último recurso: extractor genérico para cualquier otro host
  { patron: /^https?:\/\//i, fn: extraerGenerico },
];

/** Resuelve UNA URL de servidor a su link directo (o null). */
export async function extraerDirecto(
  url: string
): Promise<{ url: string; tipo: "mp4" | "m3u8" } | null> {
  if (/\.m3u8(\?|$)/i.test(url) || /\/m3u8\//i.test(url)) return { url, tipo: "m3u8" };
  if (/\.mp4(\?|$)/i.test(url)) return { url, tipo: "mp4" };
  for (const e of EXTRACTORES) {
    if (e.patron.test(url)) return e.fn(url);
  }
  return null;
}

function rangoPrioridad(servidor: string): number {
  const s = servidor.toLowerCase().replace(/\s/g, "");
  for (let i = 0; i < PRIORIDAD.length; i++) {
    if (s.includes(PRIORIDAD[i].replace("m3u8", "hls"))) return i;
  }
  return PRIORIDAD.length + 1;
}

/** Sonda de latencia real: para m3u8 mide el PRIMER SEGMENTO (no el playlist,
 *  que puede responder 200 aunque los segmentos estén bloqueados por Cloudflare). */
async function sondarServidor(s: { url: string; tipo: string }): Promise<number | null> {
  if (s.tipo === "m3u8") {
    const texto = await obtenerHttp(s.url, { timeoutMs: 5000 });
    if (!texto || !texto.startsWith("#EXTM3U")) return null;
    const linea = texto
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"));
    if (!linea) return null;
    try {
      const seg = new URL(linea, s.url).toString();
      return await latenciaMs(seg, s.url);
    } catch {
      return null;
    }
  }
  return await latenciaMs(s.url, s.url);
}

/** Verificación de un link mp4 que rechaza HEAD: GET con Range 0-1024. */
async function rangoMs(url: string, referer?: string): Promise<number | null> {
  const inicio = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": siguienteUA(),
        Range: "bytes=0-1024",
        ...(referer ? { Referer: referer } : {}),
      },
    });
    if (!res.ok && res.status !== 206) return null;
    void res.body?.cancel().catch(() => {});
    return Date.now() - inicio;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** VERIFICACIÓN de un link directo antes de ofrecerlo al reproductor:
 *  mp4 → HEAD (con fallback GET+Range) · m3u8 → playlist + 1er segmento.
 *  Devuelve la latencia en ms o null si el link NO es reproducible. */
async function verificarServidor(
  s: { url: string; tipo: "mp4" | "m3u8" },
  referer?: string
): Promise<number | null> {
  if (s.tipo === "m3u8") return await sondarServidor(s);
  const ms = await latenciaMs(s.url, referer);
  if (ms !== null) return ms;
  return await rangoMs(s.url, referer);
}

/**
 * Resuelve la lista de servidores de un episodio (REPRODUCTOR UNIVERSAL):
 *  1. Extrae el link directo de CADA servidor en paralelo.
 *  2. VERIFICA cada link (HEAD/Range/playlist) con su Referer.
 *  3. DESCARTA los servidores no extraíbles o no verificados y los
 *     externos sin stream (Mega/descargas): solo se devuelven links
 *     reproducibles por el reproductor propio (proxy /api/v1/stream).
 *  4. Ordena: LATINO primero → prioridad de host → latencia medida.
 */
export async function resolverServidores(crudos: ServidorVideo[]): Promise<ServidorVideo[]> {
  const dedup = new Map<string, ServidorVideo>();
  for (const s of crudos) {
    if (!s.url || !/^https?:\/\//.test(s.url)) continue;
    if (!dedup.has(s.url)) dedup.set(s.url, s);
  }
  const lista = [...dedup.values()];
  if (lista.length === 0) return [];

  const resueltos = await Promise.all(
    lista.map(async (s): Promise<ServidorVideo | null> => {
      // Enlaces externos (Mega/1Fichier): no ofrecen stream → se descartan
      if (s.tipo === "external") return null;
      const directo =
        s.tipo === "mp4" || s.tipo === "m3u8"
          ? { url: s.url, tipo: s.tipo as "mp4" | "m3u8" }
          : await extraerDirecto(s.url);
      // Host sin extractor → NUNCA se ofrece al reproductor
      if (!directo) return null;
      const referer = /^https?:\/\//.test(s.url) ? s.url : undefined;
      const ms = await verificarServidor(directo, referer);
      // Link no verificado → se descarta (servidor muerto/bloqueado)
      if (ms === null) return null;
      return {
        ...s,
        tipo: directo.tipo,
        url: directo.url,
        // streamUrl apunta al proxy propio: /api/v1/stream?url=…&ref=…
        streamUrl: urlProxy(directo.url, referer),
        resuelto: true,
        ms,
      } satisfies ServidorVideo;
    })
  );

  const vivos = resueltos.filter((s): s is ServidorVideo => s !== null);

  // Orden final: idioma LATINO primero; luego prioridad de host (Mp4Upload >
  // YourUpload > StreamTape > …); luego latencia medida.
  const prefIdioma = (i?: string) => (i === "latino" ? 0 : 1);
  return vivos.sort((a, b) => {
    const la = prefIdioma(a.idioma);
    const lb = prefIdioma(b.idioma);
    if (la !== lb) return la - lb;
    const ra = rangoPrioridad(a.servidor);
    const rb = rangoPrioridad(b.servidor);
    if (ra !== rb) return ra - rb;
    if (a.ms != null && b.ms != null) return a.ms - b.ms;
    if (a.ms != null) return -1;
    if (b.ms != null) return 1;
    return 0;
  });
}
