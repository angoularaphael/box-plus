'use strict';

const {
  SEPA_REASON,
  classifySepaFromCandidate,
  parseFrDate,
  formatFrDate,
  collectUnpaidTimes,
} = require('./sepa-unpaid-policy');

const GRACE_HOURS = Number(process.env.UNPAID_AM04_GRACE_HOURS || 72);

function addHoursToFrDate(frDateStr, hours = GRACE_HOURS) {
  const base = parseFrDate(frDateStr);
  if (!base) return { fr: '', ms: null };
  const end = new Date(base.getTime() + hours * 3600000);
  return { fr: formatFrDate(end), ms: end.getTime() };
}

function latestUnpaidFrDate(candidate = {}) {
  const times = collectUnpaidTimes(candidate);
  if (times.length) return formatFrDate(new Date(times[times.length - 1]));
  const dates = (candidate.dates || []).slice().sort();
  return dates[dates.length - 1] || '';
}

function pickPrimaryEid(candidate = {}) {
  const entries = candidate.entries || [];
  if (!entries.length) return candidate.primary_eid || null;
  const sorted = [...entries].sort((a, b) => {
    const ta = parseFrDate(a.date)?.getTime() || 0;
    const tb = parseFrDate(b.date)?.getTime() || 0;
    return tb - ta;
  });
  return sorted[0]?.eid || null;
}

/**
 * Politique ops 15h : AM04 -> une seule grace (+72 h) puis resiliation ;
 * tout autre motif SEPA -> resiliation immediate.
 */
function decideUnpaidDailyAction(candidate = {}, graceState = null, now = new Date()) {
  const sepa = classifySepaFromCandidate(candidate);
  const payload = {
    sepaReasons: sepa.sepaReasons,
    onlyInsufficientFunds: sepa.onlyInsufficientFunds,
    unpaidCount: Number(candidate.unpaid_count || candidate.n || 0),
  };

  if (!sepa.sepaReasons.length) {
    return { action: 'skip', why: 'awaiting_sepa_remark', ...payload };
  }

  const hasNonAm04 = sepa.sepaReasons.some(
    (r) => r !== SEPA_REASON.INSUFFICIENT_FUNDS && r !== SEPA_REASON.UNKNOWN
  );
  if (hasNonAm04 || (sepa.hasImmediateSepaReason && !sepa.onlyInsufficientFunds)) {
    return { action: 'resiliate', why: 'sepa_immediate', ...payload };
  }

  const failedDue = latestUnpaidFrDate(candidate);
  const eid = pickPrimaryEid(candidate);

  if (graceState?.reported_at) {
    const deadlineMs =
      Number(graceState.new_due_ms) ||
      addHoursToFrDate(graceState.failed_due || failedDue, GRACE_HOURS).ms;
    if (deadlineMs && now.getTime() >= deadlineMs) {
      return { action: 'resiliate', why: 'am04_grace_expired', ...payload, failedDue, eid };
    }
    return { action: 'skip', why: 'am04_in_grace', ...payload, failedDue, eid, graceState };
  }

  if (!failedDue || !eid) {
    return { action: 'skip', why: 'missing_due_or_eid', ...payload };
  }

  const grace = addHoursToFrDate(failedDue, GRACE_HOURS);
  return {
    action: 'grace',
    why: 'am04_first_grace',
    failedDue,
    newDue: grace.fr,
    newDueMs: grace.ms,
    eid,
    sendEmail: true,
    ...payload,
  };
}

module.exports = {
  GRACE_HOURS,
  addHoursToFrDate,
  latestUnpaidFrDate,
  pickPrimaryEid,
  decideUnpaidDailyAction,
};
