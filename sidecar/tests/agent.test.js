'use strict';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Mock prom-client to avoid duplicate metric registration across test runs
vi.mock('prom-client', () => {
  const metrics = {};
  const makeMetric = () => ({
    set: vi.fn(),
    inc: vi.fn(),
    observe: vi.fn(),
  });
  return {
    register: {
      contentType: 'text/plain',
      metrics: vi.fn().mockResolvedValue('# metrics'),
    },
    Gauge: vi.fn().mockImplementation(({ name }) => {
      metrics[name] = metrics[name] || makeMetric();
      return metrics[name];
    }),
    Counter: vi.fn().mockImplementation(({ name }) => {
      metrics[name] = metrics[name] || makeMetric();
      return metrics[name];
    }),
    Histogram: vi.fn().mockImplementation(({ name }) => {
      metrics[name] = metrics[name] || makeMetric();
      return metrics[name];
    }),
  };
});

// Mock axios at module level
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal();
  const upstreamFn = vi.fn().mockResolvedValue({ status: 200, data: {} });
  upstreamFn.get = vi.fn();
  upstreamFn.post = vi.fn();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn(() => upstreamFn),
      post: vi.fn(),
    },
  };
});

import axios from 'axios';
import { app, state, CONFIG, classifyError, recordProbe, probeHealth } from '../agent.js';

describe('classifyError', () => {
  it.each([
    [{ code: 'ECONNREFUSED' }, 'CRASH'],
    [{ code: 'ETIMEDOUT' }, 'TIMEOUT'],
    [{ code: 'ENOTFOUND' }, 'DNS_FAILURE'],
    [{ code: 'ECONNRESET' }, 'CONNECTION_RESET'],
    [{ code: 'UNKNOWN_CODE' }, 'NETWORK_ERROR'],
  ])('maps error code %o to %s', (err, expected) => {
    expect(classifyError(err)).toBe(expected);
  });

  it('maps HTTP 5xx responses to HTTP_5XX', () => {
    expect(classifyError({ response: { status: 500 } })).toBe('HTTP_5XX');
    expect(classifyError({ response: { status: 503 } })).toBe('HTTP_5XX');
  });

  it('maps HTTP 429 to RATE_LIMITED', () => {
    expect(classifyError({ response: { status: 429 } })).toBe('RATE_LIMITED');
  });

  it('maps HTTP 4xx to HTTP_4XX', () => {
    expect(classifyError({ response: { status: 400 } })).toBe('HTTP_4XX');
    expect(classifyError({ response: { status: 404 } })).toBe('HTTP_4XX');
  });
});

describe('recordProbe', () => {
  beforeEach(() => {
    state.probeHistory = [];
  });

  it('adds probe to history', () => {
    recordProbe(true, 100);
    expect(state.probeHistory).toHaveLength(1);
    expect(state.probeHistory[0]).toMatchObject({ success: true, latencyMs: 100 });
  });

  it('caps history at 20 entries', () => {
    for (let i = 0; i < 25; i++) {
      recordProbe(true, i);
    }
    expect(state.probeHistory).toHaveLength(20);
  });

  it('stores errorType when provided', () => {
    recordProbe(false, 500, 'CRASH');
    expect(state.probeHistory[0].errorType).toBe('CRASH');
  });
});

describe('GET /status', () => {
  it('returns the current sidecar state with uptime', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: expect.any(String),
      consecutiveFails: expect.any(Number),
      consecutiveSuccesses: expect.any(Number),
      uptime: expect.any(Number),
    });
  });
});

describe('GET /metrics', () => {
  it('returns prometheus metrics with correct content type', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });
});

describe('GET /proxy/*', () => {
  let upstreamFn;

  beforeEach(() => {
    upstreamFn = axios.create.mock.results[0]?.value;
    state.status = 'HEALTHY';
  });

  it('returns 503 with Circuit Open when service is UNHEALTHY', async () => {
    state.status = 'UNHEALTHY';
    const res = await request(app).get('/proxy/some/path');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Circuit Open');
  });

  it('proxies request to upstream when HEALTHY', async () => {
    if (upstreamFn) {
      upstreamFn.mockResolvedValueOnce({ status: 200, data: { result: 'ok' } });
      const res = await request(app).get('/proxy/api/data');
      expect(res.status).toBe(200);
    }
  });

  it('returns upstream error status when proxy request fails', async () => {
    if (upstreamFn) {
      const axiosErr = new Error('Upstream down');
      axiosErr.response = { status: 502 };
      upstreamFn.mockRejectedValueOnce(axiosErr);
      const res = await request(app).get('/proxy/api/broken');
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('Upstream Error');
    }
  });
});
