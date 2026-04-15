'use strict';

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../payment.js';

describe('Payment Service', () => {
  describe('GET /health', () => {
    it('returns 200 with service info and metrics', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('payment-service');
      expect(res.body.metrics).toBeDefined();
    });
  });

  describe('POST /process', () => {
    it('processes a valid payment and returns a transaction', async () => {
      const res = await request(app).post('/process').send({
        orderId: 'ORD-100',
        amount: 75.50,
        currency: 'USD',
        method: 'card',
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.transaction.id).toMatch(/^TXN-/);
      expect(res.body.transaction.status).toBe('completed');
      expect(res.body.transaction.amount).toBe(75.50);
    });

    it('defaults currency to USD and method to card', async () => {
      const res = await request(app).post('/process').send({ orderId: 'ORD-101', amount: 10 });
      expect(res.status).toBe(200);
      expect(res.body.transaction.currency).toBe('USD');
      expect(res.body.transaction.method).toBe('card');
    });

    it('returns 400 when orderId is missing', async () => {
      const res = await request(app).post('/process').send({ amount: 50 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/orderId/);
    });

    it('returns 400 when amount is missing', async () => {
      const res = await request(app).post('/process').send({ orderId: 'ORD-X' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/amount/);
    });

    it('returns 400 when amount is zero (treated as missing by falsy check)', async () => {
      const res = await request(app).post('/process').send({ orderId: 'ORD-X', amount: 0 });
      expect(res.status).toBe(400);
      // amount=0 is falsy, so the missing-field check fires before the positive-amount check
      expect(res.body.error).toBeTruthy();
    });

    it('returns 400 when amount is negative', async () => {
      const res = await request(app).post('/process').send({ orderId: 'ORD-X', amount: -10 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Amount must be positive/);
    });
  });

  describe('GET /transactions/:id', () => {
    it('returns the seeded transaction TXN-001', async () => {
      const res = await request(app).get('/transactions/TXN-001');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('TXN-001');
      expect(res.body.orderId).toBe('ORD-001');
    });

    it('returns a newly created transaction', async () => {
      const processRes = await request(app).post('/process').send({ orderId: 'ORD-200', amount: 25 });
      const txnId = processRes.body.transaction.id;

      const res = await request(app).get(`/transactions/${txnId}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(txnId);
    });

    it('returns 404 for a non-existent transaction', async () => {
      const res = await request(app).get('/transactions/TXN-NONEXISTENT');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Transaction not found/);
    });
  });

  describe('GET /orders/:orderId/transactions', () => {
    it('returns transactions for an order with known transactions', async () => {
      const res = await request(app).get('/orders/ORD-001/transactions');
      expect(res.status).toBe(200);
      expect(res.body.orderId).toBe('ORD-001');
      expect(res.body.transactions).toBeInstanceOf(Array);
      expect(res.body.count).toBeGreaterThanOrEqual(1);
    });

    it('returns empty list for an order with no transactions', async () => {
      const res = await request(app).get('/orders/ORD-NOTRANSACTION/transactions');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.transactions).toEqual([]);
    });

    it('calculates the correct total for an orders transactions', async () => {
      // Process two payments for the same order
      await request(app).post('/process').send({ orderId: 'ORD-TOTAL-TEST', amount: 10 });
      await request(app).post('/process').send({ orderId: 'ORD-TOTAL-TEST', amount: 20 });

      const res = await request(app).get('/orders/ORD-TOTAL-TEST/transactions');
      expect(res.body.total).toBe(30);
    });
  });

  describe('POST /transactions/:id/refund', () => {
    it('refunds a completed transaction', async () => {
      const processRes = await request(app).post('/process').send({ orderId: 'ORD-REF-1', amount: 50 });
      const txnId = processRes.body.transaction.id;

      const res = await request(app).post(`/transactions/${txnId}/refund`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.transaction.status).toBe('refunded');
      expect(res.body.transaction.refundedAt).toBeDefined();
    });

    it('returns 404 for a non-existent transaction', async () => {
      const res = await request(app).post('/transactions/TXN-GHOST/refund');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Transaction not found/);
    });

    it('returns 400 when trying to refund an already-refunded transaction', async () => {
      const processRes = await request(app).post('/process').send({ orderId: 'ORD-REF-2', amount: 30 });
      const txnId = processRes.body.transaction.id;

      // First refund
      await request(app).post(`/transactions/${txnId}/refund`);
      // Second refund attempt
      const res = await request(app).post(`/transactions/${txnId}/refund`);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already refunded/);
    });
  });
});
