// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · MÉTRICAS estilo Prometheus (texto plano).
// Contadores con etiquetas alimentados por el bus de eventos
// (src/core/eventos.ts) + gauges de proceso renderizados al vuelo.
// Exposición:
//   GET /metrics           → formato Prometheus (scrape directo)
//   GET /api/v1/metricas   → mismo cuerpo (routeado en rutasAdmin)
// El texto es 100 % compatible con un scraper de Prometheus: cada
// contador se declara con `# HELP` y `# TYPE` y las etiquetas usan
// el formato {etiqueta="valor"}.
// ─────────────────────────────────────────────────────────────

import { instantanea, suscribir } from "./eventos";

export type ValorEtiqueta = string | number;

/** Contador con etiquetas (solo sube, como un counter de Prometheus). */
export class ContadorMetrica {
  private celdas = new Map<string, number>();

  constructor(
    public readonly nombre: string,
    public readonly ayuda: string,
    public readonly etiquetas: string[] = []
  ) {}

  /** Clave canónica de una combinación de etiquetas. */
  private clave(etiquetas: Record<string, ValorEtiqueta>): string {
    return this.etiquetas
      .slice()
      .sort()
      .map((n) => `${n}=${String(etiquetas[n] ?? "")}`)
      .join("|");
  }

  /** Incrementa (+1 por defecto). Etiquetas faltantes → "desconocido". */
  inc(etiquetas: Record<string, ValorEtiqueta>, delta = 1): void {
    const completas: Record<string, ValorEtiqueta> = {};
    for (const n of this.etiquetas) {
      completas[n] = etiquetas[n] ?? "desconocido";
    }
    const k = this.clave(completas);
    this.celdas.set(k, (this.celdas.get(k) || 0) + delta);
  }

  /** Valor de una combinación concreta (para pruebas/estado). */
  valorDe(etiquetas: Record<string, ValorEtiqueta>): number {
    return this.celdas.get(this.clave(etiquetas)) || 0;
  }

  /** Celdas como lista de {etiquetas, valor} ordenadas por valor. */
  celdasInstantanea(): { etiquetas: Record<string, string>; valor: number }[] {
    return [...this.celdas.entries()]
      .map(([k, valor]) => {
        const etiquetas: Record<string, string> = {};
        const partes = k.split("|");
        for (let i = 0; i < partes.length; i++) {
          const sep = partes[i].indexOf("=");
          const nombre = partes[i].slice(0, sep);
          etiquetas[nombre] = partes[i].slice(sep + 1);
        }
        return { etiquetas, valor };
      })
      .sort((a, b) => b.valor - a.valor);
  }
}

/** Registro de contadores del server (uno por nombre). */
const registro = new Map<string, ContadorMetrica>();

/** Crea (o devuelve si ya existe) un contador registrado. */
export function contador(nombre: string, ayuda: string, etiquetas: string[] = []): ContadorMetrica {
  const existente = registro.get(nombre);
  if (existente) return existente;
  const c = new ContadorMetrica(nombre, ayuda, etiquetas);
  registro.set(nombre, c);
  return c;
}

// ── Contadores alimentados por el bus de eventos ────────────────

const cPeticiones = contador(
  "animax_http_peticiones_total",
  "Peticiones HTTP servidas por el server.",
  ["codigo"]
);
const cErrores = contador(
  "animax_http_errores_total",
  "Peticiones que acabaron en error (>= 500).",
  ["codigo"]
);
const cFuentes = contador(
  "animax_fuentes_resultados_total",
  "Resultados de health-check / scraping por fuente.",
  ["fuente", "resultado"]
);
const cExtracciones = contador(
  "animax_extracciones_total",
  "Extracciones de video por extractor.",
  ["extractor", "resultado"]
);
const cDominios = contador(
  "animax_dominios_cambios_total",
  "Conmutaciones de dominio en caliente.",
  ["motivo"]
);
const cCache = contador(
  "animax_cache_invalidaciones_total",
  "Invalidaciones de caché por namespace.",
  ["namespace"]
);

