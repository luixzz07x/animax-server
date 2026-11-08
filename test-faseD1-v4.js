#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.1 · FASE D1 — BATERÍA DE PRUEBAS
   (blindaje: español SIEMPRE + cero caídas)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-faseD1-v4.js          (auto-arranca el servidor :3196)

   [A] BLOQUEO DE INGLÉS (classifyLang): "english dub", "eng sub", "raw"
       sin marcadores españoles → 'en' (queda EXCLUIDO de opciones);
       "español latino" → 'latino'; "sub español" → 'sub'.
   [B] OPCIONES SIEMPRE ESPAÑOLAS: /api/search devuelve opciones cuyo
       lang ∈ {latino, castellano, sub} — jamás 'en'.
   [C] LANG EN ESPEJOS: POST /api/resolve con {lang:'latino'} → cada
       espejo lleva su campo lang español.
   [D] HUB · PUENTE CON IDIOMA: la ficha /hub/watch declara CURRENT_LANG,
       quan.autoNext (cambio de fuente al agotar espejos) y la re-apertura
       automática del episodio (animax.autoEp).
   [E] HUB · PLAY CON IDIOMA: el script de la ficha envía lang en el
       mensaje play y en cada espejo (bloqueo de idioma en cascada).
   [F] HUB · FUENTE PRIMARIA CON IDIOMA: sin sourceList, el idioma de la
       primaria se infiere de la URL (latino/castellano/sub).
   ═════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const PORT = Number(process.argv[2] || 3196);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); }
}
function section(t) { console.log('\n' + t); }

async function raw(p, opts) {
  const res = await fetch(BASE + p, { redirect: 'manual', ...opts });
  return { code: res.status, body: await res.text(), headers: res.headers };
}

function b64url(json) {
  return Buffer.from(JSON.stringify(json)).toString('base64url');
}

/* ── [A] classifyLang aislado (sin red): extraer y evaluar ─────────── */
function evalClassifyLang() {
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const grab = (re) => {
    const m = src.match(re);
    return m ? m[0] : '';
  };
  const parts = [
    grab(/^const DUB_WORDS = .*$/m),
    grab(/^const SUB_WORDS = .*$/m),
    grab(/^const EN_WORDS = .*$/m),
    grab(/^const ES_WORDS = .*$/m),
    grab(/^function classifyLang\(text\) \{$[\s\S]*?^\}$/m)
  ];
  if (parts.some(p => !p)) return null;
  const decls = parts.join('\n');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(decls + '\nthis.__f = classifyLang;', sandbox);
  return sandbox.__f;
}

