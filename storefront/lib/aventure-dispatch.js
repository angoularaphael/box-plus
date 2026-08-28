'use strict';

const { isAventureOrder } = require('../../lib/aventure-policy');

let onPaid = null;

function setAventurePaidHandler(fn) {
  onPaid = typeof fn === 'function' ? fn : null;
}

async function notifyAventurePaid(order) {
  if (String(order?.payment?.status || '').toLowerCase() !== 'paid') return;
  return notifyAventureDispatch(order);
}

async function notifyAventureDispatch(order) {
  if (!order || !isAventureOrder(order)) return;
  if (order.dispatched_at || order.dispatch_result?.queued) return;
  if (order.manual_migration || order.skip_bot) return;
  if (!onPaid) return;
  await onPaid(order);
}

module.exports = { setAventurePaidHandler, notifyAventurePaid, notifyAventureDispatch };
