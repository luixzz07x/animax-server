FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
# Docker fijo: Render inyecta PORT; en VPS usa -e PORT=3001
EXPOSE 3001

CMD ["npm", "start"]
