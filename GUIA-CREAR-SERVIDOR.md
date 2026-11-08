# 🛰️ Cómo crear TU servidor privado GRATIS — guía paso a paso
## (para alguien que nunca ha creado un servidor — sin saber nada de esto)

> **¿Qué es un "servidor"?** Es una computadora encendida 24/7 en alguna empresa,
> que ejecuta un programa. En este caso, el programa es `animax-server`: recibe
> preguntas de tu app ("busca One Piece"), hace TODO el trabajo pesado (abrir
> páginas, encontrar el video, comprobar que sirva) y le devuelve a tu teléfono
> la respuesta lista. **Tu teléfono deja de trabajar: solo reproduce.**
>
> Como el código es de tu propiedad y el hosting es gratis, esto no cuesta nada.

---

## Lo que vas a conseguir al final

Una dirección como esta:

```
https://animax-server-xxxx.onrender.com
```

…que tu app AniMax usará como "cerebro" (la integro en la Fase 2).

---

## PASO 0 · Crea una cuenta de GitHub (gratis, 2 minutos)

GitHub es como un Drive para código: guardas tu servidor ahí y las empresas de
hosting lo leen desde ahí.

1. Entra a **https://github.com** (desde tu celular o PC, da igual).
2. Toca **Sign up** (esquina superior derecha).
3. Correo → contraseña → nombre de usuario (elige uno, ej. `tunombre`) →
   verifica el correo con el código que te llega.
4. Listo, ya tienes GitHub.

## PASO 1 · Sube el servidor a GitHub (5 minutos, sin comandos)

1. En GitHub, toca el **+** (arriba a la derecha) → **New repository**.
2. Nombre: `animax-server` → deja todo lo demás como está →
   **Create repository** (marca "Add a README" si te aparece).
3. En la página del repo vacío, toca **Add file → Upload files**.
4. Abre la carpeta `server/animax-server` del ZIP de código fuente de AniMax
   y arrastra TODOS sus archivos (`index.js`, `package.json`, `README.md`,
   `Dockerfile`, `render.yaml`, esta guía) a la zona de carga.
5. Baja, escribe algo en "Commit changes" y toca el botón verde
   **Commit changes**.

✅ Tu código ya vive en GitHub. Ahora el hosting.

## PASO 2 · Crea la cuenta de hosting gratis (Render, 3 minutos)

Usamos **Render.com** porque es el más fácil del mundo y su plan Free es real:

1. Entra a **https://render.com** → **Get Started** (o **Sign up with GitHub**
   — mejor: así se conecta solo a tu GitHub del Paso 0).
2. Autoriza a Render a ver tus repositorios (toca **Install & Authorize**).
3. Ya tienes cuenta. Nada de tarjetas: el plan Free no pide pago.

## PASO 3 · Crea el servidor (el botón mágico, 5 minutos)

1. En tu panel de Render, toca **New +** (arriba a la izquierda) →
   **Web Service**.
2. Elige tu repositorio **`animax-server`** → **Connect**.
3. Rellena SOLO esto:
   - **Name**: `animax-server` (o el que quieras)
   - **Region**: la más cercana (ej. Ohio si estás en Colombia/Latinoamérica)
   - **Branch**: `main` · **Runtime**: `Node`
   - **Build Command**: deja lo que ponga (`npm install` funciona — no hay nada
     que instalar, termina en segundos) o escribe `echo ok`
   - **Start Command**: `node index.js`
   - **Instance Type**: **Free** ← ¡importante!
4. Toca **Create Web Service**.
5. Espera 2-3 minutos (verás el log en vivo). Cuando diga
   `escuchando en puerto 30001`… o sea `escuchando en puerto …`, está listo.

✅ Arriba verás tu dirección: `https://animax-server-xxxx.onrender.com`

## PASO 4 · Pruébalo (30 segundos)

Abre esa dirección en tu navegador. Debe aparecer el panel azul de
**AniMax Server** con el listado de funciones. Prueba:

```
https://animax-server-xxxx.onrender.com/api/ping
```

Si responde `{"ok":true,...}` → **tu servidor está vivo en internet.** 🎉

Y una búsqueda de verdad:

```
https://animax-server-xxxx.onrender.com/api/search?q=one%20piece
```

Devuelve las opciones estilo Seekee: `[Doblado] One Piece`, `[Sub] One Piece`,
con su descripción en español.

## PASO 5 · Conectarlo a la app

En la Fase 2 de este plan integro el servidor en AniMax: en Ajustes habrá un
campo "URL de tu servidor" donde pegas `https://animax-server-xxxx.onrender.com`.
Listo: búsquedas, episodios completos y reproducción pasan por tu servidor.

---

## ⚠️ Lo único "malo" del plan Free (y cómo lo resolvemos)

