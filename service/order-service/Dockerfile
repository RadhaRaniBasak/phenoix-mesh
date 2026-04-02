
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev && npm cache clean --force

COPY app.js .

EXPOSE 3000

ENV NODE_ENV=production
ENV SERVICE_NAME=phoenix-order-service
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

USER node

CMD ["node", "app.js"]
