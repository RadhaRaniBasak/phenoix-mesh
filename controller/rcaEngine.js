'use strict';

import pino from 'pino';
import { generateRCA as factoryGenerateRCA } from './rcaFactory.js';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'phoenix-rca-engine' 
});

const SYSTEM_PROMPT = `You are the Phoenix Mesh Diagnostic Engine, an autonomous SRE incident analyst embedded inside a self-healing Kubernetes microservice mesh.

You receive structured telemetry dumps — failure classification, Prometheus metrics, pod logs, deployment history — from services that have just failed and been automatically remediated by the Phoenix Controller.

Your job:
1. Determine the most likely root cause based on the evidence provided.
2. Assign a confidence level (HIGH / MEDIUM / LOW).
3. Reconstruct the incident timeline from log timestamps.
4. Evaluate whether the Phoenix auto-remediation (Isolation/Rollback) was appropriate.
5. Produce actionable recommendations ranked by urgency.
6. Suggest monitoring/alerting improvements to catch this earlier.

Rules:
- Never speculate beyond what the data supports.
- If logs are missing or ambiguous, say so explicitly in the rootCause summary.
- Respond ONLY with valid JSON — no prose, no markdown fences, no commentary outside the JSON.

Output schema (strict):
{
  "incidentTitle": "string (one line, <80 chars)",
  "severity": "P1" | "P2" | "P3",
  "rootCause": {
    "summary": "string (2-4 sentences)",
    "confidence": "HIGH" | "MEDIUM" | "LOW",
    "evidence": ["string", ...],
    "category": "CRASH" | "MEMORY_LEAK" | "DEPENDENCY_FAILURE" | "CONFIGURATION_ERROR" | "DEPLOYMENT_BUG" | "RESOURCE_EXHAUSTION" | "NETWORK_ISSUE" | "UNKNOWN"
  },
  "timeline": [
    { "ts": "ISO-8601 or HH:MM:SS", "event": "string" }
  ],
  "autoRemediationAssessment": {
    "wasAppropriate": true | false,
    "explanation": "string"
  },
  "recommendations": [
    {
      "action": "string",
      "priority": "IMMEDIATE" | "SHORT_TERM" | "LONG_TERM",
      "rationale": "string"
    }
  ],
  "alertingGaps": ["string"],
  "preventionSteps": ["string"]
}`;

//diagnostic prompts 
function buildPhoenixPrompt(data) {
  const { service, failureReport, metrics, logs, deploymentInfo, remediationTaken, timestamp } = data;

  const logBlock = (lines, label) => lines?.length
    ? `### ${label}\n\`\`\`\n${lines.slice(-40).join('\n')}\n\`\`\``
    : `### ${label}\n(Logs not available or captured)`;

  return `## Phoenix Mesh Incident Report — ${service}

**System Timestamp:** ${timestamp}
**Namespace:** ${failureReport.namespace}
**Target Pod:** ${failureReport.podName}

---

## Failure Classification (Phoenix Sidecar Data)
- Error type: ${failureReport.errorType}
- Consecutive health probe failures: ${failureReport.consecutiveFails}
- Last error message: ${failureReport.lastError?.message || 'N/A'}

---

## Phoenix Metrics Snapshot (Last 5m)
- Error rate: ${metrics?.errorRate ?? 'N/A'} errors/sec
- P99 latency: ${metrics?.p99LatencyMs ?? 'N/A'} ms
- Probe success rate: ${metrics?.probeSuccessRate ?? 'N/A'}%
- Errors by type: ${JSON.stringify(metrics?.errorsByType || [], null, 2)}

---

## Kubernetes Deployment State
- Current image: ${deploymentInfo?.currentImage || 'N/A'}
- Current revision: ${deploymentInfo?.currentRevision || 'N/A'}
- Ready/Desired Replicas: ${deploymentInfo?.readyReplicas || 0}/${deploymentInfo?.desiredReplicas || 0}

---

## Collected Logs
${logBlock(logs?.current, 'App Container Logs')}
${logBlock(logs?.previous, 'Previous Instance Logs (Post-Crash)')}
${logBlock(logs?.sidecar, 'Phoenix Sidecar Agent Logs')}

### Log Intelligence Summary
${JSON.stringify(logs?.summary || {}, null, 2)}

---

## Remediation Actions Taken by Phoenix Controller
${JSON.stringify(remediationTaken || {}, null, 2)}

---

Produce the Phoenix RCA JSON object now.`;
}

//generate RCA using Ollama (with rules-based fallback)
export async function generatePhoenixRCA(rcaData) {
  log.info({ service: rcaData.service }, 'Phoenix Mesh: Initiating Ollama RCA generation');

  const prompt = buildPhoenixPrompt(rcaData);

  try {
    const result = await factoryGenerateRCA(SYSTEM_PROMPT, prompt, rcaData);
    log.info({ service: rcaData.service, severity: result.severity }, 'Phoenix Mesh: RCA successfully generated');
    return result;
  } catch (err) {
    log.error({ err: err.message, service: rcaData.service }, 'Phoenix Mesh: RCA engine failure — using emergency fallback');
    return generateFallbackRCA(rcaData, err.message);
  }
}

function generateFallbackRCA(rcaData, errorReason) {
  return {
    incidentTitle: `Emergency Report: ${rcaData.service} Failure`,
    severity: 'P1',
    rootCause: {
      summary: `Automated analysis failed due to: ${errorReason}. Manual log review is required.`,
      confidence: 'LOW',
      evidence: [`ErrorType: ${rcaData.failureReport?.errorType}`],
      category: 'UNKNOWN'
    },
    timeline: [{ ts: new Date().toISOString(), event: 'Failure detected by Phoenix Sidecar' }],
    autoRemediationAssessment: { wasAppropriate: true, explanation: 'Remediation triggered based on health probe failure.' },
    recommendations: [{ action: 'Perform manual kubectl log analysis', priority: 'IMMEDIATE', rationale: 'RCA Engine Offline' }],
    alertingGaps: ['RCA Engine Connectivity'],
    preventionSteps: []
  };
}
