// ─────────────────────────────────────────────────────────────
// ANIMAX v5.2-FIX · Salud de fuentes: health-check periódico + CIRCUIT
// BREAKER — AJUSTADO PARA RENDER FREE (CPU compartida + arranque frío).
//
// Cambios del fix (ver README-FIX-RENDER.md):
//  1. GRACIA DE ARRANQUE: los primeros minutos los fallos NO abren el
//     circuito (en Render el TLS/DNS está frío y todo "falla" al inicio).
//  2. SONDEO POR LOTES: en lugar de 20 fetches simultáneos (ahogaba la
//     única CPU del plan free), se sondenan en lotes pequeños con pausa.
//  3. BLOQUEADA ≠ MUERTA: una fuente que responde con el challenge de
//     Cloudflare está ALCANZABLE (red bien) — NO abre su circuito, solo
//     se marca "bloqueada" y el scraping real sigue probándola.
//  4. UMBRAL MÁS ALTO + ENFRIAMIENTO LARGO: hace falta acumular más
//     fallos consecutivos para omitir una fuente.
//  5. Ciclo agregado: emite "ciclo-salud" con resumen de una línea
//     (adiós al spam de 20 líneas de log por ciclo).
// ─────────────────────────────────────────────────────────────

import ajustesJson from "../config/ajustes.json";
import fuentesJson from "../config/fuentes.json";
import { obtenerHttp } from "../lib/animax/http";
import { dominioActivo } from "./dominios";
import { emitir } from "./eventos";
import { fuenteHabilitada } from "./fuentes";

interface AjustesSalud {
  salud: {
    umbralFallos: number;
    enfriamientoMs: number;
    intervaloChequeoMs: number;
    /** FIX: minutos tras el arranque en los que NO se abre ningún circuito. */
    graciaArranqueMs?: number;
    /** FIX: tamaño del lote de sondas simultáneas (CPU friendly). */
    loteSonda?: number;
    /** FIX: pausa entre lotes de sondas. */
    pausaLoteMs?: number;
  };
  timeouts: {
    sondaSaludMs: number;
  };
}

const AJ = (ajustesJson as unknown as AjustesSalud).salud;
const TIMEOUT_SONDA = (ajustesJson as unknown as AjustesSalud).timeouts.sondaSaludMs ?? 12000;
const ARRANQUE = Date.now();

interface FuenteCfg {
  id: string;
  nombre: string;
  baseUrl: string;
  grupo: string;
  activo: boolean;
}

const FUENTES = (fuentesJson as unknown as { fuentes: FuenteCfg[] }).fuentes;

export type EstadoCircuito = "cerrado" | "abierto" | "semiabierto";

export interface EstadoFuente {
  id: string;
  nombre: string;
  dominio: string;
  grupo: string;
  circuito: EstadoCircuito;
  fallosConsecutivos: number;
  exitos: number;
  fallos: number;
  ultimaLatenciaMs: number | null;
  ultimoExito: number | null;
  ultimoFallo: number | null;
  omitidas: number;
  /** Siguiente instantánea (epoch ms) en la que se le da otra oportunidad. */
  reintentoEn: number | null;
  /** FIX: la fuente responde pero con challenge/bloqueo Cloudflare. */
  bloqueada: boolean;
}

const estados = new Map<string, EstadoFuente>();

function estadoDe(id: string): EstadoFuente {
  let e = estados.get(id);
  if (!e) {
    const cfg = FUENTES.find((f) => f.id === id);
    e = {
      id,
      nombre: cfg?.nombre || id,
      dominio: dominioActivo(id),
      grupo: cfg?.grupo || "sub",
      circuito: "cerrado",
      fallosConsecutivos: 0,
      exitos: 0,
      fallos: 0,
      ultimaLatenciaMs: null,
      ultimoExito: null,
      ultimoFallo: null,
      omitidas: 0,
      reintentoEn: null,
      bloqueada: false,
    };
    estados.set(id, e);
  }
  e.dominio = dominioActivo(id); // siempre fresco (cambios en caliente)
  return e;
}

