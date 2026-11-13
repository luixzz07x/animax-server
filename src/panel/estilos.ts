// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · CSS del panel de administración (EMBEBIDO en el
// HTML de GET /panel; cero dependencias, cero archivos externos).
// Tema oscuro coherente con la app ANIMAX, responsive y sin
// frameworks.
// ─────────────────────────────────────────────────────────────

export const estilosPanel = `
:root {
  --fondo: #0b0e17;
  --panel: #12162a;
  --borde: #232a45;
  --texto: #e8ecff;
  --texto-suave: #9aa3c7;
  --acento: #7c5cff;
  --acento-2: #38bdf8;
  --ok: #34d399;
  --aviso: #fbbf24;
  --error: #f87171;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { color-scheme: dark; }
body {
  background: var(--fondo);
  color: var(--texto);
  font: 15px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif;
  min-height: 100vh;
}
a { color: var(--acento-2); text-decoration: none; }
a:hover { text-decoration: underline; }

.cab {
  display: flex; align-items: center; gap: 16px;
  padding: 18px 28px;
  background: linear-gradient(135deg, #151b33 0%, #0b0e17 100%);
  border-bottom: 1px solid var(--borde);
  flex-wrap: wrap;
}
.cab .logo { width: 46px; height: 46px; border-radius: 12px; }
.cab h1 { font-size: 22px; letter-spacing: 2px; }
.cab .ver {
  color: var(--acento); font-size: 13px; vertical-align: middle;
  border: 1px solid var(--acento); border-radius: 6px; padding: 1px 6px; margin-left: 6px;
}
.cab .sub { color: var(--texto-suave); font-size: 12px; }
.estado-global {
  margin-left: auto; padding: 8px 14px; border-radius: 10px;
  background: rgba(124, 92, 255, .12); border: 1px solid var(--borde);
  font-size: 13px; color: var(--ok); font-weight: 600;
}

main { max-width: 1200px; margin: 0 auto; padding: 22px 22px 60px; }

.tarjetas {
  display: grid; gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
}
.tarjeta {
  background: var(--panel); border: 1px solid var(--borde);
  border-radius: 14px; padding: 16px 18px;
}
.tarjeta h3 {
  font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px;
  color: var(--texto-suave); margin-bottom: 8px;
}
.tarjeta .grande { font-size: 26px; font-weight: 700; }
.tarjeta .pie { font-size: 12px; color: var(--texto-suave); margin-top: 4px; }

.bloque {
  background: var(--panel); border: 1px solid var(--borde);
  border-radius: 16px; padding: 20px 22px; margin-top: 22px;
}
.fila-titulo { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.fila-titulo h2, .bloque > h2 { font-size: 17px; margin-bottom: 4px; }
.acciones { margin-left: auto; }
.nota { color: var(--texto-suave); font-size: 13px; margin: 6px 0 12px; }

.btn {
  background: var(--acento); color: #fff; border: 0; border-radius: 9px;
  padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: filter .15s;
}
.btn:hover { filter: brightness(1.15); }
.btn-sec { background: transparent; border: 1px solid var(--borde); color: var(--texto); }
.btn-mini { padding: 4px 10px; font-size: 12px; border-radius: 7px; }
.btn-peligro { background: #b91c1c; }

.tabla-scroll { overflow-x: auto; margin-top: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--borde); }
th { color: var(--texto-suave); font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
td .dominio { color: var(--texto-suave); font-size: 12px; }

.chip {
  display: inline-block; padding: 2px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
}
.chip-cerrado { background: rgba(52, 211, 153, .15); color: var(--ok); }
.chip-abierto { background: rgba(248, 113, 113, .16); color: var(--error); }
.chip-semiabierto { background: rgba(251, 191, 36, .16); color: var(--aviso); }
.chip-suspendida { background: rgba(154, 163, 199, .18); color: var(--texto-suave); }
.chip-viva { background: rgba(52, 211, 153, .15); color: var(--ok); }

.controles { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.control {
  border: 1px solid var(--borde); border-radius: 12px; padding: 16px;
  display: flex; flex-direction: column; gap: 10px;
}
.control h3 { font-size: 13px; color: var(--texto-suave); }
.control select {
  background: var(--fondo); color: var(--texto); border: 1px solid var(--borde);
  border-radius: 8px; padding: 8px 10px; font-size: 13px;
}
.resultado { font-size: 12px; color: var(--ok); min-height: 16px; }

.tendencias { padding-left: 20px; color: var(--texto); font-size: 13px; }
.tendencias li { margin: 3px 0; }
.tendencias li small { color: var(--texto-suave); }

.logs {
  margin-top: 8px; max-height: 260px; overflow-y: auto;
  background: #0a0d15; border: 1px solid var(--borde); border-radius: 12px;
  padding: 12px 14px; font: 12px/1.6 ui-monospace, Consolas, monospace;
}
.logs .fila-log { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.logs .codigo-2xx { color: var(--ok); }
.logs .codigo-4xx { color: var(--aviso); }
.logs .codigo-5xx { color: var(--error); font-weight: 700; }
.logs .ts { color: var(--texto-suave); }

.vivo { color: var(--ok); font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
.vivo i { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); animation: latido 1.6s infinite; }
@keyframes latido { 0%,100% { opacity: 1; } 50% { opacity: .25; } }

.metricas {
  margin-top: 8px; max-height: 300px; overflow: auto;
  background: #0a0d15; border: 1px solid var(--borde); border-radius: 12px;
  padding: 14px; font: 12px/1.55 ui-monospace, Consolas, monospace;
  color: var(--texto-suave);
}

.pie-final {
  text-align: center; color: var(--texto-suave); font-size: 12px;
  padding: 24px 12px 40px;
}

@media (max-width: 720px) {
  .cab { padding: 14px; }
  main { padding: 14px 14px 40px; }
  .bloque { padding: 14px; }
}
`;

export default estilosPanel;
