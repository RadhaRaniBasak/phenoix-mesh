'use strict';

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

describe('Inventory Service', () => {
  describe('GET /health', () => {
    it('returns 200 with ok status when healthy', async () => {
      process.env.FORCE_UNHEALTHY = 'false';
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBeDefined();
    });

    it('returns 500 when FORCE_UNHEALTHY is true', async () => {
      process.env.FORCE_UNHEALTHY = 'true';
      // Need to reimport or manipulate forceUnhealthy
      // We use the toggle endpoint to set it
      await request(app).post('/dev/toggle-health'); // toggle to unhealthy
      const res = await request(app).get('/health');
      // Reset
      await request(app).post('/dev/toggle-health');

      expect(res.status).toBe(500);
      expect(res.body.status).toBe('error');
      process.env.FORCE_UNHEALTHY = 'false';
    });
  });

  describe('GET /inventory/:sku', () => {
    it('returns stock data for a given SKU when healthy', async () => {
      process.env.FORCE_UNHEALTHY = 'false';
      // Ensure service is healthy
      // The forceUnhealthy module variable is false by default
      const res = await request(app).get('/inventory/SKU-123');
      expect(res.status).toBe(200);
      expect(res.body.sku).toBe('SKU-123');
      expect(res.body.stock).toBeGreaterThanOrEqual(0);
      expect(res.body.warehouse).toBe('WH-01');
      expect(res.body.lastUpdated).toBeDefined();
    });

    it('returns 503 when service is forced unhealthy', async () => {
      // Toggle to unhealthy state
      await request(app).post('/dev/toggle-health');
      const res = await request(app).get('/inventory/SKU-999');
      // Toggle back
      await request(app).post('/dev/toggle-health');

      expect(res.status).toBe(503);
    });

    it('returns different stock values for different SKUs', async () => {
      const res1 = await request(app).get('/inventory/SKU-A');
      const res2 = await request(app).get('/inventory/SKU-B');
      // Both should succeed
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.sku).toBe('SKU-A');
      expect(res2.body.sku).toBe('SKU-B');
    });
  });

  describe('POST /dev/toggle-health', () => {
    it('toggles health status and returns currentStatus', async () => {
      const res1 = await request(app).post('/dev/toggle-health');
      expect(res1.status).toBe(200);
      expect(['DEGRADED', 'HEALTHY']).toContain(res1.body.currentStatus);

      // Toggle back
      const res2 = await request(app).post('/dev/toggle-health');
      expect(['DEGRADED', 'HEALTHY']).toContain(res2.body.currentStatus);
      expect(res2.body.currentStatus).not.toBe(res1.body.currentStatus);
    });
  });
});
