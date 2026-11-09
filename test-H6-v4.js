#!/usr/bin/env node
'use strict';
/* ═════════════════════════════════════════════════════════════════════
   AniMax Server v7.0 · FASE H6 — BATERÍA DE PRUEBAS
   (Player con cabeceras + TTL de streams + re-resolve + subs por dominio)
   ═════════════════════════════════════════════════════════════════════
   Uso:  node test-H6-v4.js          (auto-arranca el servidor :3210)
         node test-H6-v4.js 3210     (contra un servidor ya arrancado)

   [A] CONTRATOS EN VIVO: /api/v1/tv/configuration/subtitles responde con
       la forma que consume SubtitlesApiV4 (subtitles.domainList + vttList)
       con y sin ?domain=; grep del cliente Kotlin (endpoint + runCatching).
   [B] UNIT DEL TTL: port EXACTA de VideoPlayerBean.isExpired
       (HubContracts.kt / StreamHttpFactory.isExpired): recién resuelto →
       fresco; >4 h → expirado; límite exacto (4 h justo → fresco);
       updateMediaUrlTime==0 → fresco; tiempo futuro → fresco; TTL
       configurable de 1 h.
   [C] ESTÁTICA DE CONTRATOS KOTLIN (grep sobre los archivos de H6):
       helper único StreamHttpFactory con setDefaultRequestProperties en
       WebStreamPlayer/EmbeddedPlayer/PlaybackService (sin factories HTTP
       sueltas); updateMediaUrlTime sellado al resolver; re-resolve
       automático en historial («Reconectando fuente…») y descargas
       (StreamReResolver compartido); re-resolve reactiva a 403/410 con
       retoma de posición (EmbeddedPlayer + AutoPlayerScreen cableado);
       descargas con headers persistidos; Cast con headers + honestidad
       documentada; reporte de subtítulos G8 accesible desde el player;
       subs por dominio en el player; cliente de subtitles con
       runCatching; PlayRequest aditivo; y CERO `!!` en TODOS los
       archivos tocados (grep duro fuera de comentarios).
   [D] ESTÁTICA GENERAL: node --check de test-H6-v4.js + balance Kotlin
       ${}-aware de cada .kt tocado (checker de test-H4) + marcadores de
       fases previas (G5/G6/G7/Fase 14/B3/H3) intactos.
   ═════════════════════════════════════════════════════════════════════ */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EXTERNAL_PORT = Number(process.argv[2] || 0);
const PORT = EXTERNAL_PORT || 3210;
const BASE = 'http://localhost:' + PORT;
const ROOT = path.join(__dirname, '..', '..');
const KOTLIN = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'animax', 'app');

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
}

async function getJson(base, urlPath) {
  const res = await fetch(base + urlPath, { signal: AbortSignal.timeout(30000) });
  const body = await res.text();
  try { return JSON.parse(body); } catch { return { _raw: body.slice(0, 200), _status: res.status }; }
}

function readKt(rel) {
  return fs.readFileSync(path.join(KOTLIN, ...rel.split('/')), 'utf8');
}

/* ── Port EXACTA de VideoPlayerBean.isExpired (HubContracts.kt) ────────
   También vive en StreamHttpFactory.isExpired para historial/descargas:
   updateMediaUrlTime <= 0 → NUNCA expira; si no, now - t > maxAge. */
const TTL_4H = 4 * 60 * 60 * 1000;
function isExpired(updateMediaUrlTime, maxAgeMs, nowMs) {
  if (updateMediaUrlTime <= 0) return false;
  return nowMs - updateMediaUrlTime > maxAgeMs;
}

/* QA estática Kotlin ${}-aware (checker COPIADO de test-H4-v4.js). */
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

/* Elimina comentarios de línea y de bloque (y respeta strings) para el
   grep duro de `!!`: si aparece FUERA de comentarios, la prueba falla. */
function stripComments(src) {
  let out = '', state = 'code', i = 0; const N = src.length;
  while (i < N) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === '"' || c === "'") { state = c; out += c; i++; continue; }
      out += c; i++;
    } else if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; }
      i++;
    } else if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; i += 2; continue; }
      if (c === '\n') out += '\n';
      i++;
    } else {
      if (c === '\\') { out += c + (n || ''); i += 2; continue; }
      out += c;
      if (c === state) state = 'code';
      i++;
    }
  }
  return out;
}

function nodeCheck(file) {
  try { execSync('node --check "' + file + '"', { stdio: 'pipe' }); return ''; }
  catch (e) { return String(e.message || e); }
}

