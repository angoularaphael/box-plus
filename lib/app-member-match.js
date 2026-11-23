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

const DATE_FR = /(\d{2})\/(\d{2})\/(\d{4})/;

function frToIso(fr) {
  const m = String(fr || '').match(DATE_FR);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** « ETUDIANTS 36,99€/4 SEMAINES ... CONTRAT N°C2026-1 vendu le 23/11/2026 23/11/2026 24/10/2027 336 jours restants » */
function parseContractLabel(label = '') {
  const text = String(label).replace(/\s+/g, ' ').trim();
  const offre = text.split(/\s+CONTRAT\s+N/i)[0].replace(/\s+(EN ATTENTE|ACTIF)$/i, '').trim();
  const dates = text.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  const resil = text.match(/r[ée]sili[ée]e?\D{0,20}(\d{2}\/\d{2}\/\d{4})/i);
  return {
    offre: offre.slice(0, 120),
    fin: dates.length >= 3 ? frToIso(dates[2]) : null,
    resilie_le: resil ? frToIso(resil[1]) : /r[ée]sili/i.test(text) ? 'inconnue' : null,
    annule: /annul/i.test(text),
  };
}

function isoToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now);
}

/**
 * Resume des contrats lus sur la fiche (findActiveContracts, contrats inactifs compris).
 * Un contrat « Resilie depuis le X » reste un acces valable jusqu'a X : l'app doit le dire
 * (« resilie, acces jusqu'au X ») au lieu d'afficher « actif » ou « aucun abonnement ».
 */
function summarizeContracts(contracts = [], now = new Date()) {
  const today = isoToday(now);
  const rows = contracts.filter(Boolean);
  const memberships = rows.filter((c) => !c.isBadge && isMembershipLabel(c.label));
  const parsed = memberships.map((c) => ({ c, p: parseContractLabel(c.label) }));
  const live = parsed.filter(({ c, p }) => !p.annule && !p.resilie_le && !c.inactive);
  const current = live.filter(({ c }) => !/en attente/i.test(c.label));
  const pending = live.filter(({ c }) => /en attente/i.test(c.label));
  const resilies = parsed
    .filter(({ p }) => p.resilie_le)
    .sort((a, b) => String(b.p.resilie_le).localeCompare(String(a.p.resilie_le)));
  const resilie = current.length === 0 ? resilies[0] || null : null;
  const resilieDate = resilie && resilie.p.resilie_le !== 'inconnue' ? resilie.p.resilie_le : null;
  const accesEncore = Boolean(resilieDate && resilieDate >= today);
  const principal = current[0] || resilie || pending[0] || null;
  const badges = rows.filter((c) => c.isBadge);
  return {
    abonnement_actif: current.length > 0 || accesEncore,
    abonnement_en_attente: pending.length > 0,
    badge_enregistre: badges.some((c) => !c.inactive && !/r[ée]sili|annul/i.test(c.label)),
    contrats: rows
      .filter((c) => !c.inactive || /r[ée]sili/i.test(c.label))
      .map((c) => String(c.label || '').slice(0, 160))
      .slice(0, 8),
    offre: principal ? principal.p.offre : null,
    fin_contrat: principal ? (resilieDate || principal.p.fin) : null,
    resilie_le: resilie ? resilieDate : null,
  };
}

module.exports = { APP_MATCH_FIELDS, DECISION, decideAppLink, summarizeContracts, parseContractLabel };
