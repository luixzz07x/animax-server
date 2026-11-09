'use strict';
/* ═══════════════════════════════════════════════════════════════════
   AniMax Server v7.0 · FASE H4 — DOMINIOS PROPIOS DEL HUB DEL DUEÑO
   ═══════════════════════════════════════════════════════════════════
   El eslabón que a Loklok le dan los 4 frentes H5 hardcodeados
   (tiktik.pro · loklok.tv · netpop.app · loklok.com — FORENSE-H §2):
   AniMax lo hace OPERABLE POR EL DUEÑO.

   · `animax-hub-domains.json` (mismo directorio): el dueño lista SU
     dominio del Hub `hub.midominio.tld` + mirrors. Editar el archivo
     cambia lo que la app usa SIN reiniciar el server NI publicar APK
     (la app refresca su whitelist cada 6 h — DomainWhitelist.kt).
   · Patrón mtime-cache EXACTO al de sections-config.json (v4.0 Fase 9):
     statSync + mtimeMs; archivo ausente o corrupto → lista vacía
     HONESTA (la app sigue con el searchServerUrl configurado).
   · Normalización blindada: URL obligatoria, host deduplicado,
     https forzado, flags por defecto (freshEnable/webFreshEnable true,
     desktop false) y EXACTAMENTE UNA primaria.

   Consumidores:
   · index.js      → `hubDomains: hubDomainsConfig` en el ctx del
                     watchdog (salud + failover de mirrors, H4).
   · v4-api.js     → `queryFreshDomainList` v2: mapa {hub:[…], sites:[…]}
                     con el contrato WhiteListConfig completo.
   ═══════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const HUB_DOMAINS_FILE = process.env.ANIMAX_HUB_DOMAINS_FILE
  ? path.resolve(process.env.ANIMAX_HUB_DOMAINS_FILE)
  : path.join(__dirname, 'animax-hub-domains.json');

/* Caché por mtime (mismo patrón que sections-config.json en v4-api). */
let cache = { mtime: 0, data: null };

/** Host de una URL (minúsculas, sin www) — null si no se puede parsear. */
function hostOf(u) {
  try { return new URL(u).host.toLowerCase().replace(/^www\./, ''); }
  catch { return null; }
}

/**
 * Lista normalizada de dominios del Hub del dueño:
 *   [{ url, freshEnable, webFreshEnable, desktop, primary }]
 * NUNCA lanza: cualquier problema → [] (honesto, sin dominios Hub).
 */
function hubDomainsConfig() {
  try {
    const st = fs.statSync(HUB_DOMAINS_FILE);
    if (cache.data && st.mtimeMs === cache.mtime) return cache.data;
    const raw = JSON.parse(fs.readFileSync(HUB_DOMAINS_FILE, 'utf8') || '{}');
    const list = Array.isArray(raw.hub) ? raw.hub : [];
    const clean = [];
    const seen = new Set();
    for (const h of list.slice(0, 12)) {          // tope sanidad: 12 mirrors
      if (!h || typeof h.url !== 'string') continue;
      const host = hostOf(h.url.trim());
      if (!host || !host.includes('.')) continue; // dominio mínimo viable
      if (seen.has(host)) continue;               // dedupe por host
      seen.add(host);
      clean.push({
        url: 'https://' + host,
        freshEnable: h.freshEnable !== false,       // captura de medios (Loklok)
        webFreshEnable: h.webFreshEnable !== false, // navegador interno puede abrirlo
        desktop: h.desktop === true,                // UA Chrome-desktop por dominio
        primary: h.primary === true
      });
    }
    // EXACTAMENTE una primaria: la primera marcada, o la primera de todas.
    if (clean.length) {
      const first = clean.findIndex(h => h.primary);
      const idx = first >= 0 ? first : 0;
      clean.forEach((h, i) => { h.primary = i === idx; });
    }
    cache = { mtime: st.mtimeMs, data: clean };
    return clean;
  } catch {
    /* Archivo ausente/corrupto: sin dominios Hub — honesto (la app
       sigue con searchServerUrl; el portal /hub del propio server
       sigue funcionando por la origin con la que se acceda). */
    cache = { mtime: 0, data: [] };
    return [];
  }
}

/** URL del mirror ACTIVO para views rápidas (primary o primero). */
function primaryHubUrl() {
  const list = hubDomainsConfig();
  return list.length ? (list.find(h => h.primary) || list[0]).url : null;
}

module.exports = { hubDomainsConfig, primaryHubUrl, HUB_DOMAINS_FILE };
