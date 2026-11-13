# ANIMAX v5.1 · API

Base URL: `https://animax-api.onrender.com` (o el del VPS). Todo responde JSON.
Cabeceras CORS abiertas (`*`) con `Content-Range`/`Accept-Ranges` expuestos.

Convenciones comunes de respuesta:

```jsonc
{ "ok": true, "data": { ... }, "ms": 123, "cacheado": true,
  "fuentesOk": ["animeflv", "tioanime"], "fuentesFallidas": ["jkanime"] }
```

El **slug** de un anime puede ser:
- `ded:{tituloNormalizado}` → entrada deduplicada multi-fuente (p. ej. `ded:one piece`)
- `{fuente}~{slugLocal}` → una fuente concreta (p. ej. `animeflv~one-piece`)

---

## 1. `GET /` — Healthcheck raíz

Lo usa Render para saber si el servicio vive.

```json
{
  "ok": true,
  "servicio": "ANIMAX API v5",
  "uptime": 3600,
  "fuentes": { "total": 22, "vivas": 21, "caidas": 1, "circuitoAbierto": ["jkanime"] },
  "alias": 87,
  "endpoints": ["/api/v1/ultimos", "…"]
}
```

## 2. `GET /api/v1/ultimos` — Últimos episodios

Feed de las 22 fuentes deduplicado, **latino primero**. Caché 10 min (renovado
por el cron interno y `/api/v1/cron/refresh`).

```bash
curl https://animax-api.onrender.com/api/v1/ultimos
```

```jsonc
{ "ok": true, "data": {
  "episodios": [
    { "titulo": "One Piece", "slug": "ded:one piece", "portada": "https://…",
      "numero": 1105, "idioma": "latino", "fuente": "animelatinohd",
      "nombreFuente": "AnimeLatinoHD" }
  ],
  "populares": [ { "titulo": "…", "slug": "ded:…", "idioma": "dual",
    "fuentes": [ { "fuente": "animeflv", "slugLocal": "one-piece", "idioma": "sub" } ] } ]
} }
```

## 3. `GET /api/v1/buscar?q=` — Búsqueda unificada

Paralela en las 22 fuentes + expansión de alias (inglés ↔ romaji ↔ siglas:
"AOT" → shingeki no kyojin). Caché 1 h. Si casi todas las fuentes caen, se
devuelve la **semilla offline** coincidente (`"semilla": true`).

```bash
curl "https://animax-api.onrender.com/api/v1/buscar?q=rent%20a%20girlfriend"
```

```jsonc
{ "ok": true, "data": { "resultados": [
  { "titulo": "Kanojo, Okarishimasu", "slug": "ded:kanojo okarishimasu",
    "idioma": "latino",
    "fuentes": [ { "fuente": "animegratis", "slugLocal": "kanojo-okarishimasu", "idioma": "dual" },
                 { "fuente": "animeflv", "slugLocal": "kanojo-okarishimasu-2nd-season", "idioma": "sub" } ] }
] }, "fuentesOk": ["…"], "fuentesFallidas": ["…"], "ms": 850 }
```

## 4. `GET /api/v1/anime/{slug}` — Detalle

Fusión multi-fuente: unión de episodios, sinopsis/géneros del primer detalle
con datos, idioma = mejor disponible (latino > dual > sub) y fuentes
ordenadas **latino primero** (la primera es la que el "Reproducir" prueba).

```bash
curl https://animax-api.onrender.com/api/v1/anime/ded:one%20piece
curl https://animax-api.onrender.com/api/v1/anime/animeflv~one-piece
```

```jsonc
{ "ok": true, "data": {
  "titulo": "One Piece", "slug": "ded:one piece", "idioma": "dual",
  "totalEpisodios": 1100, "generos": ["accion", "aventura"],
  "sinopsis": "…", "estado": "En emisión",
  "fuentes": [ { "fuente": "animelatinohd", "idioma": "latino", "slugLocal": "one-piece" }, … ],
  "episodios": [ { "numero": 1 }, { "numero": 2 } ]
} }
```

