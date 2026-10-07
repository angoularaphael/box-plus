/**
 * Envoie une commande vers le bot BotHosting (file persistante côté bot).
 * Ventes Raphaël → BOXPLUS_BOT_URL (eu1:20311)
 * Ventes Eddy → BOXPLUS_BOT_URL_SALES_2 (eu2:21871)
 * Résils / verify / changements → BOXPLUS_BOT_URL_OPS (eu2:21268)
 */
const { alternateSalesBot, pickSalesBotUrl, stampSalesBot } = require('./sales-bot');
const { logWarn } = require('./logger');

function isOpsOrder(order = {}) {
  const action = String(order.action || 'sale').toLowerCase();
  const reason = String(order.cancel_reason || '').toLowerCase();
  const isChangeSale =
    action === 'sale' &&
    (reason === 'change_to_comptant' ||
      order.notify_change_complete ||
      String(order.source || '').includes('change'));
  return (
    action === 'cancel' ||
    action === 'verify_identity' ||
    action === 'echeancier' ||
    action === 'encaisser' ||
    action === 'inscription_nudge' ||
    action === 'check_sale' ||
    action === 'balma_switch' ||
    isChangeSale
  );
}

function isBotUnreachableError(err) {
  const msg = `${err?.message || err || ''} ${err?.cause?.code || ''} ${err?.cause?.message || ''}`.toLowerCase();
  return /fetch failed|econnrefused|enotfound|econnreset|etimedout|ehostunreach|und_err|socket|network/.test(msg);
}

function salesFailoverBase(order = {}, primary = '') {
  if (isOpsOrder(order)) return '';
  const raphael = String(process.env.BOXPLUS_BOT_URL || '').replace(/\/$/, '');
  const eddy = String(process.env.BOXPLUS_BOT_URL_SALES_2 || '').replace(/\/$/, '');
  if (!raphael || !eddy || raphael === eddy) return '';
  if (primary === raphael) return eddy;
  if (primary === eddy) return raphael;
  return '';
}

function pickBotBase(order = {}) {
  const sales = (process.env.BOXPLUS_BOT_URL || '').replace(/\/$/, '');
  const sales2 = (process.env.BOXPLUS_BOT_URL_SALES_2 || '').replace(/\/$/, '');
  const ops = (process.env.BOXPLUS_BOT_URL_OPS || '').replace(/\/$/, '');

  if (isOpsOrder(order)) {
    if (!ops) {
      throw new Error(
        'BOXPLUS_BOT_URL_OPS manquant sur Vercel — résils / vérifs / changements doivent aller sur prem-eu2:21268'
      );
    }
    return ops;
  }
  return pickSalesBotUrl(order, sales, sales2);
}

async function forwardJobToBot(order) {
  const { getStoreUrl } = require('./app-urls');
  if (!isOpsOrder(order)) stampSalesBot(order);
  const base = pickBotBase(order);
  const secret = process.env.SYNC_SECRET || process.env.BRIDGE_SECRET || '';
  if (!base) {
    return {
      forwarded: false,
      reason: isOpsOrder(order) ? 'no_bot_url_ops' : 'no_bot_url',
    };
  }

  const postJob = async (target, pathSuffix = '/api/jobs') => {
    const res = await fetch(`${target}${pathSuffix}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-secret': secret,
      },
      body: JSON.stringify({
        ...order,
        status_callback_base: order.status_callback_base || getStoreUrl(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `Bot ingest HTTP ${res.status}`);
    }
    return body;
  };

  let usedBase = base;
  let body;
  try {
    body = await postJob(base, '/api/jobs');
  } catch (err) {
    const alt = salesFailoverBase(order, base);
    if (!alt || !isBotUnreachableError(err)) throw err;
    const previous = order.sales_bot || null;
    order.sales_bot = alternateSalesBot(previous) || (alt === String(process.env.BOXPLUS_BOT_URL_SALES_2 || '').replace(/\/$/, '') ? 'eddy' : 'raphael');
    order.failover_count = Number(order.failover_count || 0) + 1;
    order.failover_from = previous;
    order.failover_reason = String(err.message || err).slice(0, 200);
    logWarn('Bot ventes injoignable — relais vers l autre bot', {
      order_id: order.order_id,
      from: previous,
      to: order.sales_bot,
      error: err.message,
    });
    usedBase = alt;
    body = await postJob(alt, '/api/jobs');
  }
  if (!body.queued && body.reason === 'already_processed' && order.force_requeue) {
    try {
      body = await postJob(usedBase, '/api/jobs/force-requeue');
      body.forced_requeue = true;
    } catch (err) {
      body.force_requeue_error = err.message;
    }
  }
  return { forwarded: true, bot_url: usedBase, sales_bot: order.sales_bot || null, ...body };
}

module.exports = { forwardJobToBot, pickBotBase, isOpsOrder, isBotUnreachableError, salesFailoverBase };
