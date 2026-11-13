// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/estado — métricas del servidor:
// uptime, memoria, peticiones (contadores + últimas 200), caché
// (hits/fallos/entradas por namespace), colas de concurrencia,
// salud de fuentes, extractores y semilla offline.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { instantanea, peticionesRecientes } from "../core/eventos";
import { estadisticas, estadisticasPorNamespace } from "../lib/animax/cache";
import { estadisticasCola, fuentesSaturadas } from "../core/cola";
import { resumenSalud } from "../core/salud";
import { listaExtractores, trazadoUltimo } from "../extractores/fabricaExtractores";
import { resumenSemilla } from "../datos/semillaCatalogo";
import { resumenCurados } from "../datos/curados";
import { resumenPeliculas } from "../datos/semillaPeliculas";
import { totalAlias } from "../datos/aliasDb";
import { totalAliasPeliculas } from "../datos/aliasPeliculas";
import { resumenListas } from "../modulos/listasUsuario";
import { resumenContinuar } from "../modulos/gestionContinuarViendo";
import { instantaneaSemaforos, semaforoGlobal } from "../core/semaforo";
import { envolverAsync } from "./comun";

export const routerEstado = Router();

routerEstado.get(
  "/api/v1/estado",
  envolverAsync(async (_req, res) => {
    const mem = process.memoryUsage();
    const peticiones = instantanea();
    res.json({
      ok: true,
      servidor: {
        version: "5.1.0",
        node: process.version,
        uptimeSeg: Math.floor(process.uptime()),
        memoria: {
          rssMb: Math.round(mem.rss / 1048576),
          heapUsadoMb: Math.round(mem.heapUsed / 1048576),
          heapTotalMb: Math.round(mem.heapTotal / 1048576),
        },
      },
      peticiones: {
        contadores: peticiones.contadores,
        totales: peticiones.contadores.peticion ?? 0,
        errores: (peticiones.contadores["peticion-error"] ?? 0),
        recientes: peticionesRecientes().slice(-50),
      },
      cache: {
        ...estadisticas(),
        porNamespace: estadisticasPorNamespace(),
      },
      cola: {
        ...estadisticasCola(),
        fuentesSaturadas: fuentesSaturadas(),
      },
      fuentes: resumenSalud(),
      extractores: {
        cadena: listaExtractores(),
        ultimaExtraccion: trazadoUltimo(),
      },
      datos: {
        semilla: resumenSemilla(),
        peliculas: resumenPeliculas(),
        alias: totalAlias(),
        aliasPeliculas: totalAliasPeliculas(),
        curados: await resumenCurados(),
      },
      // v5.1: módulos de usuario y semáforos de concurrencia
      usuarios: {
        listas: resumenListas(),
        continuar: resumenContinuar(),
      },
      semaforos: {
        global: semaforoGlobal.estadisticas(),
        conNombre: instantaneaSemaforos(),
      },
    });
  })
);

export default routerEstado;
