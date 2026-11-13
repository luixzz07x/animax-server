// ─────────────────────────────────────────────────────────────
// ANIMAX v5 · Router /api/v1/dominios — cambio de dominio EN
// CALIENTE. Cuando una fuente migra de dominio (le pasa a casi
// todas cada pocos meses): POST {baseUrl} y TODO el scraping se
// redirige al instante (el cliente HTTP reescribe las URLs),
// vaciando los caches con URLs viejas. El vigilante lo hace
// automáticamente con los dominios de respaldo.
//  - GET  /api/v1/dominios            → inventario
//  - POST /api/v1/dominios/:fuente    → { baseUrl } conmuta
//  - POST /api/v1/dominios/:fuente/reset → vuelve al oficial
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { inventarioDominios, registrarDominio, restablecerDominio } from "../core/dominios";
import { invalidar } from "../lib/animax/cache";
import { obtenerHttp } from "../lib/animax/http";
import { envolverAsync } from "./comun";

export const routerDominios = Router();

routerDominios.get(
  "/api/v1/dominios",
  envolverAsync(async (_req, res) => {
    res.json({ ok: true, data: { fuentes: inventarioDominios() } });
  })
);

routerDominios.post(
  "/api/v1/dominios/:fuente",
  envolverAsync(async (req, res) => {
    const fuente = req.params.fuente;
    const baseUrl = typeof req.body?.baseUrl === "string" ? req.body.baseUrl.trim() : "";
    if (!baseUrl) {
      res.status(400).json({ ok: false, error: "body requerido: { baseUrl }" });
      return;
    }
    // Sonda antes de conmutar: si el dominio propuesto no responde,
    // se avisa pero NO se bloquea (puede ser el cliente el bloqueado).
    const sonda = await sondearFuenteConDominio(fuente, baseUrl);
    const aplicado = registrarDominio(fuente, baseUrl, "manual");
    if (!aplicado) {
      res.status(404).json({ ok: false, error: "fuente desconocida o baseUrl inválida" });
      return;
    }
    // Los caches guardan URLs del dominio viejo: se vacían por completo
    invalidar("buscar");
    invalidar("ultimos");
    invalidar("detalle");
    invalidar("servidores");
    invalidar("curados");
    res.json({
      ok: true,
      data: { fuente, baseUrl, sondaPrevia: sonda, cachesInvalidados: true },
      nota: "todas las peticiones a esta fuente se redirigen ya al dominio nuevo",
    });
  })
);

routerDominios.post(
  "/api/v1/dominios/:fuente/reset",
  envolverAsync(async (req, res) => {
    const fuente = req.params.fuente;
    const aplicado = restablecerDominio(fuente);
    if (!aplicado) {
      res.status(404).json({ ok: false, error: "fuente desconocida" });
      return;
    }
    invalidar("buscar");
    invalidar("ultimos");
    invalidar("detalle");
    invalidar("servidores");
    res.json({ ok: true, data: { fuente, restaurado: true } });
  })
);

/** Sonda de un dominio concreto (sin conmutarlo aún). */
async function sondearFuenteConDominio(
  fuente: string,
  baseUrl: string
): Promise<{ respuesta: boolean; ms: number | null }> {
  void fuente; // la sonda es del dominio candidato, no del id
  const inicio = Date.now();
  const html = await obtenerHttp(baseUrl, { timeoutMs: 6000, reintentos: 0 });
  const ok = html !== null && html.length > 500 && !/just a moment/i.test(html.slice(0, 2000));
  return { respuesta: ok, ms: ok ? Date.now() - inicio : null };
}

export default routerDominios;
