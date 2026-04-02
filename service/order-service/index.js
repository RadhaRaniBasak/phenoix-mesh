'use strict';

import express from 'express';
import pino from 'pino';

const SERVICE_NAME = process.env.SERVICE_NAME || 'phoenix-order-service';
const PORT = parseInt(process.env.PORT || '3000');

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: `phoenix-${SERVICE_NAME}`
});

const app = express();
app.use(express.json());

// Simulates service degradation for testing Phoenix Mesh self-healing
let forceUnhealthy = process.env.FORCE_UNHEALTHY === 'true';
let requestCount = 0;

/**
 * Phoenix Sidecar Probe Endpoint
 * The sidecar agent calls this to verify the 'Ready' status of the app.
 */
app.get('/health', (req, res) => {
  if (forceUnhealthy) {
    log.error('Phoenix Mesh: Health probe failed (forced unhealthy state)');
    return res.status(500).json({ 
      status: 'error', 
      service: SERVICE_NAME,
      reason: 'Manual degradation triggered for Phoenix Mesh testing' 
    });
  }

  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    uptime: process.uptime(),
    requests: requestCount,
    timestamp: new Date().toISOString()
  });
});


app.get('/orders', (req, res) => {
  requestCount++;
  
  if (forceUnhealthy) {
    return res.status(503).json({ error: 'Phoenix Mesh: Service Unavailable' });
  }

  res.json({
    orders: [
      { id: 'ord-001', item: 'Coffee beans', qty: 2, status: 'shipped' },
      { id: 'ord-002', item: 'Mechanical Keyboard', qty: 1, status: 'processing' },
    ],
  });
});

app.post('/orders', (req, res) => {
  requestCount++;
  
  if (forceUnhealthy) {
    return res.status(503).json({ error: 'Phoenix Mesh: Service Unavailable' });
  }

  const order = { 
    id: `ord-${Date.now()}`, 
    ...req.body, 
    status: 'created',
    processedBy: SERVICE_NAME 
  };

  log.info({ orderId: order.id }, 'Phoenix Mesh: Order created successfully');
  res.status(201).json(order);
});

if (process.env.NODE_ENV !== 'production') {
  app.post('/dev/toggle-health', (req, res) => {
    forceUnhealthy = !forceUnhealthy;
    log.warn({ forceUnhealthy }, 'Phoenix Mesh: Service health state manually toggled');
    res.json({ 
      currentStatus: forceUnhealthy ? 'DEGRADED' : 'HEALTHY',
      impact: 'Sidecar probes will now begin to fail.'
    });
  });
}

app.listen(PORT, () => {
  log.info({ port: PORT, service: SERVICE_NAME }, 'Phoenix Mesh: Target Service started');
});
