// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/stream — PROXY DE STREAMING.
//  - CORS abierto + Referer del embed + Range passthrough (seek)
//  - m3u8: reescritura de segmentos hacia el propio proxy
//  - Embeds: la FÁBRICA de extractores los resuelve (si ninguno
//    puede, el propio embed se sirve por el proxy — último recurso)
//  - Rate-limit laxo propio (un episodio HLS son decenas de
//    segmentos: el límite general no debe cortar el video)
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import fuentesJson from "../config/fuentes.json";
import ajustesJson from "../config/ajustes.json";
import { urlProxy } from "../lib/animax/extractores";
import { reescribirDominio } from "../core/dominios";
import { extraerVideo } from "../extractores/fabricaExtractores";
import { limitesStream } from "../middleware/limites";
import { envolverAsync } from "./comun";

export const routerStream = Router();
routerStream.use(limitesStream);

interface AjustesServidor {
  timeouts: { proxyStreamMs: number };
}

const TIMEOUT_PROXY = (ajustesJson as unknown as AjustesServidor).timeouts.proxyStreamMs ?? 25000;

const CFG = fuentesJson as unknown as { fuentes: { baseUrl: string }[] };

/** Hosts de video permitidos en el proxy (fuentes + reproductores conocidos). */
const HOSTS_PERMITIDOS = new Set<string>(
  [
    ...CFG.fuentes.map((f) => new URL(f.baseUrl).hostname),
    "mp4upload.com", "yourupload.com", "vidcache.net", "streamtape.com", "streamtape.to",
    "stape.net", "dood.to", "doodstream.com", "dood.la", "dood.wf", "dood.yt", "dood.sx",
    "ds2play.com", "d000d.com", "d0000d.com", "ok.ru", "voe.sx", "voe-un-block.com",
    "player.zilla-networks.com", "mega.nz", "mega.io", "1fichier.com", "transfer.it",
    "fembed.com", "streamsb.net", "sbplay.net", "vidmoly.net", "vidmoly.to", "filemoon.sx",
    "filemoon.to", "mixdrop.co", "streamlare.io", "byseapuix.com", "streamwish.com",
    "sfastwish.com", "hgcloud.com", "embedwish.com", "uqload.com", "kwik.cx",
    "sendvid.com", "vidhide.com", "luluvid.com", "savefiles.com", "ryderjet.com",
  ].map((h) => h.replace(/^www\./, ""))
);

function hostPermitido(host: string): boolean {
  const h = host.replace(/^www\./, "");
  if (HOSTS_PERMITIDOS.has(h)) return true;
  return [...HOSTS_PERMITIDOS].some((p) => h === p || h.endsWith("." + p));
}

const HEADERS_PASSTHROUGH = new Set([
  "content-type", "content-length", "accept-ranges", "content-range", "etag", "last-modified",
]);

routerStream.get(
  "/api/v1/stream",
  envolverAsync(async (req, res) => {
    const url = (req.query.url as string) || "";
    const ref = (req.query.ref as string) || undefined;
    if (!url) {
      res.status(400).json({ ok: false, error: "url requerida" });
      return;
    }

    let destino = url;
    let referer = ref;
    try {
      const u = new URL(destino);
      if (!hostPermitido(u.hostname)) {
        res.status(403).json({ ok: false, error: "host no permitido" });
        return;
      }
    } catch {
      res.status(400).json({ ok: false, error: "url inválida" });
      return;
    }

    // raw=1 → passthrough puro (segmentos HLS ya reescritos).
    const raw = req.query.raw === "1";

    // Embed → fábrica de extractores (nunca "no soportado": si todos
    // fallan devuelve el propio embed tipo "proxy").
    if (!raw && !/(\.(mp4|m3u8)(\?|$)|\/m3u8\/)/i.test(destino)) {
      const { resultado } = await extraerVideo(destino);
      if (resultado.tipo === "mp4" || resultado.tipo === "m3u8") {
        destino = resultado.urlDirecta;
        if (!referer) referer = resultado.headers?.Referer || url;
      } else {
        // Último recurso: el embed scrapeado se sirve por el proxy.
        referer = resultado.headers?.Referer || referer;
      }
      try {
        const u2 = new URL(destino);
        if (!hostPermitido(u2.hostname)) {
          res.status(403).json({ ok: false, error: "host extraído no permitido" });
          return;
        }
      } catch {
        res.status(500).json({ ok: false, error: "url extraída inválida" });
        return;
      }
    }

    // Cambios de dominio en caliente también afectan al proxy
    destino = reescribirDominio(destino);

    const range = req.headers.range;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_PROXY);
    try {
      const resp = await fetch(destino, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "*/*",
          ...(range ? { Range: range } : {}),
          ...(referer ? { Referer: referer } : {}),
        },
      });

      const tipo = (resp.headers.get("content-type") || "").toLowerCase();

      // m3u8: reescribir segmentos y sub-playlists hacia el proxy
      const esHls =
        /mpegurl|x-mpegurl/.test(tipo) || /\.m3u8(\?|$)/i.test(destino) || /\/m3u8\//i.test(destino);
      if (!raw && esHls) {
        const texto = await resp.text();
        const lineas = texto.split("\n").map((linea) => {
          const l = linea.trim();
          if (!l || l.startsWith("#")) {
            if (l.includes('URI="')) {
              return l.replace(/URI="([^"]+)"/, (_m, uri: string) => {
                const abs = new URL(uri, destino).toString();
                return `URI="${urlProxy(abs, referer, !/\.m3u8(\?|$)/i.test(abs))}"`;
              });
            }
            return l;
          }
          try {
            const abs = new URL(l, destino).toString();
            return urlProxy(abs, referer, !/\.m3u8(\?|$)/i.test(abs));
          } catch {
            return l;
          }
        });
        res.status(200);
        res.header("Content-Type", "application/vnd.apple.mpegurl");
        res.header("Cache-Control", "public, max-age=300");
        res.send(lineas.join("\n"));
        return;
      }

      // Binario (mp4/embed) con Range passthrough y backpressure
      res.status(resp.status === 206 ? 206 : 200);
      HEADERS_PASSTHROUGH.forEach((h) => {
        const v = resp.headers.get(h);
        if (v) res.header(h, v);
      });
      if (!res.getHeader("content-type")) res.header("content-type", "video/mp4");
      res.header("Cache-Control", "public, max-age=3600");
      res.header("Accept-Ranges", "bytes");

      if (!resp.body) {
        res.status(502).json({ ok: false, error: "sin cuerpo" });
        return;
      }
      const lector = resp.body.getReader();
      const escribir = async () => {
        try {
          for (;;) {
            const { done, value } = await lector.read();
            if (done) break;
            if (!res.write(Buffer.from(value))) {
              await new Promise<void>((r) => res.once("drain", () => r()));
            }
          }
          res.end();
        } catch {
          res.end();
        }
      };
      req.on("close", () => {
        void lector.cancel().catch(() => undefined);
      });
      void escribir();
    } catch {
      if (!res.headersSent) res.status(502).json({ ok: false, error: "streaming falló" });
      else res.end();
    } finally {
      clearTimeout(t);
    }
  })
);

export default routerStream;
