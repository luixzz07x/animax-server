#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v7.0 · FASE H4 — BATERÍA DE PRUEBAS
   (Dominios propios del Hub + whitelist rotatoria real)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-H4-v4.js          (auto-arranca el servidor :3208)
         node test-H4-v4.js 3208     (contra un servidor ya arrancado)

   [A] QUERYFRESHDOMAINLIST V2 (en vivo): lista plana `data` intacta
       (regresión H1) + MAPA `v2` {hub, sites, primaryHub, generatedAt}
       con el contrato WhiteListConfig completo, exactamente UNA
       primaria del Hub, rol _meta (hub/site) y primaryHub = mirror
       ACTIVO del watchdog; sources/status con la sección `hub`.
   [B] CARGADOR hub-domains.js (procesos hijos con ficheros temporales):
       normalización (https, dedupe, flags), exactamente una primaria,
       filtrado de basura, archivo corrupto → [] HONESTO y mtime-cache
       (editar el JSON se ve SIN reiniciar).
   [C] FAILOVER REAL DEL WATCHDOG (unit con request stub): ciclo sano →
       2 fallos seguidos del primario → FAILOVER al mirror sano →
       recuperación del primario → RESTAURACIÓN automática + persistencia
       v3 (el estado del Hub sobrevive a un reinicio del server).
   [D] ESTÁTICA + APP: node --check de los 5 JS · balance Kotlin ${}-
       aware de los 7 archivos tocados · contrato presente en la app
       (sp_resources_domain, refresco 6 h, match por subdominio con
       recursión, failover en HubPages, desktop remoto, startAsync en
       ServiceLocator, freshDomainsJson en el cliente) · JSON del dueño
       válido.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn, execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* El require('./watchdog') de ESTE proceso usa su PROPIO fichero de
   estado (no pisa el del server). Debe fijarse ANTES del require. */
const TEST_STATE_FILE = path.join(os.tmpdir(), 'animax-test-h4-state.json');
try { fs.unlinkSync(TEST_STATE_FILE); } catch { /* sin estado previo */ }
process.env.ANIMAX_DOMAINS_FILE = TEST_STATE_FILE;

const EXTERNAL_PORT = Number(process.argv[2] || 0);
const PORT = EXTERNAL_PORT || 3208;
const BASE = 'http://localhost:' + PORT;
const ROOT = path.join(__dirname, '..', '..');
const KOTLIN = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'animax', 'app');
const HUB_JSON = path.join(__dirname, 'animax-hub-domains.json');

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
}

async function raw(base, urlPath, opts) {
  const res = await fetch(base + urlPath, { ...opts, signal: AbortSignal.timeout(120000) });
  const body = await res.text();
  return { code: res.status, body, headers: res.headers };
}
async function getJson(base, urlPath, opts) {
  const r = await raw(base, urlPath, opts);
  try { return JSON.parse(r.body); } catch { return { _raw: r.body.slice(0, 200), _status: r.code }; }
}

/* node -e aislado: cada caso [B] corre en un proceso hijo con su propio
   ANIMAX_HUB_DOMAINS_FILE (el módulo resuelve la ruta al cargar). */
function hubDomainsInChild(file, extra) {
  const script = `
    const hd = require(${JSON.stringify(path.join(__dirname, 'hub-domains.js'))});
    const editAndRecall = ${extra ? extra : 'null'};
    const first = hd.hubDomainsConfig();
    if (editAndRecall) {
      editAndRecall(require('fs'));
      const second = hd.hubDomainsConfig();
      process.stdout.write(JSON.stringify({ first, second }));
    } else {
      process.stdout.write(JSON.stringify({ first }));
    }
  `;
  try {
    /* execFileSync SIN shell: los \n del script no los muerde bash. */
    const out = execFileSync('node', ['-e', script], {
      env: { ...process.env, ANIMAX_HUB_DOMAINS_FILE: file },
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000, encoding: 'utf8'
    }).trim();
    return JSON.parse(out);
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 300) };
  }
}

