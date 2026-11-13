// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Servidor standalone (Render / VPS) — SOLO ENSAMBLADO.
// Toda la lógica vive en módulos:
//   src/rutas/        → 20 routers Express (uno por área de API)
//   src/modulos/      → lógica de dominio v5.1 (recomendaciones,
//                       tendencias, programación, tops, usuarios)
//   src/panel/        → panel de administración web (GET /panel)
//   src/middleware/   → cors, seguridad, logging, rate-limit, errores
//   src/core/         → cola por fuente, reintentos, salud (circuit
//                       breaker), dominios en caliente, eventos,
//                       métricas Prometheus, semáforo, fuentes runtime
//   src/vigilante/    → watchdog de dominios alternativos (10 min)
//   src/extractores/  → 15 extractores de video + fábrica en cadena
//   src/scrapers/     → 8 fuentes nuevas v5 + reexporta las 14 previas
//   src/lib/animax/   → motor original (registro, dedupe, índice…)
//   src/cli/          → CLI de mantenimiento (npm run cli)
// Puerto: PORT (Render lo inyecta) · fallback 3001.
// ─────────────────────────────────────────────────────────────

import express from "express";
import compression from "compression";
import path from "node:path";

import { middlewareCors } from "./src/middleware/cors";
import { middlewareSeguridad } from "./src/middleware/seguridad";
import { middlewareRegistro } from "./src/middleware/registro";
import { limitesApi } from "./src/middleware/limites";
import { noEncontrado, manejadorErrores } from "./src/middleware/errores";

import { routerSalud } from "./src/rutas/rutasSalud";
import { routerUltimos } from "./src/rutas/rutasUltimos";
import { routerBuscar } from "./src/rutas/rutasBuscar";
import { routerAnime } from "./src/rutas/rutasAnime";
import { routerServidores } from "./src/rutas/rutasServidores";
import { routerStream } from "./src/rutas/rutasStream";
import { routerGeneros } from "./src/rutas/rutasGeneros";
import { routerCatalogo } from "./src/rutas/rutasCatalogo";
import { routerCurados } from "./src/rutas/rutasCurados";
import { routerCron, refrescar } from "./src/rutas/rutasCron";
import { routerEstado } from "./src/rutas/rutasEstado";
import { routerDominios } from "./src/rutas/rutasDominios";
// v5.1: routers de dominio nuevo + administración + panel web
import { routerTendencias } from "./src/rutas/rutasTendencias";
import { routerProgramacion } from "./src/rutas/rutasProgramacion";
import { routerRecomendaciones } from "./src/rutas/rutasRecomendaciones";
import { routerListas } from "./src/rutas/rutasListas";
import { routerContinuar } from "./src/rutas/rutasContinuar";
import { routerTop } from "./src/rutas/rutasTop";
import { routerAdmin } from "./src/rutas/rutasAdmin";
import { routerPanel } from "./src/panel/panelAdmin";

import { calentarCurados } from "./src/datos/curados";
import { iniciarVigilante } from "./src/vigilante/vigilante";
import { iniciarSaludPeriodica } from "./src/core/salud";

const app = express();
app.disable("x-powered-by");

// ── Middleware global ─────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(middlewareCors);
app.use(middlewareSeguridad);
app.use(middlewareRegistro);
app.use(limitesApi);

// ── v5.3: assets estáticos (public/img + public/fonts) ────────
// Antes GET /img/icono.png daba 404 (el panel pedía un icono que el
// server no servía) y las 20 fuentes TTF de public/fonts tampoco se
// podían descargar. Caché larga: son archivos inmutables por versión.
const PUBLICO = path.resolve(import.meta.dirname, "public");
app.use(
  "/img",
  express.static(path.join(PUBLICO, "img"), {
    fallthrough: true,
    maxAge: "7d",
    setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
  })
);
app.use(
  "/fonts",
  express.static(path.join(PUBLICO, "fonts"), {
    fallthrough: true,
    maxAge: "30d",
    setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
  })
);

