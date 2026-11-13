// ───────────────── ANIMAX v5.1 · Extractor MixDrop ─────────────
// mixdrop.ch / mixdrop.to / mixdr* / *.mxcontent etc.
// El embed (mixdrop.ch/e/ABC… o /watch-…) ofusca el player con el
// packer p,a,c,k,e,d: dentro del JS desempaquetado aparece
// MDCore.wurl="//…mp4" (y su timestamp de expiración). Se prueba:
//   1. MDCore.wurl (protocolo-relativo o absoluto)
//   2. literales .mp4/.m3u8 del JS ya desempaquetado
//   3. literales del HTML crudo (por si cambian de ofuscación)
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";
import { desempaquetarProfundo } from "./desempaquetar";

const TIMEOUT = 7000;

function absolutizar(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url;
}

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;

  // 1) Desempaquetar el packer del player
  const desempaquetado = desempaquetarProfundo(html);
  if (desempaquetado) {
    const mWurl = desempaquetado.match(/(?:MDCore\.wurl|wurl)\s*=\s*["']([^"']+)["']/);
    if (mWurl && /\.(mp4|m3u8)(\?|$)/i.test(mWurl[1])) {
      const url = absolutizar(mWurl[1]);
      return {
        urlDirecta: url,
        tipo: /\.m3u8(\?|$)/i.test(url) ? "m3u8" : "mp4",
        calidad: detectarCalidad(url),
        headers: { Referer: embed },
      };
    }
    // 2) Literal del player desempaquetado
    const mLiteral = desempaquetado.match(
      /(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)(?:\?[^"'\s\\]*)?)(?=["'\s\\]|$)/
    );
    if (mLiteral) {
      return {
        urlDirecta: mLiteral[1],
        tipo: /\.m3u8(\?|$)/i.test(mLiteral[1]) ? "m3u8" : "mp4",
        calidad: detectarCalidad(mLiteral[1]),
        headers: { Referer: embed },
      };
    }
  }

  // 3) Fallback: literales del HTML crudo
  const mCrudo = html.match(
    /["'](https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)(?:\?[^"'\s\\]*)?)["']/
  );
  if (mCrudo) {
    return {
      urlDirecta: mCrudo[1],
      tipo: /\.m3u8(\?|$)/i.test(mCrudo[1]) ? "m3u8" : "mp4",
      calidad: detectarCalidad(mCrudo[1]),
      headers: { Referer: embed },
    };
  }
  return null;
}

const mixdrop: ExtractorVideo = {
  id: "mixdrop",
  nombre: "MixDrop",
  patron: /mixdrop|mixdr\w*|mdzsmut|mxcontent|discowhore/i,
  prioridad: 11,
  extraer,
};

export default mixdrop;
