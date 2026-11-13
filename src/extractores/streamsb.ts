// ANIMAX v5 · Extractor StreamSB (streamsb.net y clones sbplay/xoline/…).
// El embed declara los links en un array de sources con .m3u8/.mp4
// (a veces en packer eval). Se prueban los patrones públicos y la
// variante "download" (/d/{id} → página con el .mp4 directo).
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

async function extraerDePagina(html: string, referer: string): Promise<ResultadoExtraccion | null> {
  const patrones: RegExp[] = [
    /file\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /sources\s*:\s*\[[\s\S]{0,240}?(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)[^"'\s\\]*)/,
    /(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4))(?=["'\s\\]|$)/,
    /download[^"']*?["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i,
  ];
  for (const p of patrones) {
    const m = html.match(p);
    if (m && m[1] && /^https?:\/\//.test(m[1])) {
      return {
        urlDirecta: m[1],
        tipo: /\.m3u8(\?|$)/i.test(m[1]) ? "m3u8" : "mp4",
        calidad: detectarCalidad(m[1]),
        headers: { Referer: referer },
      };
    }
  }
  return null;
}

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  const directo = await extraerDePagina(html, embed);
  if (directo) return directo;
  // Variante descarga: /e/{id} → /d/{id} con el .mp4 en claro
  const mId = embed.match(/https?:\/\/([^/]+)\/e\/([a-z0-9]+)/i);
  if (mId) {
    const [, host, id] = mId;
    const descarga = await obtenerHttp(`https://${host}/d/${id}`, {
      timeoutMs: TIMEOUT,
      referer: embed,
    });
    if (descarga) return extraerDePagina(descarga, `https://${host}/d/${id}`);
  }
  return null;
}

const streamsb: ExtractorVideo = {
  id: "streamsb",
  nombre: "StreamSB",
  patron: /streamsb|sbplay|xoline|sbanh|sbvideo|strcloud|streamhide/i,
  prioridad: 11,
  extraer,
};

export default streamsb;
