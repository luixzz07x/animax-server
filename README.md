# 🛰️ AniMax Server v1.1.0

Servidor privado de búsqueda para la app AniMax — el mismo concepto que usa
Seekee con su backend Buscari, pero **tuyo y gratis**: el teléfono lento ya no
busca; le pregunta a este servidor y este hace el trabajo pesado.

- **Node.js puro, CERO dependencias** (no hay nada que instalar).
- Sin anuncios, sin VIP, sin pagos, sin recolectar nada (no guarda nada: la
  caché es en memoria y muere al reiniciar).

**v1.1.0:** filtrado de URLs de paginación (`/page/2`, `?pagina=3`…) de la
lista de episodios — antes entraban como "episodios" y al tocarlas no
reproducían nada (eran páginas de listado).

**Configuración en la app (v2.1.0):** Perfil → "Servidor de búsqueda (estilo
Seekee)" → pega la URL de este servidor → Guardar → Probar conexión.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/ping` | Estado del servidor |
| GET | `/api/search?q=one piece` | Opciones estilo Seekee: `[Doblado] One Piece`, `[Sub] One Piece` + descripción en español |
| GET | `/api/episodes?pageUrl=…` | Lista COMPLETA de episodios de una serie (sin límite de 12) |
| POST | `/api/resolve` | `{pageUrl, episode?}` → servidores de video ordenados, validados y con sus headers (User-Agent + Referer) |
| POST | `/api/validate` | `{url, referer?}` → ¿el stream sirve? |

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
| `ANIMAX_API_KEY` | *(vacío = abierto)* | Si se define, exige cabecera `X-Api-Key` |
