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
// Circuit breaker + health-check periódico de las 22 fuentes
iniciarSaludPeriodica();
// Watchdog de dominios alternativos (cada 10 min)
iniciarVigilante();

// ── Arranque ──────────────────────────────────────────────────
const PUERTO = parseInt(process.env.PORT || "3001", 10);
app.listen(PUERTO, () => {
  console.log(`[animax-server v5.2] escuchando en :${PUERTO} (22 fuentes · 15 extractores · panel /panel)`);
});

export default app;
