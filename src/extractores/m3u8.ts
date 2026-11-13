// ANIMAX v5 · Extractor HLS genérico (m3u8).
// Cubre los players que sirven playlist directamente: URLs .m3u8 ya
// directas, players /play/{id} (zilla/jkplayer) que declaran el m3u8
// en JS, y dominios con "/m3u8/" en la ruta. Si la URL ya ES un m3u8
// se devuelve tal cual (cero peticiones).
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

async function extraer(url: string): Promise<ResultadoExtraccion | null> {
  // 1) La URL ya es un playlist HLS
  if (/\.m3u8(\?|$)/i.test(url) || /\/m3u8\//i.test(url)) {
    return {
      urlDirecta: url,
      tipo: "m3u8",
      calidad: detectarCalidad(url),
    };
  }
  // 2) Player tipo /play/{id} (zilla-networks, jkplayer): el m3u8 final
  //    aparece en el JS de la página.
  const html = await obtenerHttp(url, { timeoutMs: TIMEOUT, referer: url });
  if (!html) return null;
  const m =
    html.match(/['"](https?:\/\/[^"']+\.m3u8[^"']*)['"]/) ||
    html.match(/file\s*[:=]\s*['"](https?:\/\/[^"']+)['"]/);
  if (m && m[1] && /^https?:\/\//.test(m[1])) {
    const destino = m[1];
    if (/\/(?:embed|player)\//i.test(destino) && !/\.m3u8(\?|$)/i.test(destino)) {
      return null;
    }
    return {
      urlDirecta: destino,
      tipo: /\.m3u8|playlist|chunklist/i.test(destino) ? "m3u8" : "mp4",
      calidad: detectarCalidad(destino),
      headers: { Referer: url },
    };
  }
  return null;
}

const m3u8: ExtractorVideo = {
  id: "m3u8",
  nombre: "HLS",
  patron: /\.m3u8|\/m3u8\/|zill[ao]-networks|jkplayer|hls\.|\/play\//i,
  prioridad: 7,
  extraer,
};

export default m3u8;
