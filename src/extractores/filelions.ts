// ────────────── ANIMAX v5.1 · Extractor FileLions ──────────────
// filelions.to / filelion / lionsdrive / flixtag (familia con el
// mismo player que StreamWish/VidHide). El embed declara el link
// en sources:[{file:"…m3u8"}] o lo esconde tras un packer
// p,a,c,k,e,d (también doble packer). Se prueban:
//   1. sources file (con/sin label de calidad)
//   2. literales del JS desempaquetado (hasta 2 niveles)
//   3. literales del HTML crudo
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";
import { desempaquetarProfundo } from "./desempaquetar";

const TIMEOUT = 7000;

function tipoDe(url: string): "m3u8" | "mp4" {
  return /\.m3u8(\?|$)/i.test(url) ? "m3u8" : "mp4";
}

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;

  // 1) sources con file (jwplayer; con label si lo declara)
  const mLabel = html.match(
    /file\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["'][\s\S]{0,100}?label\s*[:=]\s*["'](\w+)["']/i
  );
  if (mLabel) {
    return {
      urlDirecta: mLabel[1],
      tipo: tipoDe(mLabel[1]),
      calidad: mLabel[2].toLowerCase(),
      headers: { Referer: embed },
    };
  }
  const mFile = html.match(/file\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
  if (mFile) {
    return {
      urlDirecta: mFile[1],
      tipo: tipoDe(mFile[1]),
      calidad: detectarCalidad(mFile[1]),
      headers: { Referer: embed },
    };
  }

  // 2) Packer del player (p,a,c,k,e,d — a veces encadenado)
  const desempaquetado = desempaquetarProfundo(html);
  if (desempaquetado) {
    const mUn = desempaquetado.match(
      /(https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)(?:\?[^"'\s\\]*)?)(?=["'\s\\]|$)/
    );
    if (mUn) {
      return {
        urlDirecta: mUn[1],
        tipo: tipoDe(mUn[1]),
        calidad: detectarCalidad(mUn[1]),
        headers: { Referer: embed },
      };
    }
  }

  // 3) Literales del HTML crudo
  const mCrudo = html.match(/["'](https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)(?:\?[^"'\s\\]*)?)["']/);
  if (mCrudo) {
    return {
      urlDirecta: mCrudo[1],
      tipo: tipoDe(mCrudo[1]),
      calidad: detectarCalidad(mCrudo[1]),
      headers: { Referer: embed },
    };
  }
  return null;
}

const filelions: ExtractorVideo = {
  id: "filelions",
  nombre: "FileLions",
  patron: /filelions|filelion|lionsdrive|flixtag|lion?stream/i,
  prioridad: 13,
  extraer,
};

export default filelions;
