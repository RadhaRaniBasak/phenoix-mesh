'use strict';

import pino from 'pino';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'rules-rca'
});

const ERROR_PATTERNS = {
  'CRASH': {
    causes: [
      'Out of Memory (OOM Kill)',
      'Segmentation fault or unhandled exception',
      'Process termination signal',
      'Resource exhaustion'
    ],
    recommendations: [
      'Increase memory requests/limits in deployment',
      'Check application error logs for stack traces',
      'Review recent code deployments',
      'Verify dependency compatibility',
      'Implement memory profiling'
    ],
    preventionStrategies: [
      'Set appropriate resource requests and limits',
      'Implement graceful shutdown handlers',
      'Add health check probes',
      'Monitor memory trends'
    ],
    impactAnalysis: 'Complete service unavailability - traffic cannot reach service',
    severityBase: 'critical',
  },

  'TIMEOUT': {
    causes: [
      'High response latency from service',
      'Network connectivity degradation',
      'Resource starvation (CPU/Memory)',
      'External service slowdown',
      'DNS resolution delays'
    ],
    recommendations: [
      'Increase probe timeout threshold',
      'Check service latency metrics',
      'Scale replicas to reduce load',
      'Optimize database queries',
      'Review network policies',
      'Check DNS configuration'
    ],
    preventionStrategies: [
      'Implement caching layer',
      'Optimize code performance',
      'Set resource quotas',
      'Load testing before production'
    ],
    impactAnalysis: 'Intermittent service availability - slow responses cause probe failures',
    severityBase: 'high',
  },

  'HTTP_5XX': {
    causes: [
      'Application server error',
      'Database connection failure',
      'Missing or incompatible dependency',
      'Invalid configuration',
      'Unhandled runtime exception'
    ],
    recommendations: [
      'Check application logs for error stack traces',
      'Verify database connectivity and credentials',
      'Validate all environment variables',
      'Review recent code changes',
      'Check dependency versions',
      'Verify external service connectivity'
    ],
    preventionStrategies: [
      'Improve error handling in code',
      'Add integration tests',
      'Implement circuit breakers',
      'Set up log aggregation',
      'Add request validation'
    ],
    impactAnalysis: 'Service returning errors - likely recoverable with proper remediation',
    severityBase: 'high',
  },

  'HTTP_4XX': {
    causes: [
      'Invalid request format',
      'Authentication/authorization failure',
      'Missing required fields',
      'API contract violation',
      'Client-side misconfiguration'
    ],
    recommendations: [
      'Review health check endpoint implementation',
      'Verify health check request format',
      'Check authentication credentials',
      'Validate request headers',
      'Review API documentation'
    ],
    preventionStrategies: [
      'Add request validation',
      'Implement proper error responses',
      'Document API contracts',
      'Add client-side error handling'
    ],
    impactAnalysis: 'Service is operational but health check format may be incorrect',
    severityBase: 'medium',
  },

  'RATE_LIMITED': {
    causes: [
      'Traffic spike exceeding rate limits',
      'Possible DDoS attack',
      'Insufficient horizontal scaling',
      'Resource exhaustion',
      'Dependency rate limiting'
    ],
    recommendations: [
      'Scale service replicas horizontally',
      'Implement rate limiting and backoff strategies',
      'Add caching to reduce requests',
      'Check traffic patterns for anomalies',
      'Verify auto-scaling policies',
      'Monitor for DDoS attacks'
    ],
    preventionStrategies: [
      'Implement circuit breakers',
      'Set up load balancing',
      'Configure auto-scaling thresholds',
      'Implement request queuing',
      'Add DDoS protection'
    ],
    impactAnalysis: 'Service is operational but rejecting excess requests',
    severityBase: 'medium',
  },

  'DNS_FAILURE': {
    causes: [
      'DNS misconfiguration',
      'Network isolation or connectivity issues',
      'DNS server unavailability',
      'Service not registered in DNS/service discovery',
      'Incorrect service name in configuration'
    ],
    recommendations: [
      'Verify service DNS name is correct',
      'Check network connectivity to DNS servers',
      'Verify Kubernetes service exists: kubectl get svc',
      'Check service discovery configuration',
      'Validate network policies allow DNS traffic'
    ],
    preventionStrategies: [
      'Implement DNS health checks',
      'Set up service mesh for better discovery',
      'Add network policies that allow DNS',
      'Use local DNS caching',
      'Document service naming conventions'
    ],
    impactAnalysis: 'Service cannot be reached - network-level failure',
    severityBase: 'critical',
  },

  'CONNECTION_RESET': {
    causes: [
      'Service forcefully closing connections',
      'Network intermediate dropping connections',
      'Resource exhaustion on service',
      'Firewall or security policy blocking',
      'Service crash mid-request'
    ],
    recommendations: [
      'Check service logs for crash indicators',
      'Verify network policies and firewall rules',
      'Monitor service resource utilization',
      'Check connection pool settings',
      'Review recent network changes'
    ],
    preventionStrategies: [
      'Implement connection pooling and keep-alive',
      'Add connection retry logic',
      'Monitor connection metrics',
      'Graceful connection shutdown'
    ],
    impactAnalysis: 'Service is terminating connections abruptly',
    severityBase: 'high',
  },

  'NETWORK_ERROR': {
    causes: [
      'General network connectivity issue',
      'Network interface failure',
      'Routing misconfiguration',
      'Intermediate network device failure',
      'Packet loss'
    ],
    recommendations: [
      'Check network connectivity: ping service',
      'Verify network policies',
      'Check firewall rules',
      'Monitor network metrics (packet loss, latency)',
      'Review cluster networking configuration'
    ],
    preventionStrategies: [
      'Implement network redundancy',
      'Add network monitoring',
      'Use service mesh for network resilience',
      'Implement retry logic with exponential backoff'
    ],
    impactAnalysis: 'Temporary or persistent network connectivity issues',
    severityBase: 'high',
  },
};

