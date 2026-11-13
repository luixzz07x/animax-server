// ─────────────────────────────────────────────────────────────
// ANIMAX v5.3-FIX · Salud de fuentes: health-check ADAPTATIVO.
//
// Problema que resuelve (visto en el log de Render free):
//  · 15 fuentes NO responden desde la IP del datacenter de Render.
//    El v5.2 las sondeaba TODAS cada ciclo (10 min) con timeout de
//    9-12 s → decenas de fallos acumulados (fallos: 126), CPU quemada
//    y 20 líneas de log por ciclo.
//  · El panel decía "vivas 20/20 · caídas 0" con 15 circuitos
//    abiertos (el resumen solo contaba como caída si el reintento
//    seguía en el futuro: pasaba el enfriamiento y dejaba de contar).
//
// Cambios v5.3:
//  1. SONDEO ADAPTATIVO: una fuente con circuito ABIERTO se salta
//     (omitidas++) hasta que vence SU reintento. El reintento se
//     reprograma con BACKOFF ESCALADO: 2 → 4 → 8 → 16 → 30 min (tope).
//     Las fuentes muertas dejan de gastar CPU y dejan de inflar el
//     contador de fallos.
//  2. ESTADO "LIMITADA": tras varias reaperturas fallidas (4+) la
//     fuente se sondea como mucho cada 30 min y el panel/la portada
//     la muestran como limitada (típico bloqueo de IP datacenter).
//  3. RESUMEN HONESTO: vivas = cerradas CON éxito reciente o calient
//     do; caídas = circuito abierto (sea cual sea el reintento);
//     limitadas/bloqueadas se reportan aparte.
//  4. Jitter dentro del lote (no 4 fetches al mismo milisegundo).
//  5. Se mantiene: gracia de arranque, lotes pequeños, "bloqueada"
//     (Cloudflare alcanzable) no abre circuito.
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
    /** Minutos tras el arranque en los que NO se abre ningún circuito. */
    graciaArranqueMs?: number;
    /** Tamaño del lote de sondas simultáneas (CPU friendly). */
    loteSonda?: number;
    /** Pausa entre lotes de sondas. */
    pausaLoteMs?: number;
    /** v5.3: base del backoff escalado de reintentos (1ª reapertura). */
    backoffBaseMs?: number;
    /** v5.3: tope del backoff (fuentes muy muertas se sondean poco). */
    backoffMaxMs?: number;
    /** v5.3: aperturas consecutivas a partir de las cuales la fuente
     *  se considera "limitada" (bloqueo de IP datacenter). */
    limitadaTrasAperturas?: number;
  };
  timeouts: {
    sondaSaludMs: number;
  };
}

const AJ = (ajustesJson as unknown as AjustesSalud).salud;
const TIMEOUT_SONDA = (ajustesJson as unknown as AjustesSalud).timeouts.sondaSaludMs ?? 12000;
const BACKOFF_BASE = AJ.backoffBaseMs ?? 120000;
const BACKOFF_MAX = AJ.backoffMaxMs ?? 1800000; // 30 min
const LIMITADA_TRAS = AJ.limitadaTrasAperturas ?? 4;
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
  /** La fuente responde pero con challenge/bloqueo Cloudflare. */
  bloqueada: boolean;
  /** v5.3: veces que se ha abierto el circuito sin recuperación
   *  entre medias → alimenta el backoff escalado y "limitada". */
  aperturas: number;
  /** v5.3: sondeos vencidos fallidos seguidos desde la última sonda. */
  sondasFallidas: number;
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
      aperturas: 0,
      sondasFallidas: 0,
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

/** v5.3: reintento con BACKOFF ESCALADO (2→4→8→16→30 min, tope). */
function programarReintento(e: EstadoFuente): void {
  const espera = Math.min(BACKOFF_BASE * Math.pow(2, Math.min(e.aperturas, 5)), BACKOFF_MAX);
  e.reintentoEn = Date.now() + espera;
}

/** v5.3: ¿a esta fuente le toca ya ser sondeada? (cerrada siempre;
 *  abierta solo cuando vence su reintento; semiabierta sí). */
