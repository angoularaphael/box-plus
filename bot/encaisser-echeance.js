'use strict';

/**
 * Job `encaisser` : le membre a réglé par carte sur /regulariser une échéance restée impayée.
 * On encaisse CETTE échéance (idpe) dans Deciplus en « Carte Bancaire » :
 *   presta_echeance.php?idj=<fiche>  ->  encaisser_echeance.php?idpe=<échéance>  ->  Confirmer.
 * Puis on lève la grâce en cours (plus de nouvelle présentation ni de résiliation pour cet impayé)
 * et on prévient l'app.
 */

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../lib/utils');
const { logInfo, logWarn } = require('../lib/logger');
const { notifyMemberApp } = require('../lib/app-member-notice');

// Etats Deciplus : T a faire, E encaisse, I impaye, S suspendu, P envoye a la banque.
const PAID_STATES = new Set(['E']);

function dryRun() {
  return String(process.env.ECHEANCIER_DRY_RUN || process.env.DAILY_OPS_DRY_RUN || '') === '1';
}

function stateFile() {
  const dir = process.env.BOT_DATA_DIR || path.join(ROOT, 'data');
  return path.join(dir, 'unpaid-daily-ops-state.json');
}

function markRegularised(memberId, eid, orderId) {
  let state = { am04_grace: {}, resiliated: {} };
  try {
    state = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    /* premier passage */
  }
  if (state.am04_grace) delete state.am04_grace[memberId];
  state.regularised = state.regularised || {};
  state.regularised[memberId] = { eid, order_id: orderId, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

/** Lignes de l'échéancier de la fiche : { eid, date, etat, cents }. */
async function readMemberEcheances(page, memberId) {
  const origin = new URL(page.url()).origin;
  const rel = `/presta_echeance.php?idj=${encodeURIComponent(memberId)}`;
  await page.goto(`${origin}/nextgen/legacy?path=${encodeURIComponent(rel)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const ctx of [page, ...(page.frames?.() || [])]) {
      const rows = await ctx
        .evaluate(() => {
          if (!document.querySelector('input[name="datec1"], #btFilter')) return null;
          return [...document.querySelectorAll('input[name^="etat_"], select[name^="etat_"]')]
            .map((el) => {
              const eid = (el.name.match(/^etat_(\d+)$/) || [])[1];
              if (!eid) return null;
              const tr = el.closest('tr');
              const date = ((tr?.innerText || '').match(/\d{2}\/\d{2}\/\d{4}/) || [])[0] || '';
              const price = tr?.querySelector(`input[name="price_${eid}"]`)?.value || '';
              return { eid, date, etat: el.value, cents: Math.round(Number(String(price).replace(',', '.')) * 100) || 0 };
            })
            .filter(Boolean);
        })
        .catch(() => null);
      if (rows) return rows;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('échéancier de la fiche introuvable');
}

/** L'échéance visée par le lien ; à défaut, l'impayé du même montant le plus récent. */
function pickTarget(rows, { eid, amountCents }) {
  const exact = rows.find((r) => String(r.eid) === String(eid));
  if (exact) return exact;
  const unpaid = rows.filter((r) => r.etat === 'I' && (!amountCents || r.cents === amountCents));
  return unpaid.sort((a, b) => b.date.split('/').reverse().join('').localeCompare(a.date.split('/').reverse().join('')))[0] || null;
}

async function submitEncaisser(page, eid) {
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/encaisser_echeance.php?innerP=&inner=1&idpe=${encodeURIComponent(eid)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  const form = page.locator('form').filter({ has: page.locator('input[name="idpeConfirm"]') }).first();
  await form.waitFor({ state: 'attached', timeout: 20000 });
  const confirmed = await page.locator('input[name="idpeConfirm"]').first().inputValue();
  if (String(confirmed) !== String(eid)) throw new Error(`formulaire sur la mauvaise échéance (${confirmed})`);
  await page.locator('select[name="modep"]').first().selectOption('CB');
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}),
    page.locator('input[type="submit"][value*="encaisser" i]').first().click(),
  ]);
  await page.waitForTimeout(1500);
}

async function processEncaisserJob(page, order) {
  const memberId = String(order.deciplus_member_id || '').trim();
  const eid = String(order.echeance_id || order.eid || '').trim();
  const amountCents = Number(order.amount_cents) || Math.round(Number(order.payment?.amount || 0) * 100) || 0;
  if (!memberId) return { ok: false, reason: 'member_id_manquant' };

  const before = await readMemberEcheances(page, memberId);
  const target = pickTarget(before, { eid, amountCents });
  if (!target) {
    logWarn('Encaisser : échéance introuvable', { member_id: memberId, eid, amount_cents: amountCents });
    return { ok: false, reason: 'echeance_introuvable' };
  }
  if (PAID_STATES.has(target.etat)) {
    logInfo('Encaisser : échéance déjà encaissée', { member_id: memberId, eid: target.eid });
    markRegularised(memberId, target.eid, order.order_id);
    return { ok: true, already: true, eid: target.eid };
  }
  if (target.etat === 'P') {
    // Deja partie dans un fichier SEPA : encaisser en plus ferait payer deux fois. Le club tranche.
    logWarn('Encaisser : échéance déjà envoyée à la banque', { member_id: memberId, eid: target.eid });
    return { ok: false, reason: 'deja_envoyee_banque', eid: target.eid };
  }
  if (amountCents && target.cents && Math.abs(target.cents - amountCents) > 1) {
    logWarn('Encaisser : montant différent, à vérifier', { member_id: memberId, eid: target.eid, attendu: target.cents, paye: amountCents });
    return { ok: false, reason: 'montant_different', eid: target.eid };
  }
  if (dryRun()) return { ok: true, dry_run: true, eid: target.eid };

  await submitEncaisser(page, target.eid);
  const after = await readMemberEcheances(page, memberId);
  const row = after.find((r) => String(r.eid) === String(target.eid));
  if (row && !PAID_STATES.has(row.etat)) {
    logWarn('Encaisser : état inchangé après validation', { member_id: memberId, eid: target.eid, etat: row.etat });
    return { ok: false, reason: 'etat_inchange', eid: target.eid };
  }
  markRegularised(memberId, target.eid, order.order_id);
  logInfo('Encaisser : échéance encaissée en CB', { member_id: memberId, eid: target.eid, cents: target.cents });

  const email = String(order.customer?.email || '').trim();
  if (email) {
    await notifyMemberApp({
      eventId: `regularise:${memberId}:${target.eid}`,
      email,
      kind: 'paiement_regularise',
      title: 'Paiement reçu',
      body: 'Merci, ton échéance est réglée. La banque ne repassera pas le prélèvement.',
    }).catch(() => null);
  }
  return { ok: true, encaissed: true, eid: target.eid };
}

module.exports = { processEncaisserJob, pickTarget };
