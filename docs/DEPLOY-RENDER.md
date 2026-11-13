# ANIMAX v5 · Despliegue en Render (guía real)

## 1. Preparar el código

El repo (o ZIP) debe contener exactamente esta carpeta como raíz:

```
index.ts  package.json  tsconfig.json  render.yaml  Dockerfile(opcional)
src/…  docs/…  public/(fonts e img)  node_modules NO (Render instala)
```

`render.yaml` ya está configurado: build `npm install`, start `npm start`
(`tsx index.ts`), healthcheck `/`, runtime Node ≥ 20.

## 2. Crear el servicio

1. https://dashboard.render.com → **New → Web Service**.
2. Conecta el repo de GitHub (o usa **Deploy existing ZIP**: Render lo
   descomprime y crea el repo por ti). Root directory: la carpeta del server.
3. Render detecta `render.yaml` y prellena todo:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/`
4. Elige el plan **Free** (512 MB) — suficiente: el caché es en memoria y
   el scraping limita concurrencia por fuente.
5. **Create Web Service**. En ~3 min tendrás
   `https://animax-api.onrender.com`.

## 3. Variables de entorno

| Variable | Valor | Nota |
|---|---|---|
| `PORT` | (Render la inyecta) | No la definas |
| `NODE_ENV` | `production` | ya en render.yaml |
| `LOG_HTTP` | `0` para silenciar el log por petición | opcional |

## 4. Verificación tras el arranque

```bash
BASE=https://animax-api.onrender.com
curl $BASE/                      # healthcheck + fuentes vivas
curl $BASE/api/v1/salud          # circuit breaker por fuente
curl "$BASE/api/v1/buscar?q=one+piece"
curl "$BASE/api/v1/servidores/ded:one%20piece/1" | head -c 600
curl "$BASE/api/v1/stream?url=<streamUrl del paso anterior>"
```

Con `/api/v1/estado` ves el arranque en frío calentándose (hits del caché,
fuentes con `circuito: cerrado`, semilla activa mientras el índice se llena).

## 5. Plan Free: mantenerlo despierto

El plan Free duerme tras 15 min sin tráfico. Mantenlo caliente con un cron
externo gratuito:

1. https://cron-job.org → **Create cronjob**.
2. URL: `https://animax-api.onrender.com/api/v1/cron/refresh`
3. Cada **10 minutos**, GET, timeout 60 s.
4. (Opcional) un segundo job a `https://animax-api.onrender.com/api/v1/salud`.

## 6. Cambio de dominio de una fuente SIN redeploy

Cuando una fuente migra de dominio (le pasa a todas cada pocos meses):

```bash
# 1. Ver qué fuentes están caídas
curl $BASE/api/v1/salud | python -m json.tool | grep -A3 circuitoAbierto

# 2. Conmutar (el vigilante suele haberlo hecho ya automáticamente)
curl -X POST $BASE/api/v1/dominios/animeflv \
  -H "Content-Type: application/json" -d '{"baseUrl":"https://animeflv.tv"}'
```

El cambio persiste en el disco del servicio (`animax-dominios.json`) y
redirige TODO el scraping al instante: los scrapers siguen construyendo URLs
con el dominio original y el cliente HTTP las reescribe hacia el activo.

Para hacerlo permanente, edítalo también en `src/config/fuentes.json` +
`src/lib/animax/fuentes.json` en el repo (y los respaldos en
`src/config/dominiosAlternativos.json`).

## 7. VPS con Docker

```bash
docker build -t animax-api .
docker run -d --name animax-api -p 3001:3001 --restart unless-stopped animax-api
# Comprobar:
curl http://localhost:3001/api/v1/salud
```

Persistencia opcional de índice/dominios (no requerida, se regeneran):

```bash
docker run -d --name animax-api -p 3001:3001 \
  -v /srv/animax:/app/animax-datos -e TZ=Europe/Madrid animax-api
```

(El índice se guarda en `animax-indice.json` y los dominios en
`animax-dominios.json` del working directory; móntalos como volumen si
quieres conservarlos entre reinicios.)

## 8. Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `/api/v1/ultimos` casi vacío | Arranque frío + fuentes lentas | Espera 2 min (cron interno) o `POST /api/v1/cron/refresh` |
| Una fuente siempre `abierto` | Dominio muerto o Cloudflare duro | `POST /api/v1/dominios/{fuente}` o desactívala en `fuentes.json` |
| `429` desde la app | Rate-limit | Sube `limites.maxPorVentana` en `src/config/ajustes.json` |
| m3u8 sin segmentos | CDN bloquea la IP de Render | Prueba otra fuente/servidor; sube dominio alternativo |
| Memoria alta (Render 512 MB) | Índice grande | El caché se autopurga a 5000 entradas; reinicia el servicio |

## 9. Actualizar a una nueva versión

1. `git push` (Render hace autodeploy) o sube el ZIP de nuevo.
2. El índice y los dominios en caliente sobreviven al redeploy si el disco
   persiste; si no, se recalientan en ~10 min automáticamente.
