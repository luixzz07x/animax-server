// ANIMAX v5 · Extractor Voe (voe.sx y su docena de dominios espejo
// voe-*.com / player.zilla-networks…). El embed monta el link final
// en JS ofuscado; se prueban los patrones públicos conocidos:
// .mp4/.m3u8 literales, chunklist y playlists HLS.
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

const PATRONES: RegExp[] = [
  /https?:\/\/[^"'\s]+\.mp4[^"'\s]*/,
  /https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/,
  /['"](https?:\/\/[^']+chunklist[^'"]+)['"]/,
  /["'](https?:\/\/[^"]+playlist\.m3u8[^"']*)["']/,
  /hls\s*:\s*["'](https?:\/\/[^"']+)["']/,
];

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  for (const p of PATRONES) {
    const m = html.match(p);
    if (!m) continue;
    const url = m[1] || m[0];
    // No devolver el propio embed voe como "directo"
    if (/voe\.[a-z]+\/e\//.test(url)) continue;
    const esHls = /\.m3u8(\?|$)/i.test(url) || /playlist|chunklist|\/hls\//i.test(url);
    return {
      urlDirecta: url,
      tipo: esHls ? "m3u8" : "mp4",
      calidad: detectarCalidad(url),
      headers: { Referer: embed },
    };
  }
  return null;
}

const voe: ExtractorVideo = {
  id: "voe",
  nombre: "Voe",
  patron: /voe\.[a-z]+|voe-|voeunblock|un-block\.com|zilla-networks\.com/i,
  prioridad: 5,
  extraer,
};

export default voe;
