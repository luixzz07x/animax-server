// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · PROGRAMACIÓN SEMANAL (calendario de emisión).
// A partir de los últimos episodios del feed unificado (caché de
// 10 min) detecta el DÍA DE EMISIÓN de cada anime y monta el
// calendario lunes→domingo en dos vistas:
//   · GLOBAL: un anime por día (día detectado, no por fuente)
//   · POR FUENTE: ?fuente=<id> filtra los episodios de esa fuente
// Detección del día:
//   1. Si el episodio trae `fecha` parseable (ISO, dd/mm/yyyy o
//      "hace 2 días") → día de esa marca temporal.
//   2. Si no trae fecha → se cuenta el día en que se OBSERVA en
//      el feed (los feeds frescos son episodios de hace horas).
//   3. Un memo acumulativo (slug → conteos por día) estabiliza
//      el día a lo largo de refrescos: 2+ apariciones el mismo
//      día fijan la emisión aunque el feed se renueve.
//   GET /api/v1/programacion?fuente=
// ─────────────────────────────────────────────────────────────

import { normalizarTitulo } from "../lib/animax/http";
import { ultimosUnificados, nombreFuente } from "../lib/animax/registro";
import { priorizarLatino } from "../core/idioma";
import type { EpisodioFeed, Idioma } from "../lib/animax/types";

export const DIAS = [
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
] as const;

/** Memo acumulativo: clave del anime → conteos por día (0=lunes). */
const memoDias = new Map<string, number[]>();

/** Índice del día de una fecha (0=lunes … 6=domingo) o null. */
function diaDeFecha(fecha?: string): number | null {
  if (!fecha) return null;
  const s = fecha.trim().toLowerCase();
  // "hace 2 dias" / "hace 2 horas"
  const mHace = s.match(/^hace\s+(\d+)\s+(min(?:uto)?s?|horas?|dias?)$/);
  if (mHace) {
    const n = parseInt(mHace[1], 10);
    const unidad = mHace[2];
    if (unidad.startsWith("min")) return hoy();
    if (unidad.startsWith("hora")) {
      const d = new Date(Date.now() - n * 3600 * 1000);
      return (d.getDay() + 6) % 7;
    }
    const d = new Date(Date.now() - n * 24 * 3600 * 1000);
    return (d.getDay() + 6) % 7;
  }
  // dd/mm/yyyy o dd-mm-yyyy (formato latino habitual)
  const mLat = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (mLat) {
    const dia = parseInt(mLat[1], 10);
    const mes = parseInt(mLat[2], 10);
    const anio = parseInt(mLat[3], 10);
    const a = anio < 100 ? 2000 + anio : anio;
    const d = new Date(Date.UTC(a, mes - 1, dia));
    if (!Number.isNaN(d.getTime())) return (d.getDay() + 6) % 7;
  }
  // ISO o cualquier cosa que Date entienda
  const t = Date.parse(fecha);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    if (d.getFullYear() >= 2000) return (d.getDay() + 6) % 7;
  }
  return null;
}

/** Día de hoy como índice 0=lunes. */
function hoy(): number {
  return (new Date().getDay() + 6) % 7;
}

/** Clave memo estable de un episodio/entrada del feed. */
function claveDe(e: { slug: string; titulo: string }): string {
  if (e.slug.startsWith("ded:")) return e.slug;
  return normalizarTitulo(e.titulo);
}

/** Día estabilizado del memo (≥2 observaciones) o null. */
function diaFijo(clave: string): number | null {
  const conteos = memoDias.get(clave);
  if (!conteos) return null;
  let mejor = -1;
  let max = 0;
  conteos.forEach((c, i) => {
    if (c > max) {
      max = c;
      mejor = i;
    }
  });
  return max >= 2 ? mejor : null;
}

function contar(clave: string, dia: number): void {
  let conteos = memoDias.get(clave);
  if (!conteos) {
    conteos = [0, 0, 0, 0, 0, 0, 0];
    memoDias.set(clave, conteos);
  }
  conteos[dia]++;
}

export interface EmisionSemanal {
  titulo: string;
  slug: string;
  portada: string;
  idioma: Idioma;
  episodioReciente: number;
  /** Fuentes que emiten este anime (con su nombre legible). */
  fuentes: { id: string; nombre: string }[];
  /** Días detectados (índices 0=lunes). */
  dias: number[];
  /** true si el día viene de fechas reales, no de observación. */
  deteccion: "fecha" | "observacion" | "memo";
}