| Detalle | Solución en AniMax |
|---|---|
| Tras **15 min** sin uso, el servidor **se duerme** (tarda ~50 s en despertar) | La app muestra "Despertando servidor…" y reintenta sola. La 1.ª búsqueda del día tarda un poco más; el resto vuela |
| Nunca se cae del todo: Render lo mantiene | Reintentos automáticos en la app |
| Si lo actualizas en GitHub, Render lo despliega de nuevo solo | Perfecto para futuras versiones |

**¿Quieres 24/7 de verdad y gratis para siempre?** Más adelante puedes moverte a
**Oracle Cloud Free Tier** (4 CPU + 24 GB RAM de por vida, gratis). Es más
complicado de crear (pide tarjeta solo para verificar identidad, no cobra nada
en el plan Always Free) — usa el `Dockerfile` incluido. Pídemelo y te hago esa
guía cuando lleguemos ahí.

## 🔐 Opcional: ponerle clave

En Render: **Environment** → **Add Environment Variable** →
`ANIMAX_API_KEY` = `una-clave-secreta-tuya`. Desde ese momento solo responde
a quien envíe esa clave (la app te pedirá también escribirla en Ajustes).

## 📌 Resumen de la receta (para no perderla)

```
GitHub (guardar código) → Render.com (botón New Web Service, plan Free)
→ https://animax-server-xxxx.onrender.com → pegar en AniMax Ajustes
```

Total: **~15 minutos**, $0 pesos, sin tarjeta. ✅


---

# 🆕 Novedades v2.0 (Fase 1 de AniMax 3.0.0)

Si ya tenías el servidor v1.x desplegado en Render, **solo tienes que
actualizar el código** (Render redespliega solo con `git push`). No hay
nuevas dependencias ni migraciones: sigue siendo Node puro.

## Qué trae la v2.0

1. **Catálogo multi-fuente**: animes sub/latino, películas, series y
   doramas. Un probador de salud chequea los 24 sitios cada 25 min y
   las búsquedas solo usan los VIVOS (equivalente al
   `queryFreshDomainList` de Seekee).
2. **Prioridad de idioma global**: [Doblado] → [Castellano] → [Sub].
3. **Rangos de doblaje por episodio**: One Piece 1-837 [Doblado] /
   838+ [Sub], Naruto 1-220, Dragon Ball completa… (editable con
   `ANIMAX_DUB_RANGES`).
4. **Resolución profunda de la granja**: Streamtape, Dood, MixDrop,
   Filemoon, StreamWish, Vidmoly, Mp4Upload, Uqload, OkRu… con
   desempaquetador JS sin `eval` y validación de cada stream.
5. **Rankings estilo Seekee**: `/api/hot` con puntuación 🔺 y
   `/api/home` (4 pestañas), `/api/related` (sugerencias).
6. **Metadatos AniList + Kitsu** para las tarjetas.
7. **Capa de traducción de títulos**: "rent a girlfriend" también
   encuentra "Kanojo, Okarishimasu" (romaji/sinónimos vía AniList).

## Variables de entorno nuevas (todas opcionales)

| Variable | Para qué |
|---|---|
| `ANIMAX_SITES` | Añadir sitios sin redesplegar: `"host|https://host/buscar?q={q}|latino|anime, host2|https://host2/?s={q}|latino|pelicula"` |
| `ANIMAX_DUB_RANGES` | Rangos de doblaje propios: `"shingeki no kyojin:1-25, mi serie:1-12;20-30"` |
| `ANIMAX_PROXY` | Túnel CONNECT opcional (`usuario:pass@host:puerto`) para alcanzar sitios con Cloudflare |
| `ANIMAX_DEBUG` | `1` = logs de diagnóstico |

## Si las búsquedas de películas salen vacías

Los sitios de cine (Cuevana y similares) suelen bloquear IPs de
datacenter con Cloudflare — igual que le pasa a Seekee con los suyos,
por eso ellos pagan proxies residenciales. Opciones gratis:

1. Espera al probador: los dominios rotan y cada 25 min se re-chequean.
2. Añade un sitio vivo que encuentres desde tu teléfono (abre el sitio
   en Chrome; si carga, añádelo con `ANIMAX_SITES`).
3. Configura `ANIMAX_PROXY` con un proxy barato o casero si algún día
   lo necesitas.
4. Los animes y doramas SÍ funcionan sin proxy (probado).

## Endpoints

```
GET  /api/ping · /api/domains · /api/search?q= · /api/episodes?pageUrl=
POST /api/resolve {pageUrl, episodeUrl?, episode?} · /api/validate
GET  /api/hot?tab=anime|peliculas|series|minidramas · /api/home · /api/related?q=
```
