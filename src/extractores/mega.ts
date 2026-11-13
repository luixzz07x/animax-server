// ANIMAX v5 · Extractor Mega (mega.nz / mega.io).
// Mega NO expone .mp4 directo sin su API cifrada: por eso este
// extractor NO devuelve null — devuelve tipo "proxy": la URL del
// propio embed se sirve a través de /api/v1/stream (con el
// Referer adecuado) y el reproductor decide (descarga externa o
// webview). Así la cadena NUNCA queda sin resultado para Mega.
import { type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

function extraer(url: string): Promise<ResultadoExtraccion | null> {
  // Link de carpeta o de archivo: ambos se proxyan tal cual.
  if (/\/(file|folder|embed)\//i.test(url) || /#!/.test(url)) {
    return Promise.resolve({
      urlDirecta: url,
      tipo: "proxy",
      headers: { Referer: "https://mega.nz/" },
    });
  }
  return Promise.resolve(null);
}

const mega: ExtractorVideo = {
  id: "mega",
  nombre: "Mega",
  patron: /mega\.nz|mega\.io/i,
  prioridad: 12,
  extraer,
};

export default mega;
