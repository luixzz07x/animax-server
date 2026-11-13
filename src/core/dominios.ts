// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Dominios en caliente.
// Cada fuente tiene su dominio "oficial" (fuentes.json) + respaldos
// (dominiosAlternativos.json). Este módulo mantiene el dominio ACTIVO
// de cada fuente (persistido en animax-dominios.json) y reescribe
// cualquier URL que salga hacia una fuente: los scrapers construyen
// URLs con su dominio original, y el cliente HTTP las pasa por aquí
// → cambiar el dominio en caliente redirige TODO el scraping sin
// tocar código ni recompilar.
// ─────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import fuentesJson from "../config/fuentes.json";
import dominiosJson from "../config/dominiosAlternativos.json";
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
const ALT = (dominiosJson as unknown as { alternativos: Record<string, string[]> })
  .alternativos;

const ARCHIVO = path.join(process.cwd(), "animax-dominios.json");

/** Dominio activo por fuente (por defecto el oficial de fuentes.json). */
const activos = new Map<string, string>();
/** Momento (epoch ms) del último cambio por fuente. */
const modificados = new Map<string, number>();

function cargarPersistidos(): void {
  try {
    if (!fs.existsSync(ARCHIVO)) return;
    const data = JSON.parse(fs.readFileSync(ARCHIVO, "utf8")) as {
      dominios?: Record<string, string>;
    };
    for (const [id, baseUrl] of Object.entries(data.dominios || {})) {
      if (typeof baseUrl === "string" && baseUrl.startsWith("http")) {
        activos.set(id, baseUrl);
        modificados.set(id, Date.now());
      }
    }
  } catch {
    /* sin persistencia válida: se usan los oficiales */
  }
}

function persistir(): void {
  try {
    const data = { dominios: Object.fromEntries(activos) };
    fs.writeFileSync(ARCHIVO, JSON.stringify(data));
  } catch {
    /* best-effort (Render puede montar FS read-only) */
  }
}

cargarPersistidos();

// ── Índice host → fuente ────────────────────────────────────────
/** Todos los hosts conocidos de una fuente (oficial + respaldos). */
function hostsDeFuente(id: string): string[] {
  const fuente = FUENTES.find((f) => f.id === id);
  const hosts = new Set<string>();
  if (fuente) {
    try {
      hosts.add(new URL(fuente.baseUrl).hostname);
    } catch {
      /* baseUrl inválida en config */
    }
  }
  for (const alt of ALT[id] || []) {
    try {
      hosts.add(new URL(alt).hostname);
    } catch {
      /* respaldo inválido en config */
    }
  }
  return [...hosts];
}

const HOST_A_FUENTE = new Map<string, string>();
for (const f of FUENTES) {
  for (const h of hostsDeFuente(f.id)) {
    // El primer dueño gana (los TLD .tv/.com no colisionan entre fuentes)
    if (!HOST_A_FUENTE.has(h)) HOST_A_FUENTE.set(h, f.id);
  }
}

/** Dominio activo actual de una fuente (oficial si no hubo cambio). */
export function dominioActivo(id: string): string {
  return activos.get(id) || FUENTES.find((f) => f.id === id)?.baseUrl || "";
}

/** true si la fuente tiene un dominio distinto del oficial activo. */
export function dominioConmutado(id: string): boolean {
  const oficial = FUENTES.find((f) => f.id === id)?.baseUrl || "";
  return dominioActivo(id) !== oficial;
}

/** Todos los dominios de respaldo configurados de una fuente. */
export function dominiosAlternativos(id: string): string[] {
  return [...(ALT[id] || [])];
}

/** Host oficial de una fuente. */
export function hostOriginal(id: string): string {
  const base = FUENTES.find((f) => f.id === id)?.baseUrl || "";
  try {
    return new URL(base).hostname;
  } catch {
    return "";
  }
}

export interface InfoDominio {
  id: string;
  nombre: string;
  original: string;
  actual: string;
  conmutado: boolean;
  alternativos: string[];
  activo: boolean;
}

/** Inventario completo (GET /api/v1/dominios). */
export function inventarioDominios(): InfoDominio[] {
  return FUENTES.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    original: f.baseUrl,
    actual: dominioActivo(f.id),
    conmutado: dominioConmutado(f.id),
    alternativos: dominiosAlternativos(f.id),
    activo: f.activo !== false,
  }));
}

/** Cambia en caliente el dominio de una fuente y persiste. */
export function registrarDominio(
  id: string,
  baseUrl: string,
  motivo: "manual" | "vigilante"
): boolean {
  const fuente = FUENTES.find((f) => f.id === id);
  if (!fuente) return false;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(url.protocol)) return false;
  const anterior = dominioActivo(id);
  if (anterior === baseUrl) return true; // idempotente
  activos.set(id, baseUrl);
  modificados.set(id, Date.now());
  persistir();
  emitir("dominio-cambiado", { fuente: id, anterior, nuevo: baseUrl, motivo });
  return true;
}

/** Restaura el dominio oficial de una fuente. */
export function restablecerDominio(id: string): boolean {
  const fuente = FUENTES.find((f) => f.id === id);
  if (!fuente) return false;
  const anterior = activos.get(id) || fuente.baseUrl;
  activos.delete(id);
  modificados.delete(id);
  persistir();
  emitir("dominio-restaurado", {
    fuente: id,
    anterior,
    nuevo: fuente.baseUrl,
    motivo: "manual",
  });
  return true;
}

/** Momento del último cambio de dominio (o null). */
export function ultimaModificacion(id: string): number | null {
  return modificados.get(id) ?? null;
}

/**
 * Reescribe una URL hacia el dominio ACTIVO de su fuente:
 * si el host pertenece a una fuente con dominio conmutado, se
 * sustituye esquema+host manteniendo ruta y query. Los scrapers
// siguen construyendo URLs con el dominio original — la reescritura
// centralizada en el cliente HTTP las redirige al activo.
 */
export function reescribirDominio(url: string): string {
  try {
    const u = new URL(url);
    const id = HOST_A_FUENTE.get(u.hostname.replace(/^www\./, ""));
    if (!id) return url;
    const activo = activos.get(id);
    if (!activo) return url;
    const destino = new URL(activo);
    if (destino.hostname === u.hostname) return url;
    u.protocol = destino.protocol;
    u.host = destino.host;
    return u.toString();
  } catch {
    return url;
  }
}

/** Hosts permitidos de proxy de streaming: fuentes + extractores conocidos. */
export function hostsDeFuentes(): string[] {
  return [...HOST_A_FUENTE.keys()];
}