/** ¿Estamos dentro de la gracia de arranque (CPU/DNS frío en Render)? */
function enGraciaArranque(): boolean {
  return Date.now() - ARRANQUE < (AJ.graciaArranqueMs ?? 180000);
}

/** ¿Se le puede pedir algo a esta fuente ahora? */
export function fuenteDisponible(id: string): boolean {
  const e = estadoDe(id);
  if (e.circuito === "cerrado") return true;
  if (e.circuito === "abierto") {
    if (e.reintentoEn !== null && Date.now() >= e.reintentoEn) {
      // SEMI-ABIERTO: una oportunidad controlada; si falla se reabre.
      e.circuito = "semiabierto";
      return true;
    }
    e.omitidas++;
    emitir("fuente-omitida", { fuente: id, detalle: "circuito abierto" });
    return false;
  }
  return true; // semiabierto: en prueba
}

/** Registra un ÉXITO de la fuente (reset total del circuito). */
export function registrarExito(id: string, ms?: number): void {
  const e = estadoDe(id);
  e.circuito = "cerrado";
  e.fallosConsecutivos = 0;
  e.exitos++;
  e.ultimaLatenciaMs = ms ?? e.ultimaLatenciaMs;
  e.ultimoExito = Date.now();
  e.reintentoEn = null;
  e.bloqueada = false;
  emitir("fuente-ok", { fuente: id, ms });
}

/** FIX: la fuente RESPONDE pero muestra el challenge de Cloudflare.
 * Está alcanzable (la red funciona): NO cuenta como fallo de circuito
 * porque el scraping real puede pasar donde el sondeo no. */
export function registrarBloqueada(id: string, ms?: number): void {
  const e = estadoDe(id);
  e.bloqueada = true;
  e.ultimaLatenciaMs = ms ?? e.ultimaLatenciaMs;
  e.ultimoExito = Date.now(); // alcanzable = viva para efectos de red
  e.fallosConsecutivos = 0; // no castigamos el circuito por un bloqueo
  emitir("fuente-ok", { fuente: id, ms, detalle: "alcanzable (bloqueo Cloudflare)" });
}

/** Registra un FALLO de la fuente (timeout, HTTP muerto, parse vacío). */
export function registrarFallo(id: string, detalle?: string): void {
  const e = estadoDe(id);
  e.fallos++;
  e.fallosConsecutivos++;
  e.ultimoFallo = Date.now();
  e.bloqueada = false;
  const umbral = AJ.umbralFallos ?? 6;
  // FIX: durante la gracia de arranque NINGÚN circuito se abre.
  if (
    e.fallosConsecutivos >= umbral &&
    e.circuito !== "abierto" &&
    !enGraciaArranque()
  ) {
    e.circuito = "abierto";
    e.reintentoEn = Date.now() + (AJ.enfriamientoMs ?? 120000);
    emitir("fuente-fallo", { fuente: id, detalle: `circuito abierto (${detalle || "fallo"})` });
  } else {
    emitir("fuente-fallo", { fuente: id, detalle });
  }
}

export type ClasificacionSonda = "ok" | "bloqueada" | "muerta";

/** Sonda HTTP de una fuente: GET a su dominio activo.
 * Clasifica en ok / bloqueada (Cloudflare) / muerta (sin respuesta). */
