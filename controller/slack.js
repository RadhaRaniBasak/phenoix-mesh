'use strict';

import axios from 'axios';
import pino from 'pino';

const log = pino({ 
  level: process.env.LOG_LEVEL || 'info',
  name: 'slack-notifier'
});

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

export async function postPhoenixIncident(service, rcaReport, remediationSummary) {
  if (!SLACK_WEBHOOK_URL) {
    log.info('Slack webhook not configured, skipping notification');
    return;
  }

  try {
    const severity = rcaReport.severity || 'unknown';
    const severityEmoji = {
      critical: ':fire:',
      high: ':warning:',
      medium: ':yellow_circle:',
      low: ':green_circle:',
    }[severity] || ':grey_question:';

    const payload = {
      attachments: [
        {
          color: getSeverityColor(severity),
          title: `${severityEmoji} Phoenix Mesh Incident - ${service}`,
          text: rcaReport.rootCause || 'Service failure detected',
          fields: [
            {
              title: 'Service',
              value: service,
              short: true,
            },
            {
              title: 'Severity',
              value: severity.toUpperCase(),
              short: true,
            },
            {
              title: 'Root Cause',
              value: rcaReport.rootCause || 'Analysis pending',
              short: false,
            },
            {
              title: 'Impact Analysis',
              value: rcaReport.impactAnalysis || 'Service availability affected',
              short: false,
            },
            {
              title: 'Remediation Status',
              value: remediationSummary || 'Remediation in progress',
              short: false,
            },
            {
              title: 'Recommendations',
              value: rcaReport.recommendations?.slice(0, 3).join('\n') || 'See logs for details',
              short: false,
            },
            {
              title: 'AI Model Used',
              value: rcaReport.model || 'Unknown',
              short: true,
            },
          ],
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    await axios.post(SLACK_WEBHOOK_URL, payload, { timeout: 10000 });
    log.info({ service, severity }, 'Slack notification sent');
  } catch (err) {
    log.error({ err: err.message }, 'Failed to send Slack notification');
  }
}

function getSeverityColor(severity) {
  const colors = {
    critical: '#FF0000',
    high: '#FFA500',
    medium: '#FFFF00',
    low: '#00FF00',   
  };
  return colors[severity] || '#808080';
}