404 si no se encuentra en ninguna fuente: `{ "ok": false, "error": "anime no encontrado" }`.

## 5. `GET /api/v1/servidores/{slug}/{ep}` — Servidores del episodio

Devuelve **solo servidores verificados** (link directo comprobado con
HEAD/Range o playlist+segmento), ordenados: idioma latino → prioridad de host
(Mp4Upload > YourUpload > StreamTape > …) → latencia. `streamUrl` apunta al
proxy propio: el reproductor no necesita extraer nada.

```bash
curl https://animax-api.onrender.com/api/v1/servidores/ded:one%20piece/1
```

```jsonc
{ "ok": true, "data": { "episodio": 1, "servidores": [
  { "servidor": "Mp4Upload", "tipo": "mp4", "idioma": "latino", "ms": 320,
    "url": "https://a3.mp4upload.com:183/d/…/video.mp4",
    "streamUrl": "/api/v1/stream?url=https%3A%2F%2Fa3.mp4upload.com…&ref=…",
    "resuelto": true, "fuente": "animelatinohd", "nombreFuente": "AnimeLatinoHD" }
] } }
```

## 6. `GET /api/v1/stream?url=&ref=&raw=` — Proxy de streaming

- `url`: URL del servidor (embed o directa). Si es un embed, la **fábrica de
  extractores** lo resuelve en cadena; si todos fallan, sirve el propio embed
  (último recurso, tipo `proxy`).
- `ref` (opcional): Referer a usar (por defecto el propio embed).
- `raw=1`: passthrough puro (lo usan los segmentos HLS reescritos).
- Soporta `Range` (seek de mp4) y reescribe los m3u8 para que los segmentos
  pasen también por el proxy.

```bash
# En un reproductor:
curl -H "Range: bytes=0-1024" \
  "https://animax-api.onrender.com/api/v1/stream?url=https%3A%2F%2F…%2Fvideo.mp4"
```

Errores: `400` url inválida · `403` host no permitido · `422` sin video ·
`429` rate-limit (720 req/min) · `502` upstream muerto.

## 7. `GET /api/v1/generos`

```jsonc
{ "ok": true, "data": { "generos": [ { "nombre": "accion", "total": 240 }, … ] } }
```

## 8. `GET /api/v1/catalogo?idioma=&genero=&tipo=`

- `idioma=latino` (incluye dual) o `idioma=sub`
- `genero=romance` · `tipo=pelicula`
- Si el índice está frío, se mezcla la **semilla offline** (`"semilla": true`).

```bash
curl "https://animax-api.onrender.com/api/v1/catalogo?idioma=latino&genero=accion"
```

## 9. `GET /api/v1/curados`

Destacados curados ("no te quedas sin anime"): ~80 títulos de altísima
demanda resueltos perezosamente (índice + búsqueda viva, caché 6 h).

```jsonc
{ "ok": true, "data": { "curados": [
  { "titulo": "Rent a Girlfriend", "slug": "ded:rent a girlfriend",
    "idioma": "latino", "disponible": true } ] } }
```

## 10. `GET /api/v1/salud` — Estado por fuente

```bash
curl https://animax-api.onrender.com/api/v1/salud
```

```jsonc
{ "ok": true,
  "resumen": { "total": 22, "vivas": 20, "caidas": 2, "circuitoAbierto": ["shuu"] },
  "fuentes": [
    { "id": "animeflv", "nombre": "AnimeFLV", "dominio": "https://animeflv.st",
      "grupo": "dual", "circuito": "cerrado", "fallosConsecutivos": 0,
      "exitos": 184, "fallos": 3, "ultimaLatenciaMs": 412,
      "omitidas": 0, "reintentoEn": null }
  ] }
```

`circuito`: `cerrado` (normal) · `abierto` (caída, se omite) · `semiabierto`
(en prueba tras el enfriamiento de 60 s).

## 11. `GET /api/v1/estado` — Métricas del servidor

