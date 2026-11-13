// ANIMAX v5 · Extractor Ok.ru (Odnoklassniki / mail.ru).
// El embed declara data-options="…" con JSON escapado que contiene
// {"movie":{"src":"…"}}. El src puede ser .mp4 progresivo o .m3u8
// (multi-calidad: el playlist maestro tiene las variantes).
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  const m = html.match(/data-options="([^"]+)"/);
  if (m) {
    try {
      const decodificado = decodeURIComponent(m[1]).replace(/\\"/g, '"');
      const mUrl = decodificado.match(/"movie"\s*:\s*\{[^}]*"src"\s*:\s*"([^"]+)"/);
      if (mUrl) {
        return {
          urlDirecta: mUrl[1],
          tipo: /\.m3u8/.test(mUrl[1]) ? "m3u8" : "mp4",
          calidad: detectarCalidad(mUrl[1]),
          headers: { Referer: embed },
        };
      }
    } catch {
      /* JSON corrupto: fallback */
    }
  }
  // Fallback directo por el HTML
  const m2 = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
  if (m2) return { urlDirecta: m2[0], tipo: "m3u8", headers: { Referer: embed } };
  const m3 = html.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
  if (m3) {
    return {
      urlDirecta: m3[0],
      tipo: "mp4",
      calidad: detectarCalidad(m3[0]),
      headers: { Referer: embed },
    };
  }
  return null;
}

const okru: ExtractorVideo = {
  id: "okru",
  nombre: "Ok.ru",
  patron: /ok\.ru|odnoklassniki|mail\.ru/i,
  prioridad: 6,
  extraer,
};

export default okru;
