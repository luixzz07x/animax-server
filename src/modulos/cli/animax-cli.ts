#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · CLI de mantenimiento (src/cli/animax-cli.ts).
// Se ejecuta SIN arrancar el server (no importa index.ts):
//   npm run cli salud               → sonda en vivo de las fuentes
//   npm run cli fuentes             → inventario + estado runtime
//   npm run cli probar-fuente <id>  → sonda + búsqueda de prueba
//   npm run cli probar-extractor <url> → resuelve un embed de video
//   npm run cli caché               → estadísticas del caché
//   npm run cli dominios            → dominios activos/alternativos
// Útil para cron externos, deploys y diagnóstico post-mortem.
// ─────────────────────────────────────────────────────────────

import { chequearFuentes, instantaneaSalud, sondearFuente } from "../core/salud";
import { inventarioFuentes, resumenFuentesRuntime } from "../core/fuentes";
import { inventarioDominios } from "../core/dominios";
import { estadisticas, estadisticasPorNamespace } from "../lib/animax/cache";
import { scrapersActivos } from "../lib/animax/registro";
import { extraerVideo } from "../extractores/fabricaExtractores";
import { historialVigilante } from "../vigilante/vigilante";
import { resumenContinuar } from "../modulos/gestionContinuarViendo";
import { resumenListas } from "../modulos/listasUsuario";
import { resumenSemilla } from "../datos/semillaCatalogo";
import { resumenPeliculas } from "../datos/semillaPeliculas";

const ARGS = process.argv.slice(2);
const COMANDO = ARGS[0] || "";

function linea(ancho: number, ch = "─"): string {
  return ch.repeat(ancho);
}

function ms(m: number | null): string {
  return m === null ? "—" : `${m} ms`;
}

async function cmdSalud(): Promise<number> {
  console.log("ANIMAX v5.1 · sonda de salud de fuentes (en vivo)");
  console.log(linea(72));
  const inicio = Date.now();
  await chequearFuentes();
  const estados = instantaneaSalud();
  console.log(
    `fuentes chequeadas: ${estados.length} · ${(Date.now() - inicio) / 1000}s\n`
  );
  for (const e of estados) {
    const senal =
      e.circuito === "cerrado" ? "✔" : e.circuito === "abierto" ? "✘" : "◐";
    console.log(
      `${senal} ${e.id.padEnd(16)} ${e.circuito.padEnd(12)} fallos consecutivos: ${String(e.fallosConsecutivos).padEnd(3)} latencia: ${ms(e.ultimaLatenciaMs)}`
    );
  }
  const caidas = estados.filter((e) => e.circuito === "abierto");
  console.log(linea(72));
  console.log(`resumen: ${estados.length - caidas.length} vivas · ${caidas.length} caídas`);
  const ciclos = historialVigilante();
  if (ciclos.length > 0) {
    const ultimo = ciclos[ciclos.length - 1];
    console.log(
      `último ciclo del vigilante: ${new Date(ultimo.fecha).toISOString()} · conmutadas ${ultimo.conmutadas.length} · caídas ${ultimo.caidas.length}`
    );
  }
  return caidas.length > 0 ? 1 : 0;
}

async function cmdFuentes(): Promise<number> {
  const inventario = inventarioFuentes();
  const runtime = resumenFuentesRuntime();
  console.log("ANIMAX v5.1 · inventario de fuentes");
  console.log(linea(72));
  console.log(
    `total ${runtime.total} · habilitadas ${runtime.habilitadas} · suspendidas en caliente ${runtime.suspendidas}\n`
  );
  for (const f of inventario) {
    console.log(
      `${f.habilitada ? "✔" : "⊘"} ${f.id.padEnd(16)} ${(f.nombre || "").padEnd(18)} ${f.grupo.padEnd(7)} ${f.dominio}`
    );
  }
  return 0;
}

async function cmdProbarFuente(id: string): Promise<number> {
  const scraper = scrapersActivos().find((s) => s.id === id);
  const sonda = await sondearFuente(id);
  console.log(`ANIMAX v5.1 · prueba de la fuente "${id}"`);
  console.log(linea(72));
  console.log(`sonda HTTP: ${sonda.ok ? "OK" : "SIN RESPUESTA"} (${ms(sonda.ms)})`);
  if (!scraper) {
    console.log("scraper: NO habilitado o desconocido (revisa el id con `npm run cli fuentes`)");
    return 1;
  }
  console.log(`scraper: ${scraper.nombre} · baseUrl ${scraper.baseUrl} · idioma ${scraper.idioma}`);
  try {
    const tarjetas = await scraper.buscar("naruto");
    console.log(`búsqueda de prueba ("naruto"): ${tarjetas.length} resultado(s)`);
    for (const t of tarjetas.slice(0, 5)) {
      console.log(`  · ${t.titulo} → ${t.slug}`);
    }
  } catch {
    console.log("búsqueda de prueba: FALLO (excepción)");
    return 1;
  }
  return sonda.ok ? 0 : 1;
}

