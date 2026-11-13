// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · VIGILANTE (watchdog de dominios).
// Cada 10 min recorre las 22 fuentes: si una lleva varios sondeos
// fallidos (o su circuito está ABIERTO), prueba en orden sus
// dominios de respaldo (src/config/dominiosAlternativos.json) y
// conmuta EN CALIENTE al primero que responda con HTML sano.
// El cambio redirige automáticamente todo el scraping (el cliente
// HTTP reescribe las URLs) y vacía los caches envenenados.
// Si ningún respaldo responde, la fuente queda marcada caída y el
// circuit breaker la mantiene omitida (failover silencioso).
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
} from "../core/dominios";
import { registrarExito, registrarFallo } from "../core/salud";
import { emitir } from "../core/eventos";

interface AjustesVigilante {
  vigilante: {
    intervaloMs: number;
    timeoutPruebaMs: number;
    fallosAntesDeConmutar: number;
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
    !/just a moment|challenge-platform|acceso restringido|attention required/i.test(
      html.slice(0, 4000)
    )
  );
}

/** Prueba un dominio: GET / con timeout corto. */
async function probarDominio(baseUrl: string): Promise<boolean> {
  const html = await obtenerHttp(baseUrl, {
    timeoutMs: AJ.timeoutPruebaMs ?? 6000,
    reintentos: 0,
  });
  return cuerpoSano(html);
}

export interface CicloVigilante {
  fecha: number;
  comprobadas: number;
  caidas: string[];
  conmutadas: { fuente: string; nuevo: string }[];
  ms: number;
}

/** Últimos ciclos (para /api/v1/salud y logs). */
const ciclos: CicloVigilante[] = [];

/** Ejecuta UN ciclo del vigilante sobre todas las fuentes activas. */
export async function cicloVigilante(): Promise<CicloVigilante> {
  const inicio = Date.now();
  const activas = FUENTES.filter((f) => f.activo !== false);
  const caidas: string[] = [];
  const conmutadas: { fuente: string; nuevo: string }[] = [];

  for (const fuente of activas) {
    const activo = dominioActivo(fuente.id);
    let ok = await probarDominio(activo);
    if (ok) {
      registrarExito(fuente.id, Date.now() - inicio);
      continue;
    }
    registrarFallo(fuente.id, "vigilante: dominio activo sin respuesta");

    // El dominio activo (oficial o ya conmutado) está muerto → respaldos
    const candidatos = dominiosAlternativos(fuente.id).filter((d) => d !== activo);
    // Si ya estaba conmutado, el dominio OFICIAL también es candidato
    if (dominioConmutado(fuente.id)) candidatos.push(fuente.baseUrl);

    let conmutado = false;
    for (const candidato of candidatos) {
      ok = await probarDominio(candidato);
      if (!ok) continue;
      // Conmutación en caliente: valida, aplica, persiste y vacía caches
      registrarDominio(fuente.id, candidato, "vigilante");
      invalidar("buscar");
      invalidar("ultimos");
      invalidar("detalle");
      invalidar("servidores");
      conmutadas.push({ fuente: fuente.id, nuevo: candidato });
      conmutado = true;
      break;
    }
    if (!conmutado) {
      caidas.push(fuente.id);
      emitir("fuente-fallo", { fuente: fuente.id, detalle: "vigilante: sin dominios vivos" });
    }
  }

  const ciclo: CicloVigilante = {
    fecha: Date.now(),
    comprobadas: activas.length,
    caidas,
    conmutadas,
    ms: Date.now() - inicio,
  };
  ciclos.push(ciclo);
  if (ciclos.length > 12) ciclos.shift();
  console.log(
    `[vigilante] ciclo: ${ciclo.comprobadas} fuentes, ${ciclo.conmutadas.length} conmutadas, ${ciclo.caidas.length} caídas (${ciclo.ms}ms)`
  );
  return ciclo;
}

/** Historial de ciclos (últimos 12). */
export function historialVigilante(): CicloVigilante[] {
  return [...ciclos];
}

/** Arranca el temporizador del vigilante (lo llama index.ts). */
export function iniciarVigilante(): void {
  const intervalo = AJ.intervaloMs ?? 600000;
  const t = setInterval(() => {
    void cicloVigilante().catch(() => undefined);
  }, intervalo);
  if (typeof t.unref === "function") t.unref();
  // Primer ciclo diferido: deja respirar al arranque del server
  setTimeout(() => {
    void cicloVigilante().catch(() => undefined);
  }, 45000).unref?.();
}
