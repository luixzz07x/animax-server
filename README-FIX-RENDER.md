# ANIMAX v5.3-FIX · Arreglo REAL del server en Render (plan FREE)

Tu v5.2 ya desplegaba bien, pero el log seguía mostrando el problema de
fondo: **15 fuentes no responden desde la IP del datacenter de Render**
y el server las re-sondeaba una y otra vez (fallos 126 y subiendo, CPU
quemada, 20 líneas de log por ciclo), mientras el panel mentía con
"Fuentes vivas 20/20 · caídas 0" con 15 circuitos abiertos.

El v5.3 ataca exactamente eso. Sube estos archivos a tu repo
(`github.com/luixzz07x/animax-server`) y Render re-despliega solo.

## Qué cambia el v5.3 (y por qué)

| Síntoma en tu log/panel | Causa real | Arreglo v5.3 |
|---|---|---|
| `fallos: 126` en 15 fuentes (y subiendo) | El health-check sondeaba TODAS las fuentes cada ciclo, **incluidas las que ya tenían el circuito abierto** | **Sondeo adaptativo**: una fuente abierta se salta por completo hasta que vence su reintento, y ese reintento tiene **backoff escalado 2→4→8→16→30 min** (tope). Deja de gastar CPU y de inflar contadores |
| `[salud] X falló (timeout …)` ×20 al arrancar | Cada fallo se logueaba (tope 1 línea/fuente/10 min = 20 líneas cada arranque) | Solo se loguean **transiciones** (circuito que se abre) y reintentos vencidos que fallan. El resto va en la única línea del ciclo |
| Panel: "Fuentes vivas 20/20 · caídas 0" con 15 circuitos abiertos | El resumen solo contaba "caída" mientras el enfriamiento estaba en el futuro; al expirar volvía a contar como viva | **Resumen honesto**: vivas = cerradas con éxito (o bloqueadas-CF que responden), caídas = circuito abierto, + nuevas categorías **limitadas** (IP datacenter) y **calentando** (gracia de arranque) |
| `GET /img/icono.png → 404` en el log | El server **no servía nada de `public/`** (ni el icono ni las 20 fuentes TTF) | `express.static` para `/img` y `/fonts` con caché + icono real incluido (`public/img/icono.png`) |
| El log de peticiones salía `ttp] GET /` | Prefijo corrupto en el middleware | Ahora `[http] GET / …` |
| Server duerme a los 15 min (Render free) → cada visita espera ~30-60 s el arranque frío | Ninguno | **Keep-awake**: el server se hace un ping a sí mismo cada 10 min vía `RENDER_EXTERNAL_URL` (Render la inyecta solo). Desactivable con `MANTENER_DESPIERTO=0` |
| Las 15 fuentes limitadas **nunca** van a funcionar desde Render sin ayuda | Cloudflare/bloqueos anti-bot de datacenter | **PROXY opcional**: define `PROXY_URL` en Render (Environment → Add env var) con un proxy residencial y TODO el scraping sale por él; esas fuentes reviven solas (se re-sondean cada ≤30 min y el circuito se cierra al primer éxito) |
| Vigilante re-sondeaba las mismas fuentes muertas cada 15 min | Su filtro era "sin éxito reciente" (no miraba el backoff) | Solo atiende fuentes con **reintento vencido** (integrado con el health-check: cero trabajo duplicado) |

## Archivos que cambian (13 + 2 de guía)

```
index.ts                        ← v5.3: static /img,/fonts + keep-awake + banner
package.json                    ← 5.3.0
src/config/ajustes.json         ← backoffBaseMs/backoffMaxMs/limitadaTrasAperturas
src/core/salud.ts               ← sondeo adaptativo + backoff escalado + resumen honesto
src/core/eventos.ts             ← anti-spam de verdad + ciclo con omitidas/limitadas
src/vigilante/vigilante.ts      ← solo fuentes con reintento vencido
src/rutas/rutasSalud.ts         ← portada con limitadas + /api/v1/salud ampliado
src/rutas/rutasAdmin.ts         ← detalle con bloqueada/limitada/aperturas
src/lib/animax/http.ts          ← PROXY_URL opcional (undici ProxyAgent)
src/panel/guion.ts              ← tarjetas honestas + estado real por fuente
src/panel/plantilla.ts          ← v5.3 (mismo icono, ya servido)
src/middleware/registro.ts      ← log [http] (antes "ttp]")
public/img/icono.png            ← icono real 128×128 (nuevo)
README-FIX-RENDER.md            ← este archivo
```

