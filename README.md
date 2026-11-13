# ANIMAX v5.1 · Servidor de API (standalone)

API multi-fuente de anime para la **app móvil ANIMAX** y para cualquier frontend.
22 fuentes scrapeadas, búsqueda unificada paralela con alias (inglés ↔ romaji ↔
siglas), deduplicación, **15 extractores de video encadenados** (Mp4Upload,
YourUpload, StreamTape, Doodstream, Voe, Ok.ru, HLS, StreamWish, FileMoon,
VidMoly, StreamSB, MixDrop, Upstream, FileLions, Mega) y **proxy de streaming**
con CORS + Range + reescritura m3u8.

## NOVEDADES v5.1 (ver `docs/CHANGELOG-V5.1.md`)

- **Lógica de dominio nueva** (`src/modulos/`): recomendaciones por **distancia
  Jaccard** (géneros + tipo + año), **tendencias** con decaimiento exponencial
  sobre los eventos de búsqueda, **programación semanal** lunes→domingo por
  fuente y global, **tops** (valorados/vistos/género/década) con paginación,
  **continuar viendo** con TTL 30 días y **listas de usuario** (favoritos,
  viendo después) con persistencia JSON.
- **Panel de administración web** en `GET /panel`: métricas en vivo, salud de
  fuentes, logs y controles (purgar caché, cambiar dominio, suspender fuente).
  HTML+CSS+JS embebidos, cero dependencias nuevas.
- **3 extractores nuevos**: MixDrop, Upstream y FileLions — con un
  **desempaquetador del packer p,a,c,k,e,d** real (sin `eval`).
- **Métricas Prometheus** en texto plano (`GET /metrics` y
  `GET /api/v1/metricas`) alimentadas por el bus de eventos.
- **Semáforo de concurrencia** reutilizable (`src/core/semaforo.ts`).
- **API admin** (`/api/v1/admin/…`): suspender/reanudar fuentes en caliente,
  purgar caché, cambiar dominio, logs, chequeo manual.
- **CLI de mantenimiento**: `npm run cli salud|fuentes|probar-fuente …`.
- **Semilla de 26 películas reales** (Akira, Your Name, Spirited Away…) con
  año, títulos latinos y alias propios: el catálogo de películas nunca
  arranca vacío.

## Estructura

```
index.ts               → ensamblado del app (app.use de cada router)
src/rutas/             → 20 routers (ultimos, buscar, anime, servidores,
                         stream, generos, catalogo, curados, cron, salud,
                         estado, dominios + tendencias, programacion,
                         recomendaciones, top, continuar, listas, admin)
src/modulos/           → lógica de dominio v5.1 (recomendaciones,
                         tendencias, programacionSemanal, listasTop,
                         gestionContinuarViendo, listasUsuario, aniosAnime)
src/panel/             → panel de administración web (GET /panel)
src/cli/               → CLI de mantenimiento (npm run cli …)
src/middleware/        → cors, seguridad, registro (logging con ids),
                         limites (rate-limit), errores
src/core/              → cola, reintentos, idioma, salud (circuit breaker),
                         dominios (cambio en caliente), eventos (métricas),
                         metricas (Prometheus), semaforo, fuentes (runtime)
src/vigilante/         → watchdog de dominios alternativos (10 min)
src/scrapers/          → 8 scrapers nuevos + reexporta los 14 previos
src/extractores/       → 15 extractores individuales + fabricaExtractores
                         (+ desempaquetar.ts del packer p,a,c,k,e,d)
src/datos/             → curados, semillaCatalogo (~48 series),
                         semillaPeliculas (26), aliasDb, aliasPeliculas
src/config/            → fuentes.json, dominiosAlternativos.json, ajustes.json
src/lib/animax/        → motor original (registro, dedupe, índice, cache…)
data/                  → persistencia JSON de las listas de usuario
docs/                  → API.md, CHANGELOG-V5.1.md, PANEL-ADMIN.md,
                         RENDER-FREE.md, DEPLOY-RENDER.md, ANADIR-FUENTE.md,
                         ANADIR-EXTRACTOR.md, CHANGELOG-V5.md
```

