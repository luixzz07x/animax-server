# 🛰️ AniMax Server v4.1.0

Servidor privado de búsqueda para la app AniMax — el mismo concepto que usa
Seekee con su backend Buscari, pero **tuyo y gratis**: el teléfono lento ya no
busca; le pregunta a este servidor y este hace el trabajo pesado.

- **Node.js puro, CERO dependencias** (no hay nada que instalar).
- Sin anuncios, sin VIP, sin pagos, sin recolectar nada (no guarda nada: la
  caché es en memoria y muere al reiniciar).

**v4.1.0 (FASE D0.5) · PÁGINAS PROPIAS UNIFICADAS (hub.js):** el servidor ahora
**genera sus propias páginas H5** — el mismo sistema con el que Seekee muestra
sus fichas (h5.otv.cc, dominios frescos por `queryFreshDomainList`) en vez de
abrir TioAnime/MonosChinos:

- `GET /hub` → portada propia: buscador + tendencias del ranking.
- `GET /hub?q=one piece` → búsqueda propia: las tarjetas del motor agregado
  (catálogo + web con `sourceList`) enlazan a la ficha propia de cada título.
- `GET /hub/watch?u=…&t=…&src=…` → **ficha-watch propia**: episodios resueltos
  por el servidor (grid en bloques de 50, dots de idioma), chips de
  fuentes/servidores y DOBLE puente con la app:
  - **H5 → nativo:** `AnimaxHub.postMessage(jsonBody)` con mensajes
    `ready` / `servers` / `episodes` / `resolving` / `play` / `error`
    (espejo del `javascriptChannel` del APK de Seekee).
  - **nativo → H5:** `window.quan.switchSource(i)` y `quan.openEpisode(n)`
    (mismos nombres que usa Seekee para cambiar de servidor).
  - En un navegador normal (sin app) la misma página funciona sola: `<video>`
    propio con cascada de espejos de respaldo.

Batería de pruebas: `node test-faseD05-v4.js` (24 checks: puente, chips,
bloques de 50, navigationList con el grupo "AniMax · Páginas propias", etc.).

**v4.1.0 (FASE D1) · BLINDAJE: español SIEMPRE + cero caídas:**

- **Bloqueo de idioma de raíz**: `classifyLang` detecta hits ingleses
  ("english dub", "eng sub", "raw"…) → `'en'` y `groupOptions` los EXCLUYE —
  las opciones de `/api/search` siempre son español (latino/castellano/sub).
- **Idioma por espejo**: `POST /api/resolve` acepta `lang` y etiqueta CADA
  espejo (`mirrors[].lang`) — la cascada del teléfono salta de servidor sin
  cambiar de idioma.
- **Hub con auto-curación**: el `play` lleva `lang` (y cada espejo el suyo);
  `quan.autoNext(ep)` cambia de fuente del MISMO idioma y re-abre el episodio
  solo (`animax.autoEp`) cuando una fuente no entrega espejos; el idioma de
  la fuente primaria se infiere de la URL.

Batería: `node test-faseD1-v4.js` (21 checks: bloqueo de inglés, lang en
espejos, quan.autoNext, re-apertura del episodio, etc.).

**Configuración en la app (v2.1.0):** Perfil → "Servidor de búsqueda (estilo
Seekee)" → pega la URL de este servidor → Guardar → Probar conexión.
Con el servidor configurado, la BÚSQUEDA de la app muestra el botón
**"Ver en AniMax"** (página propia) y el navegador interno añade la sección
**"Páginas AniMax"**.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/hub` | **Página propia**: portada con buscador y tendencias |
| GET | `/hub?q=one piece` | **Página propia**: búsqueda unificada |
| GET | `/hub/watch?u=…` | **Página propia**: ficha-watch con puente AnimaxHub + `quan` |
| GET | `/api/ping` | Estado del servidor |
| GET | `/api/search?q=one piece` | Opciones estilo Seekee: `[Doblado] One Piece`, `[Sub] One Piece` + descripción en español |
| GET | `/api/episodes?pageUrl=…` | Lista COMPLETA de episodios de una serie (sin límite de 12) |
| POST | `/api/resolve` | `{pageUrl, episode?}` → servidores de video ordenados, validados y con sus headers (User-Agent + Referer) |
| POST | `/api/validate` | `{url, referer?}` → ¿el stream sirve? |
| GET | `/api/v1/*` | Capa espejo de la API Buscari de Seekee (47 endpoints — ver `v4-api.js`) |

## Ejecutar localmente

```bash
node index.js          # puerto 3001
PORT=8080 node index.js
```

## Desplegarlo gratis en internet

Lee **GUIA-CREAR-SERVIDOR.md** (paso a paso para principiante total:
GitHub → Render.com → tu URL en 15 minutos, $0).

## Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `PORT` | `3001` | Puerto (Render/Fly lo inyectan solos) |
| `ANIMAX_API_KEY` | *(vacío = abierto)* | Si se define, exige cabecera `X-Api-Key` (las páginas del hub aceptan `?key=…`) |
