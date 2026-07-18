FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY workers/gateway-queue-consumer/ ./workers/gateway-queue-consumer/

CMD ["node", "workers/gateway-queue-consumer/index.mjs"]
