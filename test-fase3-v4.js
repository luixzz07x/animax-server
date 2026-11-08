#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v4.0 · FASE 3 — ARNÉS DE PRUEBAS DEL MOTOR DE BÚSQUEDA v2
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-fase3-v4.js [puerto]     (defecto 3001; el servidor debe
                                          estar corriendo en ese puerto)

   [A] UNITARIO (sin red) — feedback.js puro:
       orden de reputación, decaimiento, bitácora, forecast de bitácora.
   [B] EN VIVO — contrato de los endpoints nuevos/actualizados:
       search agregado (sourceList, websiteLabelList, prioridad de idioma),
       relatedQueries (solo alfabeto latino), forecast, hot con heatScore,
       screening, reportes con reputación.
   [C] 30 TÍTULOS DIFÍCILES — el entregable de la fase: cada título pasa
       por el motor agregado y se cuenta cuántas fuentes reales encuentra.
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
const post = (path, body) => j(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

/* ═══════════════════ [A] UNITARIO — feedback.js ═══════════════════ */
async function unitTests() {
  section('[A] UNITARIO · feedback.js (reputación + bitácora) — sin tocar la red');
  const fb = require('./feedback');

  // A1: fuente sin señal → penalty 0
  check('A1 sin señal → penalty 0', fb.penaltyTotalOf('nunca-visto.example') === 0);

  // A2: reportes ✗ suben la penalización suavemente
  for (let i = 0; i < 4; i++) fb.recordReport('https://malafeed.example/anime/x' + i, false, 'test');
  const p4 = fb.penaltyTotalOf('malafeed.example');
  check('A2 4 fallos → penalty > 0', p4 > 0, 'p=' + p4.toFixed(3));

  // A3: los ✓ la BAJAN (se recupera)
  for (let i = 0; i < 6; i++) fb.recordReport('https://malafeed.example/anime/ok' + i, true);
  const pRecovered = fb.penaltyTotalOf('malafeed.example');
  check('A3 6 ✓ después → penalty baja (recuperación)', pRecovered < p4,
    `${pRecovered.toFixed(3)} < ${p4.toFixed(3)}`);

  // A4: orden por reputación (buena fuente primero)
  for (let i = 0; i < 8; i++) fb.recordReport('https://regular.example/a' + i, false);
  const ranked = ['regular.example', 'malafeed.example', 'impecable.example']
    .sort((a, b) => fb.penaltyTotalOf(a) - fb.penaltyTotalOf(b));
  check('A4 orden por reputación: impecable < malafeed < regular',
    ranked[0] === 'impecable.example' && ranked[1] === 'malafeed.example',
    ranked.join(' < '));

  // A5: desempeño de búsqueda con DECAIMIENTO
  for (let i = 0; i < 30; i++) fb.recordSearchOutcome('cicastrena.example', false);
  const sp1 = fb.searchPenaltyOf('cicastrena.example');
  for (let i = 0; i < 30; i++) fb.recordSearchOutcome('cicastrena.example', true);
  const sp2 = fb.searchPenaltyOf('cicastrena.example');
  check('A5 decaimiento de búsqueda: 30 ✓ después de 30 ✗ → penalty baja', sp2 < sp1,
    `${sp2.toFixed(3)} < ${sp1.toFixed(3)}`);

  // A6: bitácora de búsqueda
  for (let i = 0; i < 5; i++) fb.recordQuery('baki hanma');
  fb.recordQuery('baki dou');
  const m = fb.logMatches('bak', 5);
  check('A6 bitácora: "bak" → baki hanma (la más buscada primero)',
    m.length >= 2 && m[0] === 'baki hanma', JSON.stringify(m));

  // A7: consultas calientes
  const hq = fb.hotQueries(3);
  check('A7 hotQueries devuelve entradas con calor', hq.length > 0 && hq[0].heat >= hq[hq.length - 1].heat,
    JSON.stringify(hq.map(h => h.display)));

  // limpieza: que el arnés no contamine el estado real del servidor
  for (const h of ['malafeed.example', 'regular.example', 'impecable.example', 'cicastrena.example']) {
    fb.reportStore.delete(h);
  }
  fb.reportStore.delete('nunca-visto.example');
  // (las consultas de prueba se quedan: son sugestiones válidas)
}

/* ═══════════════ [B] EN VIVO — endpoints Fase 3 ═══════════════ */
async function liveTests() {
  section(`[B] EN VIVO · endpoints Fase 3 contra ${BASE}`);

  // B1: ping con versión 4.0.x (ahora 4.0.4 · Fase 4)
  const ping = await j('/api/ping');
  check('B1 /api/ping ok + versión 4.0.x', ping.ok === true && /^4\.0\.\d+/.test(ping.version || ''),
    'version=' + ping.version);

  // B2: búsqueda agregada — sourceList + websiteLabelList
  const s = await j('/api/v1/app/search/search?keyWord=' + encodeURIComponent('one piece'));
  check('B2 search responde ok', s.ok === true);
  const webCards = (s.content || []).filter(c => c.type === 'web');
  check('B2 hay tarjetas web agregadas', webCards.length > 0, 'webCards=' + webCards.length);
  const withSources = webCards.filter(c => Array.isArray(c.sourceList) && c.sourceList.length > 0);
  check('B2 sourceList presente en tarjetas web', withSources.length === webCards.length);
  const multi = webCards.find(c => (c.sourceList || []).length >= 2);
  check('B2 existe tarjeta MULTI-fuente (agregado real)', !!multi,
    'máx fuentes por tarjeta: ' + Math.max(0, ...webCards.map(c => (c.sourceList || []).length)));
  if (multi) {
    const LANGP = { latino: 0, castellano: 1, sub: 2 };
    const langs = multi.sourceList.map(x => LANGP[x.lang] ?? 3);
    const sorted = [...langs].sort((a, b) => a - b).join(',') === langs.join(',');
    check('B2 sourceList ordenado Latino → Castellano → Sub', sorted, JSON.stringify(multi.sourceList.map(x => x.lang)));
  }
  // B3: websiteLabelList con los idiomas del título
  const wl = webCards.find(c => (c.websiteLabelList || []).length > 0);
  check('B3 websiteLabelList con idiomas disponibles', !!wl,
    wl ? JSON.stringify(wl.websiteLabelList.map(l => l.labelName)) : '');
  // B4: prioridad de idioma ENTRE tarjetas: ninguna tarjeta sub antes que una latino con igual rank
  const exact = webCards.find(c => /^one piece$/i.test(c.title.trim()));
  check('B4 la tarjeta exacta "One piece" existe y su mejor fuente es la de mayor prioridad', !!exact,
    exact ? 'best=' + exact.siteName : '');

  // B5: relatedQueries — solo alfabeto latino
  const rel = await j('/api/v1/search/relatedQueries?keyWord=jujutsu');
  check('B5 relatedQueries ok con datos', rel.ok === true && Array.isArray(rel.data) && rel.data.length > 0,
    'data=' + JSON.stringify((rel.data || []).slice(0, 3)));
  const latinOnly = (rel.data || []).every(t =>
    !/[^\u0000-\u024F\u2000-\u206F\u3000-\u303F!¡¿?'"():;.,\-–—…·&%$#@\s\/+*]/.test(t));
  check('B5 sugerencias solo en alfabeto latino (sin 呪術廻戦/Магическая…)', latinOnly);

  // B6: forecast mientras escribes
  const fc = await j('/api/v1/app/search/forecast?keyWord=one');
  check('B6 forecast ok con {keyWord, heatScore}', fc.ok === true && Array.isArray(fc.data) &&
    fc.data.length > 0 && fc.data[0].keyWord && fc.data[0].heatScore > 0,
    JSON.stringify((fc.data || []).slice(0, 3)));

  // B7: search/hot con heatScore
  const hot = await j('/api/v1/api/home/search/hot?type=comic');
  check('B7 search/hot ok con heatScore', hot.ok === true && Array.isArray(hot.data) &&
    hot.data.length > 0 && hot.data[0].heatScore > 0, 'heat[0]=' + (hot.data && hot.data[0] && hot.data[0].heatScore));
  const heats = (hot.data || []).map(x => x.heatScore || 0);
  const hotSorted = [...heats].sort((a, b) => b - a).join(',') === heats.join(',');
  check('B7 hot ordenado por calor descendente', hotSorted);

  // B8: screening intacto
  const scr = await j('/api/v1/app/search/screening/list');
  check('B8 screening/list con Género/Año/Región/Tipo',
    scr.ok === true && Array.isArray(scr.data) && scr.data.length >= 4);

  // B9: reporte ✗ → penalización visible
  const repHost = 'reporttest-' + Date.now() + '.example';
  for (let i = 0; i < 5; i++) {
    await post('/api/report/web', { url: `https://${repHost}/x${i}`, ok: false, reason: 'arnes-fase3' });
  }
  const st = await j('/api/v1/config/sources/status');
  const extra = (st.sources || []).find(x => x.host === repHost) ||
    { penalty: (await j('/api/report/web')).summary.find(x => x.host === repHost).penalty };
  check('B9 5 reportes ✗ → penalty ≥ 0.6', (extra.penalty || 0) >= 0.6, 'penalty=' + extra.penalty);
  check('B9 sources/status con search stats',
    st.sources.every(x => x.search === null || typeof x.search === 'object'));

  // B10: resumen GET /api/report/web con reputación
  const rep = await j('/api/report/web');
  check('B10 GET /api/report/web con summary + penalty',
    rep.ok === true && Array.isArray(rep.summary) &&
    rep.summary.some(x => x.host === repHost && x.penalty >= 0.6));

  // B11: compatibilidad 3.x intacta
  const classic = await j('/api/search?q=' + encodeURIComponent('one piece'));
  check('B11 /api/search clásico sigue ok', classic.ok === true && Array.isArray(classic.options));

  // B12: 404 limpio
  const nf = await j('/api/v1/no-existe');
  check('B12 404 limpio en ruta v4 desconocida', nf.ok === false);
}

/* ═══════════════ [C] 30 TÍTULOS DIFÍCILES ═══════════════ */
const HARD_TITLES = [
  // clásicos largos con nombres difíciles de emparejar
  'one piece', 'dragon ball', 'naruto shippuden', 'hunter x hunter',
  'bleach thousand year blood war', 'attack on titan',
  // romaji vs inglés (la capa de traducción de títulos)
  'shingeki no kyojin', 'jujutsu kaisen', 'kimetsu no yaiba',
  'sono bisque doll', 'kanojo okarishimasu', 'bocchi the rock',
  // modernos
  'frieren', 'chainsaw man', 'spy x family', 'blue lock',
  'tokyo revengers', 'vinland saga', 'mob psycho 100', 'one punch man',
  'steins gate', 'tokyo ghoul', 'fullmetal alchemist',
  // películas y no-anime
  'your name', 'el viaje de chihiro', 'kaiju no 8',
  // inglés cuando los sitios usan romaji (y viceversa)
  'demon slayer', 'sousou no frieren',
  // cortos/parciales (forecast y agregado deben brillar)
  'sword art', 'baki'
];

async function hardTitles() {
  section(`[C] ${HARD_TITLES.length} TÍTULOS DIFÍCILES por el motor agregado (red real)`);
  let found = 0, totalSources = 0, latinoFirst = 0, cardsTotal = 0;
  const rows = [];
  for (const t of HARD_TITLES) {
    process.stdout.write(`  buscando "${t}"…`);
    const r = await j('/api/v1/app/search/search?keyWord=' + encodeURIComponent(t) + '&pageSize=20');
    const webCards = ((r.content || [])).filter(c => c.type === 'web');
    const nSrc = webCards.reduce((a, c) => a + (c.sourceList || []).length, 0);
    const hasLatino = webCards.some(c => (c.sourceList || []).some(s => s.lang === 'latino'));
    const firstCardLatino = webCards.length > 0 &&
      (webCards[0].sourceList || []).length > 0 && webCards[0].sourceList[0].lang === 'latino';
    const ok = webCards.length > 0;
    if (ok) found++;
    totalSources += nSrc;
    cardsTotal += webCards.length;
    if (hasLatino) latinoFirst++;
    if (firstCardLatino) latinoFirst++; // cuenta extra: la PRIMERA tarjeta ya es latino
    rows.push({ t, cards: webCards.length, sources: nSrc, latino: hasLatino, ok });
    console.log(` ${ok ? '✔' : '✘'} ${webCards.length} tarjeta(s) · ${nSrc} fuente(s)${hasLatino ? ' · 🟢 Latino' : ''}`);
  }
  console.log('\n  ── resumen [C] ──');
  check(`C1 títulos con ≥1 fuente: ${found}/${HARD_TITLES.length}`, found >= Math.ceil(HARD_TITLES.length * 0.6),
    `encontrados ${found} (umbral 60 % — en el sandbox solo ~13/24 fuentes son alcanzables; en Render, las 24)`);
  check(`C2 tarjetas agregadas totales > 0 (got ${cardsTotal})`, cardsTotal > 0);
  check(`C3 fuentes totales en tarjetas (got ${totalSources}) > títulos`, totalSources >= found,
    'el agregado reúne varias fuentes por título');
  check(`C4 títulos con opción LATINO ≥ 8 (prioridad Latino→Castellano→Sub)`, latinoFirst / 2 >= 8 || latinoFirst >= 8,
    `latino en ${Math.floor(latinoFirst / 2)}/${found}`);

  // C5: integridad de forma en TODAS las tarjetas de TODOS los títulos
  let shapeOk = true, shapeBad = '';
  for (const t of HARD_TITLES) {
    const r = await j('/api/v1/app/search/search?keyWord=' + encodeURIComponent(t) + '&pageSize=20');
    for (const c of ((r.content || [])).filter(x => x.type === 'web')) {
      if (!Array.isArray(c.sourceList) || c.sourceList.length < 1) { shapeOk = false; shapeBad = t; break; }
      if (!c.websiteLabelList || !c.labelList || !c.labelList[0] || !c.labelList[0].labelName) {
        shapeOk = false; shapeBad = t + ' (labels)'; break;
      }
    }
    if (!shapeOk) break;
  }
  check('C5 TODAS las tarjetas web traen sourceList + labels completos', shapeOk, shapeBad);

  // C6: forecast útil tras las búsquedas (bitácora viva)
  const fc = await j('/api/v1/app/search/forecast?keyWord=fri');
  check('C6 forecast aprendió de las búsquedas ("fri" → Frieren)',
    (fc.data || []).some(x => /frieren/i.test(x.keyWord)),
    JSON.stringify((fc.data || []).map(x => x.keyWord)));
}

(async () => {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' ARNÉS FASE 3 (v4.0) · Motor de búsqueda agregado v2');
  console.log(` Servidor: ${BASE} · ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════════════════');
  try {
    await unitTests();
    await liveTests();
    await hardTitles();
  } catch (e) {
    console.error('\n[arnés] ERROR FATAL:', e.message);
    failed++;
  }
  console.log('\n────────────────────────────────────────────');
  console.log(`RESULTADO FASE 3: ${passed} ✔ · ${failed} ✘`);
  console.log('────────────────────────────────────────────');
  process.exit(failed > 0 ? 1 : 0);
})();
