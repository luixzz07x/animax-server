#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · ARNÉS DE PRUEBAS — FASE 2 (watchdog de dominios)
   ═════════════════════════════════════════════════════════════════════
   Dos bloques:

   A) UNITARIO (determinista, sin red): se crea un watchdog con un
      request() FALSO donde "fakesite.example" está muerto y Bing
      descubre "fakesite.com". Se corre DOS ciclos y se verifica la
      ROTACIÓN REAL: 2 fallos → descubrimiento → dominio nuevo →
      catálogo resuelto → onRotate → caché de salud.

   B) EN VIVO (contra el servidor arrancado): forma de los endpoints
      nuevos de la Fase 2 y de los actualizados:
        · GET  /api/v1/config/sources/status
        · POST /api/v1/config/sources/refresh
        · GET  /api/v1/app/content/website/queryFreshDomainList (_meta)
        · GET  /api/domains (rotación)
        · GET  /api/v1/app/content/website/navigationList

   Uso:  node test-fase2-v4.js [puerto]
   Salida: ✔/✘ + resumen. Código de salida 0 si todo OK.
   ═════════════════════════════════════════════════════════════════════ */

const PORT = Number(process.argv[2] || process.env.ANIMAX_PORT || 3009);
const BASE = `http://127.0.0.1:${PORT}`;
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; failures.push(name + (detail ? ' → ' + detail : '')); console.log('  ✘ ' + name + (detail ? ' → ' + detail : '')); }
}

function get(p) {
  return new Promise((resolve) => {
    const req = require('http').get(BASE + p, { timeout: 25000 }, (res) => {
      let b = '';
      res.on('data', c => { if (b.length < 3000000) b += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, json: j, text: b });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null, text: '' }); });
    req.on('error', () => resolve({ status: 0, json: null, text: '' }));
  });
}

function post(p, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {});
    const req = require('http').request(BASE + p, {
      method: 'POST', timeout: 25000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let b = '';
      res.on('data', c => { if (b.length < 3000000) b += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, json: j, text: b });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null, text: '' }); });
    req.on('error', () => resolve({ status: 0, json: null, text: '' }));
    req.end(payload);
  });
}

/* ══════════════════════════════════════════════════════════════════
   A) UNITARIO — rotación determinista con request() falso
   ══════════════════════════════════════════════════════════════════ */
