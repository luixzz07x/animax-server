// ─────────────── ANIMAX v5.1 · Extractor Upstream ──────────────
// upstream.to / upstreamembed / upstra.* — player jwplayer con
// sources:[{file:"…",label:"720p"}] y, en algunos despliegues, el
// payload cifrado con el packer p,a,c,k,e,d. Se prueban en orden:
//   1. file+label con calidad explícita
//   2. sources file sin label (m3u8/mp4)
//   3. literales del JS desempaquetado
//   4. literales del HTML crudo
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

  // 1) file con label (calidad declarada por el player)
  const mLabel = html.match(
    /file\s*[:=]\s*["'](https?:\/\/[^"']+)["'][\s\S]{0,120}?label\s*[:=]\s*["'](\w+)["']/i
  );
  if (mLabel && /\.(m3u8|mp4)/i.test(mLabel[1])) {
    return {
      urlDirecta: mLabel[1],
      tipo: tipoDe(mLabel[1]),
      calidad: mLabel[2].toLowerCase(),
      headers: { Referer: embed },
    };
  }

  // 2) sources:[{file:…}] (jwplayer estándar)
  const mFile = html.match(/file\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i);
  if (mFile) {
    return {
      urlDirecta: mFile[1],
      tipo: tipoDe(mFile[1]),
      calidad: detectarCalidad(mFile[1]),
      headers: { Referer: embed },
    };
  }

  // 3) JS desempaquetado del packer
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

  // 4) Literales del HTML crudo
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

const upstream: ExtractorVideo = {
  id: "upstream",
  nombre: "Upstream",
  patron: /upstream\.|upstreamembed|upstra\./i,
  prioridad: 12,
  extraer,
};

export default upstream;
