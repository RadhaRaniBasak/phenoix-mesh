'use strict';

import pino from 'pino';
import { generateRCAViaOllama } from './rcaProvider-ollama.js';
import { generateRCAViaRules } from './rcaProvider-rules.js';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'phoenix-rca-engine'
});

const rcaCache = new Map();
const CACHE_TTL_MS = parseInt(process.env.RCA_CACHE_TTL_MS || '600000'); // 10 minutes

export async function generatePhoenixRCA(phoenixContext) {
  const { service, failureReport } = phoenixContext;
  //create cache
  const cacheKey = `${service}:${failureReport.errorType}:${failureReport.consecutiveFails}`;
  
  //check cache
  const cached = rcaCache.get(cacheKey);
  if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
    log.info({ service, cacheKey }, 'RCA cache hit - returning cached analysis');
    return { ...cached, fromCache: true };
  }

  log.info({ service }, 'Generating new RCA analysis...');

  try {
    
    const rca = await generateRCAViaOllama(phoenixContext);
    
    //store
    rca.generatedAt = Date.now();
    rcaCache.set(cacheKey, rca);
    
    log.info({ service, model: 'ollama', severity: rca.severity }, 'RCA generated successfully via Ollama');
    return rca;
  } catch (err) {
    log.warn({ err: err.message }, 'Ollama RCA generation failed, falling back to rules engine');

    try {
      // Fallback to rules-based engine
      const rca = await generateRCAViaRules(phoenixContext);
      
      rca.generatedAt = Date.now();
      rcaCache.set(cacheKey, rca);
      
      log.info({ service, model: 'rules-based', severity: rca.severity }, 'RCA generated via fallback rules engine');
      return rca;
    } catch (fallbackErr) {
      log.error({ err: fallbackErr.message }, 'Both RCA engines failed - returning minimal RCA');
      
      return {
        rootCause: `${failureReport.errorType} - Unable to analyze`,
        severity: failureReport.consecutiveFails >= 5 ? 'critical' : 'high',
        recommendations: [
          'Check pod logs manually',
          'Review recent deployments',
          'Monitor resource utilization',
          'Verify external dependencies'
        ],
        model: 'error-fallback',
        timestamp: new Date().toISOString(),
      };
    }
  }
}

//periodically clears old cache entries
setInterval(() => {
  const now = Date.now();
  let cleared = 0;
  
  for (const [key, value] of rcaCache.entries()) {
    if (now - value.generatedAt > CACHE_TTL_MS) {
      rcaCache.delete(key);
      cleared++;
    }
  }
  
  if (cleared > 0) {
    log.debug({ cleared }, 'RCA cache cleanup completed');
  }
}, 600000);
