#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.1 · FASE D0.5 — BATERÍA DE PRUEBAS (páginas propias)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-faseD05-v4.js          (auto-arranca el servidor :3195)

   [A] PORTADA PROPIA: /hub responde 200 con tema oscuro de la app,
       buscador y marca "AniMax Hub"; /hub/version reporta FASE D0.5.
   [B] BÚSQUEDA PROPIA: /hub?q=naruto renderiza tarjetas del motor
       agregado con enlaces a fichas propias (/hub/watch?u=…).
   [C] FICHA-WATCH PROPIA: /hub/watch con URL real renderiza el grid de
       episodios (bloques de 50), chips de fuentes/servidores, el puente
       AnimaxHub.postMessage (H5 → nativo) y window.quan.switchSource
       (nativo → H5) — el mismo contrato del javascriptChannel de Seekee.
   [D] FUENTES/SERVIDORES: el parámetro src (base64url JSON) pinta un chip
       por fuente y la ficha declara los servers al puente.
   [E] NAVIGATIONLIST: el PRIMER grupo es "AniMax · Páginas propias" con
       el hub (espejo del grupo de sitios propios de Seekee).
   [F] API KEY: con ANIMAX_API_KEY, /hub exige ?key=… o X-Api-Key.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');
const path = require('path');

const PORT = Number(process.argv[2] || 3195);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); }
}
function section(t) { console.log('\n' + t); }