/* QA estática Kotlin ${}-aware (idéntica a test-H3). */
function balanceKt(src) {
  let state = 'code';
  const stack = [];
  let i = 0;
  const N = src.length;
  while (i < N) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === '"' && src.substr(i, 3) === '"""') { state = 'raw'; i += 3; continue; }
      if (c === '"' || c === "'") { state = c; i++; continue; }
      if (c === '{' || c === '(' || c === '[') stack.push(c);
      else if (c === '}' || c === ')' || c === ']') {
        const open = stack.pop();
        if ((c === '}' && open !== '{') || (c === ')' && open !== '(') || (c === ']' && open !== '[')) {
          return 'desbalance: ' + c + ' sin ' + open;
        }
      }
    } else if (state === 'line') { if (c === '\n') state = 'code'; }
    else if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i += 2; continue; } }
    else if (state === 'raw') {
      if (src.substr(i, 3) === '"""') { state = 'code'; i += 3; continue; }
    } else { // " o '
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && n === '{') {
        // Sub-escaneo de la interpolación: puede contener strings con }.
        let depth = 0, j = i + 1;
        while (j < N) {
          const d = src[j];
          if (d === '{') depth++;
          else if (d === '}') { depth--; if (depth === 0) { j++; break; } }
          else if (d === '"') {
            j++;
            while (j < N && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
          }
          j++;
        }
        if (depth !== 0) return 'interpolación sin cerrar';
        i = j; continue;
      }
      if (c === state) state = 'code';
    }
    i++;
  }
  return stack.length ? 'sin cerrar: ' + stack.join('') : null;
}

function nodeCheck(file) {
  try { execSync('node --check "' + file + '"', { stdio: 'pipe' }); return ''; }
  catch (e) { return String(e.message || e); }
}

async function spawnServer(port, extraEnv) {
  const child = spawn('node', [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env, PORT: String(port),
      /* estado del watchdog del server SEPARADO del de las pruebas unitarias */
      ANIMAX_DOMAINS_FILE: path.join(os.tmpdir(), 'animax-test-h4-server-state.json'),
      ...(extraEnv || {})
    },
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 2500));
  return child;
}

