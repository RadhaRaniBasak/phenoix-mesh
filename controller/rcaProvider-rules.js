'use strict';

/**
 * Rules-based deterministic RCA provider.
 * Used as a fallback when Ollama is unavailable.
 * No external API calls — pure heuristic analysis.
 */

const CATEGORY_MAP = {
  CRASH:              { severity: 'P1', confidence: 'HIGH', action: 'Inspect crash logs and restart the service with resource limits.' },
  TIMEOUT:            { severity: 'P2', confidence: 'MEDIUM', action: 'Check upstream dependency response times and increase probe timeouts.' },
  HTTP_5XX:           { severity: 'P2', confidence: 'MEDIUM', action: 'Review application error logs for unhandled exceptions.' },
  MEMORY_LEAK:        { severity: 'P1', confidence: 'HIGH', action: 'Restart the pod immediately and profile heap allocations.' },
  RESOURCE_EXHAUSTION:{ severity: 'P1', confidence: 'HIGH', action: 'Scale replicas or increase resource limits in the Deployment manifest.' },
  DNS_FAILURE:        { severity: 'P2', confidence: 'MEDIUM', action: 'Verify CoreDNS health and service name resolution within the cluster.' },
  CONNECTION_RESET:   { severity: 'P2', confidence: 'MEDIUM', action: 'Inspect network policies and service mesh connectivity rules.' },
  NETWORK_ERROR:      { severity: 'P2', confidence: 'MEDIUM', action: 'Review network policies and inter-service communication paths.' },
  UNKNOWN:            { severity: 'P2', confidence: 'LOW', action: 'Perform manual log review — insufficient telemetry for automated analysis.' },
};

function detectCategory(rcaData) {
  const errorType = rcaData.failureReport?.errorType || rcaData.failureReport?.lastError?.type || 'UNKNOWN';
  const logs = rcaData.logs?.summary || {};

  if (logs.hasOOM) return 'MEMORY_LEAK';
  if (errorType === 'CRASH' || logs.hasPanic) return 'CRASH';
  if (errorType === 'TIMEOUT' || logs.hasTimeout) return 'TIMEOUT';
  if (errorType === 'DNS_FAILURE') return 'DNS_FAILURE';
  if (errorType === 'CONNECTION_RESET') return 'CONNECTION_RESET';
  if (errorType === 'NETWORK_ERROR' || logs.hasConnRefused) return 'NETWORK_ERROR';
  if (errorType === 'HTTP_5XX') return 'HTTP_5XX';
  if (Object.keys(CATEGORY_MAP).includes(errorType)) return errorType;
  return 'UNKNOWN';
}

export function analyze(rcaData) {
  const category = detectCategory(rcaData);
  const meta = CATEGORY_MAP[category] || CATEGORY_MAP.UNKNOWN;
  const service = rcaData.service || 'unknown';
  const fails = rcaData.failureReport?.consecutiveFails || 0;
  const errorMsg = rcaData.failureReport?.lastError?.message || 'No error message captured';

  return {
    incidentTitle: `${category} detected in ${service} (${fails} consecutive failures)`,
    severity: meta.severity,
    rootCause: {
      summary: `Rules engine detected a ${category} pattern. ${errorMsg}. Automated remediation was applied.`,
      confidence: meta.confidence,
      evidence: [
        `Error type: ${category}`,
        `Consecutive failures: ${fails}`,
        `Last error: ${errorMsg}`,
        ...(rcaData.logs?.summary?.errorLines?.slice(0, 3) || []),
      ],
      category,
    },
    timeline: [
      { ts: rcaData.timestamp || new Date().toISOString(), event: `${category} detected by Phoenix sidecar` },
      { ts: new Date().toISOString(), event: 'Rules-based RCA completed' },
    ],
    autoRemediationAssessment: {
      wasAppropriate: true,
      explanation: 'Automated isolation and rollback triggered by Phoenix Mesh based on health probe failure threshold.',
    },
    recommendations: [
      {
        action: meta.action,
        priority: meta.severity === 'P1' ? 'IMMEDIATE' : 'SHORT_TERM',
        rationale: `Recommended resolution for ${category} incidents.`,
      },
      {
        action: 'Enable Ollama for AI-powered RCA analysis',
        priority: 'SHORT_TERM',
        rationale: 'Ollama was unavailable — start it with `docker-compose up ollama` for richer analysis.',
      },
    ],
    alertingGaps: ['Ollama RCA engine was offline during this incident'],
    preventionSteps: [
      'Configure resource requests and limits for all pods',
      'Add liveness and readiness probes to all Deployments',
      'Enable Ollama for AI-powered root cause analysis',
    ],
  };
}
