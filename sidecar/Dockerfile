FROM node:20-alpine

WORKDIR /app
COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production
ENV LOG_LEVEL=info

EXPOSE 9090

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=2 \
  CMD wget -qO- http://localhost:9090/status || exit 1

USER node

CMD ["node", "agent.js"]
