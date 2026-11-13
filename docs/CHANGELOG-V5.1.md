# CHANGELOG v5.1

> ANIMAX v5.1 — "el server que se administra solo". Todo lo nuevo vive en
> `src/modulos/`, `src/panel/`, `src/cli/` y en 3 extractores más; **cero
> dependencias nuevas** y `tsc --noEmit` limpio en TypeScript estricto.

## Resumen de alto nivel

| Área | v5.0 | v5.1 |
|---|---|---|
| Routers Express | 13 | 20 (+7: tendencias, programación, recomendaciones, listas, continuar, top, admin) |
| Extractores de video | 12 | 15 (+MixDrop, Upstream, FileLions con desempaquetador de packer) |
| Lógica de dominio | — | `src/modulos/` (6 módulos + tabla de años) |
| Panel web | — | `GET /panel` (HTML+CSS+JS embebidos, sin dependencias) |
| Métricas | JSON interno | + texto Prometheus (`GET /metrics`) |
| CLI de mantenimiento | — | `npm run cli …` (7 comandos) |
| Semilla offline | ~48 series | ~48 series + **26 películas reales** con año y alias propios |
| Suspensión de fuentes | solo config | **en caliente** (API admin + panel) |

## 1. `src/modulos/` — lógica de dominio nueva

- **recomendaciones.ts** — motor de "similares": **distancia Jaccard** sobre
  los géneros del catálogo unificado (índice vivo + semilla), bonus por mismo
  tipo (tv/pelicula/ova) y por cercanía de año de estreno; prioridad latino en
  el desempate. Corpus cacheado 10 min. Cada recomendación explica *por qué*
  (`razones: ["comparte 3 género(s)…", "mismo tipo", "estreno 2007"]`).
  Endpoint: `GET /api/v1/recomendaciones/{slug}?limite=12&idioma=`.
- **tendencias.ts** — tendencias de búsqueda por **ventana temporal con
  decaimiento exponencial** (puntaje = Σ exp(-Δt/τ), τ = ventana/3). Se nutre
  del bus de eventos: cada `GET /api/v1/buscar?q=` queda registrado y
  resuelto contra el catálogo. Ventanas de 1 h a 168 h.
  Endpoint: `GET /api/v1/tendencias?ventana=24&limite=20`.
- **programacionSemanal.ts** — calendario de emisión **lunes→domingo**, global
  y por fuente. Detección del día en 3 niveles: (1) fecha real del episodio
  cuando la fuente la trae (ISO, `dd/mm/yyyy`, "hace 2 días"); (2) día de
  observación si viene sin fecha; (3) **memo acumulativo** que fija la
  emisión tras 2+ apariciones el mismo día. Endpoints:
  `GET /api/v1/programacion[?fuente=]` y `/api/v1/programacion/fuentes`.
- **listasTop.ts** — tops con **paginación**: mejor valorados (valoración
  curada de comunidad), más vistos (frecuencia en el feed de últimos +
  valoración + bonus latino), por género y por **década** (con la tabla de
  años). `GET /api/v1/top/{valorados|vistos|genero|decada}` + `/top/decadas`.
- **gestionContinuarViendo.ts** — historial y "continuar viendo" por usuario
  en memoria: **TTL 30 días**, poda FIFO de 120 animes/usuario y LRU global de
  400 usuarios. `POST|GET|DELETE /api/v1/continuar…` + `GET /api/v1/historial`.
- **listasUsuario.ts** — listas personalizadas (favoritos, "viendo después" y
  propias) con CRUD completo y **persistencia JSON en `data/`** (best-effort
  como dominios/índice: si el FS es read-only todo sigue funcionando en
  memoria). `CRUD /api/v1/listas…` + mover entre listas.
- **aniosAnime.ts** — tabla curada de años de estreno (series) + helpers de
  década y cercanía (la usan recomendaciones y tops).

## 2. `src/rutas/` — 7 routers nuevos (todos registrados en index.ts)

`rutasTendencias` · `rutasProgramacion` · `rutasRecomendaciones` ·
`rutasListas` · `rutasContinuar` · `rutasTop` · `rutasAdmin`. Este último
monta la **API de administración**: estado global, inventario de fuentes,
suspender/reanudar en caliente, purgar caché (namespace o todo), cambio de
dominio en caliente, chequeo manual, logs y las métricas Prometheus
(`GET /metrics` y `GET /api/v1/metricas`).

## 3. `src/panel/` — panel de administración web (GET /panel)

Sin dependencias nuevas: `plantilla.ts` (HTML), `estilos.ts` (CSS) y
`guion.ts` (JS vanilla) exportan **strings** que `panelAdmin.ts` ensambla en
un solo documento. Muestra en vivo (refresco 10 s): uptime, memoria RSS/heap,
peticiones y errores, caché (hits/fallos/entradas), fuentes con circuito
breaker + dominio activo + latencia, tendencias, logs recientes y las métricas
Prometheus. Controles: purgar caché, cambiar dominio, suspender/reanudar
fuente, chequear fuentes y guardar listas. Detalle bonito: con la pestaña
abierta, el refresco cada 10 s **mantiene despierto** el servicio del plan
free de Render.