Uptime, memoria, contadores de peticiones, últimas 50 peticiones con traza,
caché (hits/fallos/entradas por namespace), colas de concurrencia por fuente,
cadena de extractores y última extracción con su trazado, semilla/alias/curados.

## 12. `GET /api/v1/dominios` · `POST /api/v1/dominios/{fuente}`

Cambio de dominio **en caliente** (sin redeploy). El vigilante lo hace solo
cada 10 min con los respaldos de `src/config/dominiosAlternativos.json`.

```bash
# Ver inventario
curl https://animax-api.onrender.com/api/v1/dominios

# Conmutar una fuente a su dominio nuevo
curl -X POST https://animax-api.onrender.com/api/v1/dominios/animeflv \
  -H "Content-Type: application/json" \
  -d '{"baseUrl": "https://animeflv.tv"}'

# Volver al oficial
curl -X POST https://animax-api.onrender.com/api/v1/dominios/animeflv/reset
```

El cambio vacía los caches (`buscar`, `ultimos`, `detalle`, `servidores`) y
persiste en `animax-dominios.json` (sobrevive a reinicios).

## 13. `GET|POST /api/v1/cron/refresh`

Refresca el caché de portada (lo llama el job interno cada 10 min; útil como
keep-alive del plan free de Render vía cron-job.org).

```jsonc
{ "ok": true, "episodios": 60, "populares": 30, "curados": 82, "ms": 2400 }
```

---

# Endpoints nuevos v5.1

## 14. `GET /api/v1/tendencias?ventana=24&limite=20` — Tendencias

Tendencias de búsqueda por ventana temporal con **decaimiento exponencial**:
lo que se buscó hace 10 min pesa muchísimo más que lo de ayer (τ = ventana/3).
Cada término se resuelve al anime del catálogo unificado. `ventana` en horas
(1..168; 168 = semana completa).

```bash
curl "https://animax-api.onrender.com/api/v1/tendencias?ventana=24&limite=10"
```

```jsonc
{ "ok": true, "data": {
  "ventanaHoras": 24, "totalEventos": 137, "catalogo": 512,
  "tendencias": [
    { "titulo": "Dandadan", "slug": "ded:dandadan", "portada": "https://…",
      "idioma": "dual", "tipo": "tv", "puntuacion": 3.41,
      "busquedas": 6, "terminoFrecuente": "dandadan" } ],
  "sinResolver": [ { "termino": "nanoha", "puntuacion": 0.12 } ]
} }
```

También `GET /api/v1/tendencias/busquedas` → últimas 30 búsquedas crudas
(para el panel).

## 15. `GET /api/v1/programacion?fuente=` — Programación semanal

Calendario de emisión **lunes→domingo** detectado a partir de los últimos
episodios: fecha real del episodio cuando la fuente la trae; si no, el día en
que se observa en el feed fresco; un memo acumulativo fija el día tras 2+
apariciones el mismo día. Sin `?fuente=` es global; con `?fuente=animeflv` solo
esa fuente.

```bash
curl "https://animax-api.onrender.com/api/v1/programacion"
curl "https://animax-api.onrender.com/api/v1/programacion?fuente=animelatinohd"
curl "https://animax-api.onrender.com/api/v1/programacion/fuentes"  # vista por fuente
```

```jsonc
{ "ok": true, "data": {
  "dias": [
    { "dia": 0, "nombre": "lunes", "animes": [
      { "titulo": "One Piece", "slug": "ded:one piece", "portada": "…",
        "idioma": "latino", "episodioReciente": 1105,
        "fuentes": [ { "id": "animelatinohd", "nombre": "AnimeLatinoHD" } ],
        "dias": [0], "deteccion": "fecha" } ] } ],
  "resumen": { "animes": 48, "episodios": 210, "conFechaReal": 95,
               "porObservacion": 40, "memoEstable": 75 }
} }
```

## 16. `GET /api/v1/recomendaciones/{slug}?limite=12&idioma=` — Similares

