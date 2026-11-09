# Solo se usa si Render está en modo Docker. Si usas runtime Node, se ignora.
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV PORT=3001
EXPOSE 3001
CMD ["node", "index.js"]
