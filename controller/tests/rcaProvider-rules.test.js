'use strict';

import { describe, it, expect } from 'vitest';
import { generateRCAViaRules } from '../rcaProvider-rules.js';

function makeContext(overrides = {}) {
  return {
    service: 'test-service',
    failureReport: {
      errorType: 'CRASH',
      consecutiveFails: 3,
      reportedAt: Date.now(),
      ...overrides.failureReport,
    },
    metrics: overrides.metrics ?? null,
    remediationTaken: overrides.remediationTaken ?? [],
  };
}

describe('generateRCAViaRules', () => {
  it('returns a valid RCA for CRASH error type', async () => {
    const ctx = makeContext();
    const rca = await generateRCAViaRules(ctx);

    expect(rca).toMatchObject({
      rootCause: expect.any(String),
      severity: expect.stringMatching(/critical|high|medium|low/),
      impactAnalysis: expect.any(String),
      recommendations: expect.arrayContaining([expect.any(String)]),
      preventionStrategies: expect.arrayContaining([expect.any(String)]),
      possibleCauses: expect.arrayContaining([expect.any(String)]),
      timeline: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it.each([
    'CRASH', 'TIMEOUT', 'HTTP_5XX', 'HTTP_4XX',
    'RATE_LIMITED', 'DNS_FAILURE', 'CONNECTION_RESET', 'NETWORK_ERROR',
  ])('handles known error type: %s', async (errorType) => {
    const ctx = makeContext({ failureReport: { errorType, consecutiveFails: 2, reportedAt: Date.now() } });
    const rca = await generateRCAViaRules(ctx);
    expect(rca.rootCause).toBeTruthy();
    expect(rca.severity).toMatch(/critical|high|medium|low/);
  });

  it('falls back to NETWORK_ERROR for unknown error types', async () => {
    const ctx = makeContext({ failureReport: { errorType: 'UNKNOWN_TYPE', consecutiveFails: 1, reportedAt: Date.now() } });
    const rca = await generateRCAViaRules(ctx);
    expect(rca.rootCause).toBeTruthy();
    expect(rca.recommendations).toBeDefined();
  });

  it('escalates severity to critical when consecutiveFails >= 10', async () => {
    const ctx = makeContext({
      failureReport: { errorType: 'HTTP_4XX', consecutiveFails: 10, reportedAt: Date.now() },
    });
    const rca = await generateRCAViaRules(ctx);
    expect(rca.severity).toBe('critical');
  });

  it('escalates severity to high when consecutiveFails >= 5 and base is medium', async () => {
    const ctx = makeContext({
      failureReport: { errorType: 'HTTP_4XX', consecutiveFails: 5, reportedAt: Date.now() },
    });
    const rca = await generateRCAViaRules(ctx);
    expect(rca.severity).toBe('high');
  });

  it('retains base severity for CRASH when consecutiveFails < 5', async () => {
    const ctx = makeContext({
      failureReport: { errorType: 'CRASH', consecutiveFails: 1, reportedAt: Date.now() },
    });
    const rca = await generateRCAViaRules(ctx);
    expect(rca.severity).toBe('critical'); // CRASH base is critical
  });

  describe('selectMostLikelyCause via CRASH', () => {
    it('returns OOM cause when memory > 90', async () => {
      const ctx = makeContext({ metrics: { memory: 95, cpu: 50 } });
      const rca = await generateRCAViaRules(ctx);
      expect(rca.rootCause).toContain('Out of Memory');
    });

    it('returns CPU exhaustion cause when cpu > 95', async () => {
      const ctx = makeContext({ metrics: { memory: 50, cpu: 96 } });
      const rca = await generateRCAViaRules(ctx);
      expect(rca.rootCause).toContain('CPU exhaustion');
    });

    it('returns default cause when metrics are within bounds', async () => {
      const ctx = makeContext({ metrics: { memory: 60, cpu: 70 } });
      const rca = await generateRCAViaRules(ctx);
      expect(rca.rootCause).toBeTruthy();
    });
  });

  describe('selectMostLikelyCause via TIMEOUT', () => {
    it('returns severe latency cause when latency > 10000', async () => {
      const ctx = makeContext({
        failureReport: { errorType: 'TIMEOUT', consecutiveFails: 2, reportedAt: Date.now() },
        metrics: { latency: 15000, cpu: 50, memory: 50 },
      });
      const rca = await generateRCAViaRules(ctx);
      expect(rca.rootCause).toContain('Severe latency spike');
    });

    it('returns CPU starvation cause when cpu > 80', async () => {
      const ctx = makeContext({
        failureReport: { errorType: 'TIMEOUT', consecutiveFails: 2, reportedAt: Date.now() },
        metrics: { latency: 500, cpu: 85, memory: 50 },
      });
      const rca = await generateRCAViaRules(ctx);
      expect(rca.rootCause).toContain('Resource starvation - high CPU');
    });

    it('returns memory starvation cause when memory > 80', async () => {
      const ctx = makeContext({
        failureReport: { errorType: 'TIMEOUT', consecutiveFails: 2, reportedAt: Date.now() },
        metrics: { latency: 500, cpu: 50, memory: 85 },
      });
      const rca = await generateRCAViaRules(ctx);
      expect(rca.rootCause).toContain('Resource starvation - high memory');
    });
  });

  describe('selectMostLikelyCause via RATE_LIMITED', () => {
    it('returns traffic spike cause when requestRate > 10000', async () => {
      const ctx = makeContext({
        failureReport: { errorType: 'RATE_LIMITED', consecutiveFails: 2, reportedAt: Date.now() },
        metrics: { requestRate: 15000 },
      });
      const rca = await generateRCAViaRules(ctx);
      expect(rca.rootCause).toContain('Traffic spike');
    });

    it('returns rate limit cause when requestRate <= 10000', async () => {
      const ctx = makeContext({
        failureReport: { errorType: 'RATE_LIMITED', consecutiveFails: 2, reportedAt: Date.now() },
        metrics: { requestRate: 5000 },
      });
      const rca = await generateRCAViaRules(ctx);
      expect(rca.rootCause).toContain('Rate limit threshold');
    });
  });

  describe('buildTimeline', () => {
    it('includes failure details in the timeline', async () => {
      const reportedAt = Date.now();
      const ctx = makeContext({
        failureReport: { errorType: 'HTTP_5XX', consecutiveFails: 3, reportedAt },
      });
      const rca = await generateRCAViaRules(ctx);
      expect(rca.timeline).toContain('HTTP_5XX');
      expect(rca.timeline).toContain('3');
    });

    it('includes remediation steps in the timeline', async () => {
      const ctx = makeContext({
        remediationTaken: [
          { step: 'isolation', result: { status: 'ok' }, ts: Date.now() },
          { step: 'rollback', error: 'failed', ts: Date.now() },
        ],
      });
      const rca = await generateRCAViaRules(ctx);
      expect(rca.timeline).toContain('isolation');
      expect(rca.timeline).toContain('rollback');
      expect(rca.timeline).toContain('FAILED');
    });
  });
});