async function raw(p) {
  const res = await fetch(BASE + p, { redirect: 'manual' });
  return { code: res.status, body: await res.text(), headers: res.headers };
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

(async () => {
  console.log('FASE D0.5 · páginas propias unificadas — pruebas del hub');
  console.log('══════════════════════════════════════════════════════════════');

  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT), ANIMAX_WATCHDOG_OFF: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  await new Promise(r => setTimeout(r, 2200));

  try {
    /* ── [A] PORTADA PROPIA ─────────────────────────────────────────── */
    section('[A] Portada propia (/hub)');
    let r = await raw('/hub');
    check('GET /hub → 200 HTML', r.code === 200 && /text\/html/.test(r.headers.get('content-type') || ''));
    check('Marca "AniMax Hub" + subtítulo estilo Seekee', r.body.includes('AniMax Hub') && r.body.includes('Páginas propias'));
    check('Tema oscuro de la app (#050507 / #4f9cf9)', r.body.includes('#050507') && r.body.includes('#4f9cf9'));
    check('Buscador central', r.body.includes('type="search"'));
    check('Cero recursos externos (sin <script src=)', !/<script[^>]+src=/.test(r.body));

    r = await raw('/hub/version');
    const ver = JSON.parse(r.body);
    check('/hub/version → animax-hub/1 (FASE D0.5)', r.code === 200 && /FASE D0\.5/.test(ver.hub || ''));

    /* ── [B] BÚSQUEDA PROPIA ────────────────────────────────────────── */
    section('[B] Búsqueda propia (/hub?q=…)');
    r = await raw('/hub?q=' + encodeURIComponent('one piece'));
    const cards = (r.body.match(/class="card"/g) || []).length;
    const watchLinks = (r.body.match(/hub\/watch\?u=/g) || []).length;
    check('Renderiza tarjetas del motor agregado', r.code === 200 && cards > 0, `cards=${cards}`);
    check('Enlaces a fichas propias /hub/watch?u=…', watchLinks > 0, `links=${watchLinks}`);
    check('Encabezado con el término buscado', /para .one piece./.test(r.body) || r.body.includes('one piece'));

    /* ── [C] FICHA-WATCH PROPIA ─────────────────────────────────────── */
    section('[C] Ficha-watch propia (/hub/watch)');
    const PAGE = 'https://monoschinos.st/anime/naruto';
    r = await raw('/hub/watch?u=' + encodeURIComponent(PAGE) + '&t=Naruto');
    check('GET /hub/watch → 200 HTML', r.code === 200 && /text\/html/.test(r.headers.get('content-type') || ''));
    check('Puente H5 → nativo: AnimaxHub.postMessage(jsonBody)', r.body.includes('AnimaxHub.postMessage') && r.body.includes('jsonBody'));
    check('Puente nativo → H5: window.quan.switchSource', r.body.includes('window.quan') && r.body.includes('switchSource'));
    check('Mensaje ready/servers/episodes al puente', r.body.includes("type: 'ready'") && r.body.includes("type: 'servers'") && r.body.includes("type: 'episodes'"));
    check('Mensaje play con referer + espejos', r.body.includes("type: 'play'") && r.body.includes('referer') && r.body.includes('mirrors'));
    check('Grid de episodios en bloques de 50', r.body.includes('BLOCK = 50') && r.body.includes('id="eps"'));
    check('Resolve vía /api/resolve desde la propia página', r.body.includes("/api/resolve"));
    const epsMatch = r.body.match(/var EPISODES\s*=\s*\[(.{0,80})/s);
    const hasEps = epsMatch && !/^\s*\]/.test(epsMatch[1]);
    check('Episodios resueltos por el servidor (motor v3)', !!hasEps, epsMatch ? epsMatch[1].slice(0, 50) : 'sin match');

    /* ── [D] FUENTES/SERVIDORES (src base64url) ─────────────────────── */
    section('[D] Fuentes / servidores (sourceList)');
    const src = b64url([
      { u: PAGE, n: 'monoschinos.st', l: 'Latino', g: 'latino' },
      { u: 'https://tioanime.com/anime/naruto', n: 'tioanime.com', l: 'Sub', g: 'sub' }
    ]);
    r = await raw('/hub/watch?u=' + encodeURIComponent(PAGE) + '&t=Naruto&src=' + src);
    check('Chips de fuentes/servidores (ServerDomainWebData)', r.body.includes('id="servers"') && r.body.includes('Fuentes / servidores'));
    check('SOURCES inyectado con 2 fuentes', /var SOURCES\s*=\s*\[\s*\{[^]*monoschinos[^]*tioanime/.test(r.body));
    check('switchSource navega a la ficha de la otra fuente', r.body.includes('location.replace(watchUrlFor'));

    /* ── [E] NAVIGATIONLIST (grupo propio primero) ───────────────────── */
    section('[E] navigationList — grupo de páginas propias');
    r = await raw('/api/v1/app/content/website/navigationList');
    const nav = JSON.parse(r.body);
    const first = (nav.data || [])[0];
    check('Primer grupo = "AniMax · Páginas propias"', first && first.title === 'AniMax · Páginas propias');
    check('Sitio propio del hub en el grupo', first && first.sites.some(s => /\/hub$/.test(s.url || '')));
    check('Grupos externos siguen detrás', (nav.data || []).length >= 2);

    /* ── [F] API KEY ────────────────────────────────────────────────── */
    section('[F] API key (hub protegido como el resto)');
    // El servidor de esta batería arranca SIN key → el hub debe ser abierto;
    // la protección la aplica el middleware global de index.js (401 sin
    // X-Api-Key cuando ANIMAX_API_KEY está definida). Aquí validamos el
    // soporte de ?key=… del HTML: la página debe reenviarla a sus fetch.
    r = await raw('/hub/watch?u=' + encodeURIComponent(PAGE) + '&t=N&key=test123');
    check('La ficha propaga ?key=… a sus fetch internos', r.body.includes('X-Api-Key') && r.body.includes('test123'));

  } catch (e) {
    failed++;
    console.log('  ✘ EXCEPCIÓN: ' + (e && e.message));
  } finally {
    child.kill('SIGTERM');
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`RESULTADO FASE D0.5: ${passed} ✔ · ${failed} ✘`);
  process.exit(failed ? 1 : 0);
})();