Motor de recomendación por **distancia Jaccard** de géneros + bonus de mismo
tipo (tv/pelicula) + cercanía de año de estreno, sobre el catálogo unificado
(índice + semilla). `idioma=latino|sub` filtra los resultados.

```bash
curl "https://animax-api.onrender.com/api/v1/recomendaciones/ded:naruto?limite=5"
```

```jsonc
{ "ok": true, "data": {
  "base": { "titulo": "Naruto", "slug": "ded:naruto",
             "generos": ["accion","aventura","shounen"], "tipo": "tv", "anio": 2002 },
  "similares": [
    { "titulo": "Naruto Shippuden", "slug": "ded:naruto shippuden",
      "idioma": "latino", "tipo": "tv", "anio": 2007,
      "puntuacion": 0.925,
      "razones": [ "comparte 3 género(s): accion, aventura, shounen",
                   "mismo tipo (tv)", "estreno 2007" ] } ],
  "corpusTotal": 512
} }
```

## 17. `GET /api/v1/top/{valorados|vistos}` — Tops con paginación

`valorados` usa la valoración curada (comunidad); `vistos` mezcla frecuencia
en el feed de últimos episodios + valoración + bonus latino. Ambos paginan
con `pagina` y `limite` (≤ 50) y filtran con `idioma=latino|sub`.

```bash
curl "https://animax-api.onrender.com/api/v1/top/valorados?pagina=1&limite=5"
curl "https://animax-api.onrender.com/api/v1/top/vistos?idioma=latino"
```

```jsonc
{ "ok": true, "data": {
  "tipo": "valorados", "pagina": 1, "limite": 5, "total": 67, "paginas": 14,
  "resultados": [
    { "titulo": "Fullmetal Alchemist", "slug": "ded:fullmetal alchemist",
      "portada": "…", "generos": ["accion","aventura"], "tipo": "tv",
      "idioma": "latino", "anio": 2003, "metrica": 9.2, "etiqueta": "9.2/10" } ]
} }
```

## 18. `GET /api/v1/top/genero?genero=&decada=` — Top por género/por década

```bash
curl "https://animax-api.onrender.com/api/v1/top/genero?genero=accion&limite=10"
curl "https://animax-api.onrender.com/api/v1/top/decada?decada=1990s"
curl "https://animax-api.onrender.com/api/v1/top/decadas"   # disponibles con conteo
```

`decada` acepta `1990s`, `1990` o `90`. Los años provienen de la tabla curada
(series) y de la semilla de películas (26 títulos con año real).

## 19. `POST|GET /api/v1/continuar` — Continuar viendo + historial

Historial por usuario en memoria con **TTL 30 días** y poda por tamaño
(120 animes/usuario · 400 usuarios). El usuario se identifica con
`?usuario=` o cabecera `x-usuario`.

```bash
# Marcar progreso

curl -X POST "https://animax-api.onrender.com/api/v1/continuar?usuario=juan" \
  -H "Content-Type: application/json" \
  -d '{"slug":"ded:one piece","titulo":"One Piece","episodio":1105,
       "totalEpisodios":1100,"portada":"https://…","idioma":"latino"}'

# Continuar viendo (pendientes, más reciente primero)
curl "https://animax-api.onrender.com/api/v1/continuar?usuario=juan&limite=10"

# Historial paginado
curl "https://animax-api.onrender.com/api/v1/historial?usuario=juan&pagina=1"

# Progreso de UN anime / olvidarlo / reiniciar todo
curl "https://animax-api.onrender.com/api/v1/continuar/ded:one%20piece?usuario=juan"
curl -X DELETE "https://animax-api.onrender.com/api/v1/continuar/ded:one%20piece?usuario=juan"
curl -X POST "https://animax-api.onrender.com/api/v1/continuar/reiniciar?usuario=juan"
```

```jsonc
{ "ok": true, "data": { "usuario": "juan", "total": 3, "pendientes": [
  { "titulo": "One Piece", "slug": "ded:one piece", "episodio": 1105,
    "totalEpisodios": 1100, "idioma": "latino", "actualizado": 1712345678 } ] } }
```

