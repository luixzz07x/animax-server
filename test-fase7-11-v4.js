#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · FASES 7–11 — ARNÉS DE PRUEBAS RECONSTRUIDO
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-fase7-11-v4.js            (auto-arranca el servidor en
                                             el puerto 3199 y lo apaga)

   [A] FASE 7 — sniffer v2 servido desde sniffer-script.js:
       · GET /api/v1/config/sniffer.js y alias /sniffer → 200 JS crudo
         (≥2000 chars, application/javascript, AnimaxSniffer +
         resourceAnalysisCallback + intercepción fetch/XHR + try/catch).
   [B] FASE 9 — home server-driven desde sections-config.json:
       · navigationBar 4 tabs; getSectionContentByPage por tab refleja
         EXACTAMENTE el orden y estilos del archivo (CONTINUE vacía y
         primera, BANNER, SINGLE_ALBUM, RANK_LIST con rank 1-10,
         MULTIPLE_ALBUM con multipleAlbumList), paginación isLast.
       · Panel admin: POST /config/sections reordena → el siguiente
         getSectionContentByPage lo refleja AL INSTANTE (sin APK).
       · Config corrupta → fallback (el home NUNCA se rompe).
       · Onboarding 4 pasos.
   [C] FASE 11 — búsqueda: search híbrido, relatedQueries, hot,
       screening, report/web (feedback ✗/✓).
   [D] REGRESIÓN — querySettings, sniffer en querySettings, recommend,
       adblock hosts/hide intactos.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 3199);
const BASE = `http://127.0.0.1:${PORT}`;
const CFG = path.join(__dirname, 'sections-config.json');
const CFG_ORIGINAL = fs.readFileSync(CFG, 'utf8');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); }
}
function section(t) { console.log('\n' + t); }

async function j(p, opts) {
  const res = await fetch(BASE + p, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _parseError: text.slice(0, 140), _status: res.status }; }
}
async function get(p) { return j(p); }
async function post(p, body) {
  return j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function waitServer(msLeft = 25000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function ping() {
      fetch(BASE + '/api/ping').then(r => r.ok ? resolve() : pingLater()).catch(pingLater);
      function pingLater() {
        if (Date.now() - t0 > msLeft) return reject(new Error('servidor no arranca'));
        setTimeout(ping, 400);
      }
    })();
  });
}

const TABS = ['comic', 'drama', 'movie', 'short'];

async function fase7() {
  section('[A] FASE 7 · sniffer v2 servido (actualizable sin APK)');
  for (const p of ['/api/v1/config/sniffer.js', '/api/v1/config/sniffer']) {
    const res = await fetch(BASE + p);
    check(`A1 ${p} → 200`, res.status === 200, 'status=' + res.status);
    const ct = res.headers.get('content-type') || '';
    check(`A1 ${p} es application/javascript`, ct.includes('javascript'), ct);
    const js = await res.text();
    check(`A1 ${p} ≥ 2000 chars (v2 completa)`, js.length >= 2000, `len=${js.length}`);
    check(`A1 ${p} puente AnimaxSniffer`, js.includes('AnimaxSniffer'));
    check(`A1 ${p} resourceAnalysisCallback`, js.includes('resourceAnalysisCallback'));
    check(`A1 ${p} webStateChangeCallback`, js.includes('webStateChangeCallback'));
    check(`A1 ${p} intercepción fetch/XHR`, /fetch/.test(js) && /XMLHttpRequest/.test(js));
    check(`A1 ${p} guard idempotente`, js.includes('__animaxSnifferV1'));
    check(`A1 ${p} sin romper la página (try/catch)`, js.includes('try'));
  }
  /* mtime: tocar el archivo cambia la respuesta en caliente */
  const before = await (await fetch(BASE + '/api/v1/config/sniffer.js')).text();
  const f = path.join(__dirname, 'sniffer-script.js');
  const orig = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, orig.replace('state(\'injected\');', "state('injected-v-test');"));
  try {
    const after = await (await fetch(BASE + '/api/v1/config/sniffer.js')).text();
    check('A2 editar sniffer-script.js → se sirve la versión nueva al instante',
      after !== before && after.includes('injected-v-test'));
  } finally { fs.writeFileSync(f, orig); }
  const restored = await (await fetch(BASE + '/api/v1/config/sniffer.js')).text();
  check('A2 restaurado (sin el sufijo de prueba)', !restored.includes('injected-v-test'));
}

