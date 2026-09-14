#!/usr/bin/env node
'use strict';
/**
 * Relances mail manquées (David / Principal) + reprise de la vente bloquée.
 *
 *   node scripts/catchup-relance-emails.js           # dry-run
 *   node scripts/catchup-relance-emails.js --send
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const ROOT = path.join(__dirname, '..');
loadEnvFile(path.join(ROOT, '.env'));
loadEnvFile(path.join(ROOT, '..', 'gestion-manager', '.env'));
loadEnvFile(path.join(ROOT, '..', 'gestion-manager', 'bots', 'deploy', 'email-resend', '.env'));
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.RESEND_SENDER_NAME = process.env.RESEND_SENDER_NAME || 'David';
process.env.RESEND_SENDER_EMAIL =
  process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
delete process.env.DRY_RUN;

const SEND = process.argv.includes('--send');
const BLOCKED_SALE = 'BC-1787420224978-4cd9d0';
const GAP_MS = 400;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { listOrdersCreatedSinceAsync, loadOrderAsync, saveOrderAsync } = require('../storefront/lib/order-lifecycle');
  const {
    isNudgeDue,
    nudgeEmailDone,
    isInscriptionTunnel,
    sendNudgeEmail,
    sendResumeEmail,
    customerPhone,
  } = require('../storefront/lib/inscription-nudge');
  const {
    isPaidEssaiOrder,
    classifyCustomerNudge,
    customerNudges,
    sendCustomerNudge,
    membershipKeysFromOrders,
    ESSAI_SINCE_MS,
  } = require('../storefront/lib/essai-followup');
  const { isConfigured } = require('../storefront/lib/resend-send');
  const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
  const { forwardJobToBot } = require('../lib/bot-forward');

  if (SEND && !isConfigured()) throw new Error('RESEND_API_KEY manquant');

  const now = Date.now();
  const since = new Date(Math.min(ESSAI_SINCE_MS, now - 21 * 24 * 60 * 60 * 1000)).toISOString();
  const listed = await listOrdersCreatedSinceAsync(since);
  const keys = membershipKeysFromOrders(listed);

  const summary = {
    dry_run: !SEND,
    scanned: listed.length,
    essai: { send: 0, skip: 0, errors: 0 },
    inscription: { send: 0, skip: 0, errors: 0 },
    sale: null,
    samples: [],
  };

  for (const slim of listed) {
    if (!isPaidEssaiOrder(slim)) continue;
    const decision = classifyCustomerNudge(slim, { now, membershipKeys: keys });
    const nudges = customerNudges(slim);
    const failedEmail = nudges.find((n) => n.email === false);
    const need =
      decision.action === 'nudge_customer' ||
      (failedEmail && decision.action !== 'skip');
    if (!need) {
      summary.essai.skip += 1;
      continue;
    }
    const day = decision.day || failedEmail?.day || 1;
    const order = (await loadOrderAsync(slim.order_id)) || slim;
    const live = classifyCustomerNudge(order, { now, membershipKeys: keys });
    const alreadyEmailed = customerNudges(order).some((n) => n.email === true);
    if (live.action !== 'nudge_customer' || alreadyEmailed) {
      summary.essai.skip += 1;
      continue;
    }
    if (summary.samples.length < 4) {
      summary.samples.push({
        kind: 'essai',
        order_id: order.order_id,
        email: order.customer_short?.email || null,
        day,
      });
    }
    if (!SEND) {
      summary.essai.send += 1;
      continue;
    }
    const out = await sendCustomerNudge(order, live.day || day, {
      sendWa: async () => ({ sent: false, skipped: true, reason: 'email_only' }),
      dryRun: false,
    });
    if (out.email?.sent) {
      const prev = customerNudges(order);
      const next = prev.some((n) => Number(n.day) === Number(live.day || day))
        ? prev.map((n) =>
            Number(n.day) === Number(live.day || day) ? { ...n, email: true } : n
          )
        : [
            ...prev,
            {
              day: live.day || day,
              at: new Date().toISOString(),
              email: true,
              whatsapp: false,
            },
          ];
      order.essai_customer_nudges = next.slice(0, 3);
      await saveOrderAsync(order);
      summary.essai.send += 1;
    } else {
      summary.essai.errors += 1;
    }
    await sleep(GAP_MS);
  }

  for (const slim of listed) {
    if (!isInscriptionTunnel(slim)) continue;
    if (nudgeEmailDone(slim) && !isNudgeDue(slim, now)) {
      summary.inscription.skip += 1;
      continue;
    }
    const signed = Number(slim.step || 0) >= 8 || slim.signature?.signed_at;
    if (signed) {
      summary.inscription.skip += 1;
      continue;
    }
    const email =
      slim.customer_short?.email || slim.customer?.email || slim.customer_full?.email;
    if (!email || /@boxplus-test\.local$/i.test(email)) {
      summary.inscription.skip += 1;
      continue;
    }
    if (!isNudgeDue(slim, now) && nudgeEmailDone(slim)) {
      summary.inscription.skip += 1;
      continue;
    }
    if (!isNudgeDue(slim, now) && !nudgeEmailDone(slim)) {
      const entered = Date.parse(slim.funnel?.step_entered_at || slim.created_at || '');
      if (!Number.isFinite(entered) || now - entered < 30 * 60 * 1000) {
        summary.inscription.skip += 1;
        continue;
      }
    }
    const order = (await loadOrderAsync(slim.order_id)) || slim;
    if (nudgeEmailDone(order) && !isNudgeDue(order, now)) {
      summary.inscription.skip += 1;
      continue;
    }
    if (summary.samples.length < 8) {
      summary.samples.push({
        kind: 'inscription',
        order_id: order.order_id,
        email,
        step: order.step,
      });
    }
    if (!SEND) {
      summary.inscription.send += 1;
      continue;
    }
    try {
      const mailed = isNudgeDue(order, now)
        ? await sendNudgeEmail(order)
        : await sendResumeEmail(order, { kind: 'resume' });
      if (mailed.sent) {
        const funnel = {
          ...(order.funnel || {}),
          nudge_email_sent_at: new Date().toISOString(),
        };
        order.funnel = funnel;
        await saveOrderAsync(order);
        summary.inscription.send += 1;
      } else if (mailed.skipped) {
        summary.inscription.skip += 1;
      } else {
        summary.inscription.errors += 1;
      }
    } catch (err) {
      summary.inscription.errors += 1;
    }
    await sleep(GAP_MS);
  }

  try {
    const blocked = await loadOrderAsync(BLOCKED_SALE);
    if (!blocked) {
      summary.sale = { ok: false, error: 'not_found' };
    } else if (!SEND) {
      summary.sale = {
        dry: true,
        order_id: blocked.order_id,
        product: blocked.product_snapshot?.name || blocked.product_id,
        member: blocked.deciplus_member_id || null,
        bot_error: blocked.bot_error || null,
      };
    } else {
      const payload = {
        ...buildOrderFromLifecycle(blocked, blocked.product_snapshot || {}),
        force_requeue: true,
        force_sale_retry: true,
        deciplus_member_id: blocked.deciplus_member_id || undefined,
      };
      const forwarded = await forwardJobToBot(payload);
      blocked.dispatched_at = new Date().toISOString();
      blocked.dispatch_result = forwarded;
      await saveOrderAsync(blocked);
      summary.sale = { ok: true, ...forwarded };
    }
  } catch (err) {
    summary.sale = { ok: false, error: err.message };
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
