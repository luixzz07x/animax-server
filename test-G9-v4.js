#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v6.0 · FASE G9 — BATERÍA DE PRUEBAS
   (IA: config del centro de IA + quick prompts + override del operador)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-G9-v4.js          (auto-arranca el servidor :3199)
         node test-G9-v4.js 3001     (contra un servidor ya arrancado)

   [A] CONFIG IA (/api/v1/ai/config): welcomeText/description/inputPrompt
       en español + aiTypes con bandera de capacidad (Text habilitable,
       Image DESACTIVADA — no se finge) + quickPrompts completos
       (código/etiqueta/prompt), con prompts «a completar» y «cerrados».
   [B] OVERRIDE DEL OPERADOR: animax-ai-config.json (patrón
       sections-config.json) — cambia la bienvenida y los chips SIN
       publicar APK; archivo corrupto → defaults; archivo ausente →
       defaults. El endpoint NUNCA se rompe.
   [C] CONTRATO CHAT intacto: sin ANIMAX_AI_URL → error "ai-no-
       configurada" (la app activa su fallback local); sin messages →
       "faltan messages".
   [D] MODELS intacto: data[] (vacío sin ANIMAX_AI_MODEL(S)).
   ═════════════════════════════════════════════════════════════════════ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXTERNAL_PORT = Number(process.argv[2] || 0);
const PORT = EXTERNAL_PORT || 3199;
const BASE = 'http://localhost:' + PORT;
const AI_CFG_FILE = path.join(__dirname, 'animax-ai-config.json');

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
    /* ── [A] CONFIG IA ─────────────────────────────────────────────── */
    console.log('\n[A] /api/v1/ai/config — centro de IA servido');
    const cfg = await getJson('/api/v1/ai/config');
    check('config ok', cfg.ok === true);
    check('welcomeText ES presente', typeof cfg.welcomeText === 'string' && cfg.welcomeText.includes('AniMax IA'));
    check('description presente', typeof cfg.description === 'string' && cfg.description.length > 10);
    check('inputPrompt presente', typeof cfg.inputPrompt === 'string' && cfg.inputPrompt.length > 3);

    const types = Array.isArray(cfg.aiTypes) ? cfg.aiTypes : [];
    const textT = types.find(t => t.code === 'Text');
    const imgT = types.find(t => t.code === 'Image');
    check('aiTypes Text presente con enabled booleana', !!textT && typeof textT.enabled === 'boolean');
    check('aiTypes Image presente y DESACTIVADA', !!imgT && imgT.enabled === false,
      JSON.stringify(imgT || null));

    const qp = Array.isArray(cfg.quickPrompts) ? cfg.quickPrompts : [];
    check('quickPrompts ≥ 8', qp.length >= 8, 'got ' + qp.length);
    check('quickPrompts con {code,label,prompt}', qp.every(p => p.code && p.label && typeof p.prompt === 'string'));
    check('etiquetas ES (alfabeto latino)', qp.every(p =>
      /^[\u0000-\u024F\u2000-\u206F\u2200-\u22FF\s\d!¡¿?'"():;.,\-–—…·&%$#@/+*«»]+$/.test(p.label)));
    const toComplete = qp.filter(p => /[\s:]$/.test(p.prompt));
    const closed = qp.filter(p => !/[\s:]$/.test(p.prompt));
    check('hay prompts «a completar» (→ input de la app)', toComplete.length >= 1, 'got ' + toComplete.length);
    check('hay prompts cerrados (→ envío directo)', closed.length >= 1, 'got ' + closed.length);
    check('sin campos sobrantes en quickPrompts', qp.every(p =>
      Object.keys(p).every(k => ['code', 'label', 'prompt'].includes(k))));

    /* ── [B] OVERRIDE DEL OPERADOR ─────────────────────────────────── */
    console.log('\n[B] animax-ai-config.json — override sin publicar APK');
    fs.writeFileSync(AI_CFG_FILE, JSON.stringify({
      welcomeText: 'Bienvenida personalizada del operador',
      description: 'Descripción del operador',
      inputPrompt: 'Escribe aquí, máquina…',
      quickPrompts: [
        { code: 'op1', label: 'Chip del operador', prompt: 'Prompt completo del operador' },
        { code: 'op2', label: 'A completar', prompt: 'Háblame de ' }
      ]
    }));
    const cfg2 = await getJson('/api/v1/ai/config');
    check('override: welcomeText del operador', cfg2.welcomeText === 'Bienvenida personalizada del operador');
    check('override: inputPrompt del operador', cfg2.inputPrompt === 'Escribe aquí, máquina…');
    check('override: chips del operador', Array.isArray(cfg2.quickPrompts) && cfg2.quickPrompts.length === 2 &&
      cfg2.quickPrompts[0].label === 'Chip del operador');

    fs.writeFileSync(AI_CFG_FILE, '{ JSON ROTO ');
    const cfg3 = await getJson('/api/v1/ai/config');
    check('archivo corrupto → defaults sin romper', cfg3.ok === true &&
      typeof cfg3.welcomeText === 'string' && cfg3.welcomeText.includes('AniMax IA') &&
      (cfg3.quickPrompts || []).length >= 8);

    fs.unlinkSync(AI_CFG_FILE);
    const cfg4 = await getJson('/api/v1/ai/config');
    check('archivo ausente → defaults sin romper', cfg4.ok === true &&
      cfg4.welcomeText.includes('AniMax IA') && (cfg4.quickPrompts || []).length >= 8);

    /* ── [C] CONTRATO CHAT INTACTO ─────────────────────────────────── */
    console.log('\n[C] /api/v1/ai/chat — contrato v4.0 intacto');
    const chatNoCfg = await postJson('/api/v1/ai/chat', {
      messages: [{ role: 'user', content: 'hola' }]
    });
    check('sin IA configurada → ai-no-configurada', chatNoCfg.ok === false &&
      chatNoCfg.error === 'ai-no-configurada');
    const chatEmpty = await postJson('/api/v1/ai/chat', {});
    check('sin messages → faltan messages', chatEmpty.ok === false && chatEmpty.error === 'faltan messages');

    /* ── [D] MODELS INTACTO ────────────────────────────────────────── */
    console.log('\n[D] /api/v1/ai/models — sin IA → lista vacía');
    const models = await getJson('/api/v1/ai/models');
    check('models ok con data[]', models.ok === true && Array.isArray(models.data));

    /* ── RESUMEN ───────────────────────────────────────────────────── */
    console.log('\n════════════════════════════════════════');
    console.log('  G9 · ' + passed + ' pasan · ' + failed + ' fallan');
    if (failed) { console.log('  Fallas: ' + failures.join(' · ')); process.exitCode = 1; }
  } finally {
    try { fs.unlinkSync(AI_CFG_FILE); } catch {}
    if (child) child.kill();
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
