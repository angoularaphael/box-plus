'use strict';

/**
 * Job `regul_link` : un membre demande sur la boutique (/regulariser sans lien) a regler une
 * echeance impayee. On retrouve sa fiche (nom + prenom + naissance), son echeance impayee dans
 * l'echeancier Deciplus, puis on envoie le lien /regulariser signe a l'adresse e-mail DE LA FICHE
 * (jamais a une adresse saisie sur la boutique : personne ne peut recevoir le lien d'un autre).
 */

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../lib/utils');
const { logInfo, logWarn } = require('../lib/logger');
const { scrapeUnpaidMembers } = require('../lib/echeancier-unpaid');
const { pickPrimaryEid } = require('../lib/unpaid-daily-policy');
const { matchGymSlug, resolveSaleGymConfig } = require('../lib/gym-slugs');
const { buildPayUrl } = require('../lib/echeancier-pay-link');
const { closeGreyboxIfOpen, openMemberCheck } = require('./wallet');
const { findMemberByIdentity, CHANGE_MATCH_FIELDS } = require('./member');
const { sendRegulLinkEmail } = require('../storefront/lib/unpaid-am04-email');

function stateFile() {
  const dir = process.env.BOT_DATA_DIR || path.join(ROOT, 'data');
  return path.join(dir, 'unpaid-daily-ops-state.json');
}

function graceFor(memberId) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return (state.am04_grace || {})[String(memberId)] || null;
  } catch {
    return null;
  }
}

async function readFicheContact(page) {
  for (const ctx of [page, ...(page.frames?.() || [])]) {
    try {
      const meta = await ctx.evaluate(() => {
        const form = document.querySelector('form[name="db1_form"]');
        if (!form) return null;
        const val = (sel) => (form.querySelector(sel) || {}).value || '';
        return {
          email: val('input[name="email"]:not(#i_email)'),
          prenom: val('input[name="prenom"]:not(#i_prenom)'),
        };
      });
      if (meta) return meta;
    } catch {
      /* frame detachee */
    }
  }
  return { email: '', prenom: '' };
}

/**
 * Choisit le type de lien : si l'echeance est deja en grace (nouvelle presentation prevue a une
 * date future), on reprend cette date ; sinon lien « demande » valable 30 jours.
 */
function pickKind(grace, eid, now = Date.now()) {
  if (grace && String(grace.eid) === String(eid) && grace.new_due && Number(grace.new_due_ms) > now + 24 * 3600 * 1000) {
    return { kind: 'grace', new_due: grace.new_due };
  }
  return { kind: 'demande' };
}

async function processRegulLinkRequest(page, order) {
  const c = order.customer || {};
  const identity = {
    first_name: c.first_name,
    last_name: c.last_name,
    birthdate: c.birthdate,
    email: c.email || '',
  };
  const hit = await findMemberByIdentity(page, identity, { matchFields: CHANGE_MATCH_FIELDS });
  if (!hit?.found || !hit.member_id) {
    logInfo('Lien regulariser : fiche non trouvee', { order_id: order.order_id, reason: hit?.reason || null });
    return { ok: false, reason: 'identite_non_trouvee', mismatch_fields: hit?.mismatch_fields || [] };
  }
  const memberId = String(hit.member_id);

  const targets = await scrapeUnpaidMembers(page, { fetchRemarks: false });
  const t = targets.find((x) => String(x.member) === memberId);
  if (!t) {
    logInfo('Lien regulariser : aucune echeance impayee', { order_id: order.order_id, member_id: memberId });
    return { ok: false, reason: 'aucun_impaye', member_id: memberId };
  }
  const eid = pickPrimaryEid(t);
  const entry = (t.entries || []).find((x) => String(x.eid) === String(eid)) || {};
  const gymSlug = matchGymSlug(t.gym) || 'minimes';

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, resolveSaleGymConfig(gymSlug, { gym: gymSlug }));
  const contact = await readFicheContact(page);
  const email = String(contact.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    logWarn('Lien regulariser : pas d’e-mail sur la fiche', { member_id: memberId });
    return { ok: false, reason: 'pas_email_fiche', member_id: memberId };
  }

  const kind = pickKind(graceFor(memberId), eid);
  const payUrl = buildPayUrl({
    member_id: memberId,
    eid,
    amount_cents: entry.amount_cents,
    email,
    prenom: contact.prenom || c.first_name || '',
    nom: c.last_name || '',
    gym: gymSlug,
    product: t.product || '',
    failed_due: entry.date || '',
    ...kind,
  });
  if (!payUrl) {
    return { ok: false, reason: 'lien_non_cree', member_id: memberId };
  }
  const mail = await sendRegulLinkEmail(
    { email, first_name: contact.prenom || c.first_name || '' },
    { pay_url: payUrl, amount_cents: entry.amount_cents, failed_due: entry.date || '' }
  );
  logInfo('Lien regulariser envoye', { member_id: memberId, eid, sent: mail.sent });
  return { ok: Boolean(mail.sent), reason: mail.sent ? null : mail.reason, member_id: memberId, eid };
}

module.exports = { processRegulLinkRequest, pickKind };
