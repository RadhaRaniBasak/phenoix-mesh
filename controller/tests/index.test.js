'use strict';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock all heavy dependencies before importing the app
vi.mock('../meshController.js', () => ({
  handleFailure: vi.fn().mockResolvedValue({ status: 'resolved', severity: 'high' }),
  handleRecovery: vi.fn(),
  getActiveIncidents: vi.fn().mockReturnValue([]),
}));
vi.mock('../rollback.js', () => ({
  initK8sClients: vi.fn(),
}));
vi.mock('../logs.js', () => ({
  initK8sClient: vi.fn(),
}));
// Prevent k8s client from trying to load config files
vi.mock('@kubernetes/client-node', () => ({
  default: {
    KubeConfig: class {
      loadFromFile() {}
      loadFromCluster() {}
      loadFromDefault() {}
      makeApiClient() { return {}; }
    },
  },
}));

import { handleFailure, handleRecovery, getActiveIncidents } from '../meshController.js';
import { app } from '../index.js';

describe('Controller API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleFailure.mockResolvedValue({ status: 'resolved', severity: 'high' });
    getActiveIncidents.mockReturnValue([]);
  });

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.mesh).toBe('phoenix');
    });
  });

  describe('GET /api/incidents', () => {
    it('returns empty incident list', async () => {
      const res = await request(app).get('/api/incidents');
      expect(res.status).toBe(200);
      expect(res.body.system).toBe('phoenix-mesh');
      expect(res.body.incidents).toEqual([]);
    });

    it('returns active incidents when present', async () => {
      getActiveIncidents.mockReturnValue([
        { key: 'default/svc', service: 'svc', startedAt: Date.now(), steps: [] },
      ]);
      const res = await request(app).get('/api/incidents');
      expect(res.status).toBe(200);
      expect(res.body.active_count).toBe(1);
      expect(res.body.incidents).toHaveLength(1);
    });
  });

  describe('POST /api/failure', () => {
    const validReport = {
      service: 'inventory',
      podName: 'inventory-abc',
      namespace: 'default',
      errorType: 'CRASH',
      consecutiveFails: 3,
    };

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/failure')
        .send({ service: 'inventory' }); // missing podName and namespace
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required/);
    });

    it('returns 202 for a valid failure report', async () => {
      const res = await request(app).post('/api/failure').send(validReport);
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('acknowledged');
      expect(res.body.incidentId).toBe('default/inventory');
    });

    it('returns 400 when body is empty', async () => {
      const res = await request(app).post('/api/failure').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/recovery', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await request(app).post('/api/recovery').send({ service: 'svc' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required/);
    });

    it('returns 200 for a valid recovery report', async () => {
      const res = await request(app)
        .post('/api/recovery')
        .send({ service: 'inventory', namespace: 'default' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('recovered');
      expect(handleRecovery).toHaveBeenCalledOnce();
    });
  });

  describe('POST /api/test/failure (non-production only)', () => {
    it('returns 202 with test_triggered status', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      const res = await request(app)
        .post('/api/test/failure')
        .send({ service: 'test-svc', errorType: 'TIMEOUT' });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe('test_triggered');
      process.env.NODE_ENV = originalEnv;
    });
  });
});
