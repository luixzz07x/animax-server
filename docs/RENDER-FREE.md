# ANIMAX v5.1 en el plan FREE de Render (explicación honesta)

Este server está diseñado para vivir en el **plan gratuito de Render**
(web service free). Funciona, pero conviene saber exactamente qué se obtiene
y qué no. Nada de marketing: números reales y mitigaciones que ya están
implementadas en el código.

## Lo que da el plan free (enero 2025)

| Límite | Valor real | Impacto en ANIMAX |
|---|---|---|
| RAM | **512 MB** | El server mide ~80–150 MB RSS en reposo (índice + caches + Node). Cabe sobrado; el caché se poda a 5 000 entradas y el índice persiste a JSON en disco. |
| CPU | compartida, se estrangula | El scraping es I/O (red), no CPU: la deduplicación y el cheerio de 22 fuentes caben en picos cortos. La **cola por fuente + semáforo global** (v5.1) acotan el trabajo en vuelo. |
| Disco | efímero (se pierde al reiniciar) | `animax-indice.json`, `animax-dominios.json` y `data/listas-usuarios.json` se escriben **best-effort**: si el FS es read-only tras un restart, todo sigue funcionando en memoria (misma interfaz, cero errores). |
| **Sueño** | tras **15 min sin tráfico** el proceso se congela | La primera petición tras el despertar tarda ~30–60 s (cold spin-up de Node + calentamiento). Mitigaciones abajo. |
| Ancho de banda | 100 GB/mes | Un episodio proxyeado son ~200–400 MB; el proxy de streaming es lo más caro. Si solo se usa la API (metadatos + links), el consumo es ínfimo. |
| Logs | limitados y retenidos pocos días | El bus de eventos propio + `/api/v1/estado` + `/metrics` dan observabilidad que el plan no da. |

## Por qué este server "cabe sobrado" en 512 MB

- **Cero dependencias pesadas**: express + cheerio + undici + tsx. Sin Prisma,
  sin Redis, sin build de frontend: Node arranca en segundos.
- **Caché TTL con poda oportunista** (`src/lib/animax/cache.ts`): el Map
  nunca pasa de 5 000 entradas; los namespaces caros (detalle/servidores) usan
  TTL de 6 h con hit rates altísimos.
- **Índice liviano** (`src/lib/animax/indice.ts`): JSON en disco + memoria,
  pensado para Render; al crecer se migra a MongoDB/Postgres con la misma
  interfaz.
- **Buffers acotados**: 200 peticiones recientes, 600 eventos de búsqueda,
  120 animes por usuario de "continuar viendo", 20 listas × 300 items, 12
  ciclos del vigilante… todo con límites explícitos pensados para 512 MB.
- **Circuit breaker**: las fuentes caídas se omiten con CERO peticiones → ni
  CPU ni memoria desperdiciadas en sitios muertos.

## Cómo mantenerlo despierto (y cuándo NO molestarse)

### Opción 1 · ping cada 10 min desde cron-job.org (recomendada)

1. Crea una cuenta gratis en <https://cron-job.org> (o cualquier cron HTTP:
   UptimeRobot en plan gratuito también vale con intervalo de 5–10 min).
2. Añade un job a `https://animax-api.onrender.com/api/v1/cron/refresh`
   cada **10 minutos**.
3. Ese endpoint ya existe para esto: refresca el caché de portada y devuelve
   `{ ok, episodios, populares, curados, ms }` — el ping no solo despierta,
   sino que **renueva el feed** para que la app siempre tenga datos frescos
   en el primer toque.

> Coste: cero. Tráfico generado: ~1 GB/mes como mucho (respuestas JSON de
> pocos KB). Muy por debajo del límite del plan.

### Opción 2 · el propio watchdog del server

El server ya trae temporizadores internos (refresco 10 min, salud 5 min,
vigilante 10 min), PERO **no cuentan como tráfico**: Render apaga el proceso
entero, timers incluidos. Por eso el keep-alive debe venir de FUERA
(cron-job.org, UptimeRobot, o la propia app móvil con un fetch al abrirse).

### Opción 3 · con el panel abierto

`GET /panel` se refresca solo cada 10 s: mantener la pestaña del navegador
abierta equivale a un ping constante (útil mientras se administra o se
vigilan las fuentes en vivo).

### Cuándo NO molestarse

Si el uso real de la app es diario (la gente abre ANIMAX todos los días),
el sleep casi nunca se nota: el único precio es que la PRIMERA petición de
cada día tarda ~30–60 s extra. El keep-alive solo importa para UX inmediata
de 24/7 o para que el índice se mantenga caliente de continuo.

## Recomendaciones de deploy

- `render.yaml` ya está configurado: build `npm install`, start `npm start`,
  healthcheck `GET /` (exento de rate-limit a propósito).
- Deja `LOG_HTTP=0` en variables de entorno si el log de Render se llena
  (Render trunca los logs del plan free).
- El **watchdog de dominios** + `POST /api/v1/dominios/{fuente}` permiten
  reaccionar a migraciones de las fuentes sin redeploy (clave cuando el
  proceso lleva semanas vivo).
- Para diagnóstico sin abrir el browser: `npm run cli salud` desde cualquier
  máquina con el repo (sonda las 22 fuentes con exit code).

## Cuándo migrar a pago/VPS

- Usuarios concurrentes proxyeando **video** de forma sostenida (el ancho de
  banda free se agota antes que la RAM).
- Necesidad de persistencia real del índice/listas entre restarts (disco
  efímero en free) → un VPS de 5 USD o un disco de Render resuelven.
- Peticiones > 240 req/min sostenidas (rate-limit en memoria) o necesidad de
  más de una instancia.

Todo lo demás — la API completa, las 22 fuentes, los 15 extractores, las
recomendaciones, tendencias, programación, tops, listas y el panel — corre
feliz en los 512 MB del plan gratis.
