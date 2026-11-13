// ANIMAX v5 · Extractor YourUpload (yourupload.com / vidcache.net).
// El embed monta jwplayer con `file: 'https://…/video.mp4'`
// (patrón verificado). Fallback: cualquier .mp4 absoluto del HTML.
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  // Patrón verificado: file: 'https://…mp4'
  const m = html.match(/file\s*[:=]\s*['"]([^'"]+)['"]/);
  if (m && /\.mp4/i.test(m[1])) {
    return {
      urlDirecta: m[1],
      tipo: "mp4",
      calidad: detectarCalidad(m[1]),
      headers: { Referer: embed },
    };
  }
  const m2 = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
  if (m2) {
    return {
      urlDirecta: m2[0],
      tipo: "mp4",
      calidad: detectarCalidad(m2[0]),
      headers: { Referer: embed },
    };
  }
  return null;
}

const yourupload: ExtractorVideo = {
  id: "yourupload",
  nombre: "YourUpload",
  patron: /yourupload\.com|vidcache\.net/i,
  prioridad: 2,
  extraer,
};

export default yourupload;
