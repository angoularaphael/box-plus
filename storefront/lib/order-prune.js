'use strict';

const { STEPS, memberDisplayName, deleteOrderAsync } = require('./order-lifecycle');
const { logInfo, logWarn } = require('../../lib/logger');

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

/** Arrêt salle/identité : aucune identité, pas payé. */
function isEmptyIdentityAbandon(order) {
  if (!isInscriptionTunnel(order)) return false;
  if (isPaidOrSigned(order)) return false;
  if (realEmail(order) || hasName(order)) return false;
  const step = Number(order.step || 0);
  return step > 0 && step <= STEPS.IDENTITY;
}

function paidEmailsFrom(orders) {
  const set = new Set();
  for (const order of orders || []) {
    if (!isInscriptionTunnel(order) || !isPaidOrSigned(order)) continue;
    const email = realEmail(order);
    if (email) set.add(email);
  }
  return set;
}

/** Autre session impayée alors qu’un dossier payé existe déjà pour le même e-mail. */
function isUnpaidDuplicateOfPaid(order, paidEmails) {
  if (!isInscriptionTunnel(order)) return false;
  if (isPaidOrSigned(order)) return false;
  const email = realEmail(order);
  if (!email) return false;
  return paidEmails.has(email);
}

function ordersToPrune(all = []) {
  const paidEmails = paidEmailsFrom(all);
  return all.filter(
    (order) => isEmptyIdentityAbandon(order) || isUnpaidDuplicateOfPaid(order, paidEmails)
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
  isInscriptionTunnel,
  realEmail,
  isEmptyIdentityAbandon,
  isUnpaidDuplicateOfPaid,
  paidEmailsFrom,
  ordersToPrune,
  pruneAbandonedInscriptions,
  collapseUnpaidDraftsForEmail,
};
