'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT } = require('../lib/utils');
const { logInfo, logWarn } = require('../lib/logger');
const { scrapeUnpaidMembers } = require('../lib/echeancier-unpaid');
const { decideUnpaidDailyAction, pickPrimaryEid } = require('../lib/unpaid-daily-policy');
const { closeGreyboxIfOpen, openMemberCheck } = require('./wallet');
const { findActiveContracts, cancelOneContract } = require('./cancel-sale');
const { isStaleOrInactiveAbo } = require('../lib/replace-existing-abo');
const { isDeciplusBadgeLabel } = require('../lib/catalog-sale');
const { matchGymSlug, resolveSaleGymConfig } = require('../lib/gym-slugs');
const { reportUnpaidEcheance } = require('./echeancier-report');
const { sendAm04GraceEmail, sendContractCancelledEmail } = require('../storefront/lib/unpaid-am04-email');
const { notifyMemberApp } = require('../lib/app-member-notice');

function stateFile() {
  const dir = process.env.BOT_DATA_DIR || path.join(ROOT, 'data');
  return path.join(dir, 'unpaid-daily-ops-state.json');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { am04_grace: {}, resiliated: {} };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
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
          phone: val('input[name="telsms"]') || val('input[name="tel"]:not(#i_tel)'),
          prenom: val('input[name="prenom"]:not(#i_prenom)'),
        };
      });
      if (meta) return meta;
    } catch {
      /* frame */
    }
  }
  return { email: '', phone: '', prenom: '' };
}

function looksLikeComptant(label) {
  const t = String(label || '');
  if (/pr[ée]l[èe]vement|4\s*semaines|sans\s*engagement|iban|sepa/i.test(t)) return false;
  return /comptant|259\s*€|12\s*mois|promo\s*12|baby\s*boxe|boxe\s*[eé]ducative|forfait\s*annuel/i.test(t);
}

function applyEnabled() {
  if (String(process.env.DAILY_OPS_DRY_RUN || process.env.DRY_RUN || '') === '1') return false;
  if (String(process.env.DAILY_OPS_APPLY || '1') === '0') return false;
  return true;
}

async function resiliateMemberContracts(page, memberId, gymCfg) {
  const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
  const live = contracts.filter((c) => !isStaleOrInactiveAbo(c.label));
  const pick = live.filter((c) => {
    const isBadge = Boolean(c.isBadge) || isDeciplusBadgeLabel(c.label);
    if (looksLikeComptant(c.label) && !isBadge) return false;
    return true;
  });
  const cancelled = [];
  for (const c of pick) {
    const result = await cancelOneContract(page, c, { neverVoid: true });
    cancelled.push({
      idc: c.idc,
      ok: Boolean(result.cancelled),
      reason: result.reason || null,
    });
    await closeGreyboxIfOpen(page).catch(() => {});
    await openMemberCheck(page, memberId, gymCfg).catch(() => {});
  }
  return { cancelled, ok: cancelled.some((x) => x.ok) };
}

async function runUnpaidDailyOps(page) {
  const apply = applyEnabled();
  const state = loadState();
  const report = {
    at: new Date().toISOString(),
    apply,
    scanned: 0,
    grace: [],
    resiliated: [],
    skipped: [],
  };

  const targets = await scrapeUnpaidMembers(page, { fetchRemarks: true });
  report.scanned = targets.length;

  for (const t of targets) {
    const memberId = String(t.member);
    const gymSlug = matchGymSlug(t.gym) || 'minimes';
    const gymCfg = resolveSaleGymConfig(gymSlug, { gym: gymSlug });
    const graceState = state.am04_grace[memberId] || null;
    const decision = decideUnpaidDailyAction(t, graceState, new Date());

    if (decision.action === 'skip') {
      report.skipped.push({ member: memberId, name: t.name, why: decision.why });
      continue;
    }

    await closeGreyboxIfOpen(page).catch(() => {});
    await openMemberCheck(page, memberId, gymCfg);
    const contact = await readFicheContact(page);
    const memberRow = {
      ...t,
      email: String(contact.email || '').trim(),
      first_name: contact.prenom || t.name,
    };

    if (decision.action === 'grace') {
      const eid = decision.eid || pickPrimaryEid(t);
      const entry = (t.entries || []).find((x) => String(x.eid) === String(eid)) || {};
      const row = {
        member: memberId,
        name: t.name,
        eid,
        failed_due: decision.failedDue,
        new_due: decision.newDue,
        reported: false,
        email: null,
      };
      if (!apply) {
        row.skipped = 'dry_run';
        report.grace.push(row);
        continue;
      }
      const rep = await reportUnpaidEcheance(page, {
        eid,
        newDueFr: decision.newDue,
        reportOnclick: entry.reportOnclick,
      });
      row.reported = rep.ok;
      if (!rep.ok) {
        row.error = rep.reason;
        report.grace.push(row);
        continue;
      }
      state.am04_grace[memberId] = {
        eid,
        failed_due: decision.failedDue,
        new_due: decision.newDue,
        new_due_ms: decision.newDueMs,
        reported_at: new Date().toISOString(),
      };
      if (isValidEmail(memberRow.email)) {
        const mail = await sendAm04GraceEmail(memberRow, state.am04_grace[memberId]);
        row.email = mail;
        if (mail.sent) state.am04_grace[memberId].email_sent_at = new Date().toISOString();
        row.app = await notifyMemberApp({
          eventId: `unpaid-grace:${memberId}:${decision.failedDue || eid}`,
          email: memberRow.email,
          kind: 'prelevement_retry',
          title: 'Prélèvement non passé',
          body: `Le prélèvement n’a pas abouti. Une nouvelle tentative est prévue le ${decision.newDue}. Si elle échoue, le contrat sera résilié.`,
        });
      } else {
        row.email = { sent: false, reason: 'no_email' };
      }
      saveState(state);
      report.grace.push(row);
      logInfo('Grace AM04', { member_id: memberId, new_due: decision.newDue });
      continue;
    }

    if (decision.action === 'resiliate') {
      const row = {
        member: memberId,
        name: t.name,
        why: decision.why,
        cancelled: [],
      };
      if (state.resiliated[memberId]?.ok) {
        row.skipped = 'already_resiliated';
        report.resiliated.push(row);
        continue;
      }
      if (!apply) {
        row.skipped = 'dry_run';
        report.resiliated.push(row);
        continue;
      }
      const out = await resiliateMemberContracts(page, memberId, gymCfg);
      row.cancelled = out.cancelled;
      state.resiliated[memberId] = {
        ok: out.ok,
        at: new Date().toISOString(),
        why: decision.why,
      };
      if (out.ok) {
        delete state.am04_grace[memberId];
        if (isValidEmail(memberRow.email)) {
          row.email = await sendContractCancelledEmail(memberRow);
          row.app = await notifyMemberApp({
            eventId: `unpaid-resilie:${memberId}`,
            email: memberRow.email,
            kind: 'prelevement_resilie',
            title: 'Contrat résilié',
            body: 'La nouvelle tentative de prélèvement n’a pas abouti. Votre contrat est résilié.',
          });
        }
      }
      saveState(state);
      report.resiliated.push(row);
      logInfo(out.ok ? 'Resiliation impayé' : 'Resiliation impayé partielle', {
        member_id: memberId,
        why: decision.why,
      });
    }
  }

  return report;
}

module.exports = {
  runUnpaidDailyOps,
  loadState,
  saveState,
};
