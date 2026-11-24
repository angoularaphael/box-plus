'use strict';

/**
 * Lien « Régulariser » envoyé au membre quand un prélèvement n'est pas passé.
 *
 * Le jeton est signé (HMAC SYNC_SECRET, le même secret que la boutique) et porte tout ce que la
 * page /regulariser doit savoir : la fiche, l'échéance précise (idpe Deciplus), le montant, la date
 * du prélèvement refusé et la situation du membre :
 *  - `grace`   : nouvelle présentation prévue le `r` ; payer avant évite la nouvelle présentation.
 *  - `resilie` : contrat déjà résilié ; payer solde l'échéance restée impayée.
 */

const crypto = require('crypto');
const { getStoreUrl } = require('./app-urls');

const KINDS = new Set(['grace', 'resilie', 'demande']);
const RESILIE_LINK_DAYS = 30;

function paySecret() {
  return String(process.env.SYNC_SECRET || process.env.ECHEANCIER_PAY_SECRET || '').trim();
}

function signPayToken(payload) {
  const secret = paySecret();
  if (!secret) throw new Error('SYNC_SECRET manquant pour le lien de paiement');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function storeBase() {
  return String(process.env.BOXPLUS_STORE_URL || process.env.STORE_URL || getStoreUrl()).replace(/\/$/, '');
}

/** Fin de journée (Paris approx.) de la date JJ/MM/AAAA, en secondes. */
function endOfFrDaySec(fr) {
  const m = String(fr || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return 0;
  const ms = Date.parse(`${m[3]}-${m[2]}-${m[1]}T22:59:59Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/**
 * @param {object} f
 * @param {string} f.member_id   fiche Deciplus
 * @param {string} f.eid         échéance Deciplus (idpe) à encaisser
 * @param {number} f.amount_cents
 * @param {'grace'|'resilie'} f.kind
 * @param {string} [f.failed_due] date du prélèvement refusé, JJ/MM/AAAA
 * @param {string} [f.new_due]    nouvelle présentation (grace), JJ/MM/AAAA
 */
function buildPayUrl(f = {}, now = Date.now()) {
  const kind = KINDS.has(f.kind) ? f.kind : 'grace';
  const amount = Math.round(Number(f.amount_cents) || 0);
  if (!f.member_id || !f.eid || amount <= 0) return null;
  // En grace, le lien vaut jusqu'à la veille de la nouvelle présentation : après, la banque repasse.
  // Passé ce délai, plus de lien : payer en plus d'une nouvelle présentation réussie ferait payer deux fois.
  let exp = Math.floor(now / 1000) + RESILIE_LINK_DAYS * 24 * 3600;
  if (kind === 'grace') {
    exp = endOfFrDaySec(f.new_due) - 24 * 3600;
    if (exp <= now / 1000) return null;
  }
  const token = signPayToken({
    m: String(f.member_id),
    i: String(f.eid),
    e: String(f.email || ''),
    p: String(f.prenom || ''),
    n: String(f.nom || ''),
    a: amount,
    g: String(f.gym || 'minimes'),
    o: String(f.product || '').slice(0, 60),
    d: String(f.failed_due || ''),
    r: kind === 'grace' ? String(f.new_due || '') : '',
    k: kind,
    x: exp,
  });
  return `${storeBase()}/regulariser?t=${encodeURIComponent(token)}`;
}

module.exports = { buildPayUrl, signPayToken, endOfFrDaySec };
