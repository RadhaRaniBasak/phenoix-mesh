'use strict';

import pino from 'pino';
import { collectServiceMetrics } from './prometheus.js';
import { fetchIncidentLogs } from './logs.js';
import { 
  rerouteTraffic, 
  restoreTrafficRouting, 
  rollbackDeployment, 
  watchRolloutStatus, 
  getDeploymentInfo 
} from './rollback.js';
import { generatePhoenixRCA } from './rcaEngine.js';
import { postPhoenixIncident } from './slack.js';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'phoenix-mesh-engine'
});

const RECOVERY_WINDOW_MS  = parseInt(process.env.RECOVERY_WINDOW_MS  || '60000'); 
const ERROR_RATE_THRESHOLD = parseFloat(process.env.ERROR_RATE_THRESHOLD || '0.01'); 

const activeIncidents = new Map();

export async function handleFailure(report) {
  const { service, namespace, podName } = report;
  const incidentKey = `${namespace}/${service}`;

  if (activeIncidents.has(incidentKey)) {
    log.info({ incidentKey }, 'Phoenix Mesh: Incident already being handled — skipping duplicate');
    return { status: 'duplicate', incidentKey };
  }

  const incident = {
    startedAt: Date.now(),
    report,
    remediationSteps: [],
  };
  
  activeIncidents.set(incidentKey, incident);

  log.info(
    { incidentKey, errorType: report.errorType, fails: report.consecutiveFails }, 
    'Phoenix Mesh: Initiating incident remediation'
  );

  let remediationSummary = '';

  try {
    let deploymentInfo = null;
    try {
      deploymentInfo = await getDeploymentInfo(service, namespace);
    } catch (err) {
      log.warn({ err: err.message }, 'Phoenix Mesh: Deployment info fetch failed (Mock Mode?)');
    }

    let rerouteResult = { rerouted: false, healthyPods: 0 };
    try {
      rerouteResult = await rerouteTraffic(service, namespace, podName);
      incident.remediationSteps.push({ step: 'isolation', result: rerouteResult, ts: Date.now() });
    } catch (err) {
      log.warn({ err: err.message }, 'Phoenix Mesh: Isolation failed — proceeding to emergency rollback');
      incident.remediationSteps.push({ step: 'isolation', error: err.message, ts: Date.now() });
    }

    let autoRecovered = false;
    if (rerouteResult.rerouted) {
      log.info({ service }, `Phoenix Mesh: Monitoring for auto-recovery (${RECOVERY_WINDOW_MS / 1000}s window)`);
      autoRecovered = await monitorRecovery(service);
      incident.remediationSteps.push({ step: 'monitor', recovered: autoRecovered, ts: Date.now() });
    }
    let rollbackResult = null;
    if (!autoRecovered) {
      log.warn({ service }, 'Phoenix Mesh: Service failed to auto-recover — triggering rollback');
      try {
        rollbackResult = await rollbackDeployment(service, namespace);
        incident.remediationSteps.push({ step: 'rollback', result: rollbackResult, ts: Date.now() });

        // Await verification of the new rollout
        const rolloutStatus = await watchRolloutStatus(service, namespace);
        incident.remediationSteps.push({ step: 'verification', result: rolloutStatus, ts: Date.now() });

        if (rolloutStatus.success) {
          await restoreTrafficRouting(service, namespace);
          incident.remediationSteps.push({ step: 'restore_routing', ts: Date.now() });
        }
      } catch (err) {
        log.error({ err: err.message }, 'Phoenix Mesh: Rollback execution failed');
        incident.remediationSteps.push({ step: 'rollback', error: err.message, ts: Date.now() });
      }
    } else {
      try {
        await restoreTrafficRouting(service, namespace);
        incident.remediationSteps.push({ step: 'restore_routing', ts: Date.now() });
      } catch (err) {
        log.warn({ err: err.message }, 'Phoenix Mesh: Routing restoration failed after recovery');
      }
    }

    if (autoRecovered) {
      remediationSummary = `:white_check_mark: Service auto-recovered. Traffic was isolated to ${rerouteResult.healthyPods} pods.`;
    } else if (rollbackResult) {
      remediationSummary = `:rewind: Rollback successful. Reverted to: \`${rollbackResult.image}\`.`;
    } else {
      remediationSummary = ':fire: Automated remediation incomplete. Manual intervention required.';
    }

    const [metrics, logs] = await Promise.all([
      collectServiceMetrics(service).catch(() => null),
      fetchIncidentLogs(podName, namespace, service).catch(() => null),
    ]);

    const phoenixContext = {
      service,
      namespace,
      failureReport: report,
      metrics,
      logs,
      deploymentInfo,
      remediationTaken: incident.remediationSteps,
      timestamp: new Date().toISOString(),
    };

    const rcaReport = await generatePhoenixRCA(phoenixContext);
    incident.rca = rcaReport;

    await postPhoenixIncident(service, rcaReport, remediationSummary);

    const durationMs = Date.now() - incident.startedAt;
    log.info({ incidentKey, durationMs }, 'Phoenix Mesh: Incident remediation complete');

    return {
      status: 'resolved',
      incidentKey,
      autoRecovered,
      rollbackPerformed: !!rollbackResult,
      severity: rcaReport.severity,
    };

  } catch (err) {
    log.error({ err: err.message, incidentKey }, 'Phoenix Mesh: Critical unhandled error in controller');
    throw err;
  } finally {
    activeIncidents.delete(incidentKey);
  }
}

export function handleRecovery(report) {
  const { service, namespace } = report;
  const incidentKey = `${namespace}/${service}`;
  log.info({ incidentKey }, 'Phoenix Mesh: Service recovery signal acknowledged');
}

async function monitorRecovery(service) {
  const deadline = Date.now() + RECOVERY_WINDOW_MS;

  while (Date.now() < deadline) {
    await sleep(10000); // 10s check interval
    try {
      const metrics = await collectServiceMetrics(service).catch(() => null);
      const errorRate = metrics?.errorRate ?? null;

      if (errorRate !== null && errorRate < ERROR_RATE_THRESHOLD) {
        log.info({ service, errorRate }, 'Phoenix Mesh: Health threshold met — service recovered');
        return true;
      }
    } catch (err) {
      log.warn({ err: err.message }, 'Phoenix Mesh: Recovery monitoring error');
    }
  }
  return false;
}

export function getActiveIncidents() {
  return Array.from(activeIncidents, ([key, value]) => ({
    key,
    service: value.report.service,
    startedAt: value.startedAt,
    steps: value.remediationSteps
  }));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
