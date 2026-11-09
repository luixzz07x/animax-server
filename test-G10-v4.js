#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v6.0 · FASE G10 — QA REAL (One Piece extremo a extremo)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-G10-v4.js          (auto-arranca el servidor :3201)
         node test-G10-v4.js 3001     (contra un servidor ya arrancado)

   [A] BÚSQUEDA REAL "one piece": tarjetas filmCenter + web con
       agregación por título (sourceList).
   [B] FICHA REAL — CAPÍTULOS: getSingleAlbumDetail → One Piece con
       eps ≥ 1.100 (fix G10: nextAiringEpisode−1; AniList da null en
       emisión. Hoy: 1.180. Al planificar G: 1.122.)
   [C] EPISODIOS REALES: episode/list para ep 1 · 570 · 1.122 (sub) y
       ep 1 latino — contrato bien formado en TODOS (engine-v3 toma el
       relevo con allanime tras Cloudflare, como documentó G2G3).
   [D] RESOLVE: proveedor inexistente → ok:false LIMPIO (sin crash);
       la app degrada a la siguiente fuente (contrato v4.0).
   [E] RANKING + HOME: hot con heatScore, home con rankList.viewCount
       (G8) y secciones por tab.
   [F] QA DEL REPO (estática): docs G0→G9, versiones coherentes
       (v7.0 FASE H7: bump 6.0.0 → 7.0.0 aceptado — cierre PLAN H)
       (gradle/strings/perfil), G9 en app (ai/config + effCfg), assets
       (ad_hosts ≥ 11.000, onboarding g1..g4), fix G10 en index.js.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXTERNAL_PORT = Number(process.argv[2] || 0);
const PORT = EXTERNAL_PORT || 3201;
const BASE = 'http://localhost:' + PORT;

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'app', 'src', 'main');
const SRV = __dirname;

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

async function getJson(urlPath, opts) {
  const res = await fetch(BASE + urlPath, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text.slice(0, 200), _status: res.status }; }
}