async function spawnServer(port) {
  const child = spawn('node', [path.join(__dirname, 'index.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  await new Promise(r => setTimeout(r, 2500));
  return child;
}

async function main() {
  let childA = null;
  if (!EXTERNAL_PORT) childA = await spawnServer(PORT);
  try {
    /* ══ [A] CONTRATO /tv/configuration/subtitles EN VIVO ═════════ */
    console.log('\n[A] /api/v1/tv/configuration/subtitles — forma consumible');
    const sub = await getJson(BASE, '/api/v1/tv/configuration/subtitles');
    check('endpoint responde ok:true', sub.ok === true, JSON.stringify(sub).slice(0, 120));
    check('subtitles.domainList es lista de farmacias (no vacía)',
      Array.isArray(sub.subtitles && sub.subtitles.domainList) && sub.subtitles.domainList.length > 0);
    check('subtitles.vttList es lista (el cliente la parsea con optJSONArray)',
      Array.isArray(sub.subtitles && sub.subtitles.vttList));
    check('forma estable con ?domain= (el cliente consulta por host)',
      (await getJson(BASE, '/api/v1/tv/configuration/subtitles?domain=vidmoly.to')).ok === true);

    const subsApi = readKt('data/remote/SubtitlesApiV4.kt');
    check('cliente Kotlin apunta al MISMO endpoint (grep)',
      subsApi.includes('/api/v1/tv/configuration/subtitles'));
    check('cliente Kotlin NUNCA lanza (runCatching) y parsea vttList',
      subsApi.includes('runCatching') && subsApi.includes('optJSONArray("vttList")'));
    check('reporte de subtítulos G8 en el cliente (POST /api/v1/report/web)',
      subsApi.includes('reportSubtitle') && subsApi.includes('/api/v1/report/web'));

    /* ══ [B] UNIT DEL TTL (port de isExpired) ═════════════════════ */
    console.log('\n[B] TTL de streams — port de VideoPlayerBean.isExpired');
    const now = Date.now();
    check('recién resuelto (hace 1 s) → FRESCO', !isExpired(now - 1000, TTL_4H, now));
    check('> 4 h (4 h + 1 ms) → EXPIRADO', isExpired(now - TTL_4H - 1, TTL_4H, now));
    check('límite EXACTO: 4 h justo → FRESCO (comparación estricta >)',
      !isExpired(now - TTL_4H, TTL_4H, now));
    check('updateMediaUrlTime == 0 (sin dato) → se asume FRESCO',
      !isExpired(0, TTL_4H, now));
    check('sello en el futuro (diff negativo) → FRESCO (nunca lanza)',
      !isExpired(now + 60000, TTL_4H, now));
    check('TTL CONFIGURABLE: maxAge 1 h → 2 h expirado / 30 min fresco',
      isExpired(now - 2 * 3600e3, 3600e3, now) && !isExpired(now - 1800e3, 3600e3, now));
    const helper = readKt('core/util/StreamHttpFactory.kt');
    check('StreamHttpFactory.isExpired es el port (misma lógica: <=0 fresco, > estricto)',
      helper.includes('if (updateMediaUrlTime <= 0L) return false') &&
      helper.includes('nowMs - updateMediaUrlTime > maxAgeMs'));

    /* ══ [C] ESTÁTICA DE CONTRATOS KOTLIN ═════════════════════════ */
    console.log('\n[C] contratos en la app (grep de los archivos de H6)');

    const wsp = readKt('ui/player/WebStreamPlayer.kt');
    const emb = readKt('ui/detail/EmbeddedPlayer.kt');
    const pbs = readKt('service/PlaybackService.kt');
    const cast = readKt('cast/CastBus.kt');
    const castE = readKt('cast/CastEngine.kt');
    const dls = readKt('data/downloads/DownloadsRepository.kt');
    const worker = readKt('data/downloads/DownloadWorker.kt');
    const hist = readKt('data/repository/HistoryRepository.kt');
    const entities = readKt('data/local/db/Entities.kt');
    const resolver = readKt('data/web/StreamReResolver.kt');
    const playReq = readKt('domain/model/PlayRequest.kt');
    const auto = readKt('ui/player/AutoPlayerScreen.kt');

    // 1) Helper ÚNICO: setDefaultRequestProperties vive SOLO en el helper.
    check('helper único: StreamHttpFactory aplica setDefaultRequestProperties + setUserAgent',
      helper.includes('.setDefaultRequestProperties(effective)') && helper.includes('.setUserAgent('));
    check('WebStreamPlayer usa el MISMO helper (sin DefaultHttpDataSource.Factory() suelta)',
      wsp.includes('StreamHttpFactory.httpFactory') && !wsp.includes('DefaultHttpDataSource.Factory()'));
    check('EmbeddedPlayer usa el MISMO helper (sin DefaultHttpDataSource.Factory() suelta)',
      emb.includes('StreamHttpFactory.httpFactory') && !emb.includes('DefaultHttpDataSource.Factory()'));
    check('PlaybackService usa el MISMO helper (sin DefaultHttpDataSource.Factory() suelta)',
      pbs.includes('StreamHttpFactory.httpFactory') && !pbs.includes('DefaultHttpDataSource.Factory()'));
    check('defaults honestos del helper: Accept comodín + UA Chrome móvil + Referer inferido',
      helper.includes('const val DEFAULT_ACCEPT') && helper.includes('const val MOBILE_CHROME_UA') &&
      helper.includes('Referer') && helper.includes('originUrl'));

    // 2) TTL sellado al resolver + persistido en historial.
    check('historial: recordEpisode persiste updateMediaUrlTime + mediaHeadersJson + originUrl (aditivo)',
      hist.includes('updateMediaUrlTime: Long = 0L') && hist.includes('mediaHeadersJson') &&
      hist.includes('originUrl'));
    check('EmbeddedPlayer SELLA updateMediaUrlTime = System.currentTimeMillis() al reproducir',
      emb.includes('updateMediaUrlTime =') && emb.includes('System.currentTimeMillis()'));
    check('entidades: watch_history + downloads con columnas TTL/headers (solo aditivo)',
      entities.includes('val updateMediaUrlTime: Long = 0L') &&
      entities.includes('val headersJson: String? = null') &&
      entities.includes('val mediaHeadersJson: String? = null'));

    // 3) Re-resolve automático en historial/descargas.
    check('historial: TTL gate + UI honesta «Reconectando fuente…» (re-resolve automático)',
      emb.includes('StreamHttpFactory.isExpired') && emb.includes('Reconectando fuente'));
    check('componente COMPARTIDO StreamReResolver (historial/descargas no lo duplican)',
      resolver.includes('object StreamReResolver') && resolver.includes('resolveBestStream') &&
      resolver.includes('withTimeoutOrNull'));
    check('descargas: retry/resume re-resuelven si el m3u8 expiró (refreshIfExpired + isExpired)',
      dls.includes('refreshIfExpired') && dls.includes('StreamHttpFactory.isExpired') &&
      dls.includes('StreamReResolver.reResolve'));

    // 4) Re-resolve reactiva a 403/410 con retoma de posición.
    check('re-resolve a 403/410: detección INVALID_RESPONSE_CODE en el helper',
      helper.includes('isExpiredStreamError') && helper.includes('InvalidResponseCodeException') &&
      helper.includes('403') && helper.includes('410'));
    check('WebStreamPlayer: hook onStreamExpired (UNA vez) + retoma de posición (forceResumeOnce)',
      wsp.includes('onStreamExpired') && wsp.includes('expiredReResolveDone') &&
      wsp.includes('forceResumeOnce'));
    check('EmbeddedPlayer: re-resolve reactiva a 403 con la cadena de caza existente',
      emb.includes('isExpiredStreamError') && emb.includes('expiredReResolved'));
    check('AutoPlayerScreen: re-resolve reactiva CABLEADA (onStreamExpired → reResolveAfterExpiry, UNA vez)',
      auto.includes('onStreamExpired = { vm.reResolveAfterExpiry(it) }') &&
      auto.includes('reResolveAttempts') && auto.includes('Reconectando fuente'));
    check('posición rescatada del 403 viaja al player fresco (resumeAfterExpiryMs → startPositionMs)',
      auto.includes('resumeAfterExpiryMs') && auto.includes('startPositionMs = resumeAtMs') &&
      wsp.includes('startPositionMs') &&
      wsp.includes('resumeTargetMs = remember { mutableStateOf(startPositionMs) }'));

    // 5) Descargas con headers (incluidas las re-descargas).
    check('descargas: cabeceras PERSISTIDAS en la fila y re-usadas en resume/retry/prioridad',
      dls.includes('headersJson') && dls.includes('headersMap()') &&
      dls.includes('fresh.headersMap()'));
    check('worker de descargas aplica las cabeceras (KEY_HEADERS → request.header)',
      worker.includes('KEY_HEADERS') && worker.includes('extraHeaders.forEach'));
    check('sniffer del navegador: descarga con cabeceras inferidas (StreamHttpFactory)',
      dls.includes('enqueueSniff') && dls.includes('StreamHttpFactory.effectiveHeaders'));

    // 6) Cast con headers + honestidad.
    check('Cast: load(headers) + cabeceras en requestMetadata del MediaItem',
      cast.includes('headers: Map<String, String> = emptyMap()') &&
      cast.includes('setRequestMetadata') && cast.includes('com.animax.cast.header.'));
    check('Cast: HONESTIDAD — Default Media Receiver NO puede aplicar Referer/UA (documentado)',
      cast.includes('Default Media Receiver') && cast.includes('NO puede aplicar') &&
      cast.includes('limitación'));
    check('CastEngine transmite snap.headers (y CastSnapshot los lleva con default)',
      castE.includes('headers = snap.headers') && cast.includes('val headers: Map<String, String> = emptyMap()'));

    // 7) Subtítulos por dominio + reporte G8 accesible DESDE el player.
    check('WebStreamPlayer: subtítulos por dominio (SubtitlesApiV4.byDomain + timeout corto)',
      wsp.includes('SubtitlesApiV4') && wsp.includes('byDomain') &&
      wsp.includes('withTimeoutOrNull(2_500L)'));
    check('WebStreamPlayer: botón de REPORTE de subtítulos (G8) accesible desde el player',
      wsp.includes('reportSubtitle') && wsp.includes('Reportar un problema de subtítulos') &&
      wsp.includes('AlertDialog'));

    // 8) Contrato aditivo PlayRequest.
    check('PlayRequest: campos aditivos con defaults (headers/originUrl/updateMediaUrlTime)',
      playReq.includes('val headers: Map<String, String> = emptyMap()') &&
      playReq.includes('val originUrl: String = ""') &&
      playReq.includes('val updateMediaUrlTime: Long = 0L'));

    // 9) Grep DURO: cero `!!` en TODOS los archivos tocados.
    const touched = [
      'core/util/StreamHttpFactory.kt',
      'domain/model/PlayRequest.kt',
      'ui/player/WebStreamPlayer.kt',
      'ui/player/AutoPlayerScreen.kt',
      'ui/detail/EmbeddedPlayer.kt',
      'service/PlaybackService.kt',
      'cast/CastBus.kt',
      'cast/CastEngine.kt',
      'data/local/db/Entities.kt',
      'data/local/db/AppDatabase.kt',
      'data/repository/HistoryRepository.kt',
      'data/web/StreamReResolver.kt',
      'data/downloads/DownloadsRepository.kt'
    ];
    const withBang = touched.filter(f => stripComments(readKt(f)).includes('!!'));
    check('cero `!!` fuera de comentarios en los 13 archivos de H6',
      withBang.length === 0, withBang.join(', '));

    /* ══ [D] ESTÁTICA GENERAL ═════════════════════════════════════ */
    console.log('\n[D] estática general: node --check + balance Kotlin + marcadores');
    check('node --check test-H6-v4.js', nodeCheck(__filename) === '');

    for (const k of touched) {
      const bal = balanceKt(readKt(k));
      check('balance Kotlin ' + k, bal === null, bal || '');
    }

    // Regresión ligera: los marcadores de fases previas SIGUEN ahí.
    check('marcadores previos intactos en WebStreamPlayer (Fase 3 · G5 · G7 · H3)',
      wsp.includes('v3.0 (Fase 3)') && wsp.includes('v6.0 (G5)') &&
      wsp.includes('v6.0 (G7)') && wsp.includes('H3'));
    check('marcadores previos intactos en AutoPlayerScreen (Fase 2 · D1 · H6 aditivo)',
      auto.includes('FASE 2 (v2.1)') && auto.includes('v4.1 (FASE D1)') &&
      auto.includes('v7.0 (H6)'));
    check('marcadores previos intactos en EmbeddedPlayer (B3 · Fase 13)',
      emb.includes('v4.1 (B3)') && emb.includes('Fase 13'));
    check('marcadores previos intactos en descargas (Fase 16 · G6)',
      dls.includes('v4.0 (Fase 16)') && dls.includes('G6'));
    check('marcadores previos intactos en Cast (G7) y PlaybackService (Fase 14)',
      cast.includes('v6.0 (G7)') && pbs.includes('v4.0 (Fase 14)'));
    check('marcadores previos intactos en historial (Fase 15)',
      hist.includes('v4.0 (Fase 15)'));
  } catch (e) {
    check('batería sin excepción', false, String(e));
  } finally {
    if (childA) childA.kill();
  }

  console.log('\n════════════════════════════════════════════════');
  console.log('FASE H6 · ' + passed + ' pasan · ' + failed + ' fallan');
  if (failures.length) console.log('FALLOS:\n - ' + failures.join('\n - '));
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