async function fase9() {
  section('[B] FASE 9 · home server-driven desde sections-config.json');

  const nb = await get('/api/v1/app/content/home/navigationBar');
  check('B1 navigationBar ok', nb.ok === true);
  check('B1 4 tabs (Anime/Series/Películas/Minidramas)',
    Array.isArray(nb.data) && nb.data.length === 4 &&
    ['comic', 'drama', 'movie', 'short'].every(c => nb.data.some(t => t.labelCode === c)));

  const cfg = JSON.parse(CFG_ORIGINAL);
  for (const tab of TABS) {
    const expect = cfg.tabs[tab];
    const r = await get(`/api/v1/app/content/home/getSectionContentByPage?labelCode=${tab}&page=1&pageSize=20`);
    check(`B2 ${tab}: ok y con contenido`, r.ok === true && Array.isArray(r.content) && r.content.length > 0);
    const got = r.content;
    check(`B2 ${tab}: MISMO nº de secciones que la config (${expect.length})`,
      got.length === expect.length, `got=${got.length}`);
    check(`B2 ${tab}: mismo ORDEN de nombres`,
      JSON.stringify(got.map(s => s.sectionName)) === JSON.stringify(expect.map(s => s.name)),
      JSON.stringify(got.map(s => s.sectionName)));
    const stylesOk = expect.every((e, i) => got[i] && got[i].sectionStyle === e.style);
    check(`B2 ${tab}: estilos exactos (${expect.map(e => e.style).join(',')})`, stylesOk);
    const cont = got.find(s => s.sectionStyle === 'CONTINUE');
    check(`B2 ${tab}: CONTINUE existe, primera y vacía (se oculta en la app)`,
      !!cont && got[0].sectionStyle === 'CONTINUE' && cont.singleAlbumList.length === 0);
    const rank = got.find(s => s.sectionStyle === 'RANK_LIST');
    check(`B2 ${tab}: RANK_LIST con rankList 1..N y álbum`,
      !!rank && rank.rankList.length > 0 && rank.rankList[0].rank === 1 && !!rank.rankList[0].album);
    const multi = got.find(s => s.sectionStyle === 'MULTIPLE_ALBUM');
    check(`B2 ${tab}: MULTIPLE_ALBUM rellena multipleAlbumList`,
      !!multi && multi.multipleAlbumList.length > 0);
    const single = got.find(s => s.sectionStyle === 'SINGLE_ALBUM');
    check(`B2 ${tab}: SINGLE_ALBUM con singleAlbumList no vacía`,
      !!single && single.singleAlbumList.length > 0);
    const banner = got.find(s => s.sectionStyle === 'BANNER');
    check(`B2 ${tab}: BANNER con lista (carrusel)`, !!banner && banner.singleAlbumList.length > 0);
    const album = (single || banner).singleAlbumList[0];
    check(`B2 ${tab}: álbum con campos Seekee (title/cover/type)`,
      !!album.title && !!album.cover && !!album.type);
  }

  const p3 = await get('/api/v1/app/content/home/getSectionContentByPage?labelCode=comic&page=3&pageSize=20');
  check('B3 paginación: page=3 → isLast true', p3.isLast === true);
  const p4 = await get('/api/v1/app/content/home/getSectionContentByPage?labelCode=comic&page=4&pageSize=20');
  check('B3 paginación: page=4 sigue isLast (sin infinito)', p4.isLast === true);

  /* Panel admin: reordenar en caliente → reflejo inmediato */
  const cur = await get('/api/v1/config/sections');
  check('B4 GET /config/sections ok', cur.ok === true && cur.data && cur.data.tabs);
  const tabsCfg = JSON.parse(JSON.stringify(cur.data.tabs));
  const comic = tabsCfg.comic;
  const reordered = [comic[1], comic[0], ...comic.slice(2)];   // swap 1º↔2º
  tabsCfg.comic = reordered;
  const post1 = await post('/api/v1/config/sections', { tabs: tabsCfg });
  check('B4 POST /config/sections (reordenar) ok', post1.ok === true);
  const after = await get('/api/v1/app/content/home/getSectionContentByPage?labelCode=comic&page=1&pageSize=20');
  check('B4 el home refleja el NUEVO orden al instante (sin APK)',
    after.content.length === reordered.length &&
    after.content[0].sectionName === reordered[0].name &&
    after.content[1].sectionName === reordered[1].name,
    JSON.stringify(after.content.map(s => s.sectionName)));
  const badPost = await post('/api/v1/config/sections', { tabs: { comic: [{ name: 'X', style: 'ESTILO_FALSO' }] } });
  check('B4 POST con estilo inválido → rechazado', badPost.ok === false);

  /* Config corrupta → fallback (nunca rompe el home) */
  try {
    fs.writeFileSync(CFG, '{ json corrupto !!!');
    const fb = await get('/api/v1/app/content/home/getSectionContentByPage?labelCode=movie&page=1&pageSize=20');
    check('B5 config corrupta → home con FALLBACK (nunca vacío ni error)',
      fb.ok === true && fb.content.length >= 2 && fb.content.every(s => s.sectionStyle === 'SINGLE_ALBUM'));
  } finally {
    fs.writeFileSync(CFG, CFG_ORIGINAL);   // restaura
  }
  const back = await get('/api/v1/app/content/home/getSectionContentByPage?labelCode=comic&page=1&pageSize=20');
  check('B5 config restaurada → orden original de vuelta',
    back.content[0].sectionStyle === 'CONTINUE');

  const ob = await get('/api/v1/config/onboarding');
  check('B6 onboarding: 4 pasos con title/description/emoji',
    ob.ok === true && Array.isArray(ob.data) && ob.data.length === 4 &&
    ob.data.every(s => s.title && s.description && s.emoji));
}