export async function sondearFuente(
  id: string
): Promise<{ ok: boolean; ms: number | null; clase: ClasificacionSonda }> {
  const base = dominioActivo(id);
  if (!base) return { ok: false, ms: null, clase: "muerta" };
  const inicio = Date.now();
  const html = await obtenerHttp(base, {
    timeoutMs: TIMEOUT_SONDA,
    reintentos: 0,
  });
  const ms = Date.now() - inicio;
  if (html === null || html.length <= 500) {
    // Sin cuerpo: en Render free el arranque frío provoca timeouts que
    // NO significan fuente muerta — la gracia y el umbral lo compensan.
    return { ok: false, ms: null, clase: "muerta" };
  }
  // FIX: challenge de Cloudflare = fuente ALCANZABLE (red viva), no muerta.
  const bloqueadaCloudflare =
    /just a moment|challenge-platform|attention required|cf-browser-verification|checking your browser/i.test(
      html.slice(0, 4000)
    );
  if (bloqueadaCloudflare) {
    return { ok: false, ms, clase: "bloqueada" };
  }
  return { ok: true, ms, clase: "ok" };
}

/** Chequeo de TODAS las fuentes habilitadas en LOTES pequeños con pausa
 * (el plan free de Render tiene UNA CPU: 20 sondas de golpe la ahogaban). */
export async function chequearFuentes(): Promise<EstadoFuente[]> {
  const activas = FUENTES.filter((f) => fuenteHabilitada(f.id));
  const lote = AJ.loteSonda ?? 4;
  const pausa = AJ.pausaLoteMs ?? 900;
  const inicio = Date.now();
  let vivas = 0;
  let bloqueadas = 0;
  let muertas = 0;

  for (let i = 0; i < activas.length; i += lote) {
    const grupo = activas.slice(i, i + lote);
    await Promise.all(
      grupo.map(async (f) => {
        const r = await sondearFuente(f.id);
        if (r.clase === "ok") {
          registrarExito(f.id, r.ms ?? undefined);
          vivas++;
        } else if (r.clase === "bloqueada") {
          registrarBloqueada(f.id, r.ms ?? undefined);
          bloqueadas++;
        } else {
          registrarFallo(f.id, "sonda sin respuesta");
          muertas++;
        }
      })
    );
    if (i + lote < activas.length) {
      await new Promise((resolver) => setTimeout(resolver, pausa));
    }
  }

  // Resumen agregado de UNA línea (antes: 20 líneas de spam por ciclo).
  emitir("ciclo-salud", {
    total: activas.length,
    vivas,
    bloqueadas,
    muertas,
    ms: Date.now() - inicio,
  });

  return instantaneaSalud();
}

/** Instantánea para /api/v1/salud. */
export function instantaneaSalud(): EstadoFuente[] {
  return FUENTES.filter((f) => fuenteHabilitada(f.id)).map((f) => ({ ...estadoDe(f.id) }));
}

/** Resumen agregado (para el healthcheck raíz). */
export function resumenSalud(): {
  total: number;
  vivas: number;
  bloqueadas: number;
  caidas: number;
  circuitoAbierto: string[];
  fuentesBloqueadas: string[];
} {
  const lista = instantaneaSalud();
  const caidas = lista.filter(
    (e) => e.circuito === "abierto" && e.reintentoEn !== null && Date.now() < e.reintentoEn
  );
  const bloqueadas = lista.filter((e) => e.bloqueada && !caidas.includes(e));
  return {
    total: lista.length,
    vivas: lista.length - caidas.length,
    bloqueadas: bloqueadas.length,
    caidas: caidas.length,
    circuitoAbierto: caidas.map((e) => e.id),
    fuentesBloqueadas: bloqueadas.map((e) => e.id),
  };
}

/** Temporizador de chequeo periódico (lo arranca index.ts). */
export function iniciarSaludPeriodica(): void {
  const intervalo = AJ.intervaloChequeoMs ?? 600000;
  const t = setInterval(() => {
    void chequearFuentes().catch(() => undefined);
  }, intervalo);
  if (typeof t.unref === "function") t.unref();
  // Primera pasada diferida 30 s (deja arrancar server + calentar DNS/TLS;
  // en Render free el arranque frío hacía fallar TODAS las fuentes).
  setTimeout(() => {
    void chequearFuentes().catch(() => undefined);
  }, 30000).unref?.();
}
