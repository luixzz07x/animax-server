// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Salud de fuentes: health-check periódico + CIRCUIT
// BREAKER. Cada fuente acumula fallos; al llegar al umbral el
// circuito se ABRE y el registro la omite (failover instantáneo,
// cero latencia en las búsquedas). Tras el periodo de enfriamiento
// pasa a SEMI-ABIERTO: se le deja una oportunidad y si vuelve a
// fallar se reabre. Los fallos los reporta el propio registro (via
// registrarFallo) y el chequeo periódico (sonda del dominio activo).
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
  };
  timeouts: {
    sondaSaludMs: number;
  };
}

const AJ = (ajustesJson as unknown as AjustesSalud).salud;
const TIMEOUT_SONDA = (ajustesJson as unknown as AjustesSalud).timeouts.sondaSaludMs ?? 5000;

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
    };
    estados.set(id, e);
  }
  e.dominio = dominioActivo(id); // siempre fresco (cambios en caliente)
  return e;
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
  emitir("fuente-ok", { fuente: id, ms });
}

/** Registra un FALLO de la fuente (timeout, HTTP muerto, parse vacío). */
export function registrarFallo(id: string, detalle?: string): void {
  const e = estadoDe(id);
  e.fallos++;
  e.fallosConsecutivos++;
  e.ultimoFallo = Date.now();
  const umbral = AJ.umbralFallos ?? 4;
  if (e.fallosConsecutivos >= umbral && e.circuito !== "abierto") {
    e.circuito = "abierto";
    e.reintentoEn = Date.now() + (AJ.enfriamientoMs ?? 60000);
    emitir("fuente-fallo", { fuente: id, detalle: `circuito abierto (${detalle || "fallo"})` });
  } else {
    emitir("fuente-fallo", { fuente: id, detalle });
  }
}

/** Sonda HTTP de una fuente: GET a su dominio activo con timeout corto. */
export async function sondearFuente(id: string): Promise<{ ok: boolean; ms: number | null }> {
  const base = dominioActivo(id);
  if (!base) return { ok: false, ms: null };
  const inicio = Date.now();
  const html = await obtenerHttp(base, {
    timeoutMs: TIMEOUT_SONDA,
    reintentos: 0,
  });
  const ms = Date.now() - inicio;
  // Una página de Cloudflare o un 404 no cuenta como salud.
  const cuerpoValido =
    html !== null &&
    html.length > 500 &&
    !/just a moment|challenge-platform|attention required/i.test(html.slice(0, 4000));
  return { ok: cuerpoValido, ms: cuerpoValido ? ms : null };
}

/** Chequeo de TODAS las fuentes habilitadas (lo llama el temporizador
 *  y el vigilante; las suspendidas en caliente no se sondenan). */
export async function chequearFuentes(): Promise<EstadoFuente[]> {
  const activas = FUENTES.filter((f) => fuenteHabilitada(f.id));
  await Promise.all(
    activas.map(async (f) => {
      const { ok, ms } = await sondearFuente(f.id);
      if (ok) registrarExito(f.id, ms ?? undefined);
      else registrarFallo(f.id, "sonda sin cuerpo válido");
    })
  );
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
  caidas: number;
  circuitoAbierto: string[];
} {
  const lista = instantaneaSalud();
  const caidas = lista.filter(
    (e) => e.circuito === "abierto" && e.reintentoEn !== null && Date.now() < e.reintentoEn
  );
  return {
    total: lista.length,
    vivas: lista.length - caidas.length,
    caidas: caidas.length,
    circuitoAbierto: caidas.map((e) => e.id),
  };
}

/** Temporizador de chequeo periódico (lo arranca index.ts). */
export function iniciarSaludPeriodica(): void {
  const intervalo = AJ.intervaloChequeoMs ?? 300000;
  const t = setInterval(() => {
    void chequearFuentes().catch(() => undefined);
  }, intervalo);
  if (typeof t.unref === "function") t.unref();
  // Primera pasada diferida (deja arrancar el server y el calentamiento)
  setTimeout(() => {
    void chequearFuentes().catch(() => undefined);
  }, 15000).unref?.();
}
