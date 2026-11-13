// ANIMAX v5 · Extractor StreamTape (streamtape.com / stape.net y clones).
// Algoritmo público: el HTML del embed declara `document.getElementById('robotlink')`
// con una cadena a la que se le añaden ~20 caracteres de basura delante y
// se le quitan los 2 últimos. El link final es /get_video?… o .mp4 directo.
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  // robotlink con basura en los primeros ~20 caracteres
  const m = html.match(/robotlink[^=]*=\s*['"]([^'"]{25,})['"]/);
  if (m) {
    const crudo = m[1];
    const url = `https:${crudo.substring(20, crudo.length - 2)}`.replace(/[\s"']+$/, "");
    if (/get_video|\.mp4/.test(url)) {
      return {
        urlDirecta: url,
        tipo: "mp4",
        calidad: detectarCalidad(url),
        headers: { Referer: embed },
      };
    }
  }
  // Fallback: cualquier link get_video del HTML
  const m2 = html.match(/https?:\/\/[^"'\s]*get_video\?[^"'\s]*/);
  if (m2) {
    return {
      urlDirecta: m2[0],
      tipo: "mp4",
      headers: { Referer: embed },
    };
  }
  return null;
}

const streamtape: ExtractorVideo = {
  id: "streamtape",
  nombre: "StreamTape",
  patron: /streamtape|stape\.net|streamtape\.to/i,
  prioridad: 3,
  extraer,
};

export default streamtape;
