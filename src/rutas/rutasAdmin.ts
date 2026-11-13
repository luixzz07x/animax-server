// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Router /api/v1/admin — API de ADMINISTRACIÓN:
// estado de fuentes, suspensión/reanudación en caliente, cambio
// de dominio, purga de caché, métricas Prometheus y logs.
//   GET  /api/v1/admin/estado        → vista global (panel)
//   GET  /api/v1/admin/fuentes       → inventario + salud
//   POST /api/v1/admin/fuentes/:id/suspender
//   POST /api/v1/admin/fuentes/:id/reanudar
//   POST /api/v1/admin/cache/purgar  {namespace?}  (vacío = TODO)
//   POST /api/v1/admin/dominios/:fuente  {baseUrl}
//   POST /api/v1/admin/dominios/:fuente/reset
//   GET  /api/v1/admin/logs          → últimas 100 peticiones
//   GET  /metrics                    → texto Prometheus (scrape)
//   GET  /api/v1/metricas            → mismo texto (API)
// ─────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from "express";
import { inventarioFuentes, resumenFuentesRuntime, suspenderFuente, reanudarFuente } from "../core/fuentes";
import { instantaneaSalud, chequearFuentes, resumenSalud } from "../core/salud";
import { registrarDominio, restablecerDominio } from "../core/dominios";
import { estadisticas, estadisticasPorNamespace, invalidar } from "../lib/animax/cache";
import { peticionesRecientes, instantanea, emitir } from "../core/eventos";
import { textoPrometheus } from "../core/metricas";
import { instantaneaSemaforos, semaforoGlobal } from "../core/semaforo";
import { resumenListas, guardarAhora } from "../modulos/listasUsuario";
import { resumenContinuar } from "../modulos/gestionContinuarViendo";
import { resumenSemilla } from "../datos/semillaCatalogo";
import { resumenPeliculas } from "../datos/semillaPeliculas";
import { envolverAsync } from "./comun";

export const routerAdmin = Router();

/** Contadores de todos los namespaces de caché conocidos. */
const NAMESPACES_CACHE = [
  "buscar",
  "ultimos",
  "detalle",
  "servidores",
  "extractor",
  "generos",
  "curados",
  "cattipo",
  "recomendaciones",
  "tops",
];

routerAdmin.get(
  "/api/v1/admin/estado",
  envolverAsync(async (_req, res) => {
    const mem = process.memoryUsage();
    const inventario = inventarioFuentes();
    const salud = instantaneaSalud();
    res.json({
      ok: true,
      servidor: {
        version: "5.1.0",
        node: process.version,
        uptimeSeg: Math.floor(process.uptime()),
        memoria: {
          rssMb: Math.round(mem.rss / 1048576),
          heapUsadoMb: Math.round(mem.heapUsed / 1048576),
        },
      },
      fuentes: {
        runtime: resumenFuentesRuntime(),
        salud: resumenSalud(),
        detalle: inventario.map((f) => {
          const s = salud.find((x) => x.id === f.id);
          return {
            id: f.id,
            nombre: f.nombre,
            dominio: f.dominio,
            grupo: f.grupo,
            suspendida: !f.habilitada,
            circuito: s?.circuito ?? "n/a",
            fallosConsecutivos: s?.fallosConsecutivos ?? 0,
            latenciaMs: s?.ultimaLatenciaMs ?? null,
          };
        }),
      },
      cache: { ...estadisticas(), porNamespace: estadisticasPorNamespace() },
      peticiones: instantanea().contadores,
      semaforos: { global: semaforoGlobal.estadisticas(), conNombre: instantaneaSemaforos() },
      usuarios: {
        listas: resumenListas(),
        continuar: resumenContinuar(),
      },
      datos: { semillaSeries: resumenSemilla(), peliculas: resumenPeliculas() },
    });
  })
);

routerAdmin.get(
  "/api/v1/admin/fuentes",
  envolverAsync(async (_req, res) => {
    const inventario = inventarioFuentes();
    const salud = instantaneaSalud();
    res.json({
      ok: true,
      data: {
        runtime: resumenFuentesRuntime(),
        fuentes: inventario.map((f) => {
          const s = salud.find((x) => x.id === f.id);
          return {
            ...f,
            circuito: s?.circuito ?? "n/a",
            fallosConsecutivos: s?.fallosConsecutivos ?? 0,
            latenciaMs: s?.ultimaLatenciaMs ?? null,
            ultimoExito: s?.ultimoExito ?? null,
          };
        }),
      },
    });
  })
);

