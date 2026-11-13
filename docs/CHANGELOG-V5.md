# ANIMAX v5 · CHANGELOG

## v5.0.0 — Modularización total y fiabilidad

Sobre la v4 (server standalone de 335 líneas + `src/lib/animax`):

### Modularización total

- `index.ts` queda en **solo ensamblado** (~110 líneas): `app.use` de 13
  routers + middleware + jobs. Cero lógica de negocio.
- **`src/rutas/`**: rutasUltimos, rutasBuscar, rutasAnime, rutasServidores,
  rutasStream (proxy con CORS + Range + reescritura m3u8), rutasGeneros,
  rutasCatalogo, rutasCurados, rutasCron, rutasSalud, rutasEstado,
  rutasDominios y utilidades comunes.
- **`src/middleware/`**: cors, seguridad (headers), registro (logging por
  petición con traza de 8 hex + `X-Request-Id`), limites (rate-limit en
  memoria, exime health/estado), errores (manejo centralizado + envoltorio
  async para Express 4).
- **`src/core/`**: cola (concurrencia limitada por fuente + techo global),
  reintentos (backoff exponencial genérico), idioma (`resolverIdioma`:
  cualquier fuente del grupo latino → resultado unificado "latino" y
  priorizado), salud (health-check periódico + **circuit breaker** con
  semi-apertura), dominios (cambio de dominio en caliente persistente),
  eventos (EventEmitter de métricas con contadores y buffer de peticiones).

### 8 fuentes nuevas → 22 en total

| Fuente | Dominio | Grupo | Idioma |
|---|---|---|---|
| AnimeID | animeid.tv | latino | latino |
| AnimeYT | animeyt.tv | latino | latino |
| AnimeLeyend | anime-leyend.net | dual | dual |
| OtaksTV | otak.tv | latino | latino |
| AnimeTwilight | animetwilight.com | dual | dual |
| AnimePlus | animeplus.vc | sub | sub |
| AnimeNova | animenova.org | sub | sub |
| AnimeBuka | animebuka.com | sub | sub |

Todas con el motor genérico + failover silencioso; AnimeID y OtaksTV con
métodos propios de búsqueda/feed. Reexportadas desde `src/scrapers/index.ts`
junto a las 14 previas.

### 12 extractores individuales + fábrica en cadena

`src/extractores/`: **mp4upload, yourupload, streamtape, doodstream, voe,
okru, m3u8 (HLS genérico), streamwish, filemoon, vidmoly, streamsb, mega**.

- Cada uno en SU archivo con el contrato `ExtractorVideo`
  (`{ urlDirecta, tipo: 'mp4'|'m3u8'|'proxy', calidad?, headers? }`).
- **fabricaExtractores.ts** los encadena por prioridad (config en
  `ajustes.json`): si uno falla pasa al siguiente; escáner genérico final;
  **último recurso: devuelve el iframe scrapeado vía proxy (`tipo: "proxy"`).
  Nunca "reproductor propio no soportado".**
- Mega pasa siempre a proxy (su API cifrada no expone directo).
- Trazado de la última extracción visible en `/api/v1/estado`.

### Watchdog de dominios

- `src/vigilante/vigilante.ts`: cada 10 min prueba las 22 fuentes; si una
  cae, prueba sus **dominios de respaldo**
  (`src/config/dominiosAlternativos.json`, 2-4 por fuente) y **conmuta en
  caliente** al primero vivo (persistido en `animax-dominios.json`).
- El cliente HTTP **reescribe** todas las URLs de una fuente hacia su
  dominio activo → el cambio redirige el scraping completo sin redeploy y
  sin tocar los scrapers.
- Endpoint manual: `GET/POST /api/v1/dominios/{fuente}` (+ `/reset`),
  que vacía los caches envenenados.

### Confiabilidad

- **Circuit breaker** integrado en el registro: fuente con el circuito
  ABIERTO se omite al instante (cero latencia para el usuario);
  semi-apertura tras 60 s; éxitos/fallos reales realimentan la salud.
- **Cola por fuente** (3 concurrentes por sitio, 24 global): un pico de
  tráfico ya no dispara 20 búsquedas simultáneas contra el mismo dominio.
- **Rate-limit** en memoria: 240 req/min API · 720 req/min proxy de
  streaming (los HLS son decenas de segmentos) · health/estado exentos.
- **Semilla offline** (`src/datos/semillaCatalogo.ts`, ~48 títulos con
  nombres latinos): catálogo y búsqueda nunca vacíos en arranque frío o
  caída general; el fallback universal de detalle/servidores los revive.
- **aliasDb** (`src/datos/aliasDb.ts`): alias originales + siglas (AOT, MHA,
  JJK, DBZ, KNY…) y registro en caliente; integrado en la búsqueda
  unificada.
- Cache con métricas de hits/fallos y entradas por namespace.

### Config central

- `src/config/fuentes.json` (22 fuentes + tuning, espejo de
  `src/lib/animax/fuentes.json`), `src/config/dominiosAlternativos.json`,
  `src/config/ajustes.json` (timeouts, TTLs, prioridad de extractores,
  rate-limit, cola, salud, vigilante, reintentos).

### Docs

- `docs/API.md` (15 endpoints con ejemplos), `docs/DEPLOY-RENDER.md`,
  `docs/ANADIR-FUENTE.md`, `docs/ANADIR-EXTRACTOR.md`, README v5.

### Sin rupturas

- `render.yaml`, `Dockerfile`, `bun.lock`, `public/` intactos.
- Motor original (`src/lib/animax/*`) intacto salvo integraciones puntuales:
  `registro.ts` (registro de las 8 fuentes + circuit breaker + cola +
  aliasDb), `http.ts` (reescritura de dominio en caliente),
  `cache.ts` (métricas), `fuentes.json` (nuevas fuentes).
