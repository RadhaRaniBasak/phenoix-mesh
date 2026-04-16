'use strict';

import axios from 'axios';
import pino from 'pino';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'metrics-collector'
});

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090';

export async function collectServiceMetrics(service) {
  try {
    const errorRateQuery = `rate(service_errors_total{service="${service}"}[5m])`;
    const errorRateResponse = await queryPrometheus(errorRateQuery);
    const errorRate = parseMetricValue(errorRateResponse) || 0;
    const latencyQuery = `histogram_quantile(0.95, rate(service_probe_latency_ms_bucket{service="${service}"}[5m]))`;
    const latencyResponse = await queryPrometheus(latencyQuery);
    const latency = parseMetricValue(latencyResponse) || 0;
    const cpuQuery = `rate(container_cpu_usage_seconds_total{pod_name=~"${service}.*"}[5m]) * 100`;
    const cpuResponse = await queryPrometheus(cpuQuery);
    const cpu = parseMetricValue(cpuResponse) || 0;
    const memoryQuery = `container_memory_usage_bytes{pod_name=~"${service}.*"} / container_spec_memory_limit_bytes{pod_name=~"${service}.*"} * 100`;
    const memoryResponse = await queryPrometheus(memoryQuery);
    const memory = parseMetricValue(memoryResponse) || 0;

    const metrics = {
      service,
      errorRate: Math.min(errorRate, 1), // Clamp between 0-1
      latency: Math.round(latency),
      cpu: Math.round(cpu),
      memory: Math.round(memory),
      timestamp: new Date().toISOString(),
    };

    log.info({ service, ...metrics }, 'Metrics collected');
    return metrics;
  } catch (err) {
    log.error({ err: err.message, service }, 'Failed to collect metrics');
    return null;
  }
}

async function queryPrometheus(query) {
  try {
    const response = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
      params: { query },
      timeout: 5000,
    });

    return response.data.data;
  } catch (err) {
    log.warn({ err: err.message, query }, 'Prometheus query failed');
    return null;
  }
}
function parseMetricValue(data) {
  if (!data) return null;

  if (data.resultType === 'vector' && data.result?.length > 0) {
    const value = data.result[0].value?.[1];
    return value ? parseFloat(value) : null;
  }
  if (data.resultType === 'scalar' && data.result?.length === 2) {
    return parseFloat(data.result[1]);
  }
  return null;
}
