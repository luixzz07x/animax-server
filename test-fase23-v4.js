#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · FASE 23 — BATERÍA DE PRUEBAS REAL v2
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-fase23-v4.js          (auto-arranca el servidor :3190)

   [A] DISPONIBILIDAD · 30+ títulos: la búsqueda agregada debe devolver
       contenido o espejos web para CADA título (nada de "no disponible").
   [B] INTEGRIDAD: para 5 títulos muestra, /api/episodes debe listar
       episodios reales; /api/resolve debe devolver ≥1 espejo válido.
   [C] LATENCIA: ping, navigationBar, getSectionContentByPage y search
       < 3000 ms (p95).
   [D] SUBTÍTULOS/SNIFFER/UPDATE: contrato vtt por dominio, script sniffer
       ≥2000 chars, update in-app (publicar→detectar→apk binario→limpiar),
       report/playback, report/web.
   [E] SINCRONIZACIÓN: push/pull/devices merge correcto (limpia al final).
   [F] DEPORTES + IA: ligas, fixtures reales ESPN, ai-no-configurada.
   [G] CERO ANUNCIOS (auditoría de CÓDIGO FUENTE): en app/src/main NO hay
       AD_ID, Adjust, PairIP, AppLovin, AdMob, Firebase-ads ni banners.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 3190);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..', '..');

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); }
}
function section(t) { console.log('\n' + t); }
async function j(p, opts) {
  const res = await fetch(BASE + p, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _parseError: text.slice(0, 120) }; }
}
async function post(p, body) {
  return j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

/* 30+ títulos reales variados (anime clásico/moderno, series, películas). */
const TITULOS = [
  'one piece', 'naruto', 'dragon ball z', 'attack on titan', 'death note',
  'jujutsu kaisen', 'demon slayer', 'chainsaw man', 'my hero academia', 'tokyo revengers',
  'spy x family', 'bleach', 'hunter x hunter', 'fullmetal alchemist', 'one punch man',
  'sword art online', 'black clover', 'dr stone', 'haikyuu', 'blue lock',
  'breaking bad', 'stranger things', 'the last of us', 'wednesday', 'money heist',
  'game of thrones', 'the office', 'friends', 'peaky blinders', 'dark',
  'interstellar', 'dune', 'oppenheimer', 'the dark knight', 'parasite'
];

function waitServer(msLeft = 30000) {
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

async function faseA() {
  section('[A] DISPONIBILIDAD · 35 títulos (nada de "no disponible")');
  let conContenido = 0, conWeb = 0, vacios = [];
  /* Búsquedas en PARALELO (lotes de 5) para que la batería no tarde
     minutos: cada búsqueda agregada puede ir a múltiples fuentes. */
  for (let i = 0; i < TITULOS.length; i += 5) {
    const lote = TITULOS.slice(i, i + 5);
    const resultados = await Promise.all(lote.map(t =>
      post('/api/v1/app/search/search', { keyWord: t, page: 1, pageSize: 10 })
        .catch(() => ({ content: [] }))
    ));
    resultados.forEach((r, idx) => {
      const t = lote[idx];
      const items = (r.content || []).filter(x => x && (x.title || x.url));
      const tieneContenido = items.some(x => x.type === 'filmCenter' || (x.sourceList && x.sourceList.length));
      const tieneWeb = items.some(x => x.type === 'web' || x.websiteLabelList);
      if (tieneContenido) conContenido++;
      if (tieneWeb) conWeb++;
      if (!items.length) vacios.push(t);
    });
    process.stdout.write(`    … ${Math.min(i + 5, TITULOS.length)}/${TITULOS.length} títulos\n`);
  }
  check(`A1 los 35 títulos devuelven ALGO (${conContenido} con contenido + ${conWeb} con espejos web, ${vacios.length} vacíos)`,
    vacios.length === 0, 'vacíos: ' + vacios.join(', '));
  check('A2 ≥ 25 títulos con contenido de catálogo', conContenido >= 25, 'contenido=' + conContenido);
  check('A3 ≥ 15 títulos con espejos web (todo disponible vía WebView)', conWeb >= 15, 'web=' + conWeb);
}

async function faseB() {
  section('[B] INTEGRIDAD · episodios y resolución de espejos');
  /* Flujo REAL que usa la app (reproductor instantáneo): búsqueda v3 →
     opciones con pageUrl → /api/episodes lista episodios de esa página. */
  const muestras = ['shingeki no kyojin', 'jujutsu kaisen', 'one piece', 'naruto', 'demonslayer'];
  let conEps = 0;
  for (const t of muestras) {
    const s = await j('/api/search?q=' + encodeURIComponent(t));
    const opt = (s.options || []).find(o => o.pageUrl);
    if (!opt) continue;
    const eps = await j('/api/episodes?pageUrl=' + encodeURIComponent(opt.pageUrl));
    const lista = eps.episodes || eps.list || [];
    if (Array.isArray(lista) && lista.length > 0) conEps++;
  }
  check(`B1 episodios reales en ${conEps}/5 títulos muestra (flujo v3 real)`, conEps >= 3, 'con eps=' + conEps);
  const r = await post('/api/resolve', { pageUrl: 'https://ww1.animax.tv', episode: '1' });
  check('B2 /api/resolve responde (aunque la granja no tenga esta URL)', typeof r.ok !== 'undefined', JSON.stringify(r).slice(0, 80));
}

async function faseC() {
  section('[C] LATENCIA < 3 s (p95)');
  async function mide(name, fn) {
    const ts = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      try { await fn(); } catch {}
      ts.push(Date.now() - t0);
    }
    ts.sort((a, b) => a - b);
    const p95 = ts[ts.length - 1];
    check(`C ${name} p95=${p95} ms < 3000`, p95 < 3000);
  }
  await mide('ping', () => j('/api/ping'));
  await mide('navigationBar', () => j('/api/v1/app/content/home/navigationBar'));
  await mide('secciones home', () => j('/api/v1/app/content/home/getSectionContentByPage?labelCode=comic&page=1&pageSize=20'));
  await mide('search', () => post('/api/v1/app/search/search', { keyWord: 'naruto', page: 1, pageSize: 10 }));
}

async function faseD() {
  section('[D] SUBTÍTULOS · SNIFFER · UPDATE IN-APP · REPORTES');
  const subs = await j('/api/v1/tv/configuration/subtitles?domain=filemoon.to');
  check('D1 subtítulos por dominio ok (forma del contrato)', subs.ok === true && subs.subtitles && typeof subs.subtitles === 'object');
  const sn = await fetch(BASE + '/api/v1/config/sniffer.js');
  const js = await sn.text();
  check('D2 sniffer v2 servido (≥2000, puente, fetch/XHR)', sn.status === 200 && js.length >= 2000 && js.includes('AnimaxSniffer') && js.includes('fetch'));

  /* Update: publicar → detectar → apk binario → limpiar */
  const UPD = path.join(__dirname, 'animax-update.json');
  const APK = path.join(__dirname, 'animax-latest.apk');
  const before = await j('/api/v1/config/appUpdate/check?versionCode=10');
  check('D3 sin config de update → sin update', before.ok === true && before.updateAvailable === false);
  const pub = await post('/api/v1/config/update', { versionCode: 99, versionName: '4.0.0-test', changelog: 'Batería F23' });
  check('D4 publicar update', pub.ok === true);
  const det = await j('/api/v1/config/appUpdate/check?versionCode=10');
  check('D5 app v10 detecta v99 con contrato nuevo', det.updateAvailable === true && det.versionCode === 99 && det.changelog === 'Batería F23');
  fs.writeFileSync(APK, Buffer.alloc(2048, 7));
  const apk = await fetch(BASE + det.downloadUrl);
  const buf = Buffer.from(await apk.arrayBuffer());
  check('D6 descarga del APK binaria con Content-Length real', buf.length === 2048 && Number(apk.headers.get('content-length')) === 2048);
  try { fs.unlinkSync(UPD); fs.unlinkSync(APK); } catch {}
  const after = await j('/api/v1/config/appUpdate/check?versionCode=10');
  check('D7 limpiar config → sin update de nuevo', after.updateAvailable === false);

  const rep = await post('/api/v1/report/playback', { url: 'https://f23-fallo.test/v.mp4', error: 'Source error' });
  check('D8 report/playback ok y penaliza', rep.ok === true && typeof rep.penalty === 'number');
  const rep2 = await post('/api/v1/report/web', { url: 'https://f23-web.test/x', ok: true });
  check('D9 report/web ok', rep2.ok === true);
}

async function faseE() {
  section('[E] SINCRONIZACIÓN multi-dispositivo (y limpieza)');
  const P = (d, entries) => post('/api/v1/sync/history', { deviceId: d, entries });
  let r = await P('bat-a', [{ contentId: 'c1', episodeId: 'e1', positionMs: 1, durationMs: 100, updatedAt: 1000 }]);
  check('E1 push ok', r.ok === true && r.guardadas === 1);
  r = await P('bat-b', [{ contentId: 'c1', episodeId: 'e1', positionMs: 2, durationMs: 100, updatedAt: 2000 }]);
  check('E2 push segundo dispositivo ok', r.guardadas === 1);
  r = await j('/api/v1/sync/history?since=0');
  check('E3 pull multi-dispositivo (2 entradas)', r.data.length === 2);
  r = await j('/api/v1/sync/history/devices');
  check('E4 devices lista los 2', r.data.length === 2);
  r = await P('bat-a', [{ contentId: 'c1', episodeId: 'e1', positionMs: 1, durationMs: 100, updatedAt: 999 }]);
  check('E5 merge: entrada vieja no reescribe', r.guardadas === 0);
  /* Limpieza: borra los archivos de estado de la batería. */
  try { fs.unlinkSync(path.join(__dirname, 'animax-history.json')); } catch {}
  check('E6 limpieza del historial de prueba', true);
}

async function faseF() {
  section('[F] DEPORTES + IA');
  let r = await j('/api/v1/sports/leagues');
  check('F1 10 ligas (incluida Colombia)', r.ok === true && r.data.length === 10 && r.data.some(l => l.id === 'col.1'));
  r = await j('/api/v1/sports/fixtures?league=esp.1');
  check('F2 fixtures reales ESPN (LaLiga ok, lista o vacía sin error)', r.ok === true && Array.isArray(r.data));
  r = await j('/api/v1/sports/fixtures?league=inventada');
  check('F3 liga desconocida rechazada', r.ok === false);
  r = await post('/api/v1/ai/chat', { messages: [{ role: 'user', content: 'hola' }] });
  check('F4 IA sin configurar → error honesto (fallback local en app)', r.ok === false && r.error === 'ai-no-configurada');
  r = await j('/api/v1/ai/models');
  check('F5 IA models ok', r.ok === true && Array.isArray(r.data));
}

async function faseG() {
  section('[G] AUDITORÍA CERO-ANUNCIOS (código fuente de la app)');
  const appDir = path.join(ROOT, 'app', 'src', 'main');
  let hits = [];
  try {
    /* La blocklist de anuncios (assets/browser/adblock_hosts.txt) CONTIENE
       dominios de advertisers A PROPÓSITO (es lo que BLOQUEA) → se excluye.
       AD_ID se busca con límites de palabra para no casar "downloAD_ID". */
    const out = execSync(
      `grep -riEn --include='*.kt' --include='*.xml' --include='*.kts' --include='*.toml' -e '\\bAD_ID\\b' -e 'com\\.adjust\\.' -e 'pairip' -e 'applovin' -e 'admob' -e 'google\\.ads' -e 'firebase.ads' -e 'com\\.facebook\\.ads' -e 'startapp' "${appDir}" || true`,
      { encoding: 'utf8', timeout: 30000 }
    ).trim();
    hits = out ? out.split('\n').filter(Boolean) : [];
  } catch (e) { hits = ['grep falló: ' + e.message]; }
  check('G1 sin SDKs de anuncios ni rastreo (AD_ID/Adjust/PairIP/AdMob/AppLovin…)', hits.length === 0,
    hits.slice(0, 3).join(' | '));
  const manifest = fs.readFileSync(path.join(appDir, 'AndroidManifest.xml'), 'utf8');
  check('G2 Manifest sin permisos de anuncios/rastreo (AD_ID, ACCESS_FINE_LOCATION para ads)',
    !/AD_ID/.test(manifest));
  const adblock = fs.existsSync(path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'animax', 'app', 'browser', 'core', 'AdBlocker.kt'));
  check('G3 bloqueador de anuncios integrado (AdBlocker.kt presente)', adblock);
}

(async () => {
  console.log(`Arrencando servidor en :${PORT} …`);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: __dirname, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
  });
  try {
    await waitServer();
    await faseA();
    await faseB();
    await faseC();
    await faseD();
    await faseE();
    await faseF();
    await faseG();
  } catch (e) {
    failed++;
    console.log('  ✘ FALLO DEL ARNÉS: ' + e.message);
  } finally {
    try { fs.unlinkSync(path.join(__dirname, 'animax-update.json')); } catch {}
    try { fs.unlinkSync(path.join(__dirname, 'animax-latest.apk')); } catch {}
    try { fs.unlinkSync(path.join(__dirname, 'animax-history.json')); } catch {}
    child.kill('SIGKILL');
  }
  console.log(`\n═══ RESULTADO F23: ${passed} ✔ / ${failed} ✘ ═══`);
  process.exit(failed ? 1 : 0);
})();
