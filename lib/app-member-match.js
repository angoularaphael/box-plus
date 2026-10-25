'use strict';

/**
 * Rapprochement d'un compte de l'application mobile avec une fiche Deciplus.
 *
 * Regle validee par Raphael (23/10/2026) : la fiche est liee si l'e-mail
 * (verifie par l'app) et la date de naissance concordent, plus le telephone
 * ou le nom complet. Une fiche trouvee mais incomplete part en revue manuelle ;
 * aucune fiche = prospect. Un doute ne donne jamais acces a l'espace adherent.
 */

const APP_MATCH_FIELDS = ['email', 'birthdate', 'last_name', 'first_name', 'phone'];

const DECISION = {
  LINKED: 'lie',
  REVIEW: 'a_revoir',
  PROSPECT: 'prospect',
};

function decideAppLink(match = {}) {
  if (match.found && match.member_id) {
    return { decision: DECISION.LINKED, member_id: String(match.member_id), mismatch_fields: [] };
  }
  const mismatch = Array.isArray(match.mismatch_fields) ? match.mismatch_fields : [];
  if (!match.member_id) {
    return { decision: DECISION.PROSPECT, member_id: null, mismatch_fields: mismatch, reason: match.reason || 'not_found' };
  }
  const has = (f) => mismatch.includes(f);
  const coreOk = !has('email') && !has('birthdate');
  const nameOk = !has('last_name') && !has('first_name');
  const phoneOk = !has('phone');
  if (match.reason === 'identity_mismatch' && coreOk && (nameOk || phoneOk)) {
    return { decision: DECISION.LINKED, member_id: String(match.member_id), mismatch_fields: mismatch };
  }
  return {
    decision: DECISION.REVIEW,
    member_id: String(match.member_id),
    mismatch_fields: mismatch,
    reason: match.reason || 'identity_mismatch',
  };
}

function isMembershipLabel(label = '') {
  return !/\bbadge\b|essai|coaching|pr[ée]-?d[ée]compt/i.test(label);
}

/** Resume des contrats actifs lus sur la fiche (findActiveContracts). */
function summarizeContracts(contracts = []) {
  const rows = contracts.filter(Boolean);
  const memberships = rows.filter((c) => !c.isBadge && isMembershipLabel(c.label));
  const current = memberships.filter((c) => !/en attente/i.test(c.label));
  const pending = memberships.filter((c) => /en attente/i.test(c.label));
  return {
    abonnement_actif: current.length > 0,
    abonnement_en_attente: pending.length > 0,
    badge_enregistre: rows.some((c) => c.isBadge),
    contrats: rows.map((c) => String(c.label || '').slice(0, 160)).slice(0, 8),
  };
}

module.exports = { APP_MATCH_FIELDS, DECISION, decideAppLink, summarizeContracts };
