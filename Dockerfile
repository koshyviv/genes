FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public
COPY seed ./seed

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:8080/api/auth || exit 1

CMD ["node", "server/server.js"]
