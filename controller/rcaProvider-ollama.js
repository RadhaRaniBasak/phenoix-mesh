'use strict';

import axios from 'axios';
import pino from 'pino';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'ollama-rca'
});

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT_MS || '60000'); // 60s

let ollamaReady = false;
verifyOllamaConnection().catch(err => 
  log.warn({ err: err.message }, 'Ollama not available on startup - will retry on demand')
);

async function verifyOllamaConnection() {
  try {
    const response = await axios.get(`${OLLAMA_HOST}/api/tags`, { timeout: 5000 });
    const models = response.data.models || [];
    
    if (models.length === 0) {
      log.warn('No models found in Ollama. Run: ollama pull mistral');
      return false;
    }
    
    const hasModel = models.some(m => m.name.includes(OLLAMA_MODEL));
    if (!hasModel) {
      log.warn({ model: OLLAMA_MODEL, available: models.map(m => m.name) }, 
        `Model ${OLLAMA_MODEL} not found. Install with: ollama pull ${OLLAMA_MODEL}`);
      return false;
    }
    
    ollamaReady = true;
    log.info({ model: OLLAMA_MODEL, host: OLLAMA_HOST }, 'Ollama connection verified');
    return true;
  } catch (err) {
    log.error({ err: err.message, host: OLLAMA_HOST }, 'Cannot connect to Ollama');
    return false;
  }
}

export async function generateRCAViaOllama(phoenixContext) {
  const { service, failureReport, metrics, logs, remediationTaken, deploymentInfo } = phoenixContext;

  if (!ollamaReady) {
    const ready = await verifyOllamaConnection();
    if (!ready) {
      throw new Error('Ollama service not available');
    }
  }

  const systemPrompt = `You are an expert Kubernetes SRE and DevOps engineer. Analyze the provided service failure context and provide a Root Cause Analysis (RCA) in JSON format.

Requirements:
1. Identify the most likely root cause
2. Assess severity (critical, high, medium, low)
3. Provide 3-5 actionable recommendations
4. Keep analysis concise but informative
5. Always respond with valid JSON`;

  const userPrompt = buildPrompt(service, failureReport, metrics, logs, remediationTaken, deploymentInfo);

  log.info({ service, model: OLLAMA_MODEL }, 'Sending request to Ollama...');

  try {
    const response = await axios.post(
      `${OLLAMA_HOST}/api/generate`,
      {
        model: OLLAMA_MODEL,
        prompt: userPrompt,
        system: systemPrompt,
        stream: false,
        temperature: 0.6,
        top_p: 0.8,
        top_k: 40,
      },
      { timeout: OLLAMA_TIMEOUT }
    );

    const responseText = response.data.response;
    log.debug({ service }, `Ollama response length: ${responseText.length}`);

    //Parse JSON 
    const rca = parseRCAResponse(responseText);

    return {
      ...rca,
      model: `ollama/${OLLAMA_MODEL}`,
      timestamp: new Date().toISOString(),
      context: {
        service,
        errorType: failureReport.errorType,
        consecutiveFails: failureReport.consecutiveFails,
      },
    };
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error(`Cannot connect to Ollama at ${OLLAMA_HOST}. Ensure Ollama is running: docker-compose up ollama`);
    }
    
    if (err.response?.status === 404) {
      throw new Error(`Ollama model '${OLLAMA_MODEL}' not found. Run: ollama pull ${OLLAMA_MODEL}`);
    }
    
    if (err.code === 'ECONNABORTED') {
      throw new Error(`Ollama request timed out after ${OLLAMA_TIMEOUT}ms. Model may be slow or overloaded.`);
    }
    
    throw new Error(`Ollama RCA generation failed: ${err.message}`);
  }
}

function buildPrompt(service, failureReport, metrics, logs, remediationTaken, deploymentInfo) {
  const metricsStr = metrics 
    ? `Metrics: Error Rate=${metrics.errorRate?.toFixed(2)}%, Latency=${metrics.latency}ms, CPU=${metrics.cpu}%, Memory=${metrics.memory}%`
    : 'Metrics: Not available';

  const logsStr = logs 
    ? `Recent Logs:\n${logs.split('\n').slice(-5).join('\n')}`
    : 'Logs: Not available';

  const remediationStr = remediationTaken?.length > 0
    ? `Remediation Steps Taken:\n${remediationTaken.map(s => `- ${s.step}: ${s.result?.status || s.error || 'executed'}`).join('\n')}`
    : 'No remediation steps yet';

  const deploymentStr = deploymentInfo
    ? `Current Deployment: ${deploymentInfo.currentImage} (Revision ${deploymentInfo.currentRevision}), Replicas: ${deploymentInfo.readyReplicas}/${deploymentInfo.replicas}`
    : 'Deployment info: Not available';

  return `
SERVICE FAILURE ANALYSIS REQUEST
===================================

Service: ${service}
Error Type: ${failureReport.errorType}
Consecutive Failures: ${failureReport.consecutiveFails}
First Failure: ${new Date(failureReport.reportedAt).toISOString()}
Last Error: ${failureReport.lastError?.message || 'N/A'}

${metricsStr}

${logsStr}

${remediationStr}

${deploymentStr}

ANALYSIS REQUIRED
=================
Provide JSON response with this exact structure (no markdown, pure JSON):
{
  "rootCause": "Brief, specific explanation of what caused this failure",
  "severity": "critical|high|medium|low",
  "impactAnalysis": "How this affects the system",
  "recommendations": [
    "First action to take",
    "Second action to take",
    "Third action to take"
  ],
  "preventionStrategies": [
    "Long-term fix 1",
    "Long-term fix 2"
  ]
}

CRITICAL: Return ONLY valid JSON, no explanations or markdown.
`;
}

function parseRCAResponse(responseText) {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  
  if (!jsonMatch) {
    log.warn('No JSON found in Ollama response, attempting to parse as text');
    return parseTextResponse(responseText);
  }

  try {
    const rca = JSON.parse(jsonMatch[0]);
    
    if (!rca.rootCause || !rca.severity || !rca.recommendations) {
      throw new Error('Missing required RCA fields');
    }

    rca.severity = normalizeSeverity(rca.severity);
    
    if (!Array.isArray(rca.recommendations)) {
      rca.recommendations = [rca.recommendations];
    }

    return rca;
  } catch (err) {
    log.error({ err: err.message }, 'Failed to parse RCA JSON');
    return parseTextResponse(responseText);
  }
}

function parseTextResponse(text) {
  const rootCauseMatch = text.match(/root cause[:\s]*([^\n.]+)/i);
  const severityMatch = text.match(/severity[:\s]*(critical|high|medium|low)/i);
  
  return {
    rootCause: rootCauseMatch ? rootCauseMatch[1].trim() : 'Service failure detected',
    severity: severityMatch ? severityMatch[1].toLowerCase() : 'high',
    recommendations: [
      'Check service logs',
      'Verify resource availability',
      'Monitor for recovery',
      'Escalate if issue persists'
    ],
    impactAnalysis: 'Service degradation affecting availability',
    preventionStrategies: [
      'Implement resource limits',
      'Add circuit breakers',
      'Improve monitoring'
    ],
  };
}

function normalizeSeverity(severity) {
  const normalized = severity?.toLowerCase?.() || 'medium';
  const valid = ['critical', 'high', 'medium', 'low'];
  return valid.includes(normalized) ? normalized : 'medium';
}
