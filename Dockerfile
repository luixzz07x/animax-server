# Render / Fly.io / Railway / Oracle con Docker.
# Copia TODOS los .js y .json (index.js necesita watchdog, v4-api, hub,
# feedback, enrich...). Antes solo copiaba index.js y package.json.
FROM node:20-alpine
WORKDIR /app
COPY *.js *.json ./
ENV PORT=3001
EXPOSE 3001
CMD ["node", "index.js"]
