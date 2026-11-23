'use strict';

/**
 * Job `app_member_lookup` : rapprochement d'un compte de l'application mobile
 * Boxing Center avec sa fiche Deciplus, puis lecture de l'etat de la fiche
 * (abonnement actif, badge enregistre). Lecture seule : rien n'est ecrit dans
 * Deciplus. Le resultat part, signe, vers le serveur de l'app
 * (`status_callback_base`), jamais vers la boutique.
 */

const crypto = require('crypto');
const { logInfo, logWarn } = require('../lib/logger');
const { STATUS } = require('../lib/queue');
const { APP_MATCH_FIELDS, DECISION, decideAppLink, summarizeContracts } = require('../lib/app-member-match');
const { matchGymSlug, resolveSearchGymSlug } = require('../lib/gym-slugs');
const { findMemberOnBoxingCenterGyms } = require('./search-bc-gyms');
const { openMemberCheck } = require('./wallet');
const { findActiveContracts } = require('./cancel-sale');

const CALLBACK_PATH = '/internal/app-member-status';

function signBody(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

async function postAppStatus(order, payload) {
  const base = String(order.status_callback_base || '').replace(/\/$/, '');
  const secret = process.env.APP_BRIDGE_SECRET || '';
  if (!base || !secret) {
    logWarn('Rappel app non envoye : APP_BRIDGE_SECRET ou status_callback_base absent', { order_id: order.order_id });
    return false;
  }
  const body = JSON.stringify(payload);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const res = await fetch(`${base}${CALLBACK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bc-timestamp': timestamp,
          'x-bc-signature': signBody(secret, timestamp, body),
        },
        body,
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return true;
      logWarn('Rappel app refuse', { order_id: order.order_id, status: res.status, attempt });
      if (res.status >= 400 && res.status < 500) return false;
    } catch (err) {
      logWarn('Rappel app echoue', { order_id: order.order_id, error: err.message, attempt });
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  return false;
}

/**
 * Le club inscrit sur la fiche (« Client BOXING CENTER Etats-Unis »), pas celui ou la recherche
 * a tourne : la recherche Deciplus couvre tout le reseau, depuis le site par defaut.
 */
async function readFicheClub(page) {
  for (const ctx of [page, ...(page.frames?.() || [])]) {
    const label = await ctx
      .evaluate(() => {
        const t = String(document.body?.innerText || '');
        const m = t.match(/Client\s*\)?\s*(BOXING CENTER\s+[A-Za-zÀ-ÿ' -]{2,30})/i);
        return m ? m[1].trim() : '';
      })
      .catch(() => '');
    const slug = label ? matchGymSlug(label) : null;
    if (slug) return slug;
  }
  return null;
}

/**
 * « Derniere entree au club » de la fiche (champ JJ/MM/AAAA a cote de « Cree le »), en AAAA-MM-JJ.
 * C'est la seule trace d'un vrai passage au lecteur : vide = aucune entree connue.
 */
async function readDerniereEntree(page) {
  for (const ctx of [page, ...(page.frames?.() || [])]) {
    const value = await ctx
      .evaluate(() => {
        const span = [...document.querySelectorAll('span.infojoueur')].find((el) => /Derni.re entr/i.test(el.textContent || ''));
        return span?.querySelector('input')?.value || '';
      })
      .catch(() => '');
    const m = String(value).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

async function processAppMemberLookupJob(page, order) {
  const identity = {
    first_name: order.customer?.first_name,
    last_name: order.customer?.last_name,
    birthdate: order.customer?.birthdate,
    phone: order.customer?.phone,
    email: order.customer?.email,
  };

  // Fiche deja liee (validation dans l'admin, ou relecture) : pas de nouvelle recherche
  const match = order.deciplus_member_id
    ? { found: true, member_id: order.deciplus_member_id, gym: order.gym || null }
    : await findMemberOnBoxingCenterGyms(page, identity, {
        matchFields: APP_MATCH_FIELDS,
        preferredGym: resolveSearchGymSlug(order.gym || 'minimes'),
        allowBalmaLookup: false,
        keepCandidate: true,
      });
  const link = decideAppLink(match);

  let fiche = null;
  if (link.decision === DECISION.LINKED) {
    await openMemberCheck(page, link.member_id);
    const contracts = await findActiveContracts(page).catch(() => []);
    const clubFiche = await readFicheClub(page).catch(() => null);
    const derniereEntree = await readDerniereEntree(page).catch(() => null);
    fiche = { ...summarizeContracts(contracts), club: clubFiche || match.gym || null, derniere_entree: derniereEntree };
  }

  const payload = {
    order_id: order.order_id,
    decision: link.decision,
    deciplus_member_id: link.member_id,
    mismatch_fields: link.mismatch_fields,
    reason: link.reason || null,
    fiche,
    read_at: new Date().toISOString(),
  };
  const delivered = await postAppStatus(order, payload);
  logInfo('Rapprochement app traite', {
    order_id: order.order_id,
    decision: link.decision,
    member_id: link.member_id,
    delivered,
  });

  return {
    status: link.decision === DECISION.REVIEW ? STATUS.MANUAL_REVIEW : STATUS.SUCCESS,
    action: 'app_member_lookup',
    deciplus_member_id: link.member_id,
    decision: link.decision,
    callback_delivered: delivered,
  };
}

module.exports = { processAppMemberLookupJob, signBody, CALLBACK_PATH, readDerniereEntree };
