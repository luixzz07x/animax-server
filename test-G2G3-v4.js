#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v6.0 · FASE G2+G3 — BATERÍA DE PRUEBAS
   (Backend Seekee + Navegador: español, proveedores y fallback)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-G2G3-v4.js          (auto-arranca el servidor :3197)
         node test-G2G3-v4.js 3001     (contra un servidor ya arrancado)

   [A] RELATEDQUERIES EN ESPAÑOL (navegador Seekee): ?keyWord=one piece →
       sugerencias como "one piece sub español", "ver one piece",
       "one piece latino" — las opciones relacionadas salen EN ESPAÑOL.
   [B] FORECAST de texto: predicciones con heatScore mientras escribes.
   [C] SEARCH HÍBRIDA: tarjetas filmCenter + web con sourceList y
       websiteLabelList como OBJETOS LanguageLabelData (labelCode/
       labelName/countryFlagCode) — los chips "Sub"/"Latino" de la app.
   [D] PROVEEDORES + FALLBACK ENGINE-V3: /api/v1/app/episode/list
       responde fuentes aunque allanime/hianime caigan (Cloudflare,
       dominio muerto) — el motor propio del servidor toma el relevo y
       la respuesta lleva engine:"engine-v3" + sources[] con el MISMO
       contrato (url/provider/type/lang/referer/valid).
   [E] RESOLVE con refs "engine:<pageUrl>": resolución directa del motor.
   [F] FILMCENTER: homepage con pestañas, theater/page y film/subPage
       (grid infinito) con shapes Seekee (content/isLast/totalElements).
   [G] ADBLOCK: getAdBlockRule (suscripción + dominios) y
       getAdBlockDomain (lista completa ≥ 10.000 hosts).
   [H] DOMINIOS FRESCOS: queryFreshDomainList con freshEnable.
   [I] HOT con heatScore: ranking popular tipo 🔺 Seekee.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXTERNAL_PORT = Number(process.argv[2] || 0);
const PORT = EXTERNAL_PORT || 3197;
const BASE = 'http://localhost:' + PORT;

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

