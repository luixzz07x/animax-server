// ─────────────────────────────────────────────────────────────
// ANIMAX v5.3-FIX · VIGILANTE (watchdog de dominios).
//
// Cambios acumulados del fix para Render free (ver README-FIX-RENDER.md):
//  1. YA NO cambia el dominio por UNA falla: exige `fallosAntesDeConmutar`
//     ciclos consecutivos fallidos.
//  2. YA NO sondea fuentes sanas: reutiliza el resultado del health-check.
//  3. YA NO alimenta el circuit breaker con sus propias sondas.
//  4. RECUPERACIÓN: si el dominio oficial vuelve a responder, se restaura.
//  5. Lotes pequeños con pausa (CPU del plan free de Render).
//  6. v5.3: SOLO atiende fuentes con reintento VENCIDO (sondeaVencida):
//     las abiertas pendientes de backoff se saltan por completo — el
//     vigilante deja de re-sondear cada 15 min las 15 fuentes que
//     Cloudflare/datacenter no deja responder desde Render.
// ─────────────────────────────────────────────────────────────

import ajustesJson from "../config/ajustes.json";
import fuentesJson from "../config/fuentes.json";
import { obtenerHttp } from "../lib/animax/http";
import { invalidar } from "../lib/animax/cache";
import {
  dominioActivo,
  dominiosAlternativos,
  dominioConmutado,
  registrarDominio,
  restablecerDominio,
} from "../core/dominios";
import {
  instantaneaSalud,
  registrarExito,
  registrarFallo,
  sondeaVencida,
} from "../core/salud";
import { emitir } from "../core/eventos";

interface AjustesVigilante {
  vigilante: {
    intervaloMs: number;
    timeoutPruebaMs: number;
    fallosAntesDeConmutar: number;
    /** FIX: éxito más reciente que exime de sondear (ms). */
    exitoRecienteMs?: number;
    /** FIX: tamaño de lote de pruebas simultáneas. */
    lote?: number;
    /** FIX: pausa entre lotes. */
    pausaLoteMs?: number;
  };
}

const AJ = (ajustesJson as unknown as AjustesVigilante).vigilante;

interface FuenteCfg {
  id: string;
  nombre: string;
  baseUrl: string;
  activo: boolean;
}

const FUENTES = (fuentesJson as unknown as { fuentes: FuenteCfg[] }).fuentes;

/** ¿El HTML responde y no es una página de bloqueo? */
function cuerpoSano(html: string | null): boolean {
  return (
    html !== null &&
    html.length > 500 &&
    !/just a moment|challenge-platform|acceso restringido|attention required|checking your browser/i.test(
      html.slice(0, 4000)
    )
  );
}

/** Prueba un dominio: GET / con timeout corto. */
async function probarDominio(baseUrl: string): Promise<boolean> {
  const html = await obtenerHttp(baseUrl, {
    timeoutMs: AJ.timeoutPruebaMs ?? 12000,
    reintentos: 0,
  });
  return cuerpoSano(html);
}

export interface CicloVigilante {
  fecha: number;
  comprobadas: number;
  caidas: string[];
  conmutadas: { fuente: string; nuevo: string }[];
  restauradas: string[];
  ms: number;
}

/** Últimos ciclos (para /api/v1/salud y logs). */
const ciclos: CicloVigilante[] = [];

/** Fallos CONSECUTIVOS por fuente en el vigilante (para exigir el umbral
 * antes de conmutar dominio — antes se conmutaba al primer fallo). */
const fallosConsecutivos = new Map<string, number>();