## 20. CRUD `/api/v1/listas` — Listas personalizadas

Favoritos, "viendo después" y listas propias (máx. 20 listas · 300 items).
Persistencia best-effort a `data/listas-usuarios.json` (guardado cada 60 s
y al modificar).

```bash
curl "https://animax-api.onrender.com/api/v1/listas?usuario=juan"          # todas
curl -X POST "…/api/v1/listas?usuario=juan" -d '{"nombre":"animes-invierno"}'
curl "…/api/v1/listas/favoritos?usuario=juan"                             # una lista
curl -X POST "…/api/v1/listas/favoritos/items?usuario=juan" \
  -H "Content-Type: application/json" \
  -d '{"slug":"ded:frieren","titulo":"Frieren","portada":"https://…"}'
curl -X DELETE "…/api/v1/listas/favoritos/items/ded:frieren?usuario=juan"
curl -X POST "…/api/v1/listas/mover?usuario=juan" \
  -d '{"de":"favoritos","a":"ver-despues","slug":"ded:frieren"}'
curl -X DELETE "…/api/v1/listas/animes-invierno?usuario=juan"   # borrar lista
```

## 21. `GET /api/v1/admin/*` — API de administración

Estado de fuentes, suspensión/reanudación **en caliente** (sin redeploy),
purga de caché, cambio de dominio, chequeo manual y logs.

```bash
curl "https://animax-api.onrender.com/api/v1/admin/estado"
curl "https://animax-api.onrender.com/api/v1/admin/fuentes"
curl "https://animax-api.onrender.com/api/v1/admin/logs"

# Suspender/reanudar una fuente en caliente
curl -X POST "…/api/v1/admin/fuentes/jkanime/suspender"
curl -X POST "…/api/v1/admin/fuentes/jkanime/reanudar"

# Purgar caché (uno o todos los namespaces)
curl -X POST "…/api/v1/admin/cache/purgar" -H "Content-Type: application/json" -d '{}'
curl -X POST "…/api/v1/admin/cache/purgar" -d '{"namespace":"buscar"}'

# Cambio de dominio en caliente (equivale a /api/v1/dominios/{fuente})
curl -X POST "…/api/v1/admin/dominios/animeflv" \
  -H "Content-Type: application/json" -d '{"baseUrl":"https://animeflv.tv"}'
curl -X POST "…/api/v1/admin/dominios/animeflv/reset"

# Sonda de TODAS las fuentes AHORA + guardar listas de usuario
curl -X POST "…/api/v1/admin/chequear-fuentes"
curl -X POST "…/api/v1/admin/listas/guardar"
```

## 22. `GET /metrics` · `GET /api/v1/metricas` — Métricas Prometheus

Contadores estilo Prometheus en texto plano (peticiones por código HTTP,
resultados por fuente, extracciones por extractor, conmutaciones de dominio,
invalidaciones de caché) + gauges de uptime/memoria. Compatible con cualquier
scraper de Prometheus.

```bash
curl https://animax-api.onrender.com/metrics
# HELP animax_http_peticiones_total Peticiones HTTP servidas por el server.
# TYPE animax_http_peticiones_total counter
animax_http_peticiones_total{codigo="200"} 1284
animax_uptime_segundos 3600
```

## 23. `GET /panel` — Panel de administración web

HTML servido por el propio server (CSS y JS embebidos, sin dependencias):
métricas en vivo, salud de fuentes con circuito, logs recientes, tendencias y
controles (purgar caché, cambiar dominio, suspender/reanudar fuente). Ver
`docs/PANEL-ADMIN.md`.

---

## Rate-limit

240 req/min por IP en la API · 720 req/min en `/api/v1/stream`. Respuesta
`429` con `Retry-After`. Healthcheck (`/`, `/api/v1/salud`, `/api/v1/estado`)
exento (lo usan los monitores).
