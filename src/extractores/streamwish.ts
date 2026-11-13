// ANIMAX v5 · Extractor StreamWish (streamwish.*/sfastwish/hgcloud/
// embedwish…). La familia monta el player con sources:[{file:…}] y
// el link final .m3u8/.mp4 aparece en el propio JS del embed (en
// claro o con un packer mínimo). Se prueban los patrones públicos.
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

const PATRONES: RegExp[] = [
  /sources"?\s*:?\s*\[[\s\S]{0,240}?"?file"?\s*:\s*["']([^"']+)["']/,
  /file\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/,
  /(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)\?[^"'\s\\]*)/,
  /(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4))(?=["'\s\\]|$)/,
];

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  for (const p of PATRONES) {
    const m = html.match(p);
    if (m && m[1] && /^https?:\/\//.test(m[1])) {
      return {
        urlDirecta: m[1],
        tipo: /\.m3u8(\?|$)/i.test(m[1]) ? "m3u8" : "mp4",
        calidad: detectarCalidad(m[1]),
        headers: { Referer: embed },
      };
    }
  }
  return null;
}

const streamwish: ExtractorVideo = {
  id: "streamwish",
  nombre: "StreamWish",
  patron: /sfastwish|hgcloud|hglink|embedwish|bysekoze|byselapuix|ryderjet|streamwish|kwik|sendvid|vidhide/i,
  prioridad: 8,
  extraer,
};

export default streamwish;