/** Ejecuta UN ciclo del vigilante SOLO sobre las fuentes problemáticas. */
export async function cicloVigilante(): Promise<CicloVigilante> {
  const inicio = Date.now();
  const ahora = Date.now();
  const exitoReciente = AJ.exitoRecienteMs ?? 300000;

  // ── 1) Seleccionar objetivo: SOLO fuentes que necesitan atención ──
  // (v5.3: las abiertas PENDIENTES de reintento se saltan por completo
  //  — salud ya las omitió; el vigilante no vuelve a gastar sondas en
  //  fuentes cuyo backoff no ha vencido. Las sanas tampoco se tocan.)
  const salud = new Map(instantaneaSalud().map((e) => [e.id, e]));
  const objetivo = FUENTES.filter((f) => {
    if (f.activo === false) return false;
    const e = salud.get(f.id);
    if (!e) return true; // nunca sondeada → hay que comprobarla
    if (e.circuito === "cerrado") {
      // Sana o calentando: la cubre el health-check salvo éxito muy viejo
      if (e.ultimoExito !== null && ahora - e.ultimoExito < exitoReciente) return false;
      return sondeaVencida(f.id);
    }
    if (e.circuito === "abierto") return sondeaVencida(f.id); // reintento vencido
    return false; // semiabierto: en prueba por salud, no duplicar
  });

  const caidas: string[] = [];
  const conmutadas: { fuente: string; nuevo: string }[] = [];
  const restauradas: string[] = [];
  const lote = AJ.lote ?? 3;
  const pausa = AJ.pausaLoteMs ?? 900;

  // ── 2) Probar el dominio activo en lotes pequeños ──
  for (let i = 0; i < objetivo.length; i += lote) {
    const grupo = objetivo.slice(i, i + lote);
    await Promise.all(
      grupo.map(async (fuente) => {
        const activo = dominioActivo(fuente.id);
        if (!activo) {
          caidas.push(fuente.id);
          return;
        }
        const ok = await probarDominio(activo);
        if (ok) {
          registrarExito(fuente.id, Date.now() - inicio);
          fallosConsecutivos.delete(fuente.id);
          return; // viva: nada que hacer
        }

        // Falló el dominio activo: acumular (NO conmutar todavía).
        const n = (fallosConsecutivos.get(fuente.id) || 0) + 1;
        fallosConsecutivos.set(fuente.id, n);
        const umbral = AJ.fallosAntesDeConmutar ?? 3;

        // ── 3) RECUPERACIÓN: si estaba conmutado y el OFICIAL revive,
        // se restaura (antes quedaba pegado en el dominio de respaldo). ──
        if (dominioConmutado(fuente.id) && activo !== fuente.baseUrl) {
          const oficialVivo = await probarDominio(fuente.baseUrl);
          if (oficialVivo) {
            restablecerDominio(fuente.id);
            restauradas.push(fuente.id);
            registrarExito(fuente.id, Date.now() - inicio);
            fallosConsecutivos.delete(fuente.id);
            return;
          }
        }

        if (n < umbral) return; // aún no toca conmutar (evita flip-flop)

        // ── 4) Conmutar: probar respaldos SOLO tras agotar el umbral ──
        const candidatos = dominiosAlternativos(fuente.id).filter((d) => d !== activo);
        if (dominioConmutado(fuente.id)) candidatos.push(fuente.baseUrl);

        for (const candidato of candidatos) {
          const candidatoOk = await probarDominio(candidato);
          if (!candidatoOk) continue;
          // Conmutación en caliente: valida, aplica, persiste y vacía caches
          registrarDominio(fuente.id, candidato, "vigilante");
          invalidar("buscar");
          invalidar("ultimos");
          invalidar("detalle");
          invalidar("servidores");
          conmutadas.push({ fuente: fuente.id, nuevo: candidato });
          fallosConsecutivos.delete(fuente.id);
          return;
        }

        // Ningún dominio responde: recién aquí se considera caída.
        caidas.push(fuente.id);
        fallosConsecutivos.delete(fuente.id);
        registrarFallo(fuente.id, "vigilante: sin dominios vivos");
        emitir("fuente-fallo", { fuente: fuente.id, detalle: "vigilante: sin dominios vivos" });
      })
    );
    if (i + lote < objetivo.length) {
      await new Promise((resolver) => setTimeout(resolver, pausa));
    }
  }

  const ciclo: CicloVigilante = {
    fecha: Date.now(),
    comprobadas: objetivo.length,
    caidas,
    conmutadas,
    restauradas,
    ms: Date.now() - inicio,
  };
  ciclos.push(ciclo);
  if (ciclos.length > 12) ciclos.shift();
  console.log(
    `[vigilante] ciclo: ${ciclo.comprobadas} fuentes revisadas, ${ciclo.conmutadas.length} conmutadas, ${ciclo.restauradas.length} restauradas, ${ciclo.caidas.length} caídas (${ciclo.ms}ms)`
  );
  return ciclo;
}

/** Historial de ciclos (últimos 12). */
export function historialVigilante(): CicloVigilante[] {
  return [...ciclos];
}

/** Arranca el temporizador del vigilante (lo llama index.ts). */
export function iniciarVigilante(): void {
  const intervalo = AJ.intervaloMs ?? 900000;
  const t = setInterval(() => {
    void cicloVigilante().catch(() => undefined);
  }, intervalo);
  if (typeof t.unref === "function") t.unref();
  // FIX: primer ciclo a los 75 s — después de la gracia de arranque de
  // salud y del primer health-check (antes coincidían y duplicaban sondas).
  setTimeout(() => {
    void cicloVigilante().catch(() => undefined);
  }, 75000).unref?.();
}
