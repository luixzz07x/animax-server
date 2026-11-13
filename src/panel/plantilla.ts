// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · PLANTILLA HTML del panel de administración
// (servida por el propio server en GET /panel). Sin dependencias
// nuevas: el CSS y el JS van EMBEBIDOS en el propio documento
// (src/panel/estilos.ts y src/panel/guion.ts exportan strings).
// El guion consulta la API admin en vivo (/api/v1/admin/estado,
// /api/v1/admin/logs, /metrics…) y ofrece los controles:
// purgar caché, cambiar dominio, suspender/reanudar fuente y
// chequeo manual de salud.
// ─────────────────────────────────────────────────────────────

/** Monta el documento HTML completo del panel. */
export function plantillaPanel(op: { css: string; js: string }): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ANIMAX v5.1 · Panel de administración</title>
<link rel="icon" href="/img/icono.png">
<style>
${op.css}
</style>
</head>
<body>
<header class="cab">
  <img src="/img/icono.png" alt="ANIMAX" class="logo">
  <div>
    <h1>ANIMAX <span class="ver">v5.1</span></h1>
    <p class="sub">Panel de administración · <span id="puerto-info">servidor standalone</span></p>
  </div>
  <div class="estado-global" id="estado-global">…</div>
</header>

<main>
  <section class="tarjetas" id="tarjetas">
    <div class="tarjeta"><h3>Uptime</h3><p class="grande" id="k-uptime">—</p><p class="pie" id="k-node">—</p></div>
    <div class="tarjeta"><h3>Memoria RSS</h3><p class="grande" id="k-mem">—</p><p class="pie" id="k-heap">—</p></div>
    <div class="tarjeta"><h3>Peticiones</h3><p class="grande" id="k-peticiones">—</p><p class="pie" id="k-errores">—</p></div>
    <div class="tarjeta"><h3>Caché</h3><p class="grande" id="k-cache">—</p><p class="pie" id="k-cache-detalle">—</p></div>
    <div class="tarjeta"><h3>Fuentes vivas</h3><p class="grande" id="k-fuentes">—</p><p class="pie" id="k-fuentes-detalle">—</p></div>
    <div class="tarjeta"><h3>Extractores</h3><p class="grande" id="k-extractores">15</p><p class="pie">12 v5 + 3 v5.1</p></div>
  </section>

  <section class="bloque">
    <div class="fila-titulo">
      <h2>Fuentes</h2>
      <div class="acciones">
        <button id="btn-chequear" class="btn">Chequear fuentes ahora</button>
      </div>
    </div>
    <p class="nota">El circuito <b>abierto</b> omite la fuente hasta su enfriamiento. "Suspendida" (manual) deja de scrapearse al instante; "Cambiar dominio" conmuta en caliente (POST /api/v1/admin/dominios/{fuente}).</p>
    <div class="tabla-scroll">
      <table id="tabla-fuentes">
        <thead>
          <tr>
            <th>Fuente</th><th>Dominio activo</th><th>Grupo</th><th>Circuito</th>
            <th>Fallos</th><th>Latencia</th><th>Estado</th><th>Acciones</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  </section>

  <section class="bloque">
    <div class="fila-titulo">
      <h2>Controles</h2>
    </div>
    <div class="controles">
      <div class="control">
        <h3>Purgar caché</h3>
        <select id="sel-namespace">
          <option value="">todos los namespaces</option>
          <option value="buscar">buscar</option>
          <option value="ultimos">ultimos</option>
          <option value="detalle">detalle</option>
          <option value="servidores">servidores</option>
          <option value="curados">curados</option>
          <option value="recomendaciones">recomendaciones</option>
          <option value="tops">tops</option>
        </select>
        <button id="btn-purgar" class="btn btn-accion">Purgar</button>
        <p class="resultado" id="res-purgar"></p>
      </div>
      <div class="control">
        <h3>Tendencias de búsqueda</h3>
        <ol id="tendencias" class="tendencias"></ol>
        <p class="nota">Ventana 24 h con decaimiento exponencial (GET /api/v1/tendencias).</p>
      </div>
      <div class="control">
        <h3>Guardar listas de usuario</h3>
        <button id="btn-guardar-listas" class="btn">Guardar ahora (data/listas-usuarios.json)</button>
        <p class="resultado" id="res-guardar"></p>
      </div>
    </div>
  </section>

  <section class="bloque">
    <div class="fila-titulo">
      <h2>Logs recientes</h2>
      <span class="vivo"><i></i> en vivo</span>
    </div>
    <div class="logs" id="logs"></div>
  </section>

  <section class="bloque">
    <h2>Métricas Prometheus</h2>
    <p class="nota">Texto plano en <a href="/metrics" target="_blank">/metrics</a> (compatible con cualquier scraper) · contadores con etiquetas por fuente/extractor/código HTTP.</p>
    <pre class="metricas" id="metricas">…</pre>
  </section>
</main>

<footer class="pie-final">
  <p>ANIMAX v5.1 · 22 fuentes · 15 extractores · proxy de streaming · watchdog de dominios · <a href="/api/v1/estado" target="_blank">/api/v1/estado</a> · <a href="/api/v1/admin/estado" target="_blank">/api/v1/admin/estado</a></p>
</footer>

<script>
${op.js}
</script>
</body>
</html>
`;
}

export default plantillaPanel;