/** Conecta los contadores al bus (lo llama al importar el módulo). */
function cablearBus(): void {
  suscribir("peticion", (p) => {
    cPeticiones.inc({ codigo: String(p.estado) });
  });
  suscribir("peticion-error", (p) => {
    cErrores.inc({ codigo: String(p.estado) });
  });
  suscribir("fuente-ok", (f) => cFuentes.inc({ fuente: f.fuente, resultado: "ok" }));
  suscribir("fuente-fallo", (f) => cFuentes.inc({ fuente: f.fuente, resultado: "fallo" }));
  suscribir("extractor-ok", (e) => cExtracciones.inc({ extractor: e.extractor, resultado: "ok" }));
  suscribir("extractor-fallo", (e) =>
    cExtracciones.inc({ extractor: e.extractor, resultado: "fallo" })
  );
  suscribir("dominio-cambiado", (d) => cDominios.inc({ motivo: d.motivo }));
  suscribir("dominio-restaurado", () => cDominios.inc({ motivo: "restaurado" }));
  suscribir("cache-invalidada", (c) => cCache.inc({ namespace: c.namespace }));
}
cablearBus();

// ── Gauges de proceso (se calculan al renderizar) ──────────────

function gaugesProceso(): string[] {
  const mem = process.memoryUsage();
  const lineas = [
    `# HELP animax_uptime_segundos Segundos desde el arranque del proceso.`,
    `# TYPE animax_uptime_segundos gauge`,
    `animax_uptime_segundos ${Math.floor(process.uptime())}`,
    `# HELP animax_memoria_rss_bytes Resident set size del proceso.`,
    `# TYPE animax_memoria_rss_bytes gauge`,
    `animax_memoria_rss_bytes ${mem.rss}`,
    `# HELP animax_memoria_heap_usada_bytes Heap usado del proceso.`,
    `# TYPE animax_memoria_heap_usada_bytes gauge`,
    `animax_memoria_heap_usada_bytes ${mem.heapUsed}`,
  ];
  return lineas;
}

/** Escapa un valor de etiqueta según el formato de Prometheus. */
function escapar(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

/** Render de la instantánea en texto Prometheus (para /metrics). */
export function textoPrometheus(): string {
  const bloques: string[] = [];
  // Contadores en orden alfabético estable
  for (const c of [...registro.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))) {
    const etiquetas = c.etiquetas.length > 0 ? `(${c.etiquetas.join(",")})` : "";
    bloques.push(`# HELP ${c.nombre} ${c.ayuda.replace(/\n/g, " ")}`);
    bloques.push(`# TYPE ${c.nombre} counter`);
    const celdas = c.celdasInstantanea();
    if (celdas.length === 0) {
      // Contador sin observaciones: muestra 0 (formato válido sin paréntesis)
      bloques.push(`${c.nombre} 0`);
    } else {
      for (const celda of celdas) {
        const pares = Object.entries(celda.etiquetas)
          .map(([n, v]) => `${n}="${escapar(v)}"`)
          .join(",");
        bloques.push(`${c.nombre}${pares ? `{${pares}}` : ""} ${celda.valor}`);
      }
    }
  }
  bloques.push(...gaugesProceso());
  return `${bloques.join("\n")}\n`;
}

/** Instantánea estructurada (para el panel y /api/v1/estado). */
export function instantaneaMetricasTexto(): {
  contadores: { nombre: string; ayuda: string; celdas: { etiquetas: Record<string, string>; valor: number }[] }[];
  uptimeSeg: number;
} {
  return {
    contadores: [...registro.values()].map((c) => ({
      nombre: c.nombre,
      ayuda: c.ayuda,
      celdas: c.celdasInstantanea(),
    })),
    uptimeSeg: Math.floor(process.uptime()),
  };
}

/** Contadores acumulados del bus (puente con /api/v1/estado). */
export function contadoresEvento(): Record<string, number> {
  return instantanea().contadores;
}

export default textoPrometheus;
