'use strict';
/* ═══════════════════════════════════════════════════════════════════
   AniMax Server 8.0.2 · CAPA NUBE ("cloud.js")
   ═══════════════════════════════════════════════════════════════════
   Lo que Seekee resuelve con su backend propietario, AniMax lo sirve
   desde TU servidor. La app pregunta a estos endpoints al arrancar y
   se MEJORA SOLA — sin publicar un APK nuevo:

     GET /api/cloud/sources      → fuentes de búsqueda tier-1 VIGENTES
                                   (host + plantilla {q} + idioma + tipo),
                                   ya rotadas a dominios frescos por el
                                   watchdog. La app las fusiona en su
                                   motor local.
     GET /api/cloud/servers      → catálogo de la ServerFarm: hosts de
                                   video conocidos con marcadores de
                                   calidad (mp4 directo / hls / iframe).
     GET /api/cloud/streamblock  → blocklist de anuncios DE STREAM:
                                   hosts de ad-CDNs de video y patrones
                                   de ruta que el filtro HLS de la app
                                   (HlsAdFilterDataSource) fusiona en
                                   caliente.
     GET /api/cloud/all          → los tres en un solo fetch (para abrir
                                   la app con UNA petición).

   Todo cachea 10 min en memoria (las listas no cambian por segundo) y
   responde con CORS abierto + Cache-Control público.
   ═══════════════════════════════════════════════════════════════════ */

/* ── Catálogo de la ServerFarm (espejo del AutoPlayResolver de la app) ──
   kind: 'mp4' (directo, mejor calidad) | 'hls' (m3u8) | 'iframe' (WebView).
   El orden ES la prioridad con la que la app prueba los servidores. */
const SERVER_FARM = [
  { name: 'Hydrax',        host: 'hydrax.net',        kind: 'hls',    note: 'clave para anime español' },
  { name: 'Megavo',        host: 'megavo.to',         kind: 'mp4',    note: 'directo rápido' },
  { name: 'Vidtodo',       host: 'vidtodo.pro',       kind: 'mp4',    note: '' },
  { name: 'StreamWish',    host: 'streamwish.to',     kind: 'mp4',    note: '' },
  { name: 'Dood',          host: 'dood.wf',           kind: 'mp4',    note: 'doodstream familia' },
  { name: 'DoodStream',    host: 'doodstream.com',    kind: 'mp4',    note: '' },
  { name: 'Voe',           host: 'voe.sx',            kind: 'mp4',    note: '' },
  { name: 'MixDrop',       host: 'mixdrop.ag',        kind: 'mp4',    note: 'fam. mixdrop' },
  { name: 'MixDropClub',   host: 'mixdrop.club',      kind: 'mp4',    note: '' },
  { name: 'OkRu',          host: 'ok.ru',             kind: 'mp4',    note: 'video social ruso' },
  { name: 'Streamtape',    host: 'streamtape.com',    kind: 'mp4',    note: 'fam. streamtape' },
  { name: 'StreamTapeV2',  host: 'streamtape.to',     kind: 'mp4',    note: '' },
  { name: 'Strcloud',      host: 'strcloud.link',     kind: 'mp4',    note: '' },
  { name: 'Streamlare',    host: 'streamlare.com',    kind: 'mp4',    note: '' },
  { name: 'Vtbe',          host: 'vtbe.to',           kind: 'mp4',    note: 'voe familia' },
  { name: 'UpVid',         host: 'upvid.org',         kind: 'mp4',    note: '' },
  { name: 'StreamSB',      host: 'streamsb.net',      kind: 'mp4',    note: '' },
  { name: 'Vidmoly',       host: 'vidmoly.me',        kind: 'mp4',    note: '' },
  { name: 'Vidhide',       host: 'vidhidepro.com',    kind: 'mp4',    note: '' },
  { name: 'Filemoon',      host: 'filemoon.sx',       kind: 'mp4',    note: '' },
  { name: 'HDvid',         host: 'hdvid.tv',          kind: 'mp4',    note: '' },
  { name: 'StreamM4U',     host: 'streamm4u.club',   kind: 'iframe', note: '' },
  { name: 'Mp4Upload',     host: 'mp4upload.com',     kind: 'mp4',    note: '' },
  { name: 'YourUpload',    host: 'yourupload.com',    kind: 'mp4',    note: '' },
  { name: 'BurstCloud',    host: 'burstcloud.co',    kind: 'mp4',    note: '' },
  { name: 'StreamVid',     host: 'streamvid.net',     kind: 'mp4',    note: '' }
];