async function parteUnitaria() {
  console.log('\n[A] UNITARIO · rotación REAL con request() falso (sin red)\n');

  // Estado aislado para no ensuciar el animax-domains.json real.
  const tmpState = path.join(os.tmpdir(), 'animax-fase2-test-domains.json');
  require('fs').rmSync(tmpState, { force: true });
  process.env.ANIMAX_DOMAINS_FILE = tmpState;

  // El require se hace AQUÍ para que coja la env de estado.
  const createWatchdog = require('./watchdog');

  const siteHealth = new Map();
  let rotaciones = [];
  let bingLlamadas = 0;

  const wd = createWatchdog({
    request: async (url) => {
      // El dominio VIEJO está muerto (ni responde).
      if (String(url).includes('fakesite.example')) return { ok: false, status: 0, body: '' };
      // Bing "encuentra" el dominio nuevo en su página de resultados.
      if (String(url).includes('bing.com')) {
        bingLlamadas++;
        return {
          ok: true, status: 200,
          body: '<html><body>' +
            '<a href="https://fakesite.com/anime">FakeSite</a>' +
            '<a href="https://www.youtube.com/watch">ruido</a>' +
            '<a href="https://otro-sitio-total.net/x">ruido</a>' +
            '</body></html>'
        };
      }
      // DuckDuckGo no contesta (202 de reto) — debe tolerarse.
      if (String(url).includes('duckduckgo.com')) return { ok: false, status: 202, body: '' };
      // El segundo sitio del catálogo (sano.tv) está sano.
      if (String(url).includes('sano.tv')) {
        return { ok: true, status: 200, body: '<html><body>' + 'contenido sano '.repeat(80) + '</body></html>' };
      }
      // El dominio NUEVO (y solo él) está sano.
      if (String(url).includes('fakesite.com')) {
        return { ok: true, status: 200, body: '<html><body>' + 'contenido real '.repeat(80) + '</body></html>' };
      }
      return { ok: false, status: 0, body: '' };
    },
    siteHealth,
    rawSitesCatalog: () => ([
      { host: 'fakesite.example', tpl: 'https://fakesite.example/buscar?q={q}', lang: 'latino', kind: 'anime' },
      { host: 'sano.tv', tpl: 'https://sano.tv/buscar?q={q}', lang: 'sub', kind: 'anime' }
    ]),
    onRotate: (id, from, to) => rotaciones.push({ id, from, to }),
    DEBUG: false
  });

  // Ciclo 1: fakesite.example falla UNA vez → todavía NO rota (umbral 2).
  await wd.runCycle();
  let st = wd.status();
  check('ciclo 1: fakesite sigue en su dominio original (umbral de 2 fallos)',
    st.sources[0].host === 'fakesite.example', st.sources[0].host);
  check('ciclo 1: sano.tv sigue en su dominio',
    st.sources[1].host === 'sano.tv');
  check('ciclo 1: salud registrada (down/up)',
    st.sources[0].status === 'down' && st.sources[1].status === 'up',
    st.sources[0].status + '/' + st.sources[1].status);

  // Ciclo 2: segundo fallo → descubrimiento (Bing) → ROTACIÓN.
  await wd.runCycle();
  st = wd.status();
  check('ciclo 2: ROTACIÓN a fakesite.com (descubierto por Bing)',
    st.sources[0].host === 'fakesite.com', st.sources[0].host);
  check('ciclo 2: dominio previo registrado',
    st.sources[0].previousDomain === 'fakesite.example', String(st.sources[0].previousDomain));
  check('ciclo 2: fuente del descubrimiento = bing',
    st.sources[0].discoverySource === 'bing', st.sources[0].discoverySource);
  check('ciclo 2: cambio con marca de tiempo',
    typeof st.sources[0].changedAt === 'number' && st.sources[0].changedAt > 0);
  check('ciclo 2: onRotate avisó al servidor (limpieza de caché)',
    rotaciones.length === 1 && rotaciones[0].to === 'fakesite.com', JSON.stringify(rotaciones));
  check('ciclo 2: el estado fue persistido', require('fs').existsSync(tmpState));

  // resolveSites: TODO el servidor pasa a ver el dominio nuevo.
  const resolved = wd.resolveSites([
    { host: 'fakesite.example', tpl: 'https://fakesite.example/buscar?q={q}', lang: 'latino', kind: 'anime' },
    { host: 'sano.tv', tpl: 'https://sano.tv/buscar?q={q}', lang: 'sub', kind: 'anime' }
  ]);
  check('resolveSites: host vigente aplicado', resolved[0].host === 'fakesite.com', resolved[0].host);
  check('resolveSites: plantilla reescrita al dominio nuevo',
    resolved[0].tpl === 'https://fakesite.com/buscar?q={q}', resolved[0].tpl);
  check('resolveSites: sitio sin rotación intacto',
    resolved[1].host === 'sano.tv' && resolved[1].tpl === 'https://sano.tv/buscar?q={q}');

  // La salud del dominio NUEVO ya está en el mapa compartido → la
  // búsqueda (directSiteSearch) lo usa de inmediato.
  check('siteHealth del dominio nuevo = ok', siteHealth.get('fakesite.com') && siteHealth.get('fakesite.com').ok === true);
  check('bing consultado durante el descubrimiento', bingLlamadas > 0, 'llamadas=' + bingLlamadas);

  // Ciclo 3: ya rotado y sano → no vuelve a rotar.
  await wd.runCycle();
  st = wd.status();
  check('ciclo 3: estable en el dominio nuevo (sin rebotes)',
    st.sources[0].host === 'fakesite.com' && rotaciones.length === 1);

  // resumen consistente
  const sum = st.summary;
  check('summary {total,up,down,unknown,intervalMin}',
    sum && sum.total === 2 && typeof sum.up === 'number' && typeof sum.down === 'number' &&
    typeof sum.unknown === 'number' && sum.intervalMin >= 1, JSON.stringify(sum));

  require('fs').rmSync(tmpState, { force: true });
}

/* ══════════════════════════════════════════════════════════════════
   B) EN VIVO — endpoints de la Fase 2 contra el servidor real
   ══════════════════════════════════════════════════════════════════ */
