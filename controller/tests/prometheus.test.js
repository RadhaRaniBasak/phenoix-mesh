'use strict';

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios');

import axios from 'axios';
import { collectServiceMetrics } from '../prometheus.js';

const mockVectorResponse = (value) => ({
  data: {
    data: {
      resultType: 'vector',
      result: [{ value: ['timestamp', String(value)] }],
    },
  },
});

const mockScalarResponse = (value) => ({
  data: {
    data: {
      resultType: 'scalar',
      result: ['timestamp', String(value)],
    },
  },
});

describe('collectServiceMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metrics with correct values on success', async () => {
    axios.get
      .mockResolvedValueOnce(mockVectorResponse(0.02))   // errorRate
      .mockResolvedValueOnce(mockVectorResponse(250))    // latency
      .mockResolvedValueOnce(mockVectorResponse(65))     // cpu
      .mockResolvedValueOnce(mockVectorResponse(70));    // memory

    const metrics = await collectServiceMetrics('my-service');

    expect(metrics).toMatchObject({
      service: 'my-service',
      errorRate: expect.any(Number),
      latency: expect.any(Number),
      cpu: expect.any(Number),
      memory: expect.any(Number),
      timestamp: expect.any(String),
    });
    expect(metrics.latency).toBe(250);
    expect(metrics.cpu).toBe(65);
    expect(metrics.memory).toBe(70);
  });

  it('clamps errorRate to a maximum of 1', async () => {
    axios.get
      .mockResolvedValueOnce(mockVectorResponse(5.0))  // errorRate > 1
      .mockResolvedValueOnce(mockVectorResponse(100))
      .mockResolvedValueOnce(mockVectorResponse(50))
      .mockResolvedValueOnce(mockVectorResponse(60));

    const metrics = await collectServiceMetrics('my-service');
    expect(metrics.errorRate).toBe(1);
  });

  it('defaults to 0 when a query returns empty/null data', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { data: { resultType: 'vector', result: [] } } })
      .mockResolvedValueOnce({ data: { data: null } })
      .mockResolvedValueOnce(mockVectorResponse(10))
      .mockResolvedValueOnce(mockVectorResponse(20));

    const metrics = await collectServiceMetrics('my-service');
    expect(metrics.errorRate).toBe(0);
    expect(metrics.latency).toBe(0);
  });

  it('handles scalar result type correctly', async () => {
    axios.get
      .mockResolvedValueOnce(mockScalarResponse(0.05))
      .mockResolvedValueOnce(mockScalarResponse(300))
      .mockResolvedValueOnce(mockScalarResponse(40))
      .mockResolvedValueOnce(mockScalarResponse(55));

    const metrics = await collectServiceMetrics('scalar-service');
    expect(metrics.latency).toBe(300);
  });

  it('returns metrics with all-zero values when all Prometheus queries fail', async () => {
    axios.get.mockRejectedValue(new Error('Prometheus unreachable'));

    const metrics = await collectServiceMetrics('failing-service');
    // queryPrometheus catches errors internally; outer function returns metrics with 0 defaults
    expect(metrics).not.toBeNull();
    expect(metrics.errorRate).toBe(0);
    expect(metrics.latency).toBe(0);
    expect(metrics.cpu).toBe(0);
    expect(metrics.memory).toBe(0);
  });

  it('returns metrics with zeros when individual queries fail with network errors', async () => {
    axios.get
      .mockRejectedValueOnce(new Error('query failed'))   // errorRate fails
      .mockResolvedValueOnce(mockVectorResponse(200))     // latency succeeds
      .mockRejectedValueOnce(new Error('query failed'))   // cpu fails
      .mockResolvedValueOnce(mockVectorResponse(80));     // memory succeeds

    const metrics = await collectServiceMetrics('partial-service');
    expect(metrics).not.toBeNull();
    expect(metrics.latency).toBe(200);
    expect(metrics.memory).toBe(80);
  });
});
