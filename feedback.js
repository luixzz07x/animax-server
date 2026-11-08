'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · FASE 3 — REPUTACIÓN DE FUENTES + BITÁCORA DE BÚSQUEDA
   ═════════════════════════════════════════════════════════════════════
   Motor de re-priorización automática de fuentes (la técnica de Seekee
   para que "los que están disponibles estén COMPLETOS"):

   · REPORTES DE REPRODUCCIÓN (✗/✓): los manda la app cuando un stream
     falla o funciona (POST /api/report/web) Y el propio servidor cuando
     su resolutor triunfa o fracasa (auto-reporte). penaltyOf(host)
     0..1 (0 = impecable).
   · DESEMPEÑO DE BÚSQUEDA: cada vez que buildOptions barre el catálogo
     se anota qué fuentes devolvieron resultados (hit) y cuáles no
     (miss), con decaimiento (las últimas ~50 búsquedas pesan lo mismo).
     searchPenaltyOf(host) 0..1.
   · RANK COMBINADO: sourcePenaltyOf(host) = 0.6·reproducción +
     0.3·búsqueda + 0.1·antigüedad del último fallo. Lo consumen el
     orden de resultados (v4-api), el orden de opciones (groupOptions)
     y las tarjetas agregadas por título.
   · BITÁCORA DE BÚSQUEDA: cada consulta del usuario sube su contador
     (animax-searchlog.json) → alimenta relatedQueries y forecast.

   Persistencia best-effort en JSON (en Render el disco es efímero: se
   regenera, es aceptable — la señal se reconstruye sola en minutos).
   ═════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const REPORTS_FILE = path.join(__dirname, 'animax-reports.json');
const SEARCHLOG_FILE = path.join(__dirname, 'animax-searchlog.json');
const SEARCHLOG_MAX = 400;      // consultas distintas recordadas
const SEARCH_DECAY_AT = 60;     // al superar este total hits+misses → se decian a la mitad

/* ── Reportes de reproducción + desempeño de búsqueda, por host ────── */
const reportStore = new Map();
// host → { fails, oks, lastTs, lastReason?, searchHits, searchMisses, searchLastTs }

function normHost(h) {
  return String(h || '').trim().toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
}

(function load() {
  try {
    const data = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8') || '{}');
    for (const [host, v] of Object.entries(data || {})) {
      if (!v || typeof v !== 'object') continue;
      reportStore.set(host, {
        fails: Number(v.fails) || 0, oks: Number(v.oks) || 0,
        lastTs: Number(v.lastTs) || 0,
        lastReason: v.lastReason || '',
        searchHits: Number(v.searchHits) || 0,
        searchMisses: Number(v.searchMisses) || 0,
        searchLastTs: Number(v.searchLastTs) || 0
      });
    }
  } catch { /* sin fichero: se empieza vacío */ }
})();

function save() {
  try {
    const data = {};
    for (const [host, v] of reportStore) data[host] = v;
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(data));
  } catch { /* best-effort */ }
}

function entryOf(host) {
  const h = normHost(host);
  let r = reportStore.get(h);
  if (!r) {
    r = { fails: 0, oks: 0, lastTs: 0, lastReason: '', searchHits: 0, searchMisses: 0, searchLastTs: 0 };
    reportStore.set(h, r);
  }
  return r;
}

/* ── 1. Reportes de REPRODUCCIÓN (app + auto-reporte del servidor) ──── */

/** Registra un reporte de resultado (ok=true funciona, ok=false roto).
 *  Devuelve el host normalizado (o null si la URL no es válida). */
function recordReport(url, ok, reason) {
  try {
    const host = normHost(new URL(url).host);
    const r = entryOf(host);
    if (ok) r.oks++; else r.fails++;
    r.lastTs = Date.now();
    if (reason) r.lastReason = String(reason).slice(0, 140);
    reportStore.set(host, r);
    save();
    return host;
  } catch { return null; }
}

/** Penalización de REPRODUCCIÓN 0..1 (0 = impecable). Se suaviza con
 *  pocos reportes para que 1 fallo puntual no hunda a una fuente. */
function penaltyOf(host) {
  const r = reportStore.get(normHost(host));
  if (!r) return 0;
  const total = r.fails + r.oks;
  if (total < 2) return 0;
  return Math.min(1, (r.fails / total) * Math.min(1, total / 5));
}

/* ── 2. Desempeño de BÚSQUEDA (hit/miss por consulta del catálogo) ──── */

/** Anota si una fuente devolvió resultados para la consulta que acaba
 *  de bararse. Con decaimiento: la ventana efectiva son las últimas
 *  ~SEARCH_DECAY_AT búsquedas (las fuentes MEJORAN al rotar a un
 *  dominio vivo — el pasado lejano no debe perseguirlas). */
function recordSearchOutcome(host, hit) {
  const r = entryOf(host);
  if (hit) r.searchHits++; else r.searchMisses++;
  r.searchLastTs = Date.now();
  if (r.searchHits + r.searchMisses > SEARCH_DECAY_AT) {
    r.searchHits = Math.ceil(r.searchHits / 2);
    r.searchMisses = Math.floor(r.searchMisses / 2);
  }
  reportStore.set(normHost(host), r);
  save();
}

/** Penalización de BÚSQUEDA 0..1 (0 = siempre encuentra). */
function searchPenaltyOf(host) {
  const r = reportStore.get(normHost(host));
  if (!r) return 0;
  const total = r.searchHits + r.searchMisses;
  if (total < 3) return 0;
  return Math.min(1, (r.searchMisses / total) * Math.min(1, total / 10));
}

