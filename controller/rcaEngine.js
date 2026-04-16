'use strict';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../rcaProvider-ollama.js', () => ({
  generateRCAViaOllama: vi.fn(),
}));

vi.mock('../rcaProvider-rules.js', () => ({
  generateRCAViaRules: vi.fn(),
}));

import { generateRCAViaOllama } from '../rcaProvider-ollama.js';
import { generateRCAViaRules } from '../rcaProvider-rules.js';
import { generatePhoenixRCA } from '../rcaEngine.js';

function makeContext(overrides = {}) {
  return {
    service: 'test-service',
    failureReport: {
      errorType: 'CRASH',
      consecutiveFails: 3,
      reportedAt: Date.now(),
      ...overrides.failureReport,
    },
    ...overrides,
  };
}

const baseOllamaRCA = {
  rootCause: 'OOM Kill',
  severity: 'critical',
  recommendations: ['Increase memory limits'],
  impactAnalysis: 'Service down',
  preventionStrategies: ['Set resource limits'],
  model: 'ollama/mistral',
  timestamp: new Date().toISOString(),
};

const baseRulesRCA = {
  rootCause: 'Out of Memory (OOM Kill)',
  severity: 'critical',
  recommendations: ['Increase memory'],
  impactAnalysis: 'Service down',
  preventionStrategies: ['Set limits'],
  timestamp: new Date().toISOString(),
};

describe('generatePhoenixRCA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns RCA from Ollama on success', async () => {
    generateRCAViaOllama.mockResolvedValue({ ...baseOllamaRCA });

    const ctx = makeContext();
    const result = await generatePhoenixRCA(ctx);

    expect(result.rootCause).toBe('OOM Kill');
    expect(result.model).toBe('ollama/mistral');
    expect(result.fromCache).toBeUndefined();
  });

  it('returns cached RCA on second call with same key', async () => {
    generateRCAViaOllama.mockResolvedValue({ ...baseOllamaRCA });

    const ctx = makeContext({ failureReport: { errorType: 'TIMEOUT', consecutiveFails: 99, reportedAt: Date.now() } });
    const first = await generatePhoenixRCA(ctx);
    const second = await generatePhoenixRCA(ctx);

    expect(second.fromCache).toBe(true);
    // Ollama should only have been called once
    expect(generateRCAViaOllama).toHaveBeenCalledTimes(1);
  });

  it('falls back to rules engine when Ollama fails', async () => {
    generateRCAViaOllama.mockRejectedValue(new Error('Ollama unavailable'));
    generateRCAViaRules.mockResolvedValue({ ...baseRulesRCA });

    const ctx = makeContext({ failureReport: { errorType: 'DNS_FAILURE', consecutiveFails: 4, reportedAt: Date.now() } });
    const result = await generatePhoenixRCA(ctx);

    expect(generateRCAViaRules).toHaveBeenCalledOnce();
    expect(result.rootCause).toBe('Out of Memory (OOM Kill)');
  });

  it('returns minimal fallback RCA when both engines fail', async () => {
    generateRCAViaOllama.mockRejectedValue(new Error('Ollama down'));
    generateRCAViaRules.mockRejectedValue(new Error('Rules engine down'));

    const ctx = makeContext({ failureReport: { errorType: 'HTTP_5XX', consecutiveFails: 7, reportedAt: Date.now() } });
    const result = await generatePhoenixRCA(ctx);

    expect(result.model).toBe('error-fallback');
    expect(result.rootCause).toContain('HTTP_5XX');
    expect(result.recommendations).toBeInstanceOf(Array);
  });

  it('assigns severity critical when consecutiveFails >= 5 in fallback', async () => {
    generateRCAViaOllama.mockRejectedValue(new Error('down'));
    generateRCAViaRules.mockRejectedValue(new Error('down'));

    const ctx = makeContext({ failureReport: { errorType: 'CRASH', consecutiveFails: 5, reportedAt: Date.now() } });
    const result = await generatePhoenixRCA(ctx);

    expect(result.severity).toBe('critical');
  });

  it('assigns severity high when consecutiveFails < 5 in fallback', async () => {
    generateRCAViaOllama.mockRejectedValue(new Error('down'));
    generateRCAViaRules.mockRejectedValue(new Error('down'));

    const ctx = makeContext({ failureReport: { errorType: 'CRASH', consecutiveFails: 2, reportedAt: Date.now() } });
    const result = await generatePhoenixRCA(ctx);

    expect(result.severity).toBe('high');
  });

  it('generates fresh RCA for different service+errorType+fails combination', async () => {
    generateRCAViaOllama.mockResolvedValue({ ...baseOllamaRCA });

    const ctx1 = makeContext({ failureReport: { errorType: 'CRASH', consecutiveFails: 1, reportedAt: Date.now() } });
    const ctx2 = makeContext({ failureReport: { errorType: 'TIMEOUT', consecutiveFails: 1, reportedAt: Date.now() } });

    await generatePhoenixRCA(ctx1);
    await generatePhoenixRCA(ctx2);

    expect(generateRCAViaOllama).toHaveBeenCalledTimes(2);
  });
});

