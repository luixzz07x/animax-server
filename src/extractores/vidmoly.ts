// ANIMAX v5 · Extractor VidMoly (vidmoly.net / .to).
// Player propio con sources y un JSON de configuración en línea;
// el .mp4/.m3u8 final aparece en el HTML del embed. Mismo esqueleto
// que StreamWish con rutas de descarga alternativas (?download=1).
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  const patrones: RegExp[] = [
    /file\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i,
    /sources"?\s*:?\s*\[[\s\S]{0,200}?"?file"?\s*:\s*["']([^"']+)["']/,
    /(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)\?[^"'\s\\]*)/,
    /(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4))(?=["'\s\\]|$)/,
  ];
  for (const p of patrones) {
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

const vidmoly: ExtractorVideo = {
  id: "vidmoly",
  nombre: "VidMoly",
  patron: /vidmoly|vidmolo/i,
  prioridad: 10,
  extraer,
};

export default vidmoly;
