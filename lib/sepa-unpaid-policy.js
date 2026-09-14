'use strict';

const SEPA_REASON = {
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  BAD_BANK: 'bad_bank_details',
  DEBTOR_REFUSAL: 'debtor_refusal',
  NO_MANDATE: 'no_mandate',
  JSON_ERROR: 'json_syntax_error',
  UNKNOWN: 'unknown',
};

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

const INSUFFICIENT_FUNDS_CANCEL_AT = 3;

function classifySepaRemark(text) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return SEPA_REASON.UNKNOWN;
  if (/\bAM04\b|provision insuffisante|fonds? insuffisant/i.test(t)) {
    return SEPA_REASON.INSUFFICIENT_FUNDS;
  }
  if (/\bAC01\b|coordonn[ée]e?s?\s+bancaire.?s?\s+inexploit/i.test(t)) {
    return SEPA_REASON.BAD_BANK;
  }
  if (/\bMS02\b|refus du d[ée]biteur|sur ordre du client/i.test(t)) {
    return SEPA_REASON.DEBTOR_REFUSAL;
  }
  if (/\bMD01\b|pas d['’]?autorisation|absence de mandat/i.test(t)) {
    return SEPA_REASON.NO_MANDATE;
  }
  if (/json\s*syntax\s*error|erreur json/i.test(t)) {
    return SEPA_REASON.JSON_ERROR;
  }
  return SEPA_REASON.UNKNOWN;
}

function isImmediateSepaReason(reason) {
  return (
    reason === SEPA_REASON.BAD_BANK ||
    reason === SEPA_REASON.DEBTOR_REFUSAL ||
    reason === SEPA_REASON.NO_MANDATE ||
    reason === SEPA_REASON.JSON_ERROR
  );
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

function classifySepaFromCandidate(candidate = {}) {
  const texts = collectRemarkTexts(candidate);
  const sepaReasons = texts.map(classifySepaRemark);
  const known = sepaReasons.filter((r) => r !== SEPA_REASON.UNKNOWN);
  const hasImmediateSepaReason = sepaReasons.some(isImmediateSepaReason);
  const onlyInsufficientFunds =
    known.length > 0 && known.every((r) => r === SEPA_REASON.INSUFFICIENT_FUNDS);
  return {
    sepaReasons: [...new Set(sepaReasons.filter((r) => r !== SEPA_REASON.UNKNOWN))],
    hasImmediateSepaReason,
    onlyInsufficientFunds,
  };
}

function shouldResiliateUnpaid(candidate = {}) {
  const unpaidCount = Number(candidate.unpaid_count || candidate.n || 0);
  const sepa = classifySepaFromCandidate(candidate);
  if (sepa.hasImmediateSepaReason) return { ok: true, why: 'sepa_immediate', ...sepa, unpaidCount };
  if (hasMissingContact(candidate)) {
    return { ok: true, why: 'missing_contact', ...sepa, unpaidCount };
  }
  if (unpaidCount >= INSUFFICIENT_FUNDS_CANCEL_AT) {
    return {
      ok: true,
      why: sepa.onlyInsufficientFunds ? 'am04_three_unpaid' : 'three_unpaid',
      ...sepa,
      unpaidCount,
    };
  }
  if (sepa.onlyInsufficientFunds) {
    return { ok: false, why: 'am04_wait_three', ...sepa, unpaidCount };
  }
  return { ok: false, why: 'need_sepa_detail_or_three', ...sepa, unpaidCount };
}

module.exports = {
  SEPA_REASON,
  INSUFFICIENT_FUNDS_CANCEL_AT,
  classifySepaRemark,
  classifySepaFromCandidate,
  isImmediateSepaReason,
  hasMemberContact,
  hasMissingContact,
  shouldResiliateUnpaid,
};
