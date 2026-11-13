// ANIMAX v5 · Extractor Doodstream (dood.to/.la/.wf/.sx y clones ds2play,
// d000d…). Algoritmo público: el embed declara /pass_md5/{token}; el link
// final es {cdn}/{md5(token+timestamp)}?token={token}&expiry={ts}. El
// dominio de descarga cambia de TLD cada pocos meses: se reconstruye desde
// el propio host del embed (y el vigilante de dominios cubre la fuente, no
// el CDN). La URL final caduca en ~2 h (no se cachea más de lo debido).
import { createHash } from "crypto";
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

const TIMEOUT = 6000;

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const mHost = embed.match(/https?:\/\/([^/]+)\/(?:e|d)\/([a-z0-9]+)/i);
  if (!mHost) return null;
  const [, host] = mHost;
  const html = await obtenerHttp(embed, { timeoutMs: TIMEOUT, referer: embed });
  if (!html) return null;
  const mPass = html.match(/\/pass_md5\/([^'"\/]+)/);
  if (!mPass) return null;
  const token = mPass[1];
  const marca = Date.now().toString();
  const firma = createHash("md5").update(token + marca).digest("hex");
  // El CDN se declara en window.*= o es el mismo host del embed
  const mCdn = html.match(/window\.[a-z0-9_]+\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
  const cdn = mCdn ? mCdn[1].replace(/\/$/, "") : `https://${host}`;
  const url = `${cdn}/${firma}?token=${token}&expiry=${marca}`;
  return {
    urlDirecta: url,
    tipo: "mp4",
    calidad: detectarCalidad(html),
    headers: { Referer: embed },
  };
}

const doodstream: ExtractorVideo = {
  id: "doodstream",
  nombre: "Doodstream",
  patron: /dood(stream|\.to|\.com|\.sx|\.la|\.wf|\.yt)|ds2play|d000d|d0000d/i,
  prioridad: 4,
  extraer,
};

export default doodstream;