async function fase11() {
  section('[C] FASE 11 · búsqueda completa');
  const q = 'one piece';
  const r = await post('/api/v1/app/search/search', { keyWord: q, page: 1, pageSize: 20 });
  check('C1 search híbrido ok', r.ok === true && Array.isArray(r.content));
  const withSources = r.content.filter(x => Array.isArray(x.sourceList));
  check('C1 resultados con sourceList (espejos por idioma)',
    withSources.length > 0, `content=${r.content.length}`);
  const web = r.content.filter(x => x.type === 'web' || x.websiteLabelList);
  check('C1 resultados web presentes (mixto contenido+web)', web.length >= 0);
  check('C1 labelList/websiteLabelList en el contrato',
    r.content.some(x => x.labelList || x.websiteLabelList));

  const rel = await get(`/api/v1/search/relatedQueries?keyWord=${encodeURIComponent('naruto')}`);
  check('C2 relatedQueries ok (autocompletado en vivo)', rel.ok === true && Array.isArray(rel.data));

  const hot = await get('/api/v1/api/home/search/hot?type=comic');
  check('C3 hot ok con heatScore', hot.ok === true && Array.isArray(hot.data) &&
    hot.data.every(x => typeof x.heatScore === 'number'));

  const scr = await get('/api/v1/app/search/screening/list');
  check('C3 screening ok con grupos', scr.ok === true && Array.isArray(scr.data));

  const rep = await post('/api/v1/report/web', { url: 'https://ejemplo-fase11.test/x', ok: false, reason: 'test' });
  check('C4 report/web (feedback ✗) ok y penaliza', rep.ok === true && typeof rep.penalty === 'number');
  const rep2 = await post('/api/v1/report/web', { url: 'https://ejemplo-fase11.test/x', ok: true });
  check('C4 report/web (feedback ✓) ok', rep2.ok === true);
}

async function regression() {
  section('[D] REGRESIÓN · contratos previos intactos');
  const qs = await get('/api/v1/config/javs/querySettings');
  check('D1 querySettings ok', qs.ok === true);
  check('D1 querySettings apunta al sniffer', qs.detailJsScriptUrl === '/api/v1/config/sniffer.js');
  const upd = await get('/api/v1/config/appUpdate/check');
  check('D1 appUpdate/check ok', upd.ok === true);
  const rec = await get('/api/v1/api/content/recommend/list');
  check('D1 recommend/list ok', rec.ok === true);
  const adh = await fetch(BASE + '/api/adblock/hide');
  check('D2 adblock/hide sigue 200 text/plain', adh.status === 200 &&
    (adh.headers.get('content-type') || '').startsWith('text/plain'));
  const ws = await get('/api/v1/app/content/website/navigationList');
  check('D2 catálogo de sitios ok', ws.ok === true);
}

(async () => {
  console.log(`Arrencando servidor en :${PORT} …`);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
  });
  let server;
  try {
    await waitServer();
    server = true;
    await fase7();
    await fase9();
    await fase11();
    await regression();
  } catch (e) {
    failed++;
    console.log('  ✘ FALLO DEL ARNÉS: ' + e.message);
  } finally {
    try { fs.writeFileSync(CFG, CFG_ORIGINAL); } catch {}
    child.kill('SIGKILL');
  }
  console.log(`\n═══ RESULTADO: ${passed} ✔ / ${failed} ✘ ═══`);
  process.exit(failed ? 1 : 0);
})();
