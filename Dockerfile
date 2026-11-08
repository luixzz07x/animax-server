# Dockerfile para Render (con Docker), Fly.io, Railway u Oracle Cloud.
# El proyecto no tiene dependencias externas (solo módulos nativos de Node),
# por eso no hace falta "npm install".
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=3001
EXPOSE 3001
CMD ["node", "index.js"]
