FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV SERVICE_NAME=payment-service
ENV SERVICE_PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=2 \
  CMD wget -qO- http://localhost:3000/health || exit 1

USER node

CMD ["node", "payment.js"]
