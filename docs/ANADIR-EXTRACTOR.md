# ANIMAX v5 · Cómo añadir un EXTRACTOR nuevo

Un extractor = 1 archivo en `src/extractores/` que implementa
`ExtractorVideo`. La **fábrica** (`fabricaExtractores.ts`) los encadena por
prioridad: si tu extractor devuelve `null`, pasa al siguiente y, si todos
fallan, devuelve el embed por el proxy (el usuario NUNCA ve "no soportado").

## 1. El contrato

```ts
// src/extractores/tipos.ts
export type TipoVideo = "mp4" | "m3u8" | "proxy";

export interface ResultadoExtraccion {
  urlDirecta: string;          // link para /api/v1/stream
  tipo: TipoVideo;             // cómo lo reproduce el reproductor propio
  calidad?: string;            // "720p", "1080p"… si se detecta
  headers?: Record<string, string>; // p. ej. { Referer: embed }
}

export interface ExtractorVideo {
  id: string;                  // clave en ajustes.json → extractores.prioridad
  nombre: string;
  patron: RegExp;              // qué URLs resuelve
  prioridad: number;           // menor = antes
  extraer(url: string): Promise<ResultadoExtraccion | null>;
}
```

## 2. Plantilla de archivo

`src/extractores/{servidor}.ts`:

```ts
// ANIMAX v5 · Extractor {Servidor} ({dominio}).
import { obtenerHttp } from "../lib/animax/http";
import { detectarCalidad, type ExtractorVideo, type ResultadoExtraccion } from "./tipos";

async function extraer(embed: string): Promise<ResultadoExtraccion | null> {
  const html = await obtenerHttp(embed, { timeoutMs: 6000, referer: embed });
  if (!html) return null;
  const m = html.match(/…patrón del link final…/);
  if (!m) return null;
  return {
    urlDirecta: m[1],
    tipo: /\.m3u8/.test(m[1]) ? "m3u8" : "mp4",
    calidad: detectarCalidad(m[1]),
    headers: { Referer: embed },
  };
}

const {servidor}: ExtractorVideo = {
  id: "{servidor}",
  nombre: "{Servidor}",
  patron: /{dominio}|{clon1}|{clon2}/i,
  prioridad: 13,
  extraer,
};

export default {servidor};
```

Reglas de oro:

- **Nunca lances**: `obtenerHttp` ya devuelve `null` en fallo; devuelve `null`
  para que la fábrica pruebe el siguiente extractor.
- Si el host NO puede exponer un link directo (tipo Mega), NO devuelvas null:
  devuelve `{ urlDirecta: url, tipo: "proxy" }` — el proxy lo sirve tal cual.
- Detecta el `Referer` correcto: casi todos los CDNs validan que venga del
  embed original.

## 3. Registrarlo

`src/extractores/fabricaExtractores.ts`:

```ts
import {servidor} from "./{servidor}";

const TODOS: ExtractorVideo[] = [ …, {servidor} ];
```

Y su posición en la cadena en `src/config/ajustes.json`:

```jsonc
"extractores": {
  "prioridad": ["mp4upload", …, "{servidor}"]
}
```

(La prioridad de ajustes.json MANDA sobre la del módulo; si no está
listada, se usa la del módulo.)

## 4. Comprobar

```bash
npm run dev

# Trazado completo de la cadena (qué extractores se probaron):
curl "localhost:3001/api/v1/stream?url={embed del servidor nuevo}"

# Y en las métricas:
curl localhost:3001/api/v1/estado | python -m json.tool | grep -A8 extractores
```

`trazadoUltimo()` (visible en `/api/v1/estado` → `extractores.ultimaExtraccion`)
muestra `intentos: [...]` y `extractorFinal`: si acaba en `proxy-directo`,
ningún extractor pudo y se sirvió el embed (último recurso correcto, pero
seguramente quieras mejorar el patrón).

## 5. Verificación de links (nivel registro)

Los extractores SOLO extraen. La VERIFICACIÓN (HEAD/Range/playlist + primer
segmento) y el orden final de servidores (latino → prioridad de host →
latencia) sigue en `src/lib/animax/extractores.ts` (`resolverServidores`),
que es quien alimenta `/api/v1/servidores`. No la dupliques.
