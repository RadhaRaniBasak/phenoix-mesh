'use strict';

import axios from 'axios';
import pino from 'pino';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'phoenix-metrics-client'
});

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://phoenix-prometheus:9090';


export async function queryPrometheus(promql) {
  try {
    const res = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
      params: { query: promql },
      timeout: 5000,
    });

    const data = res.data?.data;
    if (!data || data.resultType !== 'vector' || data.result.length === 0) {
      return null;
    }

    // Return first result's value (index 1 in [timestamp, value])
    const raw = data.result[0].value[1];
    return parseFloat(raw);
  } catch (err) {
    log.warn({ promql, err: err.message }, 'Phoenix Mesh: Prometheus instant query failed');
    return null;
  }
}

export async function queryRange(promql, start, end, step = '15s') {
  try {
    const res = await axios.get(`${PROMETHEUS_URL}/api/v1/query_range`, {
      params: {
        query: promql,
        start: Math.floor(start / 1000),
        end: Math.floor(end / 1000),
        step,
      },
      timeout: 5000,
    });

    const result = res.data?.data?.result?.[0]?.values || [];
    return result.map(([ts, val]) => ({
      timestamp: ts * 1000,
      value: parseFloat(val),
    }));
  } catch (err) {
    log.warn({ promql, err: err.message }, 'Phoenix Mesh: Prometheus range query failed');
    return [];
  }
}
//update new query 
export async function collectServiceMetrics(service, windowMinutes = 5) {
  const window = `${windowMinutes}m`;

  
  const [errorRate, p99Latency, p50Latency, probeSuccessRate, errorsByType] = await Promise.all([
    queryPrometheus(`rate(phoenix_service_errors_total{service="${service}"}[${window}])`),
    queryPrometheus(`histogram_quantile(0.99, rate(phoenix_service_probe_latency_ms_bucket{service="${service}"}[${window}]))`),
    queryPrometheus(`histogram_quantile(0.50, rate(phoenix_service_probe_latency_ms_bucket{service="${service}"}[${window}]))`),
    queryPrometheus(`rate(phoenix_service_probes_total{service="${service}",result="success"}[${window}]) / rate(phoenix_service_probes_total{service="${service}"}[${window}])`),
    queryPrometheusVector(`sum by (type) (rate(phoenix_service_errors_total{service="${service}"}[${window}]))`),
  ]);

  return {
    errorRate:         errorRate   !== null ? parseFloat(errorRate.toFixed(6))  : null,
    p99LatencyMs:      p99Latency  !== null ? Math.round(p99Latency)            : null,
    p50LatencyMs:      p50Latency  !== null ? Math.round(p50Latency)            : null,
    probeSuccessRate:  probeSuccessRate !== null ? parseFloat((probeSuccessRate * 100).toFixed(2)) : null,
    errorsByType,
    collectedAt: new Date().toISOString(),
  };
}

async function queryPrometheusVector(promql) {
  try {
    const res = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
      params: { query: promql },
      timeout: 5000,
    });

    const results = res.data?.data?.result || [];
    return results.map(r => ({
      labels: r.metric,
      value: parseFloat(r.value[1]),
    }));
  } catch (err) {
    log.warn({ promql, err: err.message }, 'Phoenix Mesh: Prometheus vector query failed');
    return [];
  }
}