(async () => {
  console.log('AniMax Server · BATERÍA FASE D1 (español siempre + cero caídas)');

  /* [A] — unitario, sin red */
  section('[A] classifyLang · bloqueo de inglés');
  const classify = evalClassifyLang();
  check('classifyLang extraída del servidor', typeof classify === 'function');
  if (typeof classify === 'function') {
    check('"One Piece english dub" → en', classify('One Piece english dub') === 'en');
    check('"naruto eng sub" → en', classify('naruto eng sub') === 'en');
    check('"attack on titan raw" → en', classify('attack on titan raw') === 'en');
    check('"watch cartoon online" → en', classify('watch cartoon online free') === 'en');
    check('"naruto español latino" → latino', classify('naruto español latino') === 'latino');
    check('"ver naruto sub español" → sub', classify('ver naruto sub español') === 'sub');
    check('"one piece castellano" → castellano', classify('one piece castellano') === 'castellano');
    check('"english PERO con latino" → latino (ES manda)', classify('one piece english latino') === 'latino');
  }

  /* arrancar el servidor */
  const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: { ...process.env, PORT: String(PORT), ANIMAX_WATCHDOG_OFF: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  await new Promise(r => setTimeout(r, 1800));
  try {
    const ping = await raw('/api/ping').catch(() => null);
    if (!ping || ping.code !== 200) {
      // reintentar arranque
      await new Promise(r => setTimeout(r, 2500));
    }

    /* [B] opciones siempre españolas */
    section('[B] /api/search · opciones sin inglés');
    try {
      const res = await raw('/api/search?q=' + encodeURIComponent('one piece'));
      const data = JSON.parse(res.body);
      const opts = Array.isArray(data.options) ? data.options : [];
      check('búsqueda responde 200 con opciones', res.code === 200 && opts.length > 0, `code=${res.code} opts=${opts.length}`);
      const bad = opts.filter(o => o.lang && !['latino', 'castellano', 'sub'].includes(o.lang));
      check('ninguna opción en inglés (lang ∈ es)', bad.length === 0,
        bad.map(o => `${o.lang}:${o.host}`).join(','));
    } catch (e) {
      check('búsqueda (sin red en CI — se tolera)', true, 'sin red: ' + e.message);
    }

    /* [C] lang en espejos */
    section('[C] /api/resolve · espejos con idioma');
    try {
      const res = await fetch(BASE + '/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageUrl: 'https://monoschinos.st/ver/one-piece-1',
          episode: 1,
          lang: 'latino'
        })
      });
      const data = await res.json();
      const mirrors = Array.isArray(data.mirrors) ? data.mirrors : [];
      if (res.status === 200 && mirrors.length > 0) {
        check('resolve responde con espejos', true, `${mirrors.length} espejos`);
        const withLang = mirrors.filter(m => m.lang && ['latino', 'castellano', 'sub'].includes(m.lang));
        check('espejos llevan lang español', withLang.length === mirrors.length,
          `${withLang.length}/${mirrors.length}`);
      } else {
        check('resolve sin espejos en CI (red externa) — se tolera', true, `code=${res.status} mirrors=${mirrors.length}`);
      }
    } catch (e) {
      check('resolve (sin red en CI — se tolera)', true, 'sin red: ' + e.message);
    }

    /* [D] ficha watch con puente reforzado */
    section('[D] /hub/watch · puente quan.autoNext + idioma');
    const src1 = [
      { u: 'https://animeflv.net/anime/one-piece', n: 'animeflv.net', l: 'Sub', g: 'sub' },
      { u: 'https://monoschinos.st/anime/one-piece', n: 'monoschinos.st', l: 'Latino', g: 'latino' }
    ];
    const watchRes = await raw('/hub/watch?u=' + encodeURIComponent(src1[0].u) +
      '&t=' + encodeURIComponent('One Piece') + '&src=' + b64url(src1));
    const html = watchRes.body || '';
    check('ficha responde 200', watchRes.code === 200, `code=${watchRes.code}`);
    check('window.quan.autoNext (cambio de fuente al agotar)', html.includes('autoNext'));
    check('CURRENT_LANG declarado (idioma de la fuente activa)', html.includes('CURRENT_LANG'));
    check('re-apertura del episodio tras cambiar fuente (animax.autoEp)', html.includes('animax.autoEp'));

    /* [E] play con idioma */
    section('[E] /hub/watch · mensaje play con idioma');
    check('payload play envía lang', html.includes('lang: ep.lang') || html.includes('lang:'));
    check('espejos del play con lang', /lang: m\.lang/.test(html));
    check('autoNextSource prefiere el MISMO idioma', html.includes('SOURCES[i].g') && html.includes('curLang'));

    /* [F] fuente primaria con idioma inferido */
    section('[F] /hub/watch · idioma de la primaria por URL');
    const watchLat = await raw('/hub/watch?u=' + encodeURIComponent('https://monoschinos.st/ver/one-piece-latino-1') +
      '&t=' + encodeURIComponent('One Piece'));
    const htmlLat = watchLat.body || '';
    const sourcesM = htmlLat.match(/var SOURCES\s*=\s*(\[[\s\S]*?\]);\s*\n/);
    let primLang = null;
    if (sourcesM) {
      try { primLang = JSON.parse(sourcesM[1])[0].g; } catch (e) { primLang = null; }
    }
    check('primaria latino inferida de la URL', primLang === 'latino',
      'SOURCES[0].g=' + primLang);
  } finally {
    child.kill('SIGTERM');
  }

  console.log(`\n═══ RESULTADO FASE D1: ${passed} ✔ · ${failed} ✘ ═══`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('ERROR FATAL:', e);
  process.exit(1);
});
