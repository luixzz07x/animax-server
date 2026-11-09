# Si usas Render: NO necesitas este Dockerfile (Render lee package.json).
# Este archivo es para Fly.io, Railway u Oracle Cloud con Docker instalado.
FROM node:20-alpine
WORKDIR /app
COPY index.js package.json ./
ENV PORT=3001
EXPOSE 3001
CMD ["node", "index.js"]
