// ─────────────────────────────────────────────────────────────
// ANIMAX v5.3-FIX · Router de SALUD.
//  - GET /              → PORTADA HTML (¿JSON? → ?formato=json)
//  - GET /api/v1        → listado JSON de endpoints (documentado).
//  - GET /api/v1/salud  → estado de CADA fuente: circuito breaker,
//                          fallos consecutivos, latencia, dominio,
//                          bloqueo Cloudflare y si está LIMITADA
//                          (sin respuesta sostenida desde el datacenter).
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { instantaneaSalud, resumenSalud } from "../core/salud";
import { totalAlias } from "../datos/aliasDb";
import { resumenSemilla } from "../datos/semillaCatalogo";
import { envolverAsync } from "./comun";

export const routerSalud = Router();

const ENDPOINTS = [
  "/api/v1/ultimos",
  "/api/v1/buscar?q=",
  "/api/v1/anime/{slug}",
  "/api/v1/servidores/{slug}/{ep}",
  "/api/v1/stream?url=",
  "/api/v1/generos",
  "/api/v1/catalogo?idioma=&genero=&tipo=",
  "/api/v1/curados",
  "/api/v1/tendencias?ventana=&limite=",
  "/api/v1/programacion?fuente=",
  "/api/v1/recomendaciones/{slug}",
  "/api/v1/top/{valorados|vistos|genero|decada}",
  "/api/v1/continuar?usuario=",
  "/api/v1/historial?usuario=",
  "/api/v1/listas?usuario=",
  "/api/v1/salud",
  "/api/v1/estado",
  "/api/v1/dominios",
  "/api/v1/cron/refresh",
  "/api/v1/admin/estado",
  "/api/v1/metricas · /metrics",
  "/panel",
];

function resumenJson() {
  return {
    ok: true,
    servicio: "ANIMAX API v5.3",
    uptime: Math.floor(process.uptime()),
    fuentes: resumenSalud(),
    alias: totalAlias(),
    semilla: resumenSemilla(),
    endpoints: ENDPOINTS,
    documentacion: "GET /api/v1 → esta lista · docs/API.md",
  };
}