## Cómo aplicarlo

**Opción A (rápida)**: descomprime el zip dentro de tu repo y:

```bash
bash copiar-fix.sh     # copia los 13 archivos encima del repo
git add -A
git commit -m "v5.3: sondeo adaptativo, panel honesto, keep-awake, icono, proxy opcional"
git push
```

**Opción B (a mano)**: copia tú mismo cada archivo del zip a su ruta
(la lista de arriba es la ruta exacta dentro de tu repo).

Render detecta el push y reconstruye. `Dockerfile`, `render.yaml` y
`package.json` de dependencias NO cambian (solo la versión).

## Variables nuevas (opcionales) en Render → Environment

| Variable | Efecto |
|---|---|
| `PROXY_URL` | Sale TODO el scraping por ese proxy. **Es la forma de revivir las fuentes limitadas** (p. ej. un proxy residencial barato). Formato: `http://usuario:clave@host:puerto` |
| `PROXY_AUTH` | Opcional: valor de la cabecera `Authorization` del proxy (`Basic …`) si tu proxy la pide aparte |
| `MANTENER_DESPIERTO=0` | Desactiva el keep-awake (por defecto está ACTIVO) |

## Qué esperar DESPUÉS de desplegar v5.3 (honesto)

1. **Arranque**: `[animax-server v5.3] …` y a los ~30 s la primera
   pasada de salud (lotes de 4 con pausa). Durante los primeros 3 min
   (gracia) nada se marca caído.
2. **A los ~10 min**: verás UNA línea por ciclo:
   `[salud] ciclo: 20 fuentes · 5 vivas · 0 bloqueadas(CF) · 3 sin respuesta · 12 en espera · 12 limitadas (IP DC)`.
   "En espera" = circuitos abiertos cuyo backoff no venció (no se
   gastan sondas). "Limitadas" = llevan 4+ reaperturas fallidas.
3. **El contador de fallos se estabiliza** (quizá ~10-20 por fuente
   al día, no 126 cada rato): solo crece cuando una sonda vencida
   vuelve a fallar.
4. **El panel dice la verdad**: "5/20 vivas · 15 caídas · 12 limitadas"
   y cada fila muestra su estado real (activa / bloqueada (CF) /
   limitada (IP DC) / suspendida).
5. **La app nunca está vacía**: las 5 fuentes vivas alimentan
   buscar/últimos/detalle/servidores, y si algo falla entra la semilla
   offline (40 animes + 26 películas) marcada `semilla:true`.
6. **Con PROXY_URL residencial**: las 15 limitadas empiezan a reviv
   solas en los siguientes reintentos (máx 30 min) y el panel las irá
   pasando a "activa".

## Verificación rápida tras desplegar

```bash
curl -s https://animax-server.onrender.com/              # portada HTML con chips honestos
curl -s https://animax-server.onrender.com/img/icono.png -o i.png   # 200 (favicon del panel)
curl -s https://animax-server.onrender.com/api/v1/salud | head -c 400
curl -s "https://animax-server.onrender.com/api/v1/ultimos" | head -c 300   # feed o semilla:true
```

En el log de Render, tras ~1 hora deberías ver algo así (y ya no 40
líneas de fallos por ciclo):

```
[animax-server v5.3] escuchando en :10000 (22 fuentes · 15 extractores · panel /panel)
[keep-awake] activo · ping propio cada 10 min a https://animax-server.onrender.com
[salud] animefenix falló (circuito abierto … · reintento escalado)
[salud] ciclo: 20 fuentes · 5 vivas · 0 bloqueadas(CF) · 2 sin respuesta · 13 en espera · 13 limitadas (IP DC) (31205ms)
```
