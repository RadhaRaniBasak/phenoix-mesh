'use strict';

import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { fileURLToPath } from 'url';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'payment-service' 
});

const app = express();
const PORT = parseInt(process.env.SERVICE_PORT || '3000');

app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger: log }));


const requestMetrics = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalProcessed: 0,
};

const transactions = new Map([
  ['TXN-001', { id: 'TXN-001', orderId: 'ORD-001', amount: 99.99, status: 'completed', currency: 'USD' }],
]);

app.get('/health', (req, res) => {
  requestMetrics.totalRequests++;
  requestMetrics.successfulRequests++;
  
  res.json({
    status: 'ok',
    service: 'payment-service',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    metrics: {
      totalRequests: requestMetrics.totalRequests,
      successfulRequests: requestMetrics.successfulRequests,
      failedRequests: requestMetrics.failedRequests,
      totalProcessed: requestMetrics.totalProcessed,
    },
  });
});

app.post('/process', (req, res) => {
  requestMetrics.totalRequests++;
  const { orderId, amount, currency, method } = req.body;
  
  if (!orderId || !amount) {
    requestMetrics.failedRequests++;
    log.warn({ orderId, amount }, 'Invalid payment request');
    return res.status(400).json({ error: 'Missing orderId or amount' });
  }

  if (amount <= 0) {
    requestMetrics.failedRequests++;
    return res.status(400).json({ error: 'Amount must be positive' });
  }

  const transactionId = `TXN-${Date.now()}`;
  const transaction = {
    id: transactionId,
    orderId,
    amount,
    currency: currency || 'USD',
    method: method || 'card',
    status: 'completed',
    processedAt: new Date().toISOString(),
  };

  transactions.set(transactionId, transaction);
  requestMetrics.successfulRequests++;
  requestMetrics.totalProcessed += amount;

  log.info({ transactionId, orderId, amount }, 'Payment processed successfully');
  
  res.json({
    success: true,
    transaction,
    message: 'Payment processed successfully',
  });
});

app.get('/transactions/:id', (req, res) => {
  requestMetrics.totalRequests++;
  const { id } = req.params;
  
  const transaction = transactions.get(id);
  if (!transaction) {
    requestMetrics.failedRequests++;
    log.warn({ transactionId: id }, 'Transaction not found');
    return res.status(404).json({ error: 'Transaction not found' });
  }
  
  requestMetrics.successfulRequests++;
  res.json(transaction);
});

app.get('/orders/:orderId/transactions', (req, res) => {
  requestMetrics.totalRequests++;
  const { orderId } = req.params;
  
  const orderTransactions = Array.from(transactions.values())
    .filter(t => t.orderId === orderId);
  
  requestMetrics.successfulRequests++;
  res.json({
    orderId,
    transactions: orderTransactions,
    count: orderTransactions.length,
    total: orderTransactions.reduce((sum, t) => sum + t.amount, 0),
  });
});
app.post('/transactions/:id/refund', (req, res) => {
  requestMetrics.totalRequests++;
  const { id } = req.params;
  
  const transaction = transactions.get(id);
  if (!transaction) {
    requestMetrics.failedRequests++;
    return res.status(404).json({ error: 'Transaction not found' });
  }

  if (transaction.status === 'refunded') {
    requestMetrics.failedRequests++;
    return res.status(400).json({ error: 'Transaction already refunded' });
  }

  transaction.status = 'refunded';
  transaction.refundedAt = new Date().toISOString();
  requestMetrics.successfulRequests++;
  requestMetrics.totalProcessed -= transaction.amount;

  log.info({ transactionId: id }, 'Payment refunded');
  res.json({
    success: true,
    transaction,
    message: 'Payment refunded successfully',
  });
});

export { app };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
const server = app.listen(PORT, () => {
  log.info({ port: PORT }, 'Payment Service operational');
});

function gracefulShutdown(signal) {
  log.info({ signal }, 'Payment Service: Initiating graceful shutdown');
  
  server.close(() => {
    log.info('Payment Service: All connections closed');
    process.exit(0);
  });

  setTimeout(() => {
    log.fatal('Payment Service: Shutdown timeout, forcing exit');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.fatal({ reason }, 'Payment Service: Unhandled promise rejection');
});
}
