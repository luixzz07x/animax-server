// ANIMAX v5 · Extractor Mp4Upload (mp4upload.com) — VERIFICADO.
// El embed HTML contiene la URL directa al .mp4 del CDN
// (https://a3.mp4upload.com:183/d/…/video.mp4). Página estática:
// una sola petición + regex.
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  // URL directa verificada: https://a3.mp4upload.com:183/d/{id}/video.mp4
  const m = html.match(/https?:\/\/[a-z0-9.\-]*mp4upload\.com:\d+\/d\/[a-z0-9]+\/video\.mp4[^"'\s]*/i);
  if (m) {
    return {
      urlDirecta: m[0],
      tipo: "mp4",
      calidad: detectarCalidad(m[0]),
      headers: { Referer: embed },
    };
  }
  // Segunda forma: cualquier .mp4 absoluto que no sea el propio player
  const m2 = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
  if (m2 && !/mp4upload\.com\/(player|embed)/.test(m2[0])) {
    return {
      urlDirecta: m2[0],
      tipo: "mp4",
      calidad: detectarCalidad(m2[0]),
      headers: { Referer: embed },
    };
  }
  return null;
}

const mp4upload: ExtractorVideo = {
  id: "mp4upload",
  nombre: "Mp4Upload",
  patron: /mp4upload\.com/i,
  prioridad: 1,
  extraer,
};

export default mp4upload;