## Endpoints (documentados con ejemplos en `docs/API.md`)

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/` | Healthcheck raíz + resumen de fuentes |
| GET | `/api/v1/ultimos` | Últimos episodios de las 22 fuentes (caché 10 min) |
| GET | `/api/v1/buscar?q=` | Búsqueda unificada + alias (caché 1 h) |
| GET | `/api/v1/anime/{slug}` | Detalle + episodios (LATINO primero) |
| GET | `/api/v1/servidores/{slug}/{ep}` | Servidores verificados con link directo |
| GET | `/api/v1/stream?url=&ref=&raw=` | **Proxy de streaming** (mp4/m3u8, Range) |
| GET | `/api/v1/generos` | Géneros disponibles con conteo |
| GET | `/api/v1/catalogo?idioma=&genero=&tipo=` | Catálogo (latino incluye dual; `tipo=pelicula` con semilla de 26 pelis) |
| GET | `/api/v1/curados` | Destacados curados |
| GET | `/api/v1/tendencias?ventana=&limite=` | **Tendencias** con decaimiento exponencial (1 h..168 h) |
| GET | `/api/v1/tendencias/busquedas` | Últimas 30 búsquedas crudas |
| GET | `/api/v1/programacion?fuente=` | **Programación semanal** (lunes→domingo) |
| GET | `/api/v1/programacion/fuentes` | Calendario desglosado por fuente |
| GET | `/api/v1/recomendaciones/{slug}?limite=&idioma=` | **Similares** (Jaccard géneros + tipo + año) |
| GET | `/api/v1/top/valorados?pagina=&limite=` | Top mejor valorados (paginado) |
| GET | `/api/v1/top/vistos?pagina=&limite=` | Top más vistos (feed + valoración + latino) |
| GET | `/api/v1/top/genero?genero=` | Top por género (paginado) |
| GET | `/api/v1/top/decada?decada=` | Top por década (1990s, 90, 1980…) |
| GET | `/api/v1/top/decadas` | Décadas disponibles con conteo |
| POST | `/api/v1/continuar?usuario=` | Marca progreso (continuar viendo) |
| GET | `/api/v1/continuar?usuario=&limite=` | Pendientes de seguir viendo (TTL 30 días) |
| GET | `/api/v1/historial?usuario=&pagina=` | Historial paginado por usuario |
| GET/DELETE | `/api/v1/continuar/{slug}?usuario=` | Progreso de un anime / olvidarlo |
| POST | `/api/v1/continuar/reiniciar?usuario=` | Borra todo el historial del usuario |
| GET/POST | `/api/v1/listas?usuario=` | Listas del usuario (favoritos y ver-despues garantizados) |
| POST | `/api/v1/listas/{nombre}/items?usuario=` | Añade un anime a una lista |
| DELETE | `/api/v1/listas/{nombre}/items/{slug}?usuario=` | Quita un anime |
| POST | `/api/v1/listas/mover?usuario=` | Mueve un anime entre listas |
| GET | `/api/v1/salud` | Estado de cada fuente (circuit breaker) |
| GET | `/api/v1/estado` | Métricas: caché, peticiones, colas, extractores, usuarios |
| GET | `/api/v1/dominios` | Inventario de dominios activos/alternativos |
| POST | `/api/v1/dominios/{fuente}` | Cambio de dominio en caliente |
| POST | `/api/v1/dominios/{fuente}/reset` | Restaura el dominio oficial |
| GET/POST | `/api/v1/cron/refresh` | Refresca el caché de portada |
| GET | `/api/v1/admin/estado` | Vista global del server (la usa el panel) |
| GET | `/api/v1/admin/fuentes` | Inventario runtime + salud por fuente |
| POST | `/api/v1/admin/fuentes/{id}/suspender` | Suspende la fuente en caliente |
| POST | `/api/v1/admin/fuentes/{id}/reanudar` | La reanuda |
| POST | `/api/v1/admin/cache/purgar` | Purga caché (namespace o todo) |
| POST | `/api/v1/admin/dominios/{fuente}` | Cambio de dominio (vía admin) |
| POST | `/api/v1/admin/chequear-fuentes` | Sonda manual de las 22 fuentes |
| GET | `/api/v1/admin/logs` | Últimas 100 peticiones |
| POST | `/api/v1/admin/listas/guardar` | Persiste las listas a data/ |
| GET | `/metrics` · `/api/v1/metricas` | **Métricas Prometheus** (texto plano) |
| GET | `/panel` | **Panel de administración web** (docs/PANEL-ADMIN.md) |

El **slug** de un anime es `ded:{tituloNormalizado}` (deduplicado) o
`{fuente}~{slugLocal}` (una fuente concreta).

## Desarrollo

```bash
npm install
npm run dev        # tsx watch index.ts
npm start          # tsx index.ts (lo usa Render y el Dockerfile)
npm run cli salud  # CLI de mantenimiento (sin arrancar el server)
```

## Deploy

- **Render**: guía completa en `docs/DEPLOY-RENDER.md` (render.yaml ya
  incluido: build `npm install`, start `npm start`, healthcheck `/`).
- **Docker**: `docs/DEPLOY-RENDER.md` § VPS (`docker build -t animax-api .`).

## Notas de red

- Render/VPS salen con IPs de datacenter: algunas fuentes bloqueadas en un
  entorno pueden funcionar desde otro y viceversa. El **vigilante** y el
  endpoint de dominios en caliente permiten reaccionar sin redeploy.
- El plan FREE de Render apaga el servicio tras inactividad: usa un cron
  externo (cron-job.org) que llame `/api/v1/cron/refresh` cada 10 min, o
  deja abierto el panel `/panel` (se refresca solo). Guía completa y honesta
  en `docs/RENDER-FREE.md`.
