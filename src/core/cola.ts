// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Cola de peticiones con concurrencia limitada POR FUENTE.
// Evita machacar un sitio con 20 búsquedas simultáneas (ban de IP,
// Cloudflare): cada fuente tiene como máximo N tareas en vuelo y el
// conjunto global está acotado. El registro de fuentes enruta aquí
// TODAS sus consultas, así que un pico de tráfico se serializa por
// fuente sin ralentizar a las demás.
// ─────────────────────────────────────────────────────────────

import ajustesJson from "../config/ajustes.json";

interface AjustesCola {
  cola: {
    concurrenciaPorFuente: number;
    concurrenciaGlobal: number;
  };
}

const AJ = (ajustesJson as unknown as AjustesCola).cola;

interface Tarea {
  fn: () => Promise<void>;
  resolver: (v: unknown) => void;
  rechazar: (e: unknown) => void;
}

// ── Control global (todas las fuentes sumadas) ─────────────────
const globales = {
  activas: 0,
  limite: AJ.concurrenciaGlobal ?? 24,
  esperando: [] as (() => void)[],
};

function huecoGlobal(): boolean {
  return globales.activas < globales.limite;
}

/** Ejecuta los callbacks que esperaban un hueco global. */
function notificarHueco(): void {
  while (globales.esperando.length > 0 && huecoGlobal()) {
    const cb = globales.esperando.shift();
    cb?.();
  }
}

function pedirHueco(cb: () => void): void {
  globales.esperando.push(cb);
}

class ColaFuente {
  pendientes: Tarea[] = [];
  activas = 0;
  limite: number;

  constructor(
    public readonly fuente: string,
    limitePorFuente: number
  ) {
    this.limite = limitePorFuente;
  }

  encolar<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolver, rechazar) => {
      this.pendientes.push({
        fn: fn as unknown as () => Promise<void>,
        resolver: resolver as (v: unknown) => void,
        rechazar,
      });
      this.drenar();
    });
  }

  drenar(): void {
    while (this.pendientes.length > 0 && this.activas < this.limite) {
      if (!huecoGlobal()) {
        // Sin hueco global: despertar cuando otra tarea termine.
        pedirHueco(() => this.drenar());
        return;
      }
      const tarea = this.pendientes.shift();
      if (!tarea) return;
      this.activas++;
      globales.activas++;
      void Promise.resolve()
        .then(tarea.fn)
        .then((v) => tarea.resolver(v))
        .catch((e) => tarea.rechazar(e))
        .finally(() => {
          this.activas--;
          globales.activas--;
          notificarHueco();
          this.drenar();
        });
    }
  }
}

const colas = new Map<string, ColaFuente>();
const limitePorFuente = AJ.concurrenciaPorFuente ?? 3;

function colaDe(fuente: string): ColaFuente {
  let c = colas.get(fuente);
  if (!c) {
    c = new ColaFuente(fuente, limitePorFuente);
    colas.set(fuente, c);
  }
  return c;
}

/**
 * Ejecuta `fn` respetando la concurrencia por fuente y la global.
 * La promesa se resuelve/rechaza con el resultado de `fn`.
 */
export function encolar<T>(fuente: string, fn: () => Promise<T>): Promise<T> {
  return colaDe(fuente).encolar(fn);
}

export interface EstadisticaCola {
  fuente: string;
  activas: number;
  pendientes: number;
  limite: number;
}

export interface EstadisticasCola {
  concurrenciaPorFuente: number;
  concurrenciaGlobal: number;
  enVueloGlobal: number;
  colas: EstadisticaCola[];
}

/** Estado de las colas para /api/v1/estado. */
export function estadisticasCola(): EstadisticasCola {
  return {
    concurrenciaPorFuente: limitePorFuente,
    concurrenciaGlobal: globales.limite,
    enVueloGlobal: globales.activas,
    colas: [...colas.entries()]
      .filter(([, c]) => c.activas > 0 || c.pendientes.length > 0)
      .map(([fuente, c]) => ({
        fuente,
        activas: c.activas,
        pendientes: c.pendientes.length,
        limite: c.limite,
      })),
  };
}

/** Ajusta en caliente el límite por fuente (tuning sin redeploy). */
export function ajustarLimitePorFuente(n: number): void {
  if (!Number.isFinite(n) || n < 1 || n > 16) return;
  for (const c of colas.values()) {
    c.limite = Math.floor(n);
    c.drenar();
  }
}

/** Fuentes con tareas esperando (saturación). */
export function fuentesSaturadas(): string[] {
  return [...colas.entries()]
    .filter(([, c]) => c.pendientes.length > 0)
    .map(([fuente]) => fuente);
}