// ── Routers (cada uno monta sus rutas completas) ──────────────
app.use(routerSalud); // GET / · GET /api/v1/salud
app.use(routerUltimos); // GET /api/v1/ultimos
app.use(routerBuscar); // GET /api/v1/buscar?q=
app.use(routerAnime); // GET /api/v1/anime/:slug
app.use(routerServidores); // GET /api/v1/servidores/:slug/:ep
app.use(routerStream); // GET /api/v1/stream?url=&ref=&raw=
app.use(routerGeneros); // GET /api/v1/generos
app.use(routerCatalogo); // GET /api/v1/catalogo?idioma=&genero=&tipo=
app.use(routerCurados); // GET /api/v1/curados
app.use(routerCron); // GET|POST /api/v1/cron/refresh
app.use(routerEstado); // GET /api/v1/estado
app.use(routerDominios); // GET/POST /api/v1/dominios…

// ── v5.1: dominio nuevo (módulos src/modulos/) ───────────────
app.use(routerTendencias); // GET /api/v1/tendencias…
app.use(routerProgramacion); // GET /api/v1/programacion…
app.use(routerRecomendaciones); // GET /api/v1/recomendaciones/:slug
app.use(routerTop); // GET /api/v1/top/valorados|vistos|genero|decada
app.use(routerContinuar); // GET|POST|DELETE /api/v1/continuar…, /api/v1/historial
app.use(routerListas); // CRUD /api/v1/listas…

// ── v5.1: administración + panel web + métricas Prometheus ───
app.use(routerAdmin); // GET|POST /api/v1/admin… · GET /metrics
app.use(routerPanel); // GET /panel (HTML embebido, sin dependencias)

// ── 404 de API + catch-all ───────────────────────────────────
app.use("/api", noEncontrado);
app.use(manejadorErrores);

// ── Jobs internos ────────────────────────────────────────────
// Refresco del caché de portada cada 10 min (como instrumentation.ts)
const INTERVALO = 10 * 60 * 1000;
setTimeout(() => void refrescar().catch(() => undefined), 8000).unref?.();
setInterval(() => void refrescar().catch(() => undefined), INTERVALO);
// Calienta la lista curada de destacados al arrancar
setTimeout(() => calentarCurados(), 12000).unref?.();
// Circuit breaker + health-check adaptativo de las 22 fuentes
iniciarSaludPeriodica();
// Watchdog de dominios alternativos (solo fuentes con reintento vencido)
iniciarVigilante();

// ── v5.3: KEEP-AWAKE (plan free de Render duerme a los 15 min) ─
// El server se hace un ping a sí mismo cada 10 min por su URL pública
// (RENDER_EXTERNAL_URL la inyecta Render). Desactivable con
// MANTENER_DESPIERTO=0. Con la pestaña del panel abierta también se
// mantiene despierto (refresco cada 10 s), pero esto cubre el resto.
const URL_EXTERNA = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || "";
if (URL_EXTERNA && process.env.MANTENER_DESPIERTO !== "0") {
  const ping = () =>
    fetch(`${URL_EXTERNA}/api/v1/salud`, {
      headers: { "User-Agent": "animax-keepalive/5.3", Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    })
      .then((r) => r.body?.cancel())
      .catch(() => undefined);
  const t = setInterval(() => void ping(), 10 * 60 * 1000);
  if (typeof t.unref === "function") t.unref();
  setTimeout(() => void ping(), 4 * 60 * 1000).unref?.();
  console.log(`[keep-awake] activo · ping propio cada 10 min a ${URL_EXTERNA}`);
}

// ── Arranque ──────────────────────────────────────────────────
const PUERTO = parseInt(process.env.PORT || "3001", 10);
app.listen(PUERTO, () => {
  console.log(`[animax-server v5.3] escuchando en :${PUERTO} (22 fuentes · 15 extractores · panel /panel)`);
});

export default app;