export interface Programacion {
  /** Vista global (un anime puede aparecer en varios días). */
  dias: { dia: number; nombre: string; animes: EmisionSemanal[] }[];
  /** Totales de diagnóstico. */
  resumen: {
    animes: number;
    episodios: number;
    conFechaReal: number;
    porObservacion: number;
    memoEstable: number;
  };
}

/** Detecta el día de cada episodio y agrupa por anime. */
function detectarDias(episodios: EpisodioFeed[]): {
  porAnime: Map<string, EmisionSemanal>;
  resumen: Programacion["resumen"];
} {
  const porAnime = new Map<string, EmisionSemanal>();
  const resumen = { animes: 0, episodios: episodios.length, conFechaReal: 0, porObservacion: 0, memoEstable: 0 };

  for (const e of episodios) {
    const clave = claveDe(e);
    if (!clave) continue;
    const diaFecha = diaDeFecha(e.fecha);
    let dia: number;
    let deteccion: EmisionSemanal["deteccion"];
    if (diaFecha !== null) {
      dia = diaFecha;
      deteccion = "fecha";
      contar(clave, dia);
      resumen.conFechaReal++;
    } else {
      const fijado = diaFijo(clave);
      if (fijado !== null) {
        dia = fijado;
        deteccion = "memo";
        resumen.memoEstable++;
      } else {
        // Sin fecha: el episodio está en el feed fresco → se emite
        // "ahora": el día de observación es la mejor aproximación.
        dia = hoy();
        deteccion = "observacion";
        resumen.porObservacion++;
      }
    }

    const prev = porAnime.get(clave);
    if (prev) {
      prev.episodioReciente = Math.max(prev.episodioReciente, e.numero);
      if (!prev.dias.includes(dia)) prev.dias.push(dia);
      if (!prev.fuentes.some((f) => f.id === e.fuente)) {
        prev.fuentes.push({ id: e.fuente, nombre: e.nombreFuente });
      }
      if (deteccion === "fecha") prev.deteccion = "fecha";
    } else {
      porAnime.set(clave, {
        titulo: e.titulo,
        slug: e.slug.startsWith("ded:") ? e.slug : `ded:${clave}`,
        portada: e.portada,
        idioma: e.idioma,
        episodioReciente: e.numero,
        fuentes: [{ id: e.fuente, nombre: e.nombreFuente }],
        dias: [dia],
        deteccion,
      });
    }
  }
  resumen.animes = porAnime.size;
  return { porAnime, resumen };
}

/** Calendario semanal (global o de una fuente concreta). */
export async function programacionSemanal(op: { fuente?: string } = {}): Promise<Programacion> {
  const r = await ultimosUnificados();
  let episodios = r.data?.episodios ?? [];
  if (op.fuente) episodios = episodios.filter((e) => e.fuente === op.fuente);

  const { porAnime, resumen } = detectarDias(episodios);
  const animes = priorizarLatino([...porAnime.values()]).sort((a, b) => {
    const ca = memoDias.get(claveDe(a)) || [0, 0, 0, 0, 0, 0, 0];
    const cb = memoDias.get(claveDe(b)) || [0, 0, 0, 0, 0, 0, 0];
    return Math.max(...cb) - Math.max(...ca); // más observado primero
  });

  const dias = DIAS.map((nombre, dia) => ({
    dia,
    nombre,
    animes: animes.filter((a) => a.dias.includes(dia)).slice(0, 24),
  }));

  return { dias, resumen };
}

/** Calendario POR FUENTE (una vista por cada una que emite). */
export async function programacionPorFuente(): Promise<
  { fuente: string; nombre: string; dias: Programacion["dias"]; animes: number }[]
> {
  const r = await ultimosUnificados();
  const episodios = r.data?.episodios ?? [];
  const fuentes = [...new Set(episodios.map((e) => e.fuente))];
  const vistas: { fuente: string; nombre: string; dias: Programacion["dias"]; animes: number }[] = [];
  for (const fuente of fuentes) {
    const propios = episodios.filter((e) => e.fuente === fuente);
    const { porAnime, resumen } = detectarDias(propios);
    const animes = [...porAnime.values()];
    vistas.push({
      fuente,
      nombre: nombreFuente(fuente),
      dias: DIAS.map((nombre, dia) => ({
        dia,
        nombre,
        animes: animes.filter((a) => a.dias.includes(dia)).slice(0, 24),
      })),
      animes: resumen.animes,
    });
  }
  return vistas;
}

export default programacionSemanal;