routerAdmin.post(
  "/api/v1/admin/fuentes/:id/suspender",
  envolverAsync(async (req, res) => {
    const aplicado = suspenderFuente(req.params.id);
    if (!aplicado) {
      res.status(404).json({ ok: false, error: "fuente desconocida" });
      return;
    }
    // Su caché caduca igual, pero se evita seguir sirviendo su contenido
    invalidar("buscar");
    res.json({
      ok: true,
      data: { fuente: req.params.id, suspendida: true },
      nota: "la fuente deja de scrapearse ya (sin redeploy); reanuda con /api/v1/admin/fuentes/:id/reanudar",
    });
  })
);

routerAdmin.post(
  "/api/v1/admin/fuentes/:id/reanudar",
  envolverAsync(async (req, res) => {
    const aplicado = reanudarFuente(req.params.id);
    if (!aplicado) {
      res.status(404).json({ ok: false, error: "fuente desconocida o no suspendida" });
      return;
    }
    res.json({ ok: true, data: { fuente: req.params.id, reanudada: true } });
  })
);

routerAdmin.post(
  "/api/v1/admin/cache/purgar",
  envolverAsync(async (req, res) => {
    const namespace = typeof req.body?.namespace === "string" ? req.body.namespace.trim() : "";
    if (namespace && !NAMESPACES_CACHE.includes(namespace)) {
      res.status(400).json({
        ok: false,
        error: `namespace inválido. Válidos: ${NAMESPACES_CACHE.join(", ")} (vacío = todos)`,
      });
      return;
    }
    if (namespace) {
      invalidar(namespace);
      emitir("cache-invalidada", { namespace });
    } else {
      for (const ns of NAMESPACES_CACHE) {
        invalidar(ns);
        emitir("cache-invalidada", { namespace: ns });
      }
    }
    res.json({
      ok: true,
      data: {
        purgado: namespace || "todos",
        restantes: estadisticas().entradas,
        porNamespace: estadisticasPorNamespace(),
      },
    });
  })
);

routerAdmin.post(
  "/api/v1/admin/dominios/:fuente",
  envolverAsync(async (req, res) => {
    const fuente = req.params.fuente;
    const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : "";
    if (!baseUrl) {
      res.status(400).json({ ok: false, error: "body requerido: { baseUrl }" });
      return;
    }
    const aplicado = registrarDominio(fuente, baseUrl, "manual");
    if (!aplicado) {
      res.status(404).json({ ok: false, error: "fuente desconocida o baseUrl inválida" });
      return;
    }
    for (const ns of ["buscar", "ultimos", "detalle", "servidores", "curados"]) invalidar(ns);
    res.json({
      ok: true,
      data: { fuente, baseUrl, cachesInvalidados: true },
      nota: "todo el scraping a esta fuente se redirige ya al dominio nuevo",
    });
  })
);

routerAdmin.post(
  "/api/v1/admin/dominios/:fuente/reset",
  envolverAsync(async (req, res) => {
    const aplicado = restablecerDominio(req.params.fuente);
    if (!aplicado) {
      res.status(404).json({ ok: false, error: "fuente desconocida" });
      return;
    }
    for (const ns of ["buscar", "ultimos", "detalle", "servidores"]) invalidar(ns);
    res.json({ ok: true, data: { fuente: req.params.fuente, restaurado: true } });
  })
);

routerAdmin.post(
  "/api/v1/admin/chequear-fuentes",
  envolverAsync(async (_req, res) => {
    const r = await chequearFuentes();
    res.json({ ok: true, data: { chequeadas: r.length, resumen: resumenSalud() } });
  })
);

routerAdmin.get(
  "/api/v1/admin/logs",
  envolverAsync(async (_req, res) => {
    const recientes = peticionesRecientes().slice(-100);
    res.json({
      ok: true,
      data: { total: recientes.length, peticiones: recientes.reverse() },
    });
  })
);

/** Métricas Prometheus (texto plano). */
function responderMetricas(_req: Request, res: Response): void {
  res.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(textoPrometheus());
}

routerAdmin.get("/metrics", responderMetricas);
routerAdmin.get("/api/v1/metricas", responderMetricas);

/** Guardado manual de las listas de usuario (persistencia JSON). */
routerAdmin.post(
  "/api/v1/admin/listas/guardar",
  envolverAsync(async (_req, res) => {
    guardarAhora();
    res.json({ ok: true, data: resumenListas() });
  })
);

export default routerAdmin;