function postJson(urlPath, body) {
  return getJson(urlPath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/* QA estática del repo (sin red): el archivo existe y NO está vacío. */
function fileHas(rel, needles) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return false;
  if (!needles || !needles.length) return true;
  const s = fs.readFileSync(p, 'utf8');
  return needles.every(n => s.includes(n));
}

async function main() {
  let child = null;
  if (!EXTERNAL_PORT) {
    console.log('[test] arrancando servidor en :' + PORT + '…');
    child = spawn('node', [path.join(SRV, 'index.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'ignore'
    });
    await new Promise(r => setTimeout(r, 2500));
  }

  try {
    /* ── [A] BÚSQUEDA REAL ─────────────────────────────────────────── */
    console.log('\n[A] búsqueda real «one piece»');
    const s = await getJson('/api/v1/app/search/search?keyWord=' + encodeURIComponent('one piece'));
    check('search ok', s.ok === true);
    const catalogCards = (s.content || []).filter(c => c && c.title);
    const webCards = (s.list || []);
    check('con tarjetas de catálogo o web', catalogCards.length > 0 || webCards.length > 0,
      'catalog=' + catalogCards.length + ' web=' + webCards.length);
    const allTitles = catalogCards.map(c => String(c.title)).concat(webCards.map(c => String(c.title || c.name || '')));
    check('One Piece presente en resultados',
      allTitles.some(t => /one\s*piece/i.test(t.replace(/[^\w\s]/g, ' '))),
      'titles: ' + allTitles.slice(0, 4).join(' | '));
    if (webCards.length) {
      check('web cards con sourceList (agregación Fase 3)',
        webCards.every(c => c.sourceList === undefined || Array.isArray(c.sourceList)));
    }

    /* ── [B] FICHA REAL — CAPÍTULOS (fix G10) ──────────────────────── */
    console.log('\n[B] ficha real — capítulos de One Piece');
    const det = await getJson('/api/v1/app/content/home/getSingleAlbumDetail?titles=' +
      encodeURIComponent('One Piece') + '&type=comic');
    check('detail ok', det.ok === true && Array.isArray(det.data) && det.data.length > 0);
    const op = (det.data || []).find(d => /one\s*piece/i.test(String(d.title || '')));
    check('ficha de One Piece encontrada', !!op, JSON.stringify((det.data || [{}])[0].title || null));
    if (op) {
      check('eps ≥ 1.100 (QA One Piece; al planificar G: 1.122 — hoy sube solo)',
        Number(op.eps) >= 1100, 'got eps=' + op.eps);
      check('ficha completa (cover+info+rating)', !!(op.cover && op.info && op.rating !== undefined));
    }

    /* ── [C] EPISODIOS REALES (1 · 570 · 1.122 · latino) ───────────── */
    console.log('\n[C] episode/list real — eps 1, 570 y 1.122');
    const epsToTest = [1, 570, 1122];
    let wellFormed = 0;
    for (const ep of epsToTest) {
      const r = await postJson('/api/v1/app/episode/list', { q: 'one piece', episode: ep, lang: 'sub' });
      const formOk = (r.ok === true || r.ok === false) && Array.isArray(r.sources) &&
        (r.engine === 'providers' || r.engine === 'engine-v3');
      if (formOk) wellFormed++;
      check('ep ' + ep + ' (sub): contrato bien formado', formOk,
        JSON.stringify({ ok: r.ok, engine: r.engine, n: (r.sources || []).length }).slice(0, 120));
      if ((r.sources || []).length) {
        check('ep ' + ep + ': fuentes con contrato completo', r.sources.every(x =>
          x.url && x.provider && ['embed', 'hls', 'mp4'].includes(x.type) && x.lang));
      }
    }
    const lat = await postJson('/api/v1/app/episode/list', { q: 'one piece', episode: 1, lang: 'latino' });
    check('ep 1 (latino): contrato bien formado',
      (lat.ok === true || lat.ok === false) && Array.isArray(lat.sources) && !!lat.engine);
    check('3/3 episodios sin crash (1.122 incluido)', wellFormed === epsToTest.length);

    /* ── [D] RESOLVE — DEGRADACIÓN LIMPIA ──────────────────────────── */
    console.log('\n[D] resolve — proveedor inexistente degrada limpio');
    const res = await postJson('/api/v1/app/episode/resolve',
      { provider: 'no-existe-qa', showId: 'x', episode: 1, lang: 'sub' });
    check('resolve sin crash (ok true|false explícito)', res.ok === true || res.ok === false);

    /* ── [E] RANKING + HOME (G8) ───────────────────────────────────── */
    console.log('\n[E] hot + home sections');
    const hot = await getJson('/api/v1/api/home/search/hot?type=comic');
    check('hot ok con heatScore', hot.ok === true && (hot.data || []).every(h => h.heatScore > 0));
    const home = await getJson('/api/v1/app/content/home/getSectionContentByPage?labelCode=comic&page=1');
    check('home ok', home.ok === true && Array.isArray(home.content) && home.content.length > 0);
    // Contrato real (Fase 9 + G8): content[] de secciones; la sección
    // RANK_LIST lleva rankList[] con {rank, album, viewCount}.
    const rankSec = (home.content || []).find(s => s.sectionStyle === 'RANK_LIST');
    check('sección RANK_LIST presente (config home)', !!rankSec,
      'styles: ' + (home.content || []).map(s => s.sectionStyle).join(','));
    check('rankList con viewCount (G8)', !!rankSec &&
      Array.isArray(rankSec.rankList) && rankSec.rankList.length > 0 &&
      rankSec.rankList.every(r => r.rank > 0 && r.album && typeof r.viewCount === 'number' &&
        r.viewCount > 0 && r.viewCount >= 95000 - 10 * 2400));
    const conItems = (home.content || []).filter(s =>
      (s.singleAlbumList || []).length + (s.multipleAlbumList || []).length > 0);
    check('secciones con contenido', conItems.length >= 2,
      'con-items=' + conItems.length + '/' + (home.content || []).length);

    /* ── [F] QA DEL REPO (estática) ────────────────────────────────── */
    console.log('\n[F] repo — entregables del PLAN G');
    const camb = ['G0-G1', 'G2b', 'G2G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'];
    check('CAMBIOS 6.0.0 G0→G9 completos', camb.every(g =>
      fs.existsSync(path.join(ROOT, 'docs', 'CAMBIOS-6.0.0-' + g + '.md'))));
    const foren = ['G1', 'G2G3', 'G7', 'G8', 'G9'];
    check('FORENSE G1→G9 completos', foren.every(g =>
      fs.existsSync(path.join(ROOT, 'docs', 'FORENSE-' + g + '.md'))));
    /* v7.0 (H7): la app cerró el PLAN H → versión 7.0.0 (bump aditivo;
       6.0.0 sigue siendo válido si se restaura el árbol G). */
    const gradle = fs.readFileSync(path.join(ROOT, 'app/build.gradle.kts'), 'utf8');
    check('versionName 6.0.0 o 7.0.0 (gradle)',
      /versionName = "(6\.0\.0|7\.0\.0)"/.test(gradle) && /versionCode = (60000|70000)/.test(gradle),
      gradle.match(/versionName = "[^"]+"/g));
    check('strings.xml Versión 6.0.0 o 7.0.0',
      /Versión (6\.0\.0|7\.0\.0)/.test(fs.readFileSync(path.join(ROOT, 'app/src/main/res/values/strings.xml'), 'utf8')));
    check('perfil «Seekee Edition»',
      /AniMax (6\.0\.0|7\.0\.0) «Seekee Edition»/.test(
        fs.readFileSync(path.join(ROOT, 'app/src/main/java/com/animax/app/ui/profile/ProfileScreen.kt'), 'utf8')));
    check('chip SEEKEE EDITION en Home (G8)', fileHas('app/src/main/java/com/animax/app/ui/home/HomeScreen.kt',
      ['SEEKEE EDITION']));
    check('G9 en app: config() + guía del server', fileHas('app/src/main/java/com/animax/app/data/ai/AiChatApi.kt',
      ['/api/v1/ai/config', 'EMBEDDED_CONFIG']) &&
      fileHas('app/src/main/java/com/animax/app/ui/ai/ChatScreen.kt', ['effCfg.welcomeText', 'onQuickPrompt']));
    check('ad_hosts embebido ≥ 11.000 líneas', (() => {
      const p = path.join(APP, 'assets', 'ad_hosts');
      if (!fs.existsSync(p)) return false;
      return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).length >= 11000;
    })());
    check('onboarding g1..g4 embebidos (G8)', ['g1', 'g2', 'g3', 'g4'].every(g =>
      fs.existsSync(path.join(APP, 'assets', 'onboarding', g + '.png'))));
    check('server: endpoints G-fases presentes', fileHas('server/animax-server/v4-api.js',
      ['/api/v1/ai/config', 'viewCount', 'getGuideImgList', 'sports/fixtures', 'sync/history']));
    check('server: fix G10 nextAiringEpisode', fileHas('server/animax-server/index.js',
      ['nextAiringEpisode', 'QA One Piece']));
    check('tests de fase presentes (G9, G2G3)', fs.existsSync(path.join(SRV, 'test-G9-v4.js')) &&
      fs.existsSync(path.join(SRV, 'test-G2G3-v4.js')));

    /* ── RESUMEN ───────────────────────────────────────────────────── */
    console.log('\n════════════════════════════════════════');
    console.log('  G10 · ' + passed + ' pasan · ' + failed + ' fallan');
    if (failed) { console.log('  Fallas: ' + failures.join(' · ')); process.exitCode = 1; }
  } finally {
    if (child) child.kill();
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