async function main() {
  let childA = null;
  if (!EXTERNAL_PORT) childA = await spawnServer(PORT);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animax-h4-'));
  try {
    /* ══ [A] QUERYFRESHDOMAINLIST V2 ═══════════════════════════════ */
    console.log('\n[A] queryFreshDomainList v2 — mapa {hub, sites} + compat plana');
    const wl = await getJson(BASE, '/api/v1/app/content/website/queryFreshDomainList');
    check('endpoint ok', wl.ok === true);
    const flat = Array.isArray(wl.data) ? wl.data : [];
    check('REGRESIÓN H1: data plana sigue siendo lista ≥10', flat.length >= 10, 'hay ' + flat.length);
    check('REGRESIÓN H1: contrato completo en data (url+3 flags)',
      flat.every(e => 'url' in e && typeof e.freshEnable === 'boolean' &&
        typeof e.webFreshEnable === 'boolean' && typeof e.desktop === 'boolean'));
    check('REGRESIÓN H1: _meta.discoverySource en TODAS', flat.every(e => e._meta && typeof e._meta.discoverySource === 'string'));

    const v2 = wl.v2 || null;
    check('v2 presente (mapa nuevo H4)', !!v2 && typeof v2 === 'object');
    if (v2) {
      check('v2.hub y v2.sites son listas', Array.isArray(v2.hub) && Array.isArray(v2.sites));
      check('v2.sites === data (consistencia plana ↔ mapa)', v2.sites.length === flat.length,
        v2.sites.length + ' vs ' + flat.length);
      check('v2.hub con dominios del dueño (animax-hub-domains.json)', v2.hub.length >= 1, 'hay ' + v2.hub.length);
      const primaries = v2.hub.filter(h => h._meta && h._meta.primary === true);
      check('EXACTAMENTE una primaria del Hub', primaries.length === 1,
        'hay ' + primaries.length);
      check('contrato WhiteListConfig en TODAS las entradas del Hub',
        v2.hub.every(h => typeof h.url === 'string' && h.url.startsWith('https://') &&
          typeof h.freshEnable === 'boolean' && typeof h.webFreshEnable === 'boolean' &&
          typeof h.desktop === 'boolean'));
      check('_meta.role="hub" + discoverySource="hub-config" en todas',
        v2.hub.every(h => h._meta && h._meta.role === 'hub' && h._meta.discoverySource === 'hub-config'));
      check('_meta.active booleano en todas (mirror ACTIVO del watchdog)',
        v2.hub.every(h => typeof h._meta.active === 'boolean'));
      check('primaryHub es el mirror activo y pertenece al mapa',
        typeof v2.primaryHub === 'string' && v2.primaryHub !== '' &&
        v2.hub.some(h => h.url === v2.primaryHub) &&
        v2.hub.find(h => h.url === v2.primaryHub)._meta.active === true,
        'primaryHub=' + JSON.stringify(v2.primaryHub));
      check('generatedAt epoch reciente', typeof v2.generatedAt === 'number' &&
        Date.now() - v2.generatedAt < 10 * 60 * 1000);

      /* sources/status con la sección hub (pantalla Estado de fuentes) */
      const st = await getJson(BASE, '/api/v1/config/sources/status');
      check('sources/status ok', st.ok === true);
      check('sources/status trae sección hub (H4)', !!st.hub && typeof st.hub === 'object');
      if (st.hub) {
        check('hub.configured=true + hub.active===primaryHub', st.hub.configured === true && st.hub.active === v2.primaryHub);
        check('hub.mirrors con url/primary/active/status',
          Array.isArray(st.hub.mirrors) && st.hub.mirrors.length === v2.hub.length &&
          st.hub.mirrors.every(m => 'url' in m && 'primary' in m && 'active' in m && 'status' in m));
      }
    }

    /* ══ [B] CARGADOR hub-domains.js (mtime-cache + blindaje) ══════ */
    console.log('\n[B] hub-domains.js — normalización + mtime-cache');
    const shipped = JSON.parse(fs.readFileSync(HUB_JSON, 'utf8'));
    check('animax-hub-domains.json del dueño válido (hub lista)',
      Array.isArray(shipped.hub) && shipped.hub.length >= 1);

    const tmpOk = path.join(tmpDir, 'ok.json');
    fs.writeFileSync(tmpOk, JSON.stringify({ hub: [
      { url: 'https://hub.ejemplo1.tld/', freshEnable: true, primary: false },
      { url: 'http://HUB.Ejemplo1.tld', primary: true },          // dedupe + https
      { url: 'no-es-una-url', desktop: true },                     // basura: fuera
      { url: 'https://hub.ejemplo2.tld' }                          // sin primary
    ]}));
    const child = hubDomainsInChild(tmpOk, `
      (fs) => {
        const p = process.env.ANIMAX_HUB_DOMAINS_FILE;
        const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
        cfg.hub[0].freshEnable = false;                    // editar el JSON…
        // mtime tiene resolución fina: esperar para GARANTIZAR un
        // mtimeMs distinto (así se prueba el patrón mtime-cache real).
        const until = Date.now() + 130; while (Date.now() < until) {}
        fs.writeFileSync(p, JSON.stringify(cfg));          // …sin reiniciar
      }`);
    if (child.error) {
      check('normalización en proceso hijo', false, child.error);
    } else {
      const first = child.first || [];
      check('4 entradas → 2 dominios (basura filtrada + dedupe)', first.length === 2, 'hay ' + first.length);
      check('url normalizada https:// + host minúsculas',
        first.every(h => /^https:\/\/[a-z0-9.]+\.[a-z]+$/.test(h.url)),
        JSON.stringify(first.map(h => h.url)));
      check('exactamente UNA primaria (la marcada)', first.filter(h => h.primary).length === 1);
      check('flags por defecto honestos (desktop false, webFresh true)',
        first.every(h => h.webFreshEnable === true) && first.some(h => h.desktop === false) &&
        !first.some(h => h.desktop === true));
      check('mtime-cache: editar el JSON cambia lo servido SIN reiniciar',
        child.second && child.second.length === 2 &&
        child.second[0].freshEnable === false &&
        child.second.some(h => h.primary === true) &&
        child.second[1].url === 'https://hub.ejemplo2.tld',
        JSON.stringify(child.second || []));
    }

    const tmpBad = path.join(tmpDir, 'corrupto.json');
    fs.writeFileSync(tmpBad, '{ hub: [esto no es json');
    const bad = hubDomainsInChild(tmpBad);
    check('archivo corrupto → [] HONESTO (nunca lanza)',
      !bad.error && Array.isArray(bad.first) && bad.first.length === 0, bad.error);

    const tmpNone = path.join(tmpDir, 'vacio.json');
    fs.writeFileSync(tmpNone, JSON.stringify({ hub: [] }));
    const none = hubDomainsInChild(tmpNone);
    check('hub vacío → [] (app cae a searchServerUrl)',
      !none.error && Array.isArray(none.first) && none.first.length === 0, none.error);

    const tmpNoPrim = path.join(tmpDir, 'sinprimaria.json');
    fs.writeFileSync(tmpNoPrim, JSON.stringify({ hub: [
      { url: 'https://a.tld' }, { url: 'https://b.tld' }
    ]}));
    const noPrim = hubDomainsInChild(tmpNoPrim);
    check('sin primaria marcada → la PRIMERA es la primaria',
      !noPrim.error && noPrim.first.length === 2 &&
      noPrim.first[0].primary === true && noPrim.first[1].primary === false,
      JSON.stringify(noPrim.first || []));

    /* ══ [C] FAILOVER REAL DEL WATCHDOG (unit con stub) ════════════ */
    console.log('\n[C] watchdog — salud del Hub + failover + restauración');
    const createWatchdog = require('./watchdog');
    let failA = false;
    const stubRequest = async (u) => {
      const url = String(u || '');
      const dead = url.includes('hub-a.test') && failA;
      return dead
        ? { ok: false, status: 503, body: '' }
        : { ok: true, status: 200, body: '<html>' + 'x'.repeat(1200) + '</html>' };
    };
    const ctx = {
      request: stubRequest,
      siteHealth: new Map(),
      rawSitesCatalog: () => [],
      DEBUG: false,
      hubDomains: () => [
        { url: 'https://hub-a.test', freshEnable: true, webFreshEnable: true, desktop: false, primary: true },
        { url: 'https://hub-b.test', freshEnable: true, webFreshEnable: true, desktop: false, primary: false }
      ]
    };
    const wd = createWatchdog(ctx);
    await wd.runCycle();
    let hs = wd.hubStatus();
    check('ciclo sano: activo = primario (hub-a)', hs.configured === true && hs.active === 'https://hub-a.test', JSON.stringify(hs.active));
    check('mirrors sondeados con status up', hs.mirrors.length === 2 && hs.mirrors.every(m => m.status === 'up'));

    failA = true;
    await wd.runCycle();           // 1er fallo del primario
    hs = wd.hubStatus();
    check('1 fallo: AÚN activo (tolerancia, no falla al primer intento)',
      hs.active === 'https://hub-a.test' && hs.mirrors.find(m => m.url === 'https://hub-a.test').fails === 1,
      JSON.stringify(hs.mirrors));
    await wd.runCycle();           // 2º fallo → FAILOVER
    hs = wd.hubStatus();
    check('FAILOVER: 2 fallos seguidos → activo = mirror sano (hub-b)',
      hs.active === 'https://hub-b.test' && hs.promotedFrom === 'https://hub-a.test' &&
      hs.changedAt > 0, JSON.stringify({ active: hs.active, from: hs.promotedFrom }));

    failA = false;
    await wd.runCycle();           // primario sano de nuevo → RESTAURACIÓN
    hs = wd.hubStatus();
    check('RESTAURACIÓN: primario recuperado → vuelve el tráfico a hub-a',
      hs.active === 'https://hub-a.test', JSON.stringify(hs.active));

    /* Persistencia v3: el estado del Hub sobrevive a un «reinicio». */
    const wd2 = createWatchdog({ ...ctx, rawSitesCatalog: () => [] });
    hs = wd2.hubStatus();
    check('estado v3 persistido: un watchdog «reinciado» carga active=hub-a',
      hs.active === 'https://hub-a.test' && hs.configured === true, JSON.stringify(hs.active));

    /* Watchdog SIN dominios del dueño → honesto (configured=false). */
    const wd3 = createWatchdog({
      request: stubRequest, siteHealth: new Map(), rawSitesCatalog: () => [],
      DEBUG: false, hubDomains: () => []
    });
    const hs3 = wd3.hubStatus();
    check('sin animax-hub-domains.json: hub.configured=false (app cae a searchServerUrl)',
      hs3.configured === false && hs3.active === null && Array.isArray(hs3.mirrors));

    /* ══ [D] ESTÁTICA + APP ════════════════════════════════════════ */
    console.log('\n[D] estática: node --check + balance Kotlin + contratos app');
    for (const f of ['hub-domains.js', 'watchdog.js', 'v4-api.js', 'index.js', 'test-H4-v4.js']) {
      const err = nodeCheck(path.join(__dirname, f));
      check('node --check ' + f, err === '', err);
    }
    const ktFiles = [
      'data/remote/DomainWhitelist.kt',
      'data/remote/AnimaxServerClient.kt',
      'data/remote/HubPages.kt',
      'core/ServiceLocator.kt',
      'browser/core/DesktopModeWhitelist.kt',
      'ui/sources/SourceHealthScreen.kt',
      'ui/sources/SourcesScreen.kt'
    ];
    for (const k of ktFiles) {
      const src = fs.readFileSync(path.join(KOTLIN, ...k.split('/')), 'utf8');
      const bal = balanceKt(src);
      check('balance Kotlin ' + k, bal === null, bal || '');
    }

    const dw = fs.readFileSync(path.join(KOTLIN, 'data/remote/DomainWhitelist.kt'), 'utf8');
    check('app: caché DataStore sp_resources_domain (clave MMKV de Seekee)',
      dw.includes('preferencesDataStore(name = "sp_resources_domain")'));
    check('app: refresco al arrancar + cada 6 h (espejo AppPreloadManager)',
      dw.includes('REFRESH_INTERVAL_MS: Long = 6 * 60 * 60 * 1000L'));
    check('app: coincidencia por subdominio con recursión',
      dw.includes('fun hostMatches') && dw.includes('substringAfter'));
    check('app: parsea mapa v2 Y lista plana (compat servers pre-H4)',
      dw.includes('optJSONObject("v2")') && dw.includes('optJSONArray("data")'));
    check('app: activeHubBase con failover (activo → primario → primer fresh)',
      dw.includes('fun activeHubBase') && dw.includes('it.active && it.freshEnable'));

    const hp = fs.readFileSync(path.join(KOTLIN, 'data/remote/HubPages.kt'), 'utf8');
    check('app: HubPages usa el mirror ACTIVO del Hub (cambio de dominio sin reinstalar)',
      hp.includes('DomainWhitelist.activeHubBase()'));

    const dmu = fs.readFileSync(path.join(KOTLIN, 'browser/core/DesktopModeWhitelist.kt'), 'utf8');
    check('app: flag `desktop` REMOTO manda sobre la lista local',
      dmu.includes('DomainWhitelist.needsDesktop(url)'));
    const sc = fs.readFileSync(path.join(KOTLIN, 'core/ServiceLocator.kt'), 'utf8');
    check('app: ServiceLocator arranca la whitelist rotatoria (warm-up)',
      sc.includes('DomainWhitelist') && sc.includes('startAsync'));
    const asc = fs.readFileSync(path.join(KOTLIN, 'data/remote/AnimaxServerClient.kt'), 'utf8');
    check('app: cliente con freshDomainsJson (queryFreshDomainList)',
      asc.includes('freshDomainsJson') && asc.includes('/api/v1/app/content/website/queryFreshDomainList'));
    const shs = fs.readFileSync(path.join(KOTLIN, 'ui/sources/SourceHealthScreen.kt'), 'utf8');
    check('app: pantalla Estado de fuentes muestra whitelist vigente + edad + refresco',
      shs.includes('WhitelistCard') && shs.includes('ageText()') && shs.includes('refreshWhitelist'));
    const ss = fs.readFileSync(path.join(KOTLIN, 'ui/sources/SourcesScreen.kt'), 'utf8');
    check('app: pantalla Fuentes muestra la whitelist y su edad',
      ss.includes('DomainWhitelist.snapshot') && ss.includes('ageText()'));

    const v4 = fs.readFileSync(path.join(__dirname, 'v4-api.js'), 'utf8');
    check('server: freshDomainMap + freshDomainV2 + primaryHub en v4-api.js',
      v4.includes('function freshDomainMap') && v4.includes('function freshDomainV2') &&
      v4.includes('primaryHub'));
    const wdt = fs.readFileSync(path.join(__dirname, 'watchdog.js'), 'utf8');
    check('server: watchdog con maintainHub + FAILOVER + RESTAURACIÓN',
      wdt.includes('async function maintainHub') && wdt.includes('FAILOVER HUB') &&
      wdt.includes('RESTAURACIÓN HUB'));
  } catch (e) {
    check('batería sin excepción', false, String(e));
  } finally {
    if (childA) childA.kill();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* tmp */ }
    try { fs.unlinkSync(TEST_STATE_FILE); } catch { /* tmp */ }
  }

  console.log('\n════════════════════════════════════════════════');
  console.log('FASE H4 · ' + passed + ' pasan · ' + failed + ' fallan');
  if (failures.length) console.log('FALLOS:\n - ' + failures.join('\n - '));
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
