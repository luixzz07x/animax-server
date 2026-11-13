// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · PANEL DE ADMINISTRACIÓN (montaje del router).
// Combina la plantilla HTML (plantilla.ts), los estilos (estilos.ts)
// y el guion en vivo (guion.ts) en UN solo documento servido por
// el propio server:
//   GET /panel  → HTML con métricas en vivo, salud de fuentes,
//                 logs recientes y controles (purgar caché,
//                 cambiar dominio, suspender/reanudar fuente).
// Sin dependencias nuevas: todo va embebido en la respuesta.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import { plantillaPanel } from "./plantilla";
import { estilosPanel } from "./estilos";
import { guionPanel } from "./guion";

export const routerPanel = Router();

/** Documento completo (se construye una sola vez al montar). */
const documento = plantillaPanel({ css: estilosPanel, js: guionPanel });

routerPanel.get(
  "/panel",
  (_req, res) => {
    res.header("Cache-Control", "no-store");
    res.header("Content-Type", "text/html; charset=utf-8");
    res.send(documento);
  }
);

/** HTML completo (para tests y para servirlo desde otro router). */
export function htmlPanel(): string {
  return documento;
}

export default routerPanel;
