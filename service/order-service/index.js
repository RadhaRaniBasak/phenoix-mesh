'use strict';

import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'order-service' 
});

const app = express();
const PORT = parseInt(process.env.SERVICE_PORT || '3000');


app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger: log }));

const requestMetrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
};

const orders = new Map([
  ['ORD-001', { id: 'ORD-001', status: 'completed', total: 99.99, createdAt: new Date() }],
  ['ORD-002', { id: 'ORD-002', status: 'pending', total: 149.99, createdAt: new Date() }],
]);

app.get('/health', (req, res) => {
  requestMetrics.totalRequests++;
  requestMetrics.successfulRequests++;
  
  res.json({
    status: 'ok',
    service: 'order-service',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    metrics: {
      totalRequests: requestMetrics.totalRequests,
      successfulRequests: requestMetrics.successfulRequests,
      failedRequests: requestMetrics.failedRequests,
    },
  });
});

app.get('/orders', (req, res) => {
  requestMetrics.totalRequests++;
  requestMetrics.successfulRequests++;
  
  log.info({ count: orders.size }, 'Fetching all orders');
  res.json({
    orders: Array.from(orders.values()),
    count: orders.size,
  });
});

app.get('/orders/:id', (req, res) => {
  requestMetrics.totalRequests++;
  const { id } = req.params;
  
  const order = orders.get(id);
  if (!order) {
    requestMetrics.failedRequests++;
    log.warn({ orderId: id }, 'Order not found');
    return res.status(404).json({ error: 'Order not found' });
  }
  
  requestMetrics.successfulRequests++;
  res.json(order);
});

// Create new order
app.post('/orders', (req, res) => {
  requestMetrics.totalRequests++;
  const { items, total, customer } = req.body;
  
  if (!items || !total) {
    requestMetrics.failedRequests++;
    return res.status(400).json({ error: 'Missing required fields: items, total' });
  }
  
  const orderId = `ORD-${Date.now()}`;
  const order = {
    id: orderId,
    items,
    total,
    customer,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  
  orders.set(orderId, order);
  requestMetrics.successfulRequests++;
  
  log.info({ orderId, total }, 'Order created');
  res.status(201).json(order);
});

// Update order status
app.put('/orders/:id/status', (req, res) => {
  requestMetrics.totalRequests++;
  const { id } = req.params;
  const { status } = req.body;
  
  const order = orders.get(id);
  if (!order) {
    requestMetrics.failedRequests++;
    return res.status(404).json({ error: 'Order not found' });
  }
  
  if (!['pending', 'processing', 'completed', 'cancelled'].includes(status)) {
    requestMetrics.failedRequests++;
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  order.status = status;
  order.updatedAt = new Date().toISOString();
  requestMetrics.successfulRequests++;
  
  log.info({ orderId: id, status }, 'Order status updated');
  res.json(order);
});
const server = app.listen(PORT, () => {
  log.info({ port: PORT }, 'Order Service operational');
});

function gracefulShutdown(signal) {
  log.info({ signal }, 'Order Service: Initiating graceful shutdown');
  
  server.close(() => {
    log.info('Order Service: All connections closed');
    process.exit(0);
  });

  setTimeout(() => {
    log.fatal('Order Service: Shutdown timeout, forcing exit');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.fatal({ reason }, 'Order Service: Unhandled promise rejection');
});
