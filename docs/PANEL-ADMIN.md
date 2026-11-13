# Panel de administración · `GET /panel` (v5.1)

El server ANIMAX v5.1 incluye un **panel web de administración** servido por
el propio proceso: `http://localhost:3001/panel` (o `https://animax-api.onrender.com/panel`).
No tiene dependencias nuevas ni build: `src/panel/panelAdmin.ts` ensambla la
plantilla HTML (`plantilla.ts`), los estilos (`estilos.ts`) y el guion
(`guion.ts`) — tres módulos TS que exportan strings — en un único documento
con CSS y JS **embebidos**.

```
src/panel/
├── plantilla.ts   → HTML (esqueleto del panel)
├── estilos.ts     → CSS (tema oscuro, responsive, sin frameworks)
├── guion.ts       → JS vanilla (fetch en vivo + controles)
└── panelAdmin.ts  → monta el router GET /panel
```

## Qué muestra (refresco automático cada 10 s)

- **Tarjetas de métricas**: uptime, memoria RSS/heap, peticiones totales y
  errores, entradas+hits/fallos del caché, fuentes vivas/caídas y el
  inventario de extractores (15).
- **Tabla de fuentes**: dominio activo (conmutado o oficial), grupo de
  idioma, estado del circuito breaker (`cerrado`/`abierto`/`semiabierto`),
  fallos consecutivos, latencia de la última sonda y estado runtime
  (activa / suspendida en caliente).
- **Tendencias de búsqueda** (ventana 24 h con decaimiento exponencial) con
  el término que las disparó.
- **Logs recientes**: las últimas peticiones con método, ruta, código y
  duración (coloreadas 2xx/4xx/5xx).
- **Métricas Prometheus** en texto (muestra de `/metrics`).

## Controles

| Acción | Endpoint que usa | Efecto |
|---|---|---|
| **Purgar caché** (todos o un namespace) | `POST /api/v1/admin/cache/purgar` | vacía el caché en memoria (buscar/ultimos/detalle/servidores/curados/recomendaciones/tops…) |
| **Suspender fuente** | `POST /api/v1/admin/fuentes/{id}/suspender` | la fuente deja de scrapearse al instante, sin redeploy |
| **Reanudar fuente** | `POST /api/v1/admin/fuentes/{id}/reanudar` | vuelve al scraping normal |
| **Cambiar dominio** | `POST /api/v1/admin/dominios/{fuente}` | conmuta el dominio en caliente y vacía los caches envenenados |
| **Chequear fuentes ahora** | `POST /api/v1/admin/chequear-fuentes` | sonda HTTP de las 22 fuentes + realimenta el circuit breaker |
| **Guardar listas** | `POST /api/v1/admin/listas/guardar` | persiste las listas de usuario a `data/listas-usuarios.json` |

## Detalles de diseño

- **Sin dependencias**: vanilla JS (`fetch`, `setInterval`), CSS custom con
  variables, sin CDN ni fuentes externas (el logo/icono salen de `public/`).
- **Sin estado en cliente**: todo se consulta a la API admin; el documento
  se construye una vez al montar el router y se sirve con `Cache-Control:
  no-store`.
- **Refresco 10 s** de estado y logs, 60 s de tendencias y 30 s de métricas.
  Con la pestaña abierta, ese refresco **mantiene despierto** el servicio en
  el plan free de Render (ver `docs/RENDER-FREE.md`).
- Los datos de las fuentes se pintan con escape HTML (todo lo que viene de
  red se considera no confiable).

## Endpoints que consume el panel

```
GET  /api/v1/admin/estado          → tarjetas + tabla de fuentes
GET  /api/v1/admin/logs            → log en vivo
GET  /api/v1/tendencias?ventana=24 → tendencias
GET  /metrics                      → texto Prometheus (muestra)
POST /api/v1/admin/…               → controles
```

> Nota: el panel no pide autenticación (es un servicio privado de la app
  ANIMAX). Si se expone públicamente, protéjelo con el reverse proxy
  (basic auth en nginx/Caddy) o decide qué acciones admin dejar abiertas.
