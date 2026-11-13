# ANIMAX v5.2-FIX · Arreglo del server en Render (plan FREE)

Este paquete SOLO contiene los archivos que cambian respecto a la v5.1.
Cópialos encima de tu repo (o usa `bash copiar-fix.sh`) y haz push —
Render re-despliega solo.

## Qué estaba fallando en tu log (y por qué)

| Síntoma en el log | Causa real | Arreglo |
|---|---|---|
| `[salud] X falló (timeout 3000ms)` ×20 fuentes | El timeout de búsqueda/últimos era **3000 ms**: en Render free (1 CPU compartida, TLS/DNS frío al despertar) NINGUNA fuente responde en 3 s → todo falla | Timeout ×3: **9000 ms** (detalle 15000 ms) |
| Circuitos abiertos en cadena → "casi nada funciona" | El circuit breaker se abría con 4 fallos **incluyendo el arranque frío**, y las sondas de salud+vigilante sumaban fallos dobles | Umbral 4→**6**, enfriamiento 60s→**120 s** y **gracia de arranque de 3 min** (en los primeros minutos no se abre ningún circuito) |
| `[dominios] animefenix.tv → .net` (cambios de dominios raros) | El vigilante conmutaba dominio **al primer fallo** (ignoraba su propia config `fallosAntesDeConmutar: 2`) y volaba a dominios muertos | Ahora exige **3 ciclos fallidos consecutivos**, valida el candidato y **restaura el oficial cuando revive** |
| `sonda sin cuerpo válido` en casi todas | 20 sondas HTTPS **simultáneas** ahogaban la única CPU del plan free | Sondas **por lotes de 4 con pausa de 900 ms** |
| Las fuentes con Cloudflare quedaban como caídas | Un 403/challenge significa que la web está **alcanzable** (la red funciona), no muerta | Nuevo estado **bloqueada**: no abre el circuito, el scraping sigue probando |
| Cientos de líneas de `[salud] ...` por ciclo | Se logueaba CADA fallo (20 × varios sistemas) | **1 línea resumen por ciclo**: `[salud] ciclo: 20 fuentes · X vivas · Y bloqueadas(CF) · Z sin respuesta` |
| La portada `/` era JSON crudo | La raíz servía el JSON de estado | **Portada HTML** de ANIMAX (JSON sigue en `/?formato=json` y `/api/v1`) |
| App vacía mientras las fuentes calientan | `/api/v1/ultimos` no tenía fallback | Si el feed viene vacío se sirve la **semilla offline (animes + películas)** marcada `semilla:true` |

## Archivos que cambian

```
index.ts                                 ← banner v5.2
package.json                             ← versión 5.2.0
src/config/ajustes.json                  ← timeouts/umbrales para Render free
src/config/fuentes.json                  ← tuning (timeouts ×3) [copia B]
src/lib/animax/fuentes.json              ← tuning (timeouts ×3) [copia A]
src/core/salud.ts                        ← gracia arranque + lotes + estado "bloqueada"
src/core/eventos.ts                      ← log anti-spam + evento ciclo-salud
src/vigilante/vigilante.ts               ← umbral antes de conmutar + sin doble sondeo + restauración
src/rutas/rutasSalud.ts                  ← portada HTML + GET /api/v1 + bloqueadas
src/rutas/rutasUltimos.ts                ← fallback semilla offline
copiar-fix.sh                            ← copia todo lo anterior sobre tu repo
```

## Cómo aplicarlo

```bash
# en tu PC, dentro de tu clon del repo (luixzz07x/animax-server):
bash copiar-fix.sh        # desde la carpeta descomprimida del fix
git add -A
git commit -m "v5.2: fix Render free (timeouts, circuit breaker, vigilante, portada)"
git push
```

Render detecta el push y reconstruye. El `render.yaml` y el `Dockerfile`
no cambian.

## Expectativas honestas en Render FREE

- **RAM**: 512 MB — este server cabe de sobra.
- **CPU**: 1 compartida → las búsquedas tardan más que en VPS (ahora con
  timeouts acordes: 9 s).
- **Sueño**: tras 15 min sin tráfico despierta en ~30-60 s. Mantenlo
  despierto con un ping gratis cada 10 min (cron-job.org → `https://tu-server.onrender.com/api/v1/salud`
  o el propio `/api/v1/cron/refresh`).
- **Cloudflare en datacenter**: algunas webs de anime bloquean IPs de
  datacenter (el estado "bloqueada" las muestra). Esas fuentes funcionan
  mejor desde un VPS o con IP residencial; el failover + la semilla
  offline mantienen el catálogo lleno mientras tanto.

## Verificación rápida tras desplegar

```bash
curl https://tu-server.onrender.com/                # portada HTML
curl https://tu-server.onrender.com/api/v1/salud    # fuentes + bloqueadas
curl https://tu-server.onrender.com/api/v1/ultimos  # feed o semilla:true
```
