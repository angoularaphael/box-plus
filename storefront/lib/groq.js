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
  /* On BALAIE l'environnement au lieu de lister les noms un par un. La liste
     en dur s'arretait a GROQ_API_KEY_2 : la cle _3, ajoutee le 25/08 et
     vivante, n'etait jamais essayee. Chaque cle nouvelle demandait une ligne
     de code — ce qui garantit qu'un jour on en ajoute une et qu'elle dort.
     Les noms explicites restent en tete pour garder l'ordre d'essai voulu. */
  const balayees = Object.keys(process.env)
    .filter((k) => /^GROQ_API_KEY(_\w+)?$/.test(k))
    .sort()
    .map((k) => process.env[k]);
  const keys = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_FALLBACK,
    ...balayees,
    ...(process.env.GROQ_API_KEYS || '').split(','),
  ]
    .map((k) => (k || '').trim())
    .filter((k) => k.startsWith('gsk_'));
  return [...new Set(keys)];
}

function isAiEnabled() {
  if (process.env.USE_AI_REPLY === 'false') return false;
  /* Une boutique sans cle Groq mais avec Gemini n'est pas une boutique sans IA. */
  return getApiKeys().length > 0
    || poolFor('GEMINI_API_KEY', (v) => v.startsWith('AIza')).length > 0
    || poolFor('MISTRAL_API_KEY').length > 0;
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

/* ---------------------------------------------------------------------
   LES RELAIS. Le quota gratuit de Groq se compte par ORGANISATION, pas par
   cle : nos trois cles saturent donc ENSEMBLE. Le 25/08, c'est ce qui faisait
   repondre Chloe par un menu fige — le visiteur croyait parler a un bot mort.
   Groq garde la premiere main (meme voix, meme modele qu'avant) ; ces deux
   relais ne servent que la ou il n'y avait rien.
   --------------------------------------------------------------------- */

function poolFor(prefix, test) {
  return [...new Set(
    Object.keys(process.env)
      .filter((k) => k === prefix || k.startsWith(prefix + '_'))
      .sort()
      .map((k) => (process.env[k] || '').trim())
      .filter((v) => (test ? test(v) : Boolean(v)))
  )];
}

/* Gemini attend un autre format : le systeme a part, et « model » au lieu
   de « assistant ». On traduit ici pour que l'appelant n'ait rien a savoir. */
async function tryGemini(messages, maxTokens, temperature) {
  const keys = poolFor('GEMINI_API_KEY', (v) => v.startsWith('AIza'));
  if (!keys.length) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  if (!contents.length) return null;
  for (let i = 0; i < keys.length; i += 1) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys[i]}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
            contents,
            /* thinkingBudget 0 : sur 2.5, les jetons de reflexion se payaient
               sur maxOutputTokens et coupaient la reponse en plein mot. */
            generationConfig: { maxOutputTokens: maxTokens, temperature, thinkingConfig: { thinkingBudget: 0 } },
          }),
          signal: AbortSignal.timeout(45000),
        }
      );
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      const content = data?.candidates?.[0]?.content?.parts?.map((x) => x.text).join('').trim();
      if (content) return { content, keyIndex: i + 1, provider: 'gemini' };
    } catch { /* cle suivante */ }
  }
  return null;
}

async function tryMistral(messages, maxTokens, temperature) {
  const keys = poolFor('MISTRAL_API_KEY');
  if (!keys.length) return null;
  const model = process.env.MISTRAL_MODEL || 'mistral-small-latest';
  for (let i = 0; i < keys.length; i += 1) {
    try {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${keys[i]}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (content) return { content, keyIndex: i + 1, provider: 'mistral' };
    } catch { /* cle suivante */ }
  }
  return null;
}

async function chatCompletion(messages, { maxTokens = 500, temperature = 0.4 } = {}) {
  const keys = getApiKeys();
  /* Zero cle Groq n'est plus une impasse : les relais existent. Cette garde
     jetait avant de les atteindre — dans le cas meme ou ils servent le plus. */
  let lastError = keys.length ? null : new Error('GROQ_API_KEY manquant');
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
      break;   /* plus de cle Groq : on passe aux relais, on n'abandonne pas */
    }
  }

  /* Groq est a bout. Avant, on jetait ici et l'appelant servait un template
     fige — c'est ce que voyait le visiteur le 25/08. */
  const relais = (await tryGemini(messages, maxTokens, temperature))
    || (await tryMistral(messages, maxTokens, temperature));
  if (relais) return relais;

  throw new Error((lastError && lastError.message) || 'Aucun fournisseur disponible');
}

module.exports = { chatCompletion, isAiEnabled, getApiKeys, MODEL };
