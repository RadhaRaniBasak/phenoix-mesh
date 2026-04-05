'use strict';

import k8s from '@kubernetes/client-node';
import pino from 'pino';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'log-collector'
});

let coreV1;

export function initK8sClient(kubeConfig) {
  coreV1 = kubeConfig.makeApiClient(k8s.CoreV1Api);
}

export async function fetchIncidentLogs(podName, namespace, service, tailLines = 100) {
  if (!coreV1) {
    log.warn('K8s client not initialized, returning mock logs');
    return generateMockLogs(service);
  }

  try {
    const logsResponse = await coreV1.readNamespacedPodLog(
      podName,
      namespace,
      undefined,
      undefined,
      true, 
      undefined,
      tailLines, 
      undefined,
      undefined,
      5000 
    );

    const logs = logsResponse.split('\n').filter(line => line.trim());
    log.info({ podName, namespace, lineCount: logs.length }, 'Logs fetched successfully');
    
    return logs.slice(-20).join('\n'); // Return last 20 lines
  } catch (err) {
    if (err.response?.statusCode === 404) {
      log.warn({ podName, namespace }, 'Pod or logs not found');
    } else {
      log.warn({ err: err.message, podName }, 'Failed to fetch pod logs');
    }
    return generateMockLogs(service);
  }
}

function generateMockLogs(service) {
  const now = new Date();
  return `
[${now.toISOString()}] Service: ${service}
[${now.toISOString()}] INFO: Starting health check
[${now.toISOString()}] WARN: Health check timeout after 2000ms
[${now.toISOString()}] ERROR: Failed to connect to upstream service
[${now.toISOString()}] ERROR: Connection refused - service unavailable
  `;
}
