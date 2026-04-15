'use strict';

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';

describe('Order Service', () => {
  describe('GET /health', () => {
    it('returns 200 with service info and metrics', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('order-service');
      expect(res.body.metrics).toBeDefined();
    });
  });

  describe('GET /orders', () => {
    it('returns all seeded orders', async () => {
      const res = await request(app).get('/orders');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.orders)).toBe(true);
      expect(res.body.count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /orders/:id', () => {
    it('returns a specific existing order', async () => {
      const res = await request(app).get('/orders/ORD-001');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('ORD-001');
      expect(res.body.status).toBe('completed');
    });

    it('returns 404 for a non-existent order', async () => {
      const res = await request(app).get('/orders/ORD-NONEXISTENT');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Order not found/);
    });
  });

  describe('POST /orders', () => {
    it('creates a new order with valid data', async () => {
      const payload = {
        items: [{ sku: 'SKU-1', qty: 2 }],
        total: 49.99,
        customer: 'Alice',
      };
      const res = await request(app).post('/orders').send(payload);
      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^ORD-/);
      expect(res.body.status).toBe('pending');
      expect(res.body.total).toBe(49.99);
    });

    it('returns 400 when items is missing', async () => {
      const res = await request(app).post('/orders').send({ total: 10 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required/);
    });

    it('returns 400 when total is missing', async () => {
      const res = await request(app).post('/orders').send({ items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required/);
    });

    it('returns 400 when body is empty', async () => {
      const res = await request(app).post('/orders').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /orders/:id/status', () => {
    it('updates order status to a valid value', async () => {
      const res = await request(app)
        .put('/orders/ORD-002/status')
        .send({ status: 'processing' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('processing');
      expect(res.body.updatedAt).toBeDefined();
    });

    it('returns 404 when order does not exist', async () => {
      const res = await request(app)
        .put('/orders/ORD-GHOST/status')
        .send({ status: 'completed' });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Order not found/);
    });

    it('returns 400 for an invalid status value', async () => {
      const res = await request(app)
        .put('/orders/ORD-001/status')
        .send({ status: 'unknown-status' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid status/);
    });

    it.each(['pending', 'processing', 'completed', 'cancelled'])(
      'accepts valid status: %s',
      async (status) => {
        // Create a fresh order first to avoid state pollution
        const createRes = await request(app).post('/orders').send({ items: [{}], total: 5 });
        const orderId = createRes.body.id;

        const res = await request(app)
          .put(`/orders/${orderId}/status`)
          .send({ status });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(status);
      }
    );
  });
});
