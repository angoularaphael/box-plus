'use strict';

/**
 * Rate-limit résiliation / changement d’abo — par identité membre.
 * 5 tentatives, puis blocage 10 min, puis 20 min (progressif).
 */
const crypto = require('crypto');
const { logInfo } = require('../../lib/logger');

const MAX_ATTEMPTS = 5;
const LOCK_MS = [10 * 60 * 1000, 20 * 60 * 1000]; // 10 min puis 20 min

function normalizePart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.+]/g, '')
    .trim();
}

function normalizeBirthdate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // YYYY-MM-DD or DD/MM/YYYY
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
  const fr = raw.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})/);
  if (fr) return `${fr[3]}${fr[2]}${fr[1]}`;
  return normalizePart(raw);
}

function identityKey(body = {}, scope = 'change') {
  const first = normalizePart(body.first_name);
  const last = normalizePart(body.last_name);
  const birth = normalizeBirthdate(body.birthdate);
  const email = normalizePart(body.email);
  const phone = String(body.phone || '').replace(/\D/g, '').slice(-9);
  const contact = email || phone || 'nocontact';
  const basis = `${scope}|${last}|${first}|${birth}|${contact}`;
  const hash = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 24);
  return `rl-${scope}-${hash}`;
}

function lockDurationMs(lockCount) {
  if (lockCount <= 1) return LOCK_MS[0];
  return LOCK_MS[1];
}

function formatRetryMessage(retryAfterSec) {
  const mins = Math.max(1, Math.ceil(Number(retryAfterSec || 0) / 60));
  return `Trop de tentatives pour ces informations. Réessayez dans ${mins} minute${mins > 1 ? 's' : ''}.`;
}

function formatRemainingMessage(remaining, maxAttempts = MAX_ATTEMPTS) {
  const left = Math.max(0, Number(remaining) || 0);
  if (left <= 0) {
    return `Plus aucune tentative disponible pour le moment (${maxAttempts}/${maxAttempts} utilisées).`;
  }
  return `Tentatives restantes : ${left} sur ${maxAttempts}.`;
}

async function loadBucket(orderId) {
  const { loadOrder } = require('./order-persistence');
  return loadOrder(orderId);
}

async function saveBucket(record) {
  const { saveOrderAsync } = require('./order-persistence');
  if (!record.access_token) record.access_token = `rl-${record.order_id}`;
  record.updated_at = new Date().toISOString();
  await saveOrderAsync(record);
}

function statusFromRecord(record, scope, now = Date.now()) {
  const maxAttempts = MAX_ATTEMPTS;
  if (!record) {
    return {
      ok: true,
      scope,
      remaining: maxAttempts,
      attempts: 0,
      max_attempts: maxAttempts,
      locked: false,
      retry_after_sec: 0,
      locked_until: null,
      message: formatRemainingMessage(maxAttempts, maxAttempts),
    };
  }

  const lockUntilMs = record.lock_until ? new Date(record.lock_until).getTime() : 0;
  if (lockUntilMs && lockUntilMs > now) {
    const retryAfterSec = Math.ceil((lockUntilMs - now) / 1000);
    return {
      ok: false,
      scope,
      remaining: 0,
      attempts: Array.isArray(record.attempts) ? record.attempts.length : maxAttempts,
      max_attempts: maxAttempts,
      locked: true,
      code: 'rate_limited',
      retry_after_sec: retryAfterSec,
      locked_until: record.lock_until,
      error: formatRetryMessage(retryAfterSec),
      message: formatRetryMessage(retryAfterSec),
    };
  }

  const attempts =
    lockUntilMs && lockUntilMs <= now
      ? []
      : Array.isArray(record.attempts)
        ? record.attempts.filter(Boolean)
        : [];
  const remaining = Math.max(0, maxAttempts - attempts.length);
  return {
    ok: remaining > 0,
    scope,
    remaining,
    attempts: attempts.length,
    max_attempts: maxAttempts,
    locked: false,
    retry_after_sec: 0,
    locked_until: null,
    code: remaining > 0 ? undefined : 'rate_limited',
    error: remaining > 0 ? undefined : formatRetryMessage(lockDurationMs(Number(record.lock_count || 0) + 1) / 1000),
    message:
      remaining > 0
        ? formatRemainingMessage(remaining, maxAttempts)
        : formatRetryMessage(lockDurationMs(Number(record.lock_count || 0) + 1) / 1000),
  };
}

/** Lecture seule — ne consomme pas de tentative (survit au refresh via store). */
async function peekMembershipRateLimit(body = {}, scope = 'change') {
  const orderId = identityKey(body, scope);
  const record = await loadBucket(orderId);
  return statusFromRecord(record, scope);
}

/**
 * @returns {{ ok: true, remaining: number } | { ok: false, error: string, retry_after_sec: number, locked_until: string }}
 */
async function assertMembershipAttemptAllowed(body = {}, scope = 'change') {
  const orderId = identityKey(body, scope);
  const now = Date.now();
  let record = (await loadBucket(orderId)) || {
    order_id: orderId,
    action: 'membership_rate_limit',
    scope,
    attempts: [],
    lock_count: 0,
    lock_until: null,
    created_at: new Date().toISOString(),
  };

  const lockUntilMs = record.lock_until ? new Date(record.lock_until).getTime() : 0;
  if (lockUntilMs && lockUntilMs > now) {
    const retryAfterSec = Math.ceil((lockUntilMs - now) / 1000);
    return {
      ok: false,
      error: formatRetryMessage(retryAfterSec),
      message: formatRetryMessage(retryAfterSec),
      code: 'rate_limited',
      retry_after_sec: retryAfterSec,
      locked_until: record.lock_until,
      remaining: 0,
      max_attempts: MAX_ATTEMPTS,
    };
  }

  // Fenêtre expirée → on repart sur un nouveau compteur d’essais
  if (lockUntilMs && lockUntilMs <= now) {
    record.attempts = [];
    record.lock_until = null;
  }

  const attempts = Array.isArray(record.attempts) ? record.attempts.filter(Boolean) : [];
  if (attempts.length >= MAX_ATTEMPTS) {
    const nextLockCount = Number(record.lock_count || 0) + 1;
    const duration = lockDurationMs(nextLockCount);
    const lockedUntil = new Date(now + duration).toISOString();
    record.lock_count = nextLockCount;
    record.lock_until = lockedUntil;
    record.attempts = attempts;
    await saveBucket(record);
    const retryAfterSec = Math.ceil(duration / 1000);
    logInfo('Membership rate-limit lock', {
      scope,
      order_id: orderId,
      lock_count: nextLockCount,
      retry_after_sec: retryAfterSec,
    });
    return {
      ok: false,
      error: formatRetryMessage(retryAfterSec),
      message: formatRetryMessage(retryAfterSec),
      code: 'rate_limited',
      retry_after_sec: retryAfterSec,
      locked_until: lockedUntil,
      remaining: 0,
      max_attempts: MAX_ATTEMPTS,
    };
  }

  attempts.push({ at: new Date(now).toISOString() });
  record.attempts = attempts;
  await saveBucket(record);

  const remaining = Math.max(0, MAX_ATTEMPTS - attempts.length);
  return {
    ok: true,
    remaining,
    attempts: attempts.length,
    max_attempts: MAX_ATTEMPTS,
    message: formatRemainingMessage(remaining),
  };
}

module.exports = {
  MAX_ATTEMPTS,
  LOCK_MS,
  identityKey,
  normalizeBirthdate,
  assertMembershipAttemptAllowed,
  peekMembershipRateLimit,
  formatRetryMessage,
  formatRemainingMessage,
  lockDurationMs,
};
