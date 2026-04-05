'use strict';

import pino from 'pino';
import * as ollamaProvider from './rcaProvider-ollama.js';
import * as rulesProvider from './rcaProvider-rules.js';

const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  name: 'phoenix-rca-factory',
});

// Simple in-memory RCA cache to avoid redundant Ollama calls for the same incident pattern.
const rcaCache = new Map();
const CACHE_TTL_MS = parseInt(process.env.RCA_CACHE_TTL_MS || '300000', 10) || 300000; // 5 min default

function getCacheKey(rcaData) {
  return `${rcaData.service}:${rcaData.failureReport?.errorType}:${rcaData.failureReport?.consecutiveFails}`;
}

function getCached(key) {
  const entry = rcaCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    rcaCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key, result) {
  rcaCache.set(key, { result, cachedAt: Date.now() });
  // Prevent unbounded growth — prefer evicting expired entries first
  if (rcaCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of rcaCache) {
      if (now - v.cachedAt > CACHE_TTL_MS) {
        rcaCache.delete(k);
        if (rcaCache.size <= 100) break;
      }
    }
    // If no expired entries freed enough space, remove the oldest entry
    if (rcaCache.size > 100) {
      const oldestKey = rcaCache.keys().next().value;
      rcaCache.delete(oldestKey);
    }
  }
}

/**
 * Generate RCA using the best available provider.
 * Priority: Ollama → Rules-based fallback.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} rcaData - Raw incident data (used for cache key and rules fallback)
 * @returns {Promise<object>} RCA result object
 */
export async function generateRCA(systemPrompt, userPrompt, rcaData) {
  const cacheKey = getCacheKey(rcaData);
  const cached = getCached(cacheKey);
  if (cached) {
    log.info({ service: rcaData.service }, 'Phoenix RCA: Returning cached result');
    return cached;
  }

  // Try Ollama first
  const ollamaAvailable = await ollamaProvider.isAvailable();

  if (ollamaAvailable) {
    try {
      const raw = await ollamaProvider.analyze(systemPrompt, userPrompt);
      const result = parseJsonResponse(raw);
      log.info({ service: rcaData.service }, 'Phoenix RCA: Ollama analysis complete');
      setCache(cacheKey, result);
      return result;
    } catch (err) {
      log.warn({ err: err.message }, 'Phoenix RCA: Ollama analysis failed — falling back to rules engine');
    }
  } else {
    log.warn('Phoenix RCA: Ollama unavailable — using rules-based fallback');
  }

  // Fallback to rules engine
  const rulesResult = rulesProvider.analyze(rcaData);
  setCache(cacheKey, rulesResult);
  return rulesResult;
}

function parseJsonResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Empty response from Ollama');
  }

  // Try direct parse first
  try {
    return JSON.parse(raw);
  } catch {
    // Extract the first JSON object from the response
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No valid JSON found in Ollama response');
    return JSON.parse(match[0]);
  }
}
