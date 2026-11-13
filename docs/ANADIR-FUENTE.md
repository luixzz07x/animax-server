# ANIMAX v5 · Cómo añadir una FUENTE nueva

Una fuente = 1 archivo de scraper + 3 líneas de config. Gracias al motor
genérico (`src/lib/animax/scrapers/motor.ts`) la mayoría de fuentes se
dan de alta con rutas y selectores, sin escribir parsing a mano.

## 1. Crear el scraper

`src/scrapers/{id}.ts`:

```ts
// ANIMAX · {Nombre} ({dominio}) — {latino|sub|dual}.
import { fabricarScraper } from "../../lib/animax/scrapers/fabrica";
import type { Scraper } from "../../lib/animax/types";

const scraper: Scraper = fabricarScraper({
  id: "{id}",
  nombre: "{Nombre}",
  baseUrl: "https://{dominio}",
  idioma: "latino",                 // "latino" | "sub" | "dual"
  rutaBuscar: (q) => `https://{dominio}/buscar?q=${encodeURIComponent(q)}`,
  rutaUltimos: "https://{dominio}/",
  rutaAnime: (slug) => `https://{dominio}/anime/${slug}`,
  rutaEpisodio: (slug, ep) => `https://{dominio}/ver/${slug}/${ep}`,
  selectores: { tarjeta: "article, .card", imagen: "img", enlace: "a" },
});

export default scraper;
```

Qué recibe gratis cada fuente así configurada:

- **Búsqueda** con filtro por slug y coincidencia tolerante a acentos.
- **Últimos** por heurística de tarjetas (descarta navegación/badges).
- **Detalle** por heurística de página (título, sinopsis, géneros, episodios).
- **Servidores** por escáner genérico (iframes, `data-src` base64, vars JS,
  enlaces .mp4/.m3u8) → extraídos y verificados por la fábrica de extractores.
- **Failover silencioso**: si el sitio no responde o salta Cloudflare,
  la fuente se omite y la API sigue funcionando (circuit breaker).

Si el sitio tiene algo especial (API JSON propia, player propio), extiende
el objeto devuelto sobreponiendo el método, como hacen `jkanime.ts`,
`animeid.ts` u `otakstv.ts` en `src/scrapers/`.

## 2. Reexportarla en el índice

`src/scrapers/index.ts`:

```ts
export { default as {id} } from "./{id}";
import {id} from "./{id}";
// y añadirla a NUEVAS_V5 (o a la lista que uses)
```

## 3. Registrarla en registro.ts

`src/lib/animax/registro.ts` — añade el import y la entrada en `MODULOS`:

```ts
import { …, {id} } from "../../scrapers";
const MODULOS: Record<string, Scraper> = { …, {id} };
```

## 4. Config (los DOS fuentes.json)

Añade la fuente a `src/config/fuentes.json` **y** a
`src/lib/animax/fuentes.json` (misma entrada, mismo orden):

```jsonc
{ "id": "{id}", "nombre": "{Nombre}", "baseUrl": "https://{dominio}",
  "idioma": "latino", "grupo": "latino", "activo": true }
```

- `grupo` decide la **priorización de idioma**: `"latino"` (solo doblado),
  `"dual"` (latino+sub), `"sub"`.
- `"activo": false` la desactiva sin borrarla.

Y añade sus dominios de respaldo en `src/config/dominiosAlternativos.json`:

```jsonc
"{id}": ["https://{dominio}.to", "https://{dominio}.xyz"]
```

## 5. (Opcional) TTLs y prioridades

`src/config/ajustes.json` — timeouts de la fuente si es lenta
(`timeouts.fuenteBuscarMs`) y orden de extractores para sus servidores.

## 6. Comprobar

```bash
npm run dev
curl "localhost:3001/api/v1/buscar?q=naruto"        # debe incluir la fuente
curl localhost:3001/api/v1/salud                     # circuito "cerrado"
curl "localhost:3001/api/v1/servidores/{id}~{slug}/1"
```

Si sale `abierto` en `/api/v1/salud`: el dominio está muerto/bloqueado desde
tu IP. Prueba `POST /api/v1/dominios/{id}` con un dominio alternativo.
