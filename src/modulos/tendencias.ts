// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · TENDENCIAS por ventana temporal con DECAIMIENTO
// EXPONENCIAL. Se nutre de los eventos de búsqueda del bus
// (src/core/eventos.ts: cada GET /api/v1/buscar?q=… alimenta el
// registro interno con su término y su marca temporal). El puntaje
// de un término es Σ exp(-Δt/τ): lo que se buscó hace 10 min pesa
// muchísimo más que lo de ayer — al agrandar la ventana, τ crece y
// la "memoria" se alarga. Cada término se resuelve contra el
// catálogo unificado (índice + semilla) para devolver tarjetas.
//   GET /api/v1/tendencias?ventana=24&limite=20
// ─────────────────────────────────────────────────────────────

import { suscribir } from "../core/eventos";
import { normalizarTitulo } from "../lib/animax/http";
import { catalogoIndice, entradaATarjeta } from "../lib/animax/indice";
import { catalogoSemilla } from "../datos/semillaCatalogo";
import { priorizarLatino } from "../core/idioma";
import type { AnimeCard } from "../lib/animax/types";

interface EventoBusqueda {
  termino: string; // normalizado
  original: string; // tal cual lo escribió el usuario
  ts: number;
}

/** Busquedas observadas (buffer circular de 600). */
const eventos: EventoBusqueda[] = [];
const MAX_EVENTOS = 600;

/** Registra una búsqueda a mano (tests, CLI, importación). */
export function registrarBusqueda(q: string, ts = Date.now()): void {
  const termino = normalizarTitulo(q);
  if (!termino || termino.length < 2) return;
  eventos.push({ termino, original: q.trim().slice(0, 80), ts });
  if (eventos.length > MAX_EVENTOS) eventos.shift();
}

/** Conecta el módulo al bus de eventos (peticiones /api/v1/buscar). */
function cablearBus(): void {
  suscribir("peticion", (p) => {
    if (p.metodo !== "GET" && p.metodo !== "POST") return;
    if (!p.ruta.startsWith("/api/v1/buscar")) return;
    const q = extraerQ(p.ruta);
    if (q) registrarBusqueda(q);
  });
}
cablearBus();

/** Extrae ?q= de una URL registrada. */
function extraerQ(ruta: string): string | null {
  const i = ruta.indexOf("?");
  if (i < 0) return null;
  try {
    const params = new URLSearchParams(ruta.slice(i + 1));
    return params.get("q");
  } catch {
    return null;
  }
}

export interface Tendencia {
  titulo: string;
  slug: string;
  portada: string;
  generos: string[];
  idioma: AnimeCard["idioma"];
  tipo: string;
  /** Puntuación con decaimiento (para ordenar, no es un "rating"). */
  puntuacion: number;
  /** Nº de búsquedas distintas dentro de la ventana. */
  busquedas: number;
  /** Término que más se buscó para llegar aquí. */
  terminoFrecuente: string;
}

/** Tarjeta (índice + semilla) indexada por título normalizado. */
const tarjetasPorTitulo = new Map<string, AnimeCard>();
let tarjetasConstruidas = 0;
const REFRESCO_TARJETAS_MS = 10 * 60 * 1000; // 10 min

/** Reconstruye el índice título→tarjeta (cada 10 min para absorber
 *  lo nuevo que la búsqueda va indexando en el índice vivo). */
async function asegurarTarjetas(): Promise<number> {
  if (tarjetasPorTitulo.size > 0 && Date.now() - tarjetasConstruidas < REFRESCO_TARJETAS_MS) {
    return tarjetasPorTitulo.size;
  }
  tarjetasPorTitulo.clear();
  const entradas = await catalogoIndice({ limite: 1000 });
  for (const e of entradas) {
    const t = entradaATarjeta(e);
    const n = normalizarTitulo(t.titulo);
    if (n && !tarjetasPorTitulo.has(n)) tarjetasPorTitulo.set(n, t);
  }
  for (const s of catalogoSemilla({ limite: 200 })) {
    const n = normalizarTitulo(s.titulo);
    if (n && !tarjetasPorTitulo.has(n)) tarjetasPorTitulo.set(n, s);
  }
  tarjetasConstruidas = Date.now();
  return tarjetasPorTitulo.size;
}