## 4. `src/extractores/` — 3 extractores nuevos (+1 utilidad)

- **mixdrop.ts** — desempaqueta el packer `p,a,c,k,e,d` y lee
  `MDCore.wurl` (con fallback a literales .mp4/.m3u8).
- **upstream.ts** — jwplayer con `sources:[{file,label}]` + packer.
- **filelions.ts** — la familia StreamWish/VidHide con file+literals y packer
  (hasta doble nivel).
- **desempaquetar.ts** — desempaquetador del packer Dean Edwards **sin
  `eval`**: decodifica base hasta 62 con charset 0-9a-zA-Z y sustituye
  `\btoken\b` por el diccionario k (soporta hasta 3 niveles encadenados).

Los tres se registran en `fabricaExtractores.ts` ANTES del último recurso
(la cadena sigue → escáner genérico → proxy directo; la regla de oro
"nunca devuelve error" se mantiene).

## 5. `src/core/` — 3 módulos nuevos

- **metricas.ts** — contadores Prometheus con etiquetas
  (`animax_http_peticiones_total{codigo="200"}`), alimentados por el bus de
  eventos, + gauges de uptime/memoria. Render en texto plano compatible con
  cualquier scraper.
- **semaforo.ts** — semáforo reutilizable de concurrencia global
  (`adquirir/ejecutar`, semáforos con nombre e instantánea para /estado).
- **fuentes.ts** — capa runtime de activación: `fuenteHabilitada()` consulta
  config + suspensión en caliente; `registro.scrapersActivos()` y la salud
  ya la usan, así que suspender una fuente desde el panel la quita del
  scraping al instante.

## 6. `src/cli/animax-cli.ts` — CLI de mantenimiento

`npm run cli salud|fuentes|probar-fuente <id>|probar-extractor <url>|caché|dominios|resumen`.
Arranca SIN levantar el server (no importa index.ts): sonda en vivo de las
22 fuentes con exit code, inventario runtime, prueba de una fuente (sonda +
búsqueda de prueba), prueba de la cadena de extractores sobre un embed,
estadísticas de caché y dominios activos/respaldos.

## 7. `src/datos/` — semilla de PELÍCULAS + alias

- **semillaPeliculas.ts** — **26 películas reales** (Akira, Your Name,
  Spirited Away, A Silent Voice, Ghost in the Shell, Princess Mononoke,
  Suzume, Demon Slayer: Mugen Train, Jujutsu Kaisen 0…) con título latino,
  idioma, **año real**, estudio, géneros y sinopsis. Se fusiona con la
  semilla de series en `semillaCatalogo.ts`, así que
  `/api/v1/catalogo?tipo=pelicula` arranca vivo en un deploy frío.
- **aliasPeliculas.ts** — alias inglés ↔ español-latino ↔ romaji de las
  películas ("El Viaje de Chihiro" ↔ Spirited Away ↔ sen to chihiro), fusionados
  en `aliasDb.EXTRA`: buscar en español encuentra el título inglés en TODAS
  las fuentes.
- `catalogoSemilla()` ahora filtra también por **tipo** (rutasCatalogo pasa
  el `?tipo=` a la semilla).

## 8. Documentación

- `docs/API.md` — 10 endpoints nuevos documentados con ejemplos curl (§14–23).
- `docs/PANEL-ADMIN.md` — guía completa del panel `/panel`.
- `docs/RENDER-FREE.md` — el plan gratis de Render explicado sin humo:
  512 MB, se duerme a los 15 min, cómo mantenerlo despierto y por qué este
  server cabe sobrado.
- `README.md` — tabla de endpoints completa (30+ rutas).

## 9. Ajustes sobre archivos existentes (mínimos, coherentes)

- `index.ts` — registra los 7 routers + el panel; cabecera actualizada.
- `package.json` — `version: 5.1.0`, script `"cli"`.
- `registro.ts` / `salud.ts` — `scrapersActivos()` y las sondas consultan la
  capa runtime `fuenteHabilitada()` (suspensión en caliente).
- `rutasEstado.ts` / `rutasSalud.ts` — versión 5.1.0, datos de películas,
  listas/continuar-viendo y semáforos; lista de endpoints ampliada.
- `rutasCatalogo.ts` — la semilla fría respeta `?tipo=` (las películas
  aparecen con el índice frío).

## Compatibilidad

Ningún endpoint v5 cambia de forma; todo lo nuevo es aditivo. `tsc --noEmit`
pasa limpio con el tsconfig estricto existente. El server sigue siendo un
solo proceso Node/tsx sin base de datos externa.