// ── Portada HTML (la portada de tu server de Render) ──────────
routerSalud.get(
  "/",
  envolverAsync(async (req, res) => {
    // Consumidores de API (app Android, curl): mismo JSON de siempre.
    const quiereJson =
      req.query.formato === "json" ||
      (req.headers.accept || "").includes("application/json");
    if (quiereJson) {
      res.json(resumenJson());
      return;
    }
    const r = resumenSalud();
    const s = resumenSemilla();
    const chips = [
      { etiqueta: "vivas", valor: r.vivas, color: "#22c55e" },
      { etiqueta: "bloqueadas (CF)", valor: r.bloqueadas, color: "#f59e0b" },
      { etiqueta: "limitadas (IP DC)", valor: r.limitadas, color: "#a855f7" },
      { etiqueta: "caídas", valor: r.caidas, color: "#ef4444" },
      { etiqueta: "alias", valor: totalAlias(), color: "#a1a1aa" },
    ];
    const chipsHtml = chips
      .map(
        (c) =>
          `<div class="chip"><span style="color:${c.color}">●</span> <strong>${c.valor}</strong> ${c.etiqueta}</div>`
      )
      .join("");
    const links = [
      { t: "Panel de administración", u: "/panel", d: "salud, métricas y controles en vivo" },
      { t: "Métricas Prometheus", u: "/metrics", d: "exportadas en texto plano" },
      { t: "Últimos episodios", u: "/api/v1/ultimos", d: "feed unificado de las 22 fuentes" },
      { t: "Catálogo", u: "/api/v1/catalogo", d: "filtrable por idioma/género/tipo" },
      { t: "Curados", u: "/api/v1/curados", d: "destacados con doblaje latino" },
      { t: "Salud por fuente", u: "/api/v1/salud", d: "circuito breaker + bloqueos CF" },
    ]
      .map(
        (l) =>
          `<a class="card" href="${l.u}"><span class="card-t">${l.t}</span><span class="card-d">${l.d}</span><span class="card-u">${l.u}</span></a>`
      )
      .join("");
    res
      .status(200)
      .type("html")
      .send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ANIMAX API · en línea</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif;
    background: #09090b; color: #e4e4e7; min-height: 100vh;
    display: flex; flex-direction: column; align-items: center;
    padding: 48px 20px 40px;
  }
  header { text-align: center; max-width: 640px; }
  .logo {
    display: inline-block; font-weight: 900; font-size: 34px;
    letter-spacing: 2px; color: #dc2626; line-height: 1;
    border: 2px solid #7f1d1d; border-radius: 14px; padding: 10px 18px;
    background: linear-gradient(180deg, #1c1917, #0c0a09);
  }
  h1 { margin-top: 18px; font-size: 22px; color: #fafafa; }
  .sub { margin-top: 8px; color: #a1a1aa; font-size: 14px; line-height: 1.5; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 22px; }
  .chip {
    background: #18181b; border: 1px solid #27272a; border-radius: 999px;
    padding: 8px 14px; font-size: 13px; color: #d4d4d8;
  }
  .grid {
    margin-top: 30px; display: grid; gap: 12px; width: 100%;
    max-width: 640px; grid-template-columns: 1fr;
  }
  @media (min-width: 560px) { .grid { grid-template-columns: 1fr 1fr; } }
  .card {
    display: flex; flex-direction: column; gap: 4px; text-decoration: none;
    background: #18181b; border: 1px solid #27272a; border-radius: 12px;
    padding: 16px; transition: border-color .15s, transform .15s;
  }
  .card:hover { border-color: #dc2626; transform: translateY(-1px); }
  .card-t { font-weight: 700; color: #fafafa; font-size: 15px; }
  .card-d { color: #a1a1aa; font-size: 12.5px; }
  .card-u { color: #dc2626; font-size: 11.5px; font-family: ui-monospace, monospace; }
  footer { margin-top: 36px; color: #52525b; font-size: 12px; text-align: center; line-height: 1.6; }
  footer code { background: #18181b; border-radius: 4px; padding: 1px 6px; color: #d4d4d8; }
</style>
</head>
<body>
  <header>
    <span class="logo">ANIMAX</span>
    <h1>API en línea</h1>
    <p class="sub">
      ${r.total} fuentes · ${r.vivas} vivas · ${r.bloqueadas} bloqueadas por
      Cloudflare (alcanzables) · ${r.limitadas} limitadas por IP de datacenter ·
      ${r.caidas} caídas.
      Semilla offline: ${s.total} animes y películas — la app nunca se queda vacía.
    </p>
    <div class="chips">${chipsHtml}</div>
  </header>
  <nav class="grid" aria-label="Enlaces de la API">${links}</nav>
  <footer>
    uptime ${Math.floor(process.uptime())} s ·
    JSON de este estado: <code>/?formato=json</code> ·
    lista de endpoints: <code>/api/v1</code> · docs/API.md
  </footer>
</body>
</html>`);
  })
);

// ── Listado JSON de endpoints (lo que documenta la API) ────────
routerSalud.get(
  "/api/v1",
  envolverAsync(async (_req, res) => {
    res.json(resumenJson());
  })
);

routerSalud.get(
  "/api/v1/salud",
  envolverAsync(async (_req, res) => {
    const fuentes = instantaneaSalud();
    const resumen = resumenSalud();
    res.json({
      ok: true,
      resumen,
      fuentes,
      circuito: {
        leyenda: {
          cerrado: "funcionando con normalidad",
          abierto: "caída: se omite hasta que vence su reintento escalado",
          semiabierto: "en prueba tras el reintento",
        },
      },
      bloqueadas: {
        explicacion:
          "fuentes alcanzables pero tras el challenge de Cloudflare: NO se omite su scraping",
        ids: resumen.fuentesBloqueadas,
      },
      limitadas: {
        explicacion:
          "sin respuesta sostenida desde la IP del datacenter de Render (típico bloqueo anti-bot de Cloudflare/proveedores): se re-sondean con backoff de hasta 30 min y reviven solas si vuelven a responder",
        ids: resumen.fuentesLimitadas,
      },
    });
  })
);

export default routerSalud;