/* ── 3. RANK COMBINADO — lo que ordena resultados y opciones ───────── */

/** Penalización TOTAL 0..1 de una fuente:
 *    60 % reproducción (lo que más duele: eliges y no funciona)
 *    30 % búsqueda (fuente que nunca aporta resultados)
 *    10 % frescura del último fallo (fallo hace segundos pesa más que
 *        uno de ayer — deja recuperarse rápido tras arreglarse).
 *  penaltyTotalOf(host) === 0 → fuente sin señal, orden natural. */
function penaltyTotalOf(host) {
  const r = reportStore.get(normHost(host));
  if (!r) return 0;
  const play = penaltyOf(host);
  const search = searchPenaltyOf(host);
  let fresh = 0;
  if (r.lastTs && r.fails > 0) {
    const hours = (Date.now() - r.lastTs) / 3600000;
    fresh = Math.max(0, 1 - hours / 48);   // se apaga en 48 h
  }
  return Math.min(1, play * 0.6 + search * 0.3 + fresh * 0.1 * (r.fails / Math.max(1, r.fails + r.oks)));
}

/** Igual que penaltyTotalOf pero desde una URL completa. */
function penaltyOfUrl(u) {
  try { return penaltyTotalOf(new URL(u).host); } catch { return 0; }
}

/** Estadísticas completas de un host (pantalla "Estado de fuentes"). */
function statsOf(host) {
  const r = reportStore.get(normHost(host));
  return {
    reports: r ? { fails: r.fails, oks: r.oks, penalty: penaltyOf(host) } : null,
    search: r
      ? { hits: r.searchHits, misses: r.searchMisses, searchPenalty: searchPenaltyOf(host) }
      : null,
    penalty: penaltyTotalOf(host),
    lastTs: r ? r.lastTs : 0,
    lastReason: r ? (r.lastReason || '') : ''
  };
}

/* ── 4. BITÁCORA DE BÚSQUEDA (para relatedQueries + forecast) ───────── */

const searchLog = new Map();   // query(minúsculas) → { count, lastTs, display }

(function loadLog() {
  try {
    const data = JSON.parse(fs.readFileSync(SEARCHLOG_FILE, 'utf8') || '{}');
    for (const [q, v] of Object.entries(data || {})) {
      if (q && v && typeof v === 'object') {
        searchLog.set(q, {
          count: Number(v.count) || 1, lastTs: Number(v.lastTs) || 0,
          display: v.display || q
        });
      }
    }
  } catch { /* sin fichero */ }
})();

function saveLog() {
  try {
    // conserva las SEARCHLOG_MAX más buscadas/recientes
    const keep = [...searchLog.entries()]
      .sort((a, b) => (b[1].lastTs - a[1].lastTs) || (b[1].count - a[1].count))
      .slice(0, SEARCHLOG_MAX);
    const data = {};
    for (const [q, v] of keep) data[q] = v;
    fs.writeFileSync(SEARCHLOG_FILE, JSON.stringify(data));
  } catch { /* best-effort */ }
}

/** Registra una consulta del usuario (para sugerencias y forecast). */
function recordQuery(q) {
  const s = String(q || '').trim();
  if (s.length < 2 || s.length > 90) return;
  const k = s.toLowerCase();
  const e = searchLog.get(k) || { count: 0, lastTs: 0, display: s };
  e.count++;
  e.lastTs = Date.now();
  e.display = s;
  searchLog.set(k, e);
  if (searchLog.size > SEARCHLOG_MAX * 2) {
    // recorte agresivo si alguien consulta miles de cosas distintas
    const keep = [...searchLog.entries()]
      .sort((a, b) => (b[1].lastTs - a[1].lastTs) || (b[1].count - a[1].count))
      .slice(0, SEARCHLOG_MAX);
    searchLog.clear();
    for (const [q2, v] of keep) searchLog.set(q2, v);
  }
  saveLog();
}

/** Las N consultas más CALIENTES de la bitácora (count y frescura). */
function hotQueries(n = 10) {
  const now = Date.now();
  return [...searchLog.values()]
    .map(v => ({
      display: v.display, count: v.count,
      heat: v.count * Math.max(0.2, 1 - (now - v.lastTs) / (7 * 86400000))
    }))
    .sort((a, b) => b.heat - a.heat)
    .slice(0, n);
}

/** Consultas de la bitácora que casan con un prefijo/palabra (forecast). */
function logMatches(prefix, n = 6) {
  const p = String(prefix || '').trim().toLowerCase();
  if (p.length < 2) return [];
  const starts = [], contains = [];
  for (const v of searchLog.values()) {
    const k = v.display.toLowerCase();
    if (k === p) continue;
    if (k.startsWith(p)) starts.push(v);
    else if (k.split(/\s+/).some(w => w.startsWith(p))) contains.push(v);
  }
  const byHeat = (a, b) => (b.count - a.count) || (b.lastTs - a.lastTs);
  return [...starts.sort(byHeat).slice(0, n), ...contains.sort(byHeat).slice(0, n)]
    .slice(0, n).map(v => v.display);
}

module.exports = {
  reportStore,
  recordReport, penaltyOf,
  recordSearchOutcome, searchPenaltyOf,
  penaltyTotalOf, penaltyOfUrl, statsOf,
  recordQuery, hotQueries, logMatches,
  normHost
};
