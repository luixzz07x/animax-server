# ═══════════════════════════════════════════════════════════════════
#  AniMax Server 8.0.2 — Dockerfile universal
#  Funciona igual en: Fly.io · Railway · Oracle Cloud · Koyeb · tu VPS
#  (Render NO necesita Docker: lee package.json directamente)
# ═══════════════════════════════════════════════════════════════════
FROM node:20-alpine

# Sin dependencias npm: el servidor es Node puro (cero npm install).
WORKDIR /app

# Copia TODOS los módulos que index.js requiere (el Dockerfile viejo
# solo copiaba index.js y se rompía al hacer require('./providers.js')).
COPY index.js package.json cloud.js providers.js hub.js hub-domains.js \
     feedback.js watchdog.js v4-api.js sections-config.json enrich.js ./
# Datos vivos (se regeneran en runtime si faltan; mejor copiarlos).
COPY animax-domains.json animax-hub-domains.json animax-reports.json \
     animax-searchlog.json ./

ENV PORT=3001 \
    NODE_ENV=production

EXPOSE 3001

# Healthcheck con el endpoint propio /api/ping (sin curl extra).
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3001/api/ping || exit 1

CMD ["node", "index.js"]