async function cmdProbarExtractor(url: string): Promise<number> {
  console.log(`ANIMAX v5.1 · prueba del extractor sobre:`);
  console.log(`  ${url}`);
  console.log(linea(72));
  const inicio = Date.now();
  const { resultado, trazado } = await extraerVideo(url);
  console.log(`resultado: ${resultado.tipo} · ${(Date.now() - inicio) / 1000}s`);
  console.log(`url directa: ${resultado.urlDirecta}`);
  if (resultado.calidad) console.log(`calidad: ${resultado.calidad}`);
  if (trazado) {
    console.log(`extractores probados: ${trazado.intentos.join(" → ")}`);
    console.log(`extractor final: ${trazado.extractorFinal}`);
  }
  return resultado.tipo === "proxy" ? 2 : 0;
}

function cmdCache(): number {
  const est = estadisticas();
  console.log("ANIMAX v5.1 · estadísticas del caché en memoria");
  console.log(linea(72));
  console.log(
    `entradas: ${est.entradas} · en vuelo: ${est.enVuelo} · hits: ${est.hits} · fallos: ${est.fallos}`
  );
  const porNs = estadisticasPorNamespace();
  if (porNs.length > 0) {
    console.log("\npor namespace:");
    for (const ns of porNs) {
      console.log(`  ${ns.namespace.padEnd(18)} ${ns.entradas} entradas`);
    }
  }
  return 0;
}

function cmdDominios(): number {
  const inv = inventarioDominios();
  console.log("ANIMAX v5.1 · dominios activos por fuente");
  console.log(linea(72));
  for (const d of inv) {
    console.log(
      `${d.conmutado ? "⇄" : " "} ${d.id.padEnd(16)} ${d.actual}`
    );
    if (d.conmutado) console.log(`    oficial: ${d.original}`);
    if (d.alternativos.length > 0) {
      console.log(`    respaldos: ${d.alternativos.join(", ")}`);
    }
  }
  return 0;
}

function cmdResumen(): number {
  console.log("ANIMAX v5.1 · resumen del estado local");
  console.log(linea(72));
  const cache = estadisticas();
  console.log(`caché: ${cache.entradas} entradas · ${cache.hits} hits`);
  console.log(`semilla series: ${resumenSemilla().total} títulos`);
  console.log(`semilla películas: ${resumenPeliculas().total} títulos`);
  console.log(`listas de usuario: ${JSON.stringify(resumenListas())}`);
  console.log(`continuar viendo: ${JSON.stringify(resumenContinuar())}`);
  return 0;
}

function ayuda(): number {
  console.log("ANIMAX v5.1 · CLI de mantenimiento");
  console.log(linea(72));
  console.log("uso: npm run cli <comando> [args]");
  console.log("");
  console.log("comandos:");
  console.log("  salud                    sonda en vivo de todas las fuentes");
  console.log("  fuentes                  inventario de fuentes + estado runtime");
  console.log("  probar-fuente <id>       sonda + búsqueda de prueba de una fuente");
  console.log("  probar-extractor <url>   resuelve un embed de video con la cadena");
  console.log("  caché                    estadísticas del caché en memoria");
  console.log("  dominios                 dominios activos + respaldos");
  console.log("  resumen                  resumen local (caché, semillas, usuarios)");
  return 0;
}

async function main(): Promise<void> {
  switch (COMANDO) {
    case "salud":
      process.exitCode = await cmdSalud();
      break;
    case "fuentes":
      process.exitCode = await cmdFuentes();
      break;
    case "probar-fuente":
      if (!ARGS[1]) {
        console.log("uso: npm run cli probar-fuente <id-fuente>");
        process.exitCode = 1;
        break;
      }
      process.exitCode = await cmdProbarFuente(ARGS[1]);
      break;
    case "probar-extractor":
      if (!ARGS[1]) {
        console.log("uso: npm run cli probar-extractor <url-del-embed>");
        process.exitCode = 1;
        break;
      }
      process.exitCode = await cmdProbarExtractor(ARGS[1]);
      break;
    case "cache":
    case "caché":
      process.exitCode = cmdCache();
      break;
    case "dominios":
      process.exitCode = cmdDominios();
      break;
    case "resumen":
      process.exitCode = cmdResumen();
      break;
    default:
      process.exitCode = ayuda();
  }
}

void main().catch((e: unknown) => {
  console.error(`[cli] error: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