async function parteViva() {
  console.log(`\n[B] EN VIVO · endpoints Fase 2 contra ${BASE}\n`);

  console.log('[B1] GET /api/v1/config/sources/status');
  const st = await get('/api/v1/config/sources/status');
  check('responde 200', st.status === 200, 'status=' + st.status);
  const S = st.json || {};
  check('ok=true + version 4.0.x', S.ok === true && /^4\.0\./.test(S.version || ''), S.version);
  check('sources[] con los 24 sitios',
    Array.isArray(S.sources) && S.sources.length >= 24, 'n=' + (S.sources || []).length);
  check('SourceStatusEntry forma completa {id,kind,lang,host,url,status,ms,lastCheck,previousDomain,changedAt,discoverySource,candidates,penalty}',
    (S.sources || []).every(s =>
      typeof s.id === 'string' && typeof s.kind === 'string' && typeof s.lang === 'string' &&
      typeof s.host === 'string' && typeof s.url === 'string' &&
      (s.status === 'up' || s.status === 'down' || s.status === 'unknown') &&
      ('ms' in s) && ('lastCheck' in s) && ('previousDomain' in s) &&
      ('changedAt' in s) && typeof s.discoverySource === 'string' &&
      typeof s.candidates === 'number' && typeof s.penalty === 'number'));
  check('summary {total,up,down,unknown,running,lastRun,nextRun,intervalMin}',
    S.summary && S.summary.total === (S.sources || []).length &&
    typeof S.summary.up === 'number' && typeof S.summary.down === 'number' &&
    typeof S.summary.unknown === 'number' && typeof S.summary.running === 'boolean' &&
    'lastRun' in S.summary && 'nextRun' in S.summary && S.summary.intervalMin >= 1,
    JSON.stringify(S.summary));
  const up = (S.sources || []).filter(s => s.status === 'up').length;
  console.log(`      → ${up} vivas / ${(S.sources || []).length} (en el sandbox solo ~7 son alcanzables)`);

  console.log('[B2] POST /api/v1/config/sources/refresh');
  const rf = await post('/api/v1/config/sources/refresh', {});
  check('responde 200 {ok, started, alreadyRunning}',
    rf.status === 200 && rf.json && rf.json.ok === true && typeof rf.json.started === 'boolean',
    JSON.stringify(rf.json));

  console.log('[B3] GET /api/v1/app/content/website/queryFreshDomainList (con rotación)');
  const fd = await get('/api/v1/app/content/website/queryFreshDomainList');
  check('responde 200 con data[]', fd.status === 200 && Array.isArray(fd.json && fd.json.data) && fd.json.data.length >= 24);
  check('WhiteListConfig {url, freshEnable, webFreshEnable}',
    (fd.json.data || []).every(d => typeof d.url === 'string' && typeof d.freshEnable === 'boolean' && d.webFreshEnable === true));
  check('_meta con rotación {id, kind, lang, lastCheck, previousDomain, changedAt, discoverySource}',
    (fd.json.data || []).every(d => d._meta && typeof d._meta.id === 'string' && typeof d._meta.kind === 'string' &&
      typeof d._meta.lang === 'string' && ('lastCheck' in d._meta) && ('previousDomain' in d._meta) &&
      ('changedAt' in d._meta) && typeof d._meta.discoverySource === 'string'));

  console.log('[B4] GET /api/domains (rotación en la ruta clásica)');
  const dm = await get('/api/domains');
  check('responde 200 con sites[] + summary',
    dm.status === 200 && Array.isArray(dm.json && dm.json.sites) && dm.json.sites.length >= 24 && !!dm.json.summary);
  check('sitios con {previousDomain, changedAt, discoverySource}',
    dm.json.sites.every(s => ('previousDomain' in s) && ('changedAt' in s) && typeof s.discoverySource === 'string'));

  console.log('[B5] GET /api/v1/app/content/website/navigationList (dominios resueltos)');
  const nl = await get('/api/v1/app/content/website/navigationList');
  check('grupos con sites {url, cover}', nl.status === 200 && Array.isArray(nl.json && nl.json.data) &&
    nl.json.data.length >= 3 && nl.json.data.every(g => Array.isArray(g.sites) && g.sites.length > 0 &&
      g.sites.every(s => /^https:\/\//.test(s.url))));
  const hostsNav = new Set();
  (nl.json.data || []).forEach(g => g.sites.forEach(s => hostsNav.add(s.url.replace(/^https:\/\//, '').replace(/\/$/, ''))));
  const hostsStat = new Set((S.sources || []).map(s => s.host));
  check('navigationList sirve los DOMINIOS VIGENTES del watchdog',
    [...hostsStat].every(h => hostsNav.has(h)),
    'faltan: ' + [...hostsStat].filter(h => !hostsNav.has(h)).slice(0, 3).join(','));

  console.log('[B6] Compatibilidad: las rutas 3.x siguen intactas');
  const ping = await get('/api/ping');
  check('GET /api/ping ok + versión 4.0.x (ahora 4.0.4 · Fase 4)', ping.status === 200 && ping.json && ping.json.ok === true && /^4\.0\.\d+$/.test(ping.json.version || ''), ping.json && ping.json.version);
  const nf = await get('/api/v1/ruta-que-no-existe');
  check('404 limpio en /api/v1/* desconocida', nf.status === 404 && nf.json && nf.json.ok === false);
}

(async () => {
  await parteUnitaria();
  try {
    await parteViva();
  } catch (e) {
    console.log('\n[!] La parte viva falló (¿servidor arrancado?):', String(e && e.message || e));
    fail++;
    failures.push('parte-viva');
  }
  console.log('\n──────────────────────────────────────────────');
  console.log(`RESULTADO FASE 2: ${pass} ✔ · ${fail} ✘`);
  if (failures.length) console.log('Fallos:\n  - ' + failures.join('\n  - '));
  process.exit(fail ? 1 : 0);
})();
