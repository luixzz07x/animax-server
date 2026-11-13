// ANIMAX v5 · Extractor FileMoon (filemoon.sx y clones /e/ y /d/).
// Mismo player que StreamWish (jwplayer con sources y packer JW):
// se prueban los patrones de sources/file y los literales .m3u8/.mp4
// con control de calidad (label:"720p") cuando está declarado.
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  // 1) sources con file + label (calidad explícita)
  const mLabel = html.match(
    /file\s*[:=]\s*["'](https?:\/\/[^"']+)["'][\s\S]{0,80}?label\s*[:=]\s*["'](\w+)["']/i
  );
  if (mLabel && /\.(m3u8|mp4)/i.test(mLabel[1])) {
    return {
      urlDirecta: mLabel[1],
      tipo: /\.m3u8(\?|$)/i.test(mLabel[1]) ? "m3u8" : "mp4",
      calidad: mLabel[2].toLowerCase(),
      headers: { Referer: embed },
    };
  }
  // 2) sources:[{file:…}] sin label
  const mFile = html.match(/file\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
  if (mFile) {
    return {
      urlDirecta: mFile[1],
      tipo: /\.m3u8(\?|$)/i.test(mFile[1]) ? "m3u8" : "mp4",
      calidad: detectarCalidad(mFile[1]),
      headers: { Referer: embed },
    };
  }
  // 3) Literal del packer
  const mLiteral = html.match(/(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4))(?=["'\s\\]|$)/);
  if (mLiteral) {
    return {
      urlDirecta: mLiteral[1],
      tipo: /\.m3u8(\?|$)/i.test(mLiteral[1]) ? "m3u8" : "mp4",
      headers: { Referer: embed },
    };
  }
  return null;
}

const filemoon: ExtractorVideo = {
  id: "filemoon",
  nombre: "FileMoon",
  patron: /filemoon|moonbeam|movies\.moon|fmoon\.xyz/i,
  prioridad: 9,
  extraer,
};

export default filemoon;
