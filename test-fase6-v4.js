#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · FASE 6 — ARNÉS DE PRUEBAS DE LAS REGLAS
   DE OCULTACIÓN DE ELEMENTOS (cosméticas, elemhide estilo ABP)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-fase6-v4.js [puerto]     (defecto 3001; el servidor debe
                                          estar corriendo en ese puerto)

   [B] EN VIVO — contrato del endpoint nuevo:
       · GET /api/adblock/hide → 200 text/plain, una regla EasyList por
         línea (`##selector` o `dominio.com##selector`), cabecera X-Blocks,
         Cache-Control 24 h, CORS. Si el sandbox NO puede descargar
         EasyList, el FALLBACK debe activarse (la respuesta nunca es vacía).
       · Sanitización real: NINGUNA línea puede contener sintaxis
         propietaria ABP (:-abp-, :has-text, #?#, #@#, llaves, backslash…)
         ni dominios de excepción ~dominio.
       · GET /api/v1/api/config/getAdBlockRule ahora incluye elementHideUrl.
   [C] REGRESIÓN — /api/adblock (hosts) y getAdBlockRule intactos.
   ═════════════════════════════════════════════════════════════════════ */

const PORT = Number(process.argv[2] || process.env.PORT || 3001);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); }
}
function section(t) { console.log('\n' + t); }

async function j(path, opts) {
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _parseError: text.slice(0, 120) }; }
}

/* Sintaxis propietaria ABP/uBO que JAMÁS debe llegar a la app (la misma
   lista que sanitiza digestEasyListCosmetics en index.js). */
