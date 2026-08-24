'use strict';

const { STEPS, memberDisplayName, deleteOrderAsync } = require('./order-lifecycle');
const { logInfo, logWarn } = require('../../lib/logger');

/** Brouillon salle/identité encore ouvert sur le téléphone — ne pas toucher. */
const EMPTY_IDENTITY_GRACE_MS = 6 * 60 * 60 * 1000;
/** Doublon d’onglet juste après un paiement — pas un réabonnement ancien. */
const RECENT_PAID_DUPLICATE_MS = 48 * 60 * 60 * 1000;

function isInscriptionTunnel(order) {
  if (!order || order.action) return false;
  const id = String(order.order_id || '');
  if (/^(COACH|CHANGE|VERIFY|CANCEL|ENCAISSER|ECH-)/i.test(id)) return false;
  return Boolean(order.access_token || id.startsWith('BC-'));
}

function realEmail(order) {
  const e = String(
    order?.customer_short?.email || order?.customer_full?.email || order?.customer?.email || ''
  )
    .trim()
    .toLowerCase();
  if (!e || e === '—' || !e.includes('@')) return '';
  return e;
}

function hasName(order) {
  return memberDisplayName(order?.customer_short || order?.customer || {}) !== '—';
}

function isPaidOrSigned(order) {
  const st = String(order?.payment?.status || '');
  return st === 'paid' || st === 'free' || Boolean(order?.signature?.signed_at);
}

function parseOrderTime(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function orderTouchedAt(order) {
  return (
    parseOrderTime(order?.updated_at) ||
    parseOrderTime(order?.funnel?.step_entered_at) ||
    parseOrderTime(order?.created_at)
  );
}

function paidAtMs(order) {
  return (
    parseOrderTime(order?.payment?.paid_at) ||
    parseOrderTime(order?.signature?.signed_at) ||
    parseOrderTime(order?.updated_at) ||
    parseOrderTime(order?.created_at)
  );
}

function isOlderThan(order, maxAgeMs, now = Date.now()) {
  const ts = orderTouchedAt(order);
  if (!ts) return true;
  return now - ts >= maxAgeMs;
}

/** Arrêt salle/identité : aucune identité, pas payé, abandonné depuis des heures. */
function isEmptyIdentityAbandon(order, now = Date.now()) {
  if (!isInscriptionTunnel(order)) return false;
  if (isPaidOrSigned(order)) return false;
  if (realEmail(order) || hasName(order)) return false;
  const step = Number(order.step || 0);
  if (!(step > 0 && step <= STEPS.IDENTITY)) return false;
  return isOlderThan(order, EMPTY_IDENTITY_GRACE_MS, now);
}

function paidEmailsFrom(orders) {
  return recentPaidEmailsFrom(orders, Number.POSITIVE_INFINITY);
}

function recentPaidEmailsFrom(orders, maxAgeMs = RECENT_PAID_DUPLICATE_MS, now = Date.now()) {
  const set = new Set();
  for (const order of orders || []) {
    if (!isInscriptionTunnel(order) || !isPaidOrSigned(order)) continue;
    const paidAt = paidAtMs(order);
    if (paidAt && now - paidAt > maxAgeMs) continue;
    if (!paidAt && Number.isFinite(maxAgeMs)) continue;
    const email = realEmail(order);
    if (email) set.add(email);
  }
  return set;
}

/**
 * Autre session impayée alors qu’un paiement récent existe déjà pour le même e-mail.
 * Un abo suspendu / résilié (ancien dossier payé) n’est PAS un doublon : la personne
 * a le droit de racheter.
 */
function isUnpaidDuplicateOfPaid(order, paidEmails) {
  if (!isInscriptionTunnel(order)) return false;
  if (isPaidOrSigned(order)) return false;
  const email = realEmail(order);
  if (!email) return false;
  return paidEmails.has(email);
}

function ordersToPrune(all = [], now = Date.now()) {
  const paidEmails = recentPaidEmailsFrom(all, RECENT_PAID_DUPLICATE_MS, now);
  return all.filter(
    (order) =>
      isEmptyIdentityAbandon(order, now) || isUnpaidDuplicateOfPaid(order, paidEmails)
  );
}

async function pruneAbandonedInscriptions(all = []) {
  const doomed = ordersToPrune(all);
  let deleted = 0;
  for (const order of doomed) {
    try {
      await deleteOrderAsync(order.order_id);
      deleted += 1;
    } catch (err) {
      logWarn('Prune inscription échoué', { order_id: order.order_id, error: err.message });
    }
  }
  if (deleted) {
    logInfo('Inscriptions fantômes / doublons supprimés', {
      deleted,
      empty_identity: doomed.filter((o) => isEmptyIdentityAbandon(o)).length,
      unpaid_dupes: doomed.filter((o) => !isEmptyIdentityAbandon(o)).length,
    });
  }
  const gone = new Set(doomed.map((o) => o.order_id));
  return {
    deleted,
    kept: all.filter((o) => !gone.has(o.order_id)),
  };
}

async function collapseUnpaidDraftsForEmail(email, keepOrderId) {
  const dest = String(email || '')
    .trim()
    .toLowerCase();
  if (!dest || !dest.includes('@')) return 0;
  const { listAllOrdersAsync } = require('./order-lifecycle');
  const all = await listAllOrdersAsync();
  let deleted = 0;
  for (const order of all) {
    if (order.order_id === keepOrderId) continue;
    if (!isInscriptionTunnel(order) || isPaidOrSigned(order)) continue;
    if (realEmail(order) !== dest) continue;
    try {
      await deleteOrderAsync(order.order_id);
      deleted += 1;
    } catch (err) {
      logWarn('Collapse brouillon échoué', { order_id: order.order_id, error: err.message });
    }
  }
  return deleted;
}

module.exports = {
  EMPTY_IDENTITY_GRACE_MS,
  RECENT_PAID_DUPLICATE_MS,
  isInscriptionTunnel,
  realEmail,
  isEmptyIdentityAbandon,
  isUnpaidDuplicateOfPaid,
  paidEmailsFrom,
  recentPaidEmailsFrom,
  ordersToPrune,
  pruneAbandonedInscriptions,
  collapseUnpaidDraftsForEmail,
};