export function sondeaVencida(id: string): boolean {
  const e = estadoDe(id);
  if (e.circuito === "cerrado") return true;
  if (e.circuito === "semiabierto") return true;
  return e.reintentoEn === null || Date.now() >= e.reintentoEn;
}

/** v5.3: fuente que lleva demasiadas reaperturas fallidas (típico
 *  bloqueo de IP de datacenter: responde desde redes residenciales,
 *  calla desde Render). Se sondea como mucho cada 30 min. */
export function fuenteLimitada(id: string): boolean {
  const e = estadoDe(id);
  return e.circuito === "abierto" && e.aperturas >= LIMITADA_TRAS;
}

/** ¿Se le puede pedir algo a esta fuente ahora? */
export function fuenteDisponible(id: string): boolean {
  const e = estadoDe(id);
  if (e.circuito === "cerrado") return true;
  if (e.circuito === "abierto") {
    if (e.reintentoEn !== null && Date.now() >= e.reintentoEn) {
      // SEMI-ABIERTO: una oportunidad controlada; si falla se reabre
      // con el backoff siguiente (v5.3: escalado, no fijo).
      e.circuito = "semiabierto";
      return true;
    }
    e.omitidas++;
    emitir("fuente-omitida", { fuente: id, detalle: "circuito abierto (backoff)" });
    return false; // failover instantáneo y SILENCIOSO (sin log)
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
  e.aperturas = 0;
  e.sondasFallidas = 0;
  emitir("fuente-ok", { fuente: id, ms });
}

/** La fuente RESPONDE pero muestra el challenge de Cloudflare.
 * Está alcanzable (la red funciona): NO cuenta como fallo de circuito. */
export function registrarBloqueada(id: string, ms?: number): void {
  const e = estadoDe(id);
  e.bloqueada = true;
  e.ultimaLatenciaMs = ms ?? e.ultimaLatenciaMs;
  e.ultimoExito = Date.now(); // alcanzable = viva para efectos de red
  e.fallosConsecutivos = 0; // no castigamos el circuito por un bloqueo
  e.sondasFallidas = 0;
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

  // SEMIABIERTO que falla: se reabre con backoff ESCALADO.
  if (e.circuito === "semiabierto") {
    e.circuito = "abierto";
    e.sondasFallidas++;
    e.aperturas++;
    programarReintento(e);
    emitir("fuente-fallo", {
      fuente: id,
      detalle: `sigue sin respuesta (reintento en ${Math.round(
        ((e.reintentoEn ?? Date.now()) - Date.now()) / 60000
      )} min)`,
    });
    return;
  }

  if (e.circuito === "abierto") {
    // Ya estaba abierta (fallo reportado por otra vía): solo contabiliza,
    // NO se re-programa el reintento ni se vuelve a loguear.
    return;
  }

  // CERRADA → abrir (respetando la gracia de arranque).
  if (e.fallosConsecutivos >= umbral && !enGraciaArranque()) {
    e.circuito = "abierto";
    e.aperturas++;
    programarReintento(e);
    emitir("fuente-fallo", {
      fuente: id,
      detalle: `circuito abierto (${detalle || "fallo"}) · reintento escalado`,
    });
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
    return { ok: false, ms: null, clase: "muerta" };
  }
  const bloqueadaCloudflare =
    /just a moment|challenge-platform|attention required|cf-browser-verification|checking your browser/i.test(
      html.slice(0, 4000)
    );
  if (bloqueadaCloudflare) {
    return { ok: false, ms, clase: "bloqueada" };
  }
  return { ok: true, ms, clase: "ok" };
}

/** Chequeo adaptativo (v5.3):
 *  - Solo se sondan las fuentes cuyo reintento ha vencido (cerradas,
 *    semiabiertas o abiertas-con-reintento-vencido). Las abiertas a
 *    espera se OMITEN sin contar fallo: cero CPU y cero spam.
 *  - Lotes pequeños + jitter dentro del lote (no 4 fetches al mismo ms). */
export async function chequearFuentes(): Promise<EstadoFuente[]> {
  const activas = FUENTES.filter((f) => fuenteHabilitada(f.id));
  const lote = AJ.loteSonda ?? 4;
  const pausa = AJ.pausaLoteMs ?? 900;
  const inicio = Date.now();
  let vivas = 0;
  let bloqueadas = 0;
  let muertas = 0;
  let omitidas = 0;

  // v5.3: ¿a quién le toca? (las abiertas pendientes ni se tocan)
  const pendientes = activas.filter((f) => sondeaVencida(f.id));
  for (const f of activas) {
    if (!sondeaVencida(f.id)) estadoDe(f.id).omitidas++;
  }
  omitidas = activas.length - pendientes.length;

  for (let i = 0; i < pendientes.length; i += lote) {
    const grupo = pendientes.slice(i, i + lote);
    await Promise.all(
      grupo.map(async (f, idx) => {
        // Jitter: 0/250/500/750 ms según posición en el lote
        if (idx > 0) await new Promise((r) => setTimeout(r, idx * 250));
        // Abierta con reintento vencido → pasarla a SEMIABIERTA (si
        // la sonda falla, registrarFallo la reabre con backoff escalado)
        if (!fuenteDisponible(f.id)) return;
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
    if (i + lote < pendientes.length) {
      await new Promise((resolver) => setTimeout(resolver, pausa));
    }
  }

  // Resumen agregado de UNA línea (incluye las limitadas por IP DC).
  const limitadas = activas.filter((f) => fuenteLimitada(f.id)).length;
  emitir("ciclo-salud", {
    total: activas.length,
    vivas,
    bloqueadas,
    muertas,
    omitidas,
    limitadas,
    ms: Date.now() - inicio,
  });

  return instantaneaSalud();
}

/** Instantánea para /api/v1/salud. */
export function instantaneaSalud(): EstadoFuente[] {
  return FUENTES.filter((f) => fuenteHabilitada(f.id)).map((f) => ({ ...estadoDe(f.id) }));
}

/** Resumen HONESTO (v5.3):
 *  - vivas: cerradas con algún éxito (o bloqueadas-CF que SÍ responden)
 *  - calentando: cerradas aún sin sondeo/éxito (gracia de arranque)
 *  - caidas: circuito ABIERTO (antes: solo si el reintento estaba en
 *    el futuro → pasaba el enfriamiento y "caídas" volvía a 0 con la
 *    fuente igual de muerta: el panel decía 20/20 vivas)
 *  - limitadas: abiertas con muchas reaperturas (IP datacenter). */
export function resumenSalud(): {
  total: number;
  vivas: number;
  calentando: number;
  bloqueadas: number;
  caidas: number;
  limitadas: number;
  circuitoAbierto: string[];
  fuentesBloqueadas: string[];
  fuentesLimitadas: string[];
} {
  const lista = instantaneaSalud();
  const caidas = lista.filter((e) => e.circuito === "abierto");
  const vivas = lista.filter(
    (e) => (e.circuito === "cerrado" && e.ultimoExito !== null) || e.bloqueada
  );
  const calentando = lista.filter((e) => e.circuito === "cerrado" && e.ultimoExito === null);
  const limitadas = lista.filter((e) => e.circuito === "abierto" && e.aperturas >= LIMITADA_TRAS);
  return {
    total: lista.length,
    vivas: vivas.length,
    calentando: calentando.length,
    bloqueadas: lista.filter((e) => e.bloqueada).length,
    caidas: caidas.length,
    limitadas: limitadas.length,
    circuitoAbierto: caidas.map((e) => e.id),
    fuentesBloqueadas: lista.filter((e) => e.bloqueada).map((e) => e.id),
    fuentesLimitadas: limitadas.map((e) => e.id),
  };
}

/** Temporizador de chequeo periódico (lo arranca index.ts). */
export function iniciarSaludPeriodica(): void {
  const intervalo = AJ.intervaloChequeoMs ?? 600000;
  const t = setInterval(() => {
    void chequearFuentes().catch(() => undefined);
  }, intervalo);
  if (typeof t.unref === "function") t.unref();
  // Primera pasada diferida 30 s (deja arrancar server + calentar DNS/TLS).
  setTimeout(() => {
    void chequearFuentes().catch(() => undefined);
  }, 30000).unref?.();
}
