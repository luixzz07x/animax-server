// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · Activación/suspensión de fuentes EN CALIENTE.
// fuentes.json declara el estado oficial (activo), y este módulo
// añade una capa runtime: el panel de administración y la API admin
// pueden desactivar una fuente sin redeploy (útil cuando un sitio
// está en obras o llena el log de fallos). El registro consulta
// `fuenteHabilitada` para decidir qué scrapers participan en las
// búsquedas, y la salud suspende sus sondas.
// ─────────────────────────────────────────────────────────────

import fuentesJson from "../config/fuentes.json";
import { dominioActivo } from "./dominios";
import { emitir } from "./eventos";

interface FuenteCfg {
  id: string;
  nombre: string;
  baseUrl: string;
  idioma: string;
  grupo: string;
  activo: boolean;
}

const FUENTES = (fuentesJson as unknown as { fuentes: FuenteCfg[] }).fuentes;

/** Fuentes suspendidas en caliente (id → epoch de la suspensión). */
const suspendidas = new Map<string, number>();

/** ¿La fuente participa ahora mismo en el scraping? */
export function fuenteHabilitada(id: string): boolean {
  const cfg = FUENTES.find((f) => f.id === id);
  if (!cfg || cfg.activo === false) return false;
  return !suspendidas.has(id);
}

/** Suspende una fuente en caliente (deja de scrapearse ya). */
export function suspenderFuente(id: string): boolean {
  if (!FUENTES.some((f) => f.id === id)) return false;
  if (suspendidas.has(id)) return true; // idempotente
  suspendidas.set(id, Date.now());
  emitir("fuente-omitida", { fuente: id, detalle: "suspendida en caliente por administración" });
  return true;
}

/** Reanuda una fuente suspendida en caliente. */
export function reanudarFuente(id: string): boolean {
  if (!FUENTES.some((f) => f.id === id)) return false;
  return suspendidas.delete(id);
}

/** IDs suspendados actualmente. */
export function suspendidasAhora(): { fuente: string; desde: number }[] {
  return [...suspendidas.entries()].map(([fuente, desde]) => ({ fuente, desde }));
}

export interface InfoFuenteAdmin {
  id: string;
  nombre: string;
  dominio: string;
  grupo: string;
  idioma: string;
  /** Estado oficial de fuentes.json. */
  activoConfig: boolean;
  /** ¿Scrapeable ahora? (config y sin suspensión runtime). */
  habilitada: boolean;
  suspendidaDesde: number | null;
}

/** Inventario completo para la API admin y el panel. */
export function inventarioFuentes(): InfoFuenteAdmin[] {
  return FUENTES.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    dominio: dominioActivo(f.id),
    grupo: f.grupo,
    idioma: f.idioma,
    activoConfig: f.activo !== false,
    habilitada: fuenteHabilitada(f.id),
    suspendidaDesde: suspendidas.get(f.id) ?? null,
  }));
}

/** Total / vivas según la capa runtime. */
export function resumenFuentesRuntime(): { total: number; habilitadas: number; suspendidas: number } {
  return {
    total: FUENTES.length,
    habilitadas: FUENTES.filter((f) => fuenteHabilitada(f.id)).length,
    suspendidas: suspendidas.size,
  };
}

export default inventarioFuentes;
