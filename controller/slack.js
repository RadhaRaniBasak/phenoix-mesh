'use strict';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ status: 200 }),
    get: vi.fn(),
  },
}));

import axios from 'axios';
import { postPhoenixIncident } from '../slack.js';

const baseRCA = {
  rootCause: 'OOM Kill detected',
  severity: 'critical',
  impactAnalysis: 'Service unavailable',
  recommendations: ['Increase memory', 'Review resource limits', 'Check OOM logs'],
  model: 'ollama/mistral',
};

describe('postPhoenixIncident', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axios.post.mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it('skips notification when SLACK_WEBHOOK_URL is not set', async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    await postPhoenixIncident('my-service', baseRCA, ':white_check_mark: Auto-recovered');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('sends a Slack notification with correct payload when webhook is configured', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example.com/webhook';

    await postPhoenixIncident('my-service', baseRCA, 'Rollback successful');

    expect(axios.post).toHaveBeenCalledOnce();
    const [url, payload] = axios.post.mock.calls[0];
    expect(url).toBe('https://hooks.slack.example.com/webhook');
    expect(payload.attachments[0].title).toContain('my-service');
    expect(payload.attachments[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Severity', value: 'CRITICAL' }),
      ])
    );
  });

  it.each([
    ['critical', '#FF0000'],
    ['high', '#FFA500'],
    ['medium', '#FFFF00'],
    ['low', '#00FF00'],
    ['unknown', '#808080'],
  ])('sends correct color for severity %s', async (severity, expectedColor) => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example.com/webhook';

    await postPhoenixIncident('svc', { ...baseRCA, severity }, 'status');

    const payload = axios.post.mock.calls[0][1];
    expect(payload.attachments[0].color).toBe(expectedColor);
  });

  it('uses correct emoji for each severity level', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example.com/webhook';
    const emojiMap = {
      critical: ':fire:',
      high: ':warning:',
      medium: ':yellow_circle:',
      low: ':green_circle:',
    };

    for (const [severity, emoji] of Object.entries(emojiMap)) {
      vi.clearAllMocks();
      axios.post.mockResolvedValue({ status: 200 });
      await postPhoenixIncident('svc', { ...baseRCA, severity }, 'status');
      const payload = axios.post.mock.calls[0][1];
      expect(payload.attachments[0].title).toContain(emoji);
    }
  });

  it('handles Slack API errors gracefully without throwing', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example.com/webhook';
    axios.post.mockRejectedValueOnce(new Error('Slack API error'));

    await expect(
      postPhoenixIncident('svc', baseRCA, 'status')
    ).resolves.toBeUndefined();
  });

  it('includes only the first 3 recommendations', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.example.com/webhook';

    const manyRecsRCA = { ...baseRCA, recommendations: ['r1', 'r2', 'r3', 'r4', 'r5'] };
    await postPhoenixIncident('svc', manyRecsRCA, 'status');

    const payload = axios.post.mock.calls[0][1];
    const recsField = payload.attachments[0].fields.find(f => f.title === 'Recommendations');
    expect(recsField.value).not.toContain('r4');
    expect(recsField.value).not.toContain('r5');
  });
});
