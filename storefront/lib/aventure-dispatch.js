'use strict';

const { isAventureOrder } = require('../../lib/aventure-policy');
const { aventureDossierReady, deciplusSaleSettled } = require('./deciplus-sale-reconcile');

let onPaid = null;

function setAventurePaidHandler(fn) {
  onPaid = typeof fn === 'function' ? fn : null;
}

async function notifyAventurePaid(order) {
  if (String(order?.payment?.status || '').toLowerCase() !== 'paid') return;
  if (!aventureDossierReady(order)) return;
  return notifyAventureDispatch(order);
}

async function notifyAventureDispatch(order) {
  if (!order || !isAventureOrder(order)) return;
  if (deciplusSaleSettled(order)) return;
  if (!aventureDossierReady(order)) return;
  if (!onPaid) return;
  await onPaid(order);
}

module.exports = { setAventurePaidHandler, notifyAventurePaid, notifyAventureDispatch };
