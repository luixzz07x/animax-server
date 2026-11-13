// ─────────────────────────────────────────────────────────────
// ANIMAX v5.1 · JS del panel de administración (EMBEBIDO en el
// HTML de GET /panel). Vanilla JS: sin dependencias, sin build.
// Consulta la API admin en vivo y monta:
//   · tarjetas de métricas (uptime, memoria, peticiones, caché)
//   · tabla de fuentes con circuito, dominio, latencia y controles
//   · tendencias de búsqueda (ventana 24 h)
//   · logs recientes en vivo
//   · métricas Prometheus en texto
// El refresco automático cada 10 s MANTIENE DESPIERTO el server
// del plan free de Render mientras la pestaña está abierta.
// ─────────────────────────────────────────────────────────────

export const guionPanel = `
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function claseCodigo(codigo) {
    if (codigo >= 500) return "codigo-5xx";
    if (codigo >= 400) return "codigo-4xx";
    return "codigo-2xx";
  }

  // ── Tarjetas + fuentes + tendencias ─────────────────────────
  async function refrescarEstado() {
    try {
      var r = await fetch("/api/v1/admin/estado", { headers: { Accept: "application/json" } });
      var j = await r.json();
      if (!j || !j.ok) return;
      var s = j.servidor;
      $("k-uptime").textContent = Math.floor(s.uptimeSeg / 3600) + "h " + Math.floor((s.uptimeSeg % 3600) / 60) + "m";
      $("k-node").textContent = "node " + s.node;
      $("k-mem").textContent = s.memoria.rssMb + " MB";
      $("k-heap").textContent = "heap " + s.memoria.heapUsadoMb + " MB";
      var p = j.peticiones || {};
      $("k-peticiones").textContent = String((p.peticion || 0) + (p["peticion-error"] || 0));
      $("k-errores").textContent = "errores " + (p["peticion-error"] || 0);
      var c = j.cache || {};
      $("k-cache").textContent = String(c.entradas || 0);
      $("k-cache-detalle").textContent = "hits " + (c.hits || 0) + " · fallos " + (c.fallos || 0);
      var salud = (j.fuentes && j.fuentes.salud) || { total: 0, vivas: 0, caidas: 0, limitadas: 0, bloqueadas: 0 };
      // v5.3: resumen HONESTO — vivas reales (circuito cerrado con éxito
      // o bloqueada-CF alcanzable), caídas reales (circuito abierto) y
      // limitadas (sin respuesta sostenida desde la IP del datacenter).
      $("k-fuentes").textContent = salud.vivas + "/" + salud.total;
      $("k-fuentes-detalle").textContent =
        "caídas " + salud.caidas + " · limitadas " + (salud.limitadas || 0) + " · bloqueadas " + (salud.bloqueadas || 0);
      $("estado-global").textContent =
        salud.caidas === 0 && (salud.limitadas || 0) === 0
          ? "TODO OPERATIVO"
          : salud.vivas + " vivas · " + salud.caidas + " caídas · " + (salud.limitadas || 0) + " limitadas";
      pintarFuentes(j.fuentes.detalle || []);
    } catch (e) {
      $("estado-global").textContent = "sin respuesta del server";
    }
  }

  function pintarFuentes(fuentes) {
    var tbody = document.querySelector("#tabla-fuentes tbody");
    if (!tbody) return;
    var html = "";
    for (var i = 0; i < fuentes.length; i++) {
      var f = fuentes[i];
      var suspendida = f.suspendida === true;
      var chip = suspendida
        ? '<span class="chip chip-suspendida">suspendida</span>'
        : '<span class="chip chip-' + esc(f.circuito) + '">' + esc(f.circuito) + "</span>";
      // v5.3: estado REAL por fuente (antes todo "activa")
      var estadoReal = suspendida
        ? "—"
        : f.limitada === true
          ? "limitada (IP DC)"
          : f.bloqueada === true
            ? "bloqueada (CF)"
            : "activa";
      var acciones = suspendida
        ? '<button class="btn btn-mini btn-sec" data-reanudar="' + esc(f.id) + '">Reanudar</button>'
        : '<button class="btn btn-mini btn-sec" data-suspender="' + esc(f.id) + '">Suspender</button>';
      acciones +=
        ' <button class="btn btn-mini btn-sec" data-dominio="' + esc(f.id) +
        '" data-actual="' + esc(f.dominio) + '">Cambiar dominio</button>';
      html +=
        "<tr><td><b>" + esc(f.nombre) + '</b><br><span class="dominio">' + esc(f.id) + "</span></td>" +
        '<td class="dominio">' + esc(f.dominio) + "</td>" +
        "<td>" + esc((f.grupo || "")) + "</td>" +
        "<td>" + chip + "</td>" +
        "<td>" + esc(f.fallosConsecutivos) + "</td>" +
        "<td>" + (f.latenciaMs == null ? "—" : esc(f.latenciaMs) + " ms") + "</td>" +
        "<td>" + estadoReal + "</td>" +
        "<td>" + acciones + "</td></tr>";
    }
    tbody.innerHTML = html;
  }

  // ── Logs recientes ─────────────────────────────────────────
  async function refrescarLogs() {
    try {
      var r = await fetch("/api/v1/admin/logs");
      var j = await r.json();
      if (!j || !j.ok) return;
      var cont = $("logs");
      var html = "";
      var peticiones = (j.data && j.data.peticiones) || [];
      for (var i = 0; i < peticiones.length && i < 60; i++) {
        var p = peticiones[i];
        var hora = new Date().toLocaleTimeString("es");
        html +=
          '<div class="fila-log"><span class="ts">' + hora + "</span> " +
          esc(p.metodo) + " " + esc(p.ruta) +
          ' <span class="' + claseCodigo(p.estado) + '">' + esc(p.estado) + "</span>" +
          " " + esc(p.ms) + "ms [" + esc(p.id) + "]</div>";
      }
      cont.innerHTML = html || '<div class="fila-log">sin peticiones todavía</div>';
    } catch (e) { /* silencio */ }
  }

  // ── Tendencias ──────────────────────────────────────────────
  async function refrescarTendencias() {
    try {
      var r = await fetch("/api/v1/tendencias?ventana=24&limite=10");
      var j = await r.json();
      var t = (j && j.data && j.data.tendencias) || [];
      var html = "";
      for (var i = 0; i < t.length; i++) {
        html += "<li><b>" + esc(t[i].titulo) + "</b> <small>" +
          esc(t[i].terminoFrecuente) + " · " + t[i].busquedas + " búsqueda(s)</small></li>";
      }
      $("tendencias").innerHTML = html || "<li>sin búsquedas en la ventana</li>";
    } catch (e) { /* silencio */ }
  }

  // ── Métricas Prometheus (texto) ─────────────────────────────
  async function refrescarMetricas() {
    try {
      var r = await fetch("/metrics");
      var texto = await r.text();
      var lineas = texto.split("\\n").slice(0, 40);
      $("metricas").textContent = lineas.join("\\n") + "\\n… (texto completo en /metrics)";
    } catch (e) { /* silencio */ }
  }

  // ── Controles ───────────────────────────────────────────────
  async function post(url, body) {
    var r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return r.json();
  }

  $("btn-purgar").addEventListener("click", async function () {
    var ns = $("sel-namespace").value;
    var j = await post("/api/v1/admin/cache/purgar", ns ? { namespace: ns } : {});
    $("res-purgar").textContent = j && j.ok
      ? "Purgado " + (j.data && j.data.purgado) + " · quedan " + (j.data && j.data.restantes) + " entradas"
      : "error: " + (j && j.error);
  });

  $("btn-chequear").addEventListener("click", async function () {
    $("btn-chequear").disabled = true;
    var j = await post("/api/v1/admin/chequear-fuentes", {});
    $("btn-chequear").disabled = false;
    refrescarEstado();
  });

  $("btn-guardar-listas").addEventListener("click", async function () {
    var j = await post("/api/v1/admin/listas/guardar", {});
    $("res-guardar").textContent = j && j.ok
      ? "Guardadas " + (j.data && j.data.listas) + " listas de " + (j.data && j.data.usuarios) + " usuario(s)"
      : "error: " + (j && j.error);
  });

  // Delegación de acciones de la tabla de fuentes
  document.addEventListener("click", async function (ev) {
    var el = ev.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset.suspender) {
      await post("/api/v1/admin/fuentes/" + el.dataset.suspender + "/suspender", {});
      refrescarEstado();
    } else if (el.dataset.reanudar) {
      await post("/api/v1/admin/fuentes/" + el.dataset.reanudar + "/reanudar", {});
      refrescarEstado();
    } else if (el.dataset.dominio) {
      var actual = el.dataset.actual || "";
      var nuevo = prompt("Nueva baseUrl de " + el.dataset.dominio + " (actual: " + actual + ")", actual);
      if (!nuevo || nuevo === actual) return;
      var j = await post("/api/v1/admin/dominios/" + el.dataset.dominio, { baseUrl: nuevo });
      if (!j || !j.ok) alert("No se pudo conmutar: " + (j && j.error));
      refrescarEstado();
    }
  });

  // ── Bucle en vivo: refresco cada 10 s (además mantiene
  //    despierto el servicio del plan free de Render) ───────────
  refrescarEstado();
  refrescarLogs();
  refrescarTendencias();
  refrescarMetricas();
  setInterval(refrescarEstado, 10000);
  setInterval(refrescarLogs, 10000);
  setInterval(refrescarTendencias, 60000);
  setInterval(refrescarMetricas, 30000);
})();
`;

export default guionPanel;
