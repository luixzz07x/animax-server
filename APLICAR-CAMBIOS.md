# APLICAR-CAMBIOS · ANIMAX v5.3-FIX para Render

**Problema que resuelve**: tu deploy v5.2 arrancaba bien pero 15 fuentes
no respondían desde la IP del datacenter de Render y el server las
seguía sondeando cada ciclo (fallos 126+), con el panel mintiendo
"vivas 20/20 · caídas 0".

## Pasos (2 minutos)

1. Descarga `ANIMAX-RENDER-FIX-V5.3.zip`.
2. En tu PC, dentro de tu clon de `github.com/luixzz07x/animax-server`:

```bash
unzip -o ANIMAX-RENDER-FIX-V5.3.zip    # sobrescribe los 13 archivos
bash copiar-fix.sh                     # verifica que todo está en su sitio
git add -A
git commit -m "v5.3: sondeo adaptativo, panel honesto, keep-awake, proxy opcional"
git push
```

3. Render detecta el push y re-despliega solo (Docker y render.yaml NO
   cambian).

## Qué incluye (13 archivos)

| Archivo | Cambio |
|---|---|
| `index.ts` | estáticos `/img` y `/fonts` (adiós 404 del icono), keep-awake automático (ping propio cada 10 min), banner v5.3 |
| `package.json` | versión 5.3.0 |
| `src/config/ajustes.json` | `backoffBaseMs` / `backoffMaxMs` / `limitadaTrasAperturas` |
| `src/core/salud.ts` | **el corazón**: sondeo adaptativo (las fuentes caídas se saltan hasta su reintento), backoff escalado 2→4→8→16→30 min, estado "limitada", resumen honesto (vivas/caídas/limitadas/calentando) |
| `src/core/eventos.ts` | anti-spam real: solo transiciones; el ciclo resume en UNA línea con omitidas y limitadas |
| `src/vigilante/vigilante.ts` | solo atiende fuentes con reintento vencido (nada de re-sondear muertas cada 15 min) |
| `src/rutas/rutasSalud.ts` | portada HTML con chip "limitadas (IP DC)" y `/api/v1/salud` ampliado |
| `src/rutas/rutasAdmin.ts` | detalle por fuente con `bloqueada` / `limitada` / `aperturas` |
| `src/lib/animax/http.ts` | `PROXY_URL` opcional: todo el scraping por un proxy (residencial) → las fuentes limitadas reviven |
| `src/panel/guion.ts` | tarjetas honestas ("5/20 · 15 caídas · 12 limitadas") y estado real por fila |
| `src/panel/plantilla.ts` | v5.3 |
| `src/middleware/registro.ts` | log de peticiones `[http]` (decía "ttp]") |
| `public/img/icono.png` | icono real 128×128 (favicon y logo del panel) |

## Variables opcionales (Render → Environment → Add)

- `PROXY_URL` — proxy residencial: revivelas 15 fuentes bloqueadas por
  IP de datacenter. `http://usuario:clave@host:puerto`.
- `MANTENER_DESPIERTO=0` — apaga el keep-awake (por defecto activo).

## Cómo se ve el log DESPUÉS (normal en Render free)

```
[animax-server v5.3] escuchando en :10000 (22 fuentes · 15 extractores · panel /panel)
[keep-awake] activo · ping propio cada 10 min a https://animax-server.onrender.com
[salud] ciclo: 20 fuentes · 5 vivas · 0 bloqueadas(CF) · 2 sin respuesta · 13 en espera · 13 limitadas (IP DC) (31205ms)
```

Eso NO es un error: "en espera/limitadas" es el comportamiento correcto
para fuentes que Cloudflare bloquea desde datacenters. La API sigue
llena con las vivas + la semilla offline (40 animes + 26 películas),
y el panel/portada ahora dicen la verdad.