export async function generateRCAViaRules(phoenixContext) {
  const { service, failureReport, metrics, remediationTaken } = phoenixContext;
  const errorType = failureReport.errorType || 'NETWORK_ERROR';
  
  const pattern = ERROR_PATTERNS[errorType] || ERROR_PATTERNS['NETWORK_ERROR'];
  
  const rootCause = selectMostLikelyCause(errorType, failureReport, metrics);
  
  const severity = calculateSeverity(
    pattern.severityBase,
    failureReport.consecutiveFails,
    remediationTaken
  );

  log.info({ 
    service, 
    errorType, 
    severity,
    failureCount: failureReport.consecutiveFails 
  }, 'RCA generated via rules engine');

  return {
    rootCause,
    severity,
    impactAnalysis: pattern.impactAnalysis,
    recommendations: pattern.recommendations,
    preventionStrategies: pattern.preventionStrategies,
    possibleCauses: pattern.causes,
    timeline: buildTimeline(failureReport, remediationTaken),
    timestamp: new Date().toISOString(),
  };
}

function selectMostLikelyCause(errorType, failureReport, metrics) {
  const pattern = ERROR_PATTERNS[errorType];
  if (!pattern) return 'Service health degradation detected';

  if (errorType === 'CRASH') {
    if (metrics?.memory > 90) return 'Out of Memory (OOM Kill)';
    if (metrics?.cpu > 95) return 'CPU exhaustion causing crash';
    return pattern.causes[0];
  }

  if (errorType === 'TIMEOUT') {
    if (metrics?.latency > 10000) return 'Severe latency spike';
    if (metrics?.cpu > 80) return 'Resource starvation - high CPU';
    if (metrics?.memory > 80) return 'Resource starvation - high memory';
    return pattern.causes[0];
  }

  if (errorType === 'RATE_LIMITED') {
    if (metrics?.requestRate > 10000) return 'Traffic spike exceeding capacity';
    return 'Rate limit threshold exceeded';
  }

  return pattern.causes[0];
}

function calculateSeverity(base, failureCount, remediationTaken) {
  let severity = base;

  if (failureCount >= 10) {
    severity = 'critical';
  } else if (failureCount >= 5 && (severity === 'high' || severity === 'medium')) {
    severity = 'high';
  }

  if (remediationTaken?.some(s => s.step === 'recovery' && s.recovered)) {
    const severities = ['critical', 'high', 'medium', 'low'];
    const index = severities.indexOf(severity);
    if (index > 0) {
      severity = severities[index - 1];
    }
  }

  return severity;
}

function buildTimeline(failureReport, remediationTaken) {
  const events = [
    `Failure detected at ${new Date(failureReport.reportedAt).toISOString()}`,
    `Error Type: ${failureReport.errorType}`,
    `Consecutive Failures: ${failureReport.consecutiveFails}`,
  ];

  if (remediationTaken?.length > 0) {
    events.push('', 'Remediation Actions Taken:');
    remediationTaken.forEach(step => {
      const status = step.error ? `FAILED (${step.error})` : 'SUCCESS';
      events.push(`- ${step.step}: ${status}`);
    });
  }

  return events.join('\n');
}
