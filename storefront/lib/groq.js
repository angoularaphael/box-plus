#!/usr/bin/env node
'use strict';

/**
 * Groq API — même pattern que mail-bot (failover multi-clés).
 */

const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function isReasoningModel(model = MODEL) {
  return /gpt-oss|qwen\/qwen3/i.test(model);
}

function getApiKeys() {
  const keys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_FALLBACK,
    process.env.GROQ_API_KEY_2,
    ...(process.env.GROQ_API_KEYS || '').split(','),
  ]
    .map((k) => (k || '').trim())
    .filter((k) => k.startsWith('gsk_'));
  return [...new Set(keys)];
}

function isAiEnabled() {
  if (process.env.USE_AI_REPLY === 'false') return false;
  return getApiKeys().length > 0;
}

function shouldRetry(status) {
  return status === 429 || status === 401 || status === 403 || status === 503 || (status >= 500 && status < 600);
}

function buildRequestBody({ messages, maxTokens, temperature }) {
  const body = {
    model: MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (isReasoningModel()) {
    body.reasoning_effort = process.env.GROQ_REASONING_EFFORT || 'low';
  }
  return body;
}

async function chatCompletion(messages, { maxTokens = 500, temperature = 0.4 } = {}) {
  const keys = getApiKeys();
  if (!keys.length) throw new Error('GROQ_API_KEY manquant');

  let lastError = null;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildRequestBody({ messages, maxTokens, temperature })),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error?.message || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('Réponse Groq vide');
      return { content, keyIndex: i + 1 };
    } catch (err) {
      lastError = err;
      if (i < keys.length - 1 && (shouldRetry(err.status) || !err.status)) continue;
      throw new Error(err.message || 'Groq indisponible');
    }
  }
  throw lastError || new Error('Groq indisponible');
}

module.exports = { chatCompletion, isAiEnabled, getApiKeys, MODEL };
