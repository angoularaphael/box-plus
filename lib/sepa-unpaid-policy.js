'use strict';

const SEPA_REASON = {
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  NO_MANDATE: 'no_mandate',
  DEBTOR_DISPUTE: 'debtor_dispute',
  DEBTOR_REFUSAL: 'debtor_refusal',
  BAD_BANK: 'bad_bank_details',
  CLOSED_ACCOUNT: 'closed_account',
  ACCOUNT_BLOCKED: 'account_blocked',
  INVALID_BANK_ID: 'invalid_bank_id',
  JSON_ERROR: 'json_syntax_error',
  UNKNOWN: 'unknown',
};

/** cancelAt = impayés avant résil ; ribEmailAt = 1er impayé → mail demande RIB */
const REASON_POLICY = {
  [SEPA_REASON.INSUFFICIENT_FUNDS]: { cancelAt: 3, ribEmailAt: null },
  [SEPA_REASON.NO_MANDATE]: { cancelAt: 3, ribEmailAt: null },
  [SEPA_REASON.DEBTOR_DISPUTE]: { cancelAt: 1, ribEmailAt: null },
  [SEPA_REASON.DEBTOR_REFUSAL]: { cancelAt: 1, ribEmailAt: null },
  [SEPA_REASON.BAD_BANK]: { cancelAt: 2, ribEmailAt: 1 },
  [SEPA_REASON.CLOSED_ACCOUNT]: { cancelAt: 1, ribEmailAt: null },
  [SEPA_REASON.ACCOUNT_BLOCKED]: { cancelAt: 2, ribEmailAt: null },
  [SEPA_REASON.INVALID_BANK_ID]: { cancelAt: 2, ribEmailAt: 1 },
  [SEPA_REASON.JSON_ERROR]: { cancelAt: 1, ribEmailAt: null },
  [SEPA_REASON.UNKNOWN]: { cancelAt: 3, ribEmailAt: null },
};

const INSUFFICIENT_FUNDS_CANCEL_AT = 3;

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

function hasUsablePhone(s) {
  return String(s || '').replace(/\D/g, '').length >= 8;
}

function hasMemberContact(candidate = {}) {
  return isValidEmail(candidate.email) || hasUsablePhone(candidate.phone);
}

function hasMissingContact(candidate = {}) {
  if (candidate.missing_contact === true) return true;
  if (candidate.email === undefined && candidate.phone === undefined) return false;
  return !hasMemberContact(candidate);
}

function classifySepaRemark(text) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return SEPA_REASON.UNKNOWN;
  if (/\bAM04\b|provision insuffisante|fonds? insuffisant/i.test(t)) {
    return SEPA_REASON.INSUFFICIENT_FUNDS;
  }
  if (/\bMD06\b|contestation d[ée]biteur|contestation d['’]une op[ée]ration autoris[ée]e/i.test(t)) {
    return SEPA_REASON.DEBTOR_DISPUTE;
  }
  if (/\bMS02\b|refus du d[ée]biteur|sur ordre du client/i.test(t)) {
    return SEPA_REASON.DEBTOR_REFUSAL;
  }
  if (/\bMS03\b|raison non communiqu[ée]e/i.test(t)) {
    return SEPA_REASON.DEBTOR_REFUSAL;
  }
  if (/\bAC01\b|coordonn[ée]e?s?\s+bancaire.?s?\s+inexploit/i.test(t)) {
    return SEPA_REASON.BAD_BANK;
  }
  if (/\bAC04\b|compte cl[ôo]tur[ée]/i.test(t)) {
    return SEPA_REASON.CLOSED_ACCOUNT;
  }
  if (/\bAC06\b|opposition sur compte|pr[ée]l[èe]vement sepa interdit/i.test(t)) {
    return SEPA_REASON.ACCOUNT_BLOCKED;
  }
  if (/\bRC01\b|code banque incorrect|identifiant bancaire incorrect/i.test(t)) {
    return SEPA_REASON.INVALID_BANK_ID;
  }
  if (/\bMD01\b|pas d['’]?autorisation|absence de mandat/i.test(t)) {
    return SEPA_REASON.NO_MANDATE;
  }
  if (/json\s*syntax\s*error|erreur json/i.test(t)) {
    return SEPA_REASON.JSON_ERROR;
  }
  return SEPA_REASON.UNKNOWN;
}

function collectRemarkTexts(candidate = {}) {
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s) out.push(s);
  };
  for (const r of candidate.remarks || []) push(r);
  for (const s of candidate.samples || []) push(s);
  push(candidate.remark);
  push(candidate.sepa_remark);
  push(candidate.status);
  return out;
}

