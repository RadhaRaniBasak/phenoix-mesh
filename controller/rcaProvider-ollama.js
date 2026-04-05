'use strict';

import axios from 'axios';
import pino from 'pino';

const log = pino({
  level: process.env.LOG_LEVEL || 'info',
  name: 'phoenix-rca-ollama',
});

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'mistral';
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || '60000', 10) || 60000;

export async function isAvailable() {
  try {
    await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function analyze(systemPrompt, userPrompt) {
  log.info({ model: OLLAMA_MODEL }, 'Phoenix RCA: Sending request to Ollama');

  const response = await axios.post(
    `${OLLAMA_URL}/api/chat`,
    {
      model: OLLAMA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 2048,
      },
    },
    { timeout: OLLAMA_TIMEOUT_MS }
  );

  const content = response.data?.message?.content || '';
  log.info({ model: OLLAMA_MODEL }, 'Phoenix RCA: Ollama response received');
  return content;
}