/* ── Blocklist de STREAM: anuncios cosidos en manifiestos HLS ──
   hosts: ad-CDNs de VIDEO (el bloqueador de PÁGINAS no los ve porque
   los pide el player, no el WebView).
   paths: patrones de URL que delatan un segmento/variante de anuncio. */
const STREAM_AD_HOSTS = [
  // Google / IMA / AdMob
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'admob.com', 'applovin.com', 'unityads.unity3d.com',
  // Pop-under / redirect típicos de mirrors
  'popads.net', 'popcash.net', 'propellerads.com', 'adsterra.com',
  'exoclick.com', 'juicyads.com', 'trafficjunky.net', 'trafficfactory.biz',
  'hilltopads.net', 'onclickads.net', 'onclasrv.com',
  // Ad-tech / RTB de video
  'smartadserver.com', 'rubiconproject.com', 'pubmatic.com', 'criteo.com',
  'adnxs.com', 'adsrvr.org', 'openx.net', 'casalemedia.com',
  'magnite.com', 'indexww.com', '33across.com', 'sharethrough.com',
  'adform.net', 'adroll.com', 'media.net', 'zedo.com',
  'amazon-adsystem.com', 'taboola.com', 'outbrain.com', 'mgid.com',
  'revcontent.com', 'yieldmo.com',
  // SSAI (server-side ad insertion)
  'teads.tv', 'springserve.com', 'freewheel.tv', 'stickyadstv.com',
  'broadpeak.tv', 'yospace.com', 'eyewonder.com', 'improvedigital.com',
  'spotxchange.com', 'spotx.tv', 'lkqd.net', 'aniview.com',
  'vidoomy.com', 'smartclip.net', 'adition.com', 'videoplaza.com',
  // Verificación / píxeles de anuncios
  'moatads.com', 'adsafeprotected.com', 'doubleverify.com',
  'scorecardresearch.com'
];

const STREAM_AD_PATHS = [
  '/ads/', '/ad/', '/adv/', 'preroll', 'postroll', 'midroll',
  'adserver', 'ad_tag', 'adtag', 'adtype=', 'ad_break', 'adbreak',
  '/advertisement', 'adslot', 'admarker', 'adplayer',
  'vast', 'adindex', 'bumper', '/adcreatives', 'adcreative'
];

/* ── Cache en memoria (10 min) ── */
let cache = { ts: 0, sources: null };
const CACHE_TTL = 10 * 60 * 1000;

function buildCloud(deps) {
  const { allSitesConfig, siteHealth, VERSION } = deps;

  function sourcesPayload() {
    const now = Date.now();
    if (cache.sources && now - cache.ts < CACHE_TTL) return cache.sources;
    const sites = allSitesConfig().map(s => {
      const h = siteHealth.get(s.host);
      const alive = !h || h.ok; // sin datos → se asume vivo (la app lo prueba igual)
      return {
        host: s.host,
        template: s.tpl,
        lang: s.lang || 'sub',
        kind: s.kind || 'anime',
        alive
      };
    });
    cache = { ts: now, sources: sites };
    return sites;
  }

  function serversPayload() {
    return SERVER_FARM.map(s => ({ ...s }));
  }

  function streamBlockPayload() {
    return { hosts: [...STREAM_AD_HOSTS], paths: [...STREAM_AD_PATHS] };
  }

  /** Registra las rutas /api/cloud/* en el router clásico de index.js. */
  function register(path, req, res, json) {
    const send = (obj) => json(res, 200, {
      ...obj,
      server: 'animax-server ' + VERSION,
      generatedAt: new Date().toISOString()
    });

    if (path === '/api/cloud/sources' && req.method === 'GET') {
      send({ ok: true, count: sourcesPayload().length, sources: sourcesPayload() });
      return true;
    }
    if (path === '/api/cloud/servers' && req.method === 'GET') {
      send({ ok: true, count: serversPayload().length, servers: serversPayload() });
      return true;
    }
    if (path === '/api/cloud/streamblock' && req.method === 'GET') {
      const p = streamBlockPayload();
      send({ ok: true, hosts: p.hosts, paths: p.paths });
      return true;
    }
    if (path === '/api/cloud/all' && req.method === 'GET') {
      const sb = streamBlockPayload();
      send({
        ok: true,
        sources: sourcesPayload(),
        servers: serversPayload(),
        streamblock: sb
      });
      return true;
    }
    return false; // no era ruta de esta capa
  }

  return { register };
}

module.exports = { buildCloud };
