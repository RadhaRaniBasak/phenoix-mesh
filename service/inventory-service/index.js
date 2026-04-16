'use strict';

import express from 'express';
import pino from 'pino';
import { fileURLToPath } from 'url';

const SERVICE_NAME = process.env.SERVICE_NAME || 'phoenix-inventory-service';
const PORT = parseInt(process.env.PORT || '3000');

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: `phoenix-${SERVICE_NAME}`
});

const app = express();
app.use(express.json());


let forceUnhealthy = process.env.FORCE_UNHEALTHY === 'true';


app.get('/health', (req, res) => {
  if (forceUnhealthy) {
    log.error('Phoenix Mesh: Inventory health probe failed (Simulated)');
    return res.status(500).json({ status: 'error', service: SERVICE_NAME });
  }
  
  res.json({ 
    status: 'ok', 
    service: SERVICE_NAME, 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/inventory/:sku', (req, res) => {
  if (forceUnhealthy) {
    return res.status(503).json({ error: 'Phoenix Mesh: Service unavailable' });
  }

  const stockData = {
    sku: req.params.sku,
    stock: Math.floor(Math.random() * 100),
    warehouse: 'WH-01',
    lastUpdated: new Date().toISOString()
  };

  log.info({ sku: stockData.sku }, 'Phoenix Mesh: Inventory lookup successful');
  res.json(stockData);
});

if (process.env.NODE_ENV !== 'production') {
  app.post('/dev/toggle-health', (req, res) => {
    forceUnhealthy = !forceUnhealthy;
    log.warn({ forceUnhealthy }, 'Phoenix Mesh: Inventory service health state toggled');
    res.json({ 
      currentStatus: forceUnhealthy ? 'DEGRADED' : 'HEALTHY' 
    });
  });
}

export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    log.info({ port: PORT, service: SERVICE_NAME }, 'Phoenix Mesh: Inventory Service started');
  });
}