const RE_FORBIDDEN = /:-abp-|:has-text|:contains\(|:matches-|:matches-path\(|:style\(|:upward\(|:nth-ancestor\(|:remove\(|:xpath\(|:react\(|:if\(|:if-not\(|[\\{}]|#@#|#\?#/;

/* ═══════════════ [B] EN VIVO — /api/adblock/hide ═══════════════ */
async function liveTests() {
  section(`[B] EN VIVO · ocultación de elementos contra ${BASE}`);

  // B1: estado + tipo + cabeceras
  const res = await fetch(BASE + '/api/adblock/hide');
  check('B1 /api/adblock/hide responde 200', res.status === 200, 'status=' + res.status);
  const ct = res.headers.get('content-type') || '';
  check('B1 Content-Type text/plain; charset=utf-8', ct.startsWith('text/plain'), ct);
  const cc = res.headers.get('cache-control') || '';
  check('B1 Cache-Control 24 h', /max-age=86400/.test(cc), cc);
  const cors = res.headers.get('access-control-allow-origin') || '';
  check('B1 CORS abierto (*),', cors === '*', cors);
  const xblocks = Number(res.headers.get('x-blocks') || 0);

  const body = await res.text();
  const lines = body.trim() ? body.trim().split('\n') : [];
  check('B1 cabecera X-Blocks = nº de líneas', xblocks === lines.length,
    `X-Blocks=${xblocks} líneas=${lines.length}`);
  check('B1 respuesta NUNCA vacía (EasyList o fallback)', lines.length >= 20,
    `líneas=${lines.length}${lines.length === 22 ? ' (fallback activo: sandbox sin red o EasyList caída)' : ''}`);

  // B2: TODAS las líneas traen el separador ## (formato EasyList conservado)
  const withSep = lines.filter(l => l.includes('##')).length;
  check('B2 TODAS las líneas contienen "##"', withSep === lines.length,
    `${withSep}/${lines.length}`);
  const generic = lines.filter(l => l.startsWith('##')).length;
  const specific = lines.filter(l => /^[a-z0-9.,-]+##/i.test(l)).length;
  check('B2 hay reglas genéricas (##selector)', generic > 0, 'genéricas=' + generic);
  check('B2 reglas con dominio parseables (dom.com,dom2.net##sel)',
    specific + generic === lines.length, `específicas=${specific}`);

  // B3: sanitización — nada de sintaxis propietaria ABP/uBO
  const bad = lines.filter(l => RE_FORBIDDEN.test(l));
  check('B3 CERO sintaxis propietaria (:-abp-, :has-text, #?#, #@#, {, }, \\)',
    bad.length === 0, bad.slice(0, 3).join(' | '));
  const tooLong = lines.filter(l => l.length > 320); // dominios + ## + ≤200 de selector
  check('B3 ningún selector de >200 chars (+dominios)', tooLong.length === 0);
  const withTilde = lines.filter(l => /~/.test(l.split('##')[0]));
  check('B3 CERO dominios de excepción (~dominio.com)', withTilde.length === 0);

  // B4: deduplicación y límite
  const dupes = lines.length - new Set(lines).size;
  check('B4 sin líneas duplicadas', dupes === 0, 'duplicadas=' + dupes);
  check('B4 respeta el límite ADBLOCK_MAX_HIDE (3000)', lines.length <= 3000,
    'líneas=' + lines.length);

  // B5: selector CSS estándar verificable (los genéricos deben pasar querySelector)
  // — comprobación de forma: comienzan por . # [ a-z * o :
  const shaped = lines.every(l => /^##[.#[*a-zA-Z:]/.test(l) || /^[a-z0-9.,-]+##[.#[*a-zA-Z:]/i.test(l));
  check('B5 todos los selectores tienen forma CSS válida', shaped);

  // B6: caché — segunda petición idéntica (misma lista, misma cabecera)
  const res2 = await fetch(BASE + '/api/adblock/hide');
  const body2 = await res2.text();
  check('B6 segunda llamada idéntica (caché 24 h)', body2 === body,
    `tam1=${body.length} tam2=${body2.length}`);

  // B7: fuente — si EasyList real llegó hay MUCHAS más que el fallback (22)
  const source = lines.length === 22 ? 'fallback' : (lines.length > 100 ? 'easylist' : '¿?');
  console.log(`  ℹ fuente de la lista: ${source} · ${lines.length} selectores · ${(body.length / 1024).toFixed(1)} KB`);
  check('B7 fuente identificable (easylist real o fallback empaquetado)',
    source === 'easylist' || source === 'fallback');

  // B8: getAdBlockRule ahora anuncia la lista de ocultación
  const rule = await j('/api/v1/api/config/getAdBlockRule');
  check('B8 getAdBlockRule ok:true', rule.ok === true);
  check('B8 getAdBlockRule incluye elementHideUrl=/api/adblock/hide',
    rule.elementHideUrl === '/api/adblock/hide', 'elementHideUrl=' + rule.elementHideUrl);
  check('B8 subscription intacta (/api/adblock, versionCode 1)',
    rule.subscription && rule.subscription.url === '/api/adblock' && rule.subscription.versionCode === 1);
  check('B8 domainList (hosts) sigue presente y no vacío',
    Array.isArray(rule.domainList) && rule.domainList.length > 0,
    'hosts=' + (rule.domainList || []).length);
  // el elementHideUrl anunciado DEBE funcionar de verdad
  const hideProbe = await fetch(BASE + (rule.elementHideUrl || '/api/adblock/hide'));
  check('B8 la URL anunciada responde 200', hideProbe.status === 200);
}

/* ═══════════════ [C] REGRESIÓN — nada roto ═══════════════ */
async function regressionTests() {
  section('[C] REGRESIÓN · Fase 3-C (hosts) intacta');
  const res = await fetch(BASE + '/api/adblock');
  const body = await res.text();
  const lines = body.trim() ? body.trim().split('\n') : [];
  check('C1 /api/adblock sigue 200 text/plain', res.status === 200 &&
    (res.headers.get('content-type') || '').startsWith('text/plain'));
  check('C1 sigue sin contener selectores ## (solo hosts)', lines.every(l => !l.includes('##')));
  check('C1 lista de hosts no vacía', lines.length > 0, 'hosts=' + lines.length);

  const v2 = await j('/api/v1/api/config/v2/getAdBlockDomain');
  check('C2 v2/getAdBlockDomain intacto', v2.ok === true && Array.isArray(v2.domainList));

  const ping = await j('/api/ping');
  check('C3 /api/ping ok (servidor vivo)', ping.ok === true);
}

(async () => {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' ARNÉS FASE 6 (v4.0) · Ocultación de elementos (cosméticos)');
  console.log(` Servidor: ${BASE} · ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════════════════');
  try {
    await liveTests();
    await regressionTests();
  } catch (e) {
    console.error('\n[arnés] ERROR FATAL:', e.message);
    console.error('  (¿está el servidor corriendo en el puerto ' + PORT + '?)');
    failed++;
  }
  console.log('\n────────────────────────────────────────────');
  console.log(`RESULTADO FASE 6: ${passed} ✔ · ${failed} ✘`);
  console.log('────────────────────────────────────────────');
  process.exit(failed > 0 ? 1 : 0);
})();
