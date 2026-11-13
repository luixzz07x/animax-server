// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · SEMÁFORO reutilizable (limite de concurrencia).
// Un primitivo de sincronización genérico para acotar cuántas
// promesas corren a la vez en CUALQUIER parte del server (refrescos
// del panel, prefetch de tops, sondeos en lote…), distinto de la
// cola por fuente (src/core/cola.ts, que agrupa por scraper).
// Uso:
//   const sem = crearSemaforo(4);
//   await sem.ejecutar(() => tarea());
//   // o manual:
//   const liberar = await sem.adquirir();
//   try { … } finally { liberar(); }
// ─────────────────────────────────────────────────────────────

interface Espera {
  resolver: (liberar: () => void) => void;
}

export interface Semaforo {
  /** Límite configurado (mayor que 0). */
  readonly limite: number;
  /** Tareas dentro del semáforo ahora mismo. */
  readonly enVuelo: number;
  /** Tareas esperando un hueco. */
  readonly enEspera: number;
  /** Ejecuta `fn` dentro del semáforo (propaga resultado/error). */
  ejecutar<T>(fn: () => Promise<T>): Promise<T>;
  /** Adquiere un hueco; devuelve el liberador. */
  adquirir(): Promise<() => void>;
  /** Condiciones actuales (para /api/v1/estado). */
  estadisticas(): { limite: number; enVuelo: number; enEspera: number };
}

/** Crea un semáforo con `limite` huecos concurrentes. */
export function crearSemaforo(limite: number): Semaforo {
  const n = Math.max(1, Math.floor(limite));
  let activas = 0;
  const esperando: Espera[] = [];

  function liberar(): void {
    activas = Math.max(0, activas - 1);
    // Despierta al siguiente en la fila (FIFO) si hay hueco.
    const siguiente = esperando.shift();
    if (siguiente) {
      activas++;
      siguiente.resolver(liberar);
    }
  }

  function adquirir(): Promise<() => void> {
    if (activas < n) {
      activas++;
      return Promise.resolve(liberar);
    }
    return new Promise<() => void>((resolver) => {
      esperando.push({ resolver });
    });
  }

  async function ejecutar<T>(fn: () => Promise<T>): Promise<T> {
    const salir = await adquirir();
    try {
      return await fn();
    } finally {
      salir();
    }
  }

  return {
    limite: n,
    get enVuelo() {
      return activas;
    },
    get enEspera() {
      return esperando.length;
    },
    ejecutar,
    adquirir,
    estadisticas() {
      return { limite: n, enVuelo: activas, enEspera: esperando.length };
    },
  };
}

/** Semáforo global del server: acota los trabajos internos que no
 *  pertenecen a una fuente concreta (paneles, prefetch de tops…). */
export const semaforoGlobal = crearSemaforo(6);

/** Mapa con todos los semáforos con nombre (observabilidad). */
const conNombre = new Map<string, Semaforo>();

/** Crea (o recupera) un semáforo con nombre persistente. */
export function semaforoDe(nombre: string, limite: number): Semaforo {
  const existente = conNombre.get(nombre);
  if (existente) return existente;
  const sem = crearSemaforo(limite);
  conNombre.set(nombre, sem);
  return sem;
}

/** Instantánea de todos los semáforos con nombre. */
export function instantaneaSemaforos(): {
  nombre: string;
  limite: number;
  enVuelo: number;
  enEspera: number;
}[] {
  return [...conNombre.entries()].map(([nombre, sem]) => ({
    nombre,
    ...sem.estadisticas(),
  }));
}

export default crearSemaforo;