async function main() {
  let child = null;
  if (!EXTERNAL_PORT) {
    console.log('[test] arrancando servidor en :' + PORT + '…');
    child = spawn('node', [path.join(__dirname, 'index.js')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'ignore'
    });
    await new Promise(r => setTimeout(r, 2500));
  }

  try {
    /* ── [A] RELATEDQUERIES EN ESPAÑOL ─────────────────────────────── */
    console.log('\n[A] relatedQueries — navegador Seekee en español');
    const rel = await getJson('/api/v1/search/relatedQueries?keyWord=' + encodeURIComponent('one piece'));
    check('related ok', rel.ok === true);
    const relList = Array.isArray(rel.data) ? rel.data : [];
    check('≥ 5 sugerencias', relList.length >= 5, 'got ' + relList.length);
    const relJoined = relList.join(' | ').toLowerCase();
    check('plantilla ES "sub español"', relJoined.includes('sub español'));
    check('plantilla ES "ver …"', relJoined.includes('ver one piece'));
    check('todo en alfabeto latino', relList.every(s => /^[\u0000-\u024F\u2000-\u206F\s\d!¡¿?'"():;.,\-–—…·&%$#@/+*]+$/.test(s)));

    /* ── [B] FORECAST ──────────────────────────────────────────────── */
    console.log('\n[B] forecast — predicción con calor');
    const fc = await getJson('/api/v1/app/search/forecast?keyWord=' + encodeURIComponent('one'));
    check('forecast ok', fc.ok === true);
    check('con heatScore', (fc.data || []).every(x => typeof x.heatScore === 'number' && x.keyWord));

    /* ── [C] SEARCH HÍBRIDA ────────────────────────────────────────── */
    console.log('\n[C] search híbrida — LanguageLabelData (objetos Seekee)');
    const sr = await getJson('/api/v1/app/search/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keyWord: 'one piece', page: 1, pageSize: 10 })
    });
    check('search ok', sr.ok === true);
    const content = Array.isArray(sr.content) ? sr.content : [];
    check('mezcla filmCenter + web', content.some(c => c.type === 'filmCenter') && content.some(c => c.type === 'web'));
    const webWithLabels = content.find(c => c.type === 'web' && Array.isArray(c.websiteLabelList) && c.websiteLabelList.length);
    check('websiteLabelList es LanguageLabelData',
      !webWithLabels || (typeof webWithLabels.websiteLabelList[0] === 'object'
        && typeof webWithLabels.websiteLabelList[0].labelCode === 'string'));
    const webWithSources = content.find(c => c.type === 'web' && (c.sourceList || []).length);
    check('sourceList con url+lang+penalty',
      !webWithSources || webWithSources.sourceList.every(s => s.url && s.lang && typeof s.penalty === 'number'));

    /* ── [D] EPISODE/LIST con FALLBACK ─────────────────────────────── */
    console.log('\n[D] episode/list — proveedores reales + fallback engine-v3');
    const ep = await getJson('/api/v1/app/episode/list?q=' + encodeURIComponent('one piece') + '&episode=1&lang=sub', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'one piece', episode: 1, lang: 'sub' })
    });
    check('respuesta bien formada', ep.ok !== undefined && Array.isArray(ep.sources));
    check('campo engine presente', ep.engine === 'providers' || ep.engine === 'engine-v3');
    check('fuentes con contrato completo',
      (ep.sources || []).every(s => s.url && s.provider && ['embed', 'hls', 'mp4'].includes(s.type) && s.lang));
    check('nunca lanza: ok:false SOLO con providerStatus/notas',
      ep.ok === true || (ep.providerStatus || (ep.providerErrors || []).length > 0 || ep.error));

    /* ── [E] RESOLVE con refs engine: ──────────────────────────────── */
    console.log('\n[E] episode/resolve — refs engine:<pageUrl>');
    const rs = await getJson('/api/v1/app/episode/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ showRef: 'engine:https://monoschinos.st/anime/one-piece-sub-espanol', episode: 1, lang: 'sub' })
    });
    check('resolve engine responde', rs.ok !== undefined && Array.isArray(rs.sources));
    check('engine-v3 etiquetado', rs.ok !== true || rs.engine === 'engine-v3');

    /* ── [F] FILMCENTER ────────────────────────────────────────────── */
    console.log('\n[F] filmCenter — homepage + theater + subPage');
    const hp = await getJson('/api/v1/content/filmCenter/homepage');
    check('homepage ok', hp.ok === true);
    const tp = await getJson('/api/v1/content/filmCenter/theater/page?stream=comic&page=1');
    check('theater ok', tp.ok === true);
    const sp = await getJson('/api/v1/content/filmCenter/film/subPage?stream=comic&orderType=trending&page=2');
    check('subPage ok', sp.ok === true);
    check('subPage grid infinito', Array.isArray(sp.content) && sp.content.length > 0 && sp.isLast === false);

    /* ── [G] ADBLOCK ───────────────────────────────────────────────── */
    console.log('\n[G] adblock — reglas + dominios');
    const ab = await getJson('/api/v1/api/config/getAdBlockRule');
    check('getAdBlockRule ok', ab.ok === true && ab.subscription && ab.subscription.url);
    const abd = await getJson('/api/v1/api/config/v2/getAdBlockDomain');
    check('getAdBlockDomain ≥ 10.000 hosts', abd.ok === true && (abd.domainList || []).length >= 10000,
      'got ' + ((abd.domainList || []).length));

    /* ── [H] DOMINIOS FRESCOS ──────────────────────────────────────── */
    console.log('\n[H] queryFreshDomainList — dominios vigentes');
    const df = await getJson('/api/v1/app/content/website/queryFreshDomainList');
    check('lista fresca ok', df.ok === true && Array.isArray(df.data) && df.data.length > 0);
    check('formato Seekee (url+freshEnable)', df.data.every(d => d.url && typeof d.freshEnable === 'boolean'));

    /* ── [I] HOT con heatScore ─────────────────────────────────────── */
    console.log('\n[I] search/hot — ranking 🔺');
    const hot = await getJson('/api/v1/api/home/search/hot?type=comic');
    check('hot ok', hot.ok === true && (hot.data || []).length > 0);
    check('heatScore + nombres ES', (hot.data || []).every(h => h.heatScore > 0 && h.resourceName));

    /* ── RESUMEN ───────────────────────────────────────────────────── */
    console.log('\n════════════════════════════════════════');
    console.log('  G2+G3 · ' + passed + ' pasan · ' + failed + ' fallan');
    if (failed) { console.log('  Fallas: ' + failures.join(' · ')); process.exitCode = 1; }
  } finally {
    if (child) child.kill();
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