/**
 * Tendencias de la ventana: cada término puntuado con decaimiento
 * exponencial (τ = ventana/3, vida media ≈ 21 % de la ventana) y
 * fusionado en el anime conocido más cercano del catálogo.
 */
export async function tendencias(
  op: { ventanaHoras?: number; limite?: number } = {}
): Promise<{
  ventanaHoras: number;
  totalEventos: number;
  catalogo: number;
  tendencias: Tendencia[];
  sinResolver: { termino: string; puntuacion: number }[];
}> {
  const ventanaHoras = Math.min(Math.max(op.ventanaHoras ?? 24, 1), 168);
  const limite = Math.min(Math.max(op.limite ?? 20, 1), 60);
  const ahora = Date.now();
  const ventanaMs = ventanaHoras * 3600 * 1000;
  const tau = ventanaMs / 3;

  // 1) Puntuar términos (decaimiento exponencial por antigüedad)
  const puntajeTerminos = new Map<string, number>();
  const originales = new Map<string, string>();
  for (const e of eventos) {
    const edad = ahora - e.ts;
    if (edad < 0 || edad > ventanaMs) continue;
    const peso = Math.exp(-edad / tau);
    puntajeTerminos.set(e.termino, (puntajeTerminos.get(e.termino) || 0) + peso);
    const prev = originales.get(e.termino);
    if (!prev) originales.set(e.termino, e.original);
  }

  // 2) Resolver cada término contra el catálogo unificado
  const catalogo = await asegurarTarjetas();
  const porAnime = new Map<string, Tendencia>();
  const sinResolver: { termino: string; puntuacion: number }[] = [];

  for (const [termino, puntuacion] of puntajeTerminos) {
    const tarjeta = resolverTermino(termino);
    if (!tarjeta) {
      sinResolver.push({ termino: originales.get(termino) || termino, puntuacion });
      continue;
    }
    const prev = porAnime.get(tarjeta.slug);
    if (prev) {
      prev.puntuacion += puntuacion;
      prev.busquedas += 1;
      if (puntuacion > prev.puntuacion / 2) prev.terminoFrecuente = originales.get(termino) || termino;
    } else {
      porAnime.set(tarjeta.slug, {
        titulo: tarjeta.titulo,
        slug: tarjeta.slug,
        portada: tarjeta.portada,
        generos: tarjeta.generos || [],
        idioma: tarjeta.idioma,
        tipo: (tarjeta.tipo || "").toLowerCase(),
        puntuacion,
        busquedas: 1,
        terminoFrecuente: originales.get(termino) || termino,
      });
    }
  }

  const lista = priorizarLatino([...porAnime.values()])
    .sort((a, b) => b.puntuacion - a.puntuacion)
    .slice(0, limite);

  return {
    ventanaHoras,
    totalEventos: eventos.length,
    catalogo,
    tendencias: lista,
    sinResolver: sinResolver.sort((a, b) => b.puntuacion - a.puntuacion).slice(0, 10),
  };
}

/** Mejor tarjeta conocida para un término (incluso parcial). */
function resolverTermino(termino: string): AnimeCard | null {
  const directa = tarjetasPorTitulo.get(termino);
  if (directa) return directa;
  // Coincidencia parcial: prefijo largo o contenido
  if (termino.length >= 4) {
    let mejor: AnimeCard | null = null;
    for (const [titulo, tarjeta] of tarjetasPorTitulo) {
      if (titulo.includes(termino) || termino.includes(titulo)) {
        if (!mejor || titulo.length < normalizarTitulo(mejor.titulo).length) mejor = tarjeta;
      }
    }
    return mejor;
  }
  return null;
}

/** Últimas búsquedas registradas (para el panel de administración). */
export function ultimasBusquedas(n = 20): { termino: string; ts: number }[] {
  return eventos.slice(-n).map((e) => ({ termino: e.original, ts: e.ts }));
}

export default tendencias;