function resolveUnpaidPolicy(sepaReasons = []) {
  const known = [...new Set((sepaReasons || []).filter((r) => r && r !== SEPA_REASON.UNKNOWN))];
  const effective = known.length ? known : [SEPA_REASON.UNKNOWN];
  const cancelAt = Math.min(...effective.map((r) => REASON_POLICY[r].cancelAt));
  const ribHits = effective.map((r) => REASON_POLICY[r].ribEmailAt).filter((n) => n != null);
  const ribEmailAt = ribHits.length ? Math.min(...ribHits) : null;
  const onlyInsufficientFunds =
    effective.length > 0 && effective.every((r) => r === SEPA_REASON.INSUFFICIENT_FUNDS);
  const onlyNoMandate = effective.length > 0 && effective.every((r) => r === SEPA_REASON.NO_MANDATE);
  const waitOnlyUnpaidCount = effective.every(
    (r) => r === SEPA_REASON.INSUFFICIENT_FUNDS || r === SEPA_REASON.NO_MANDATE
  );
  return {
    cancelAt,
    ribEmailAt,
    onlyInsufficientFunds,
    onlyNoMandate,
    waitOnlyUnpaidCount,
    effectiveReasons: effective,
  };
}

function classifySepaFromCandidate(candidate = {}) {
  const texts = collectRemarkTexts(candidate);
  const sepaReasons = [...new Set(texts.map(classifySepaRemark).filter((r) => r !== SEPA_REASON.UNKNOWN))];
  const policy = resolveUnpaidPolicy(sepaReasons);
  return {
    sepaReasons,
    policy,
    hasImmediateSepaReason: policy.cancelAt === 1,
    onlyInsufficientFunds: policy.onlyInsufficientFunds,
    onlyNoMandate: policy.onlyNoMandate,
    waitOnlyUnpaidCount: policy.waitOnlyUnpaidCount,
  };
}

function isImmediateSepaReason(reason) {
  return REASON_POLICY[reason]?.cancelAt === 1;
}

function resiliateWhy(sepa, unpaidCount) {
  const { cancelAt, onlyInsufficientFunds, onlyNoMandate, sepaReasons } = sepa;
  if (cancelAt === 1) {
    if (sepaReasons.includes(SEPA_REASON.DEBTOR_DISPUTE)) return 'sepa_debtor_dispute';
    if (sepaReasons.includes(SEPA_REASON.DEBTOR_REFUSAL)) return 'sepa_debtor_refusal';
    if (sepaReasons.includes(SEPA_REASON.CLOSED_ACCOUNT)) return 'sepa_closed_account';
    if (sepaReasons.includes(SEPA_REASON.JSON_ERROR)) return 'sepa_json_error';
    return 'sepa_immediate';
  }
  if (cancelAt === 2) return 'two_unpaid';
  if (onlyInsufficientFunds) return 'am04_three_unpaid';
  if (onlyNoMandate) return 'md01_three_unpaid';
  if (unpaidCount >= INSUFFICIENT_FUNDS_CANCEL_AT) return 'three_unpaid';
  return 'threshold_reached';
}

function waitWhy(sepa) {
  const { cancelAt, onlyInsufficientFunds, onlyNoMandate, ribEmailAt } = sepa.policy || {};
  if (cancelAt === 2 && ribEmailAt === 1) return 'rib_email_wait_two';
  if (cancelAt === 2) return 'wait_two_unpaid';
  if (onlyInsufficientFunds) return 'am04_wait_three';
  if (onlyNoMandate) return 'md01_wait_three';
  if (cancelAt === 3) return 'wait_three_unpaid';
  return 'need_sepa_detail_or_threshold';
}

function shouldSendRibReminder(candidate = {}, sepa = null, memberState = {}) {
  const classified = sepa || classifySepaFromCandidate(candidate);
  const unpaidCount = Number(candidate.unpaid_count || candidate.n || 0);
  const { ribEmailAt, cancelAt } = classified.policy || {};
  if (!ribEmailAt) return { ok: false, why: 'no_rib_email_rule' };
  if (memberState?.rib_reminder_at || memberState?.at) return { ok: false, why: 'already_sent' };
  if (!isValidEmail(candidate.email)) return { ok: false, why: 'no_email' };
  if (unpaidCount < ribEmailAt) return { ok: false, why: 'before_rib_email_threshold' };
  if (unpaidCount >= cancelAt) return { ok: false, why: 'past_cancel_threshold' };
  return { ok: true, why: 'rib_email_due', ...classified };
}

function shouldResiliateUnpaid(candidate = {}) {
  const unpaidCount = Number(candidate.unpaid_count || candidate.n || 0);
  const sepa = classifySepaFromCandidate(candidate);
  const payload = { ...sepa, unpaidCount, cancelAt: sepa.policy.cancelAt };

  if (hasMissingContact(candidate)) {
    return { ok: true, why: 'missing_contact', ...payload };
  }
  if (unpaidCount >= sepa.policy.cancelAt) {
    return { ok: true, why: resiliateWhy(payload, unpaidCount), ...payload };
  }

  const rib = shouldSendRibReminder(candidate, sepa, candidate.rib_reminder_state || {});
  return {
    ok: false,
    why: waitWhy(sepa),
    needsRibEmail: rib.ok,
    ...payload,
  };
}

module.exports = {
  SEPA_REASON,
  REASON_POLICY,
  INSUFFICIENT_FUNDS_CANCEL_AT,
  classifySepaRemark,
  classifySepaFromCandidate,
  resolveUnpaidPolicy,
  isImmediateSepaReason,
  hasMemberContact,
  hasMissingContact,
  shouldSendRibReminder,
  shouldResiliateUnpaid,
};
