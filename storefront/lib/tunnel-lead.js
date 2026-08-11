/**
 * Écrit un lead marketing dans tunnel_leads (même Supabase que gestion-manager).
 */
'use strict';

const { getSupabase } = require('./supabase');
const { logInfo, logWarn } = require('../../lib/logger');

const ALLOWED = new Set(['offre_29', 'offre_259', 'seance_essai', 'referral_pote']);

function cleanText(v, max = 120) {
  return (
    String(v || '')
      .trim()
      .slice(0, max) || null
  );
}

function normalizeEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('33') && digits.length >= 11) return `0${digits.slice(-9)}`;
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  if (digits.length === 9 && /^[1-9]/.test(digits)) return `0${digits}`;
  return digits.length >= 8 ? digits : null;
}

function tunnelFromProductId(productId) {
  const id = String(productId || '').toLowerCase();
  if (id === 'offre-saison' || id === 'offre_259') return 'offre_259';
  if (id === 'offre-duo' || id === 'offre_29' || id === 'dp-104') return 'offre_29';
  if (id === 'seance-essai') return 'seance_essai';
  return null;
}

/**
 * @param {object} input
 * @returns {Promise<{ ok: boolean, lead_id?: string, error?: string, skipped?: boolean }>}
 */
async function insertTunnelLead(input = {}) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, error: 'supabase_not_configured' };
  }

  let tunnel = cleanText(input.tunnel, 40);
  if (!tunnel && input.product_id) tunnel = tunnelFromProductId(input.product_id);
  if (!tunnel || !ALLOWED.has(tunnel)) {
    return { ok: false, error: 'tunnel_invalide' };
  }

  const prenom = cleanText(input.prenom);
  const nom = cleanText(input.nom);
  const telephone = normalizePhone(input.telephone || input.phone);
  const email = normalizeEmail(input.email);
  const salle = cleanText(input.salle, 80);

  if (!prenom || !telephone) {
    return { ok: false, error: 'Prénom et téléphone requis' };
  }

  try {
    const sb = getSupabase();
    const isFriend = Boolean(input.is_friend_referral || input.friend || tunnel === 'referral_pote');
    const { data, error } = await sb
      .from('tunnel_leads')
      .insert({
        tunnel: isFriend && tunnel === 'offre_29' ? 'referral_pote' : tunnel,
        prenom,
        nom,
        telephone,
        email,
        salle,
        meta: {
          source: input.source || 'boxplus',
          product_id: input.product_id || null,
          order_id: input.order_id || null,
          is_friend_referral: isFriend,
          origin_tunnel: tunnel,
        },
      })
      .select('id')
      .single();

    if (error) {
      logWarn('tunnel_leads insert échoué', { tunnel, error: error.message });
      return { ok: false, error: error.message };
    }

    logInfo('Lead tunnel enregistré', { tunnel, lead_id: data.id, friend: isFriend });

    let portet = { synced: false };
    const wantPortet =
      input.sync_portet !== false &&
      (isFriend || tunnel === 'offre_29' || tunnel === 'offre_259' || tunnel === 'referral_pote');
    if (wantPortet) {
      const { upsertLeadClient } = require('./client-sync');
      portet = await upsertLeadClient({
        prenom,
        nom,
        telephone,
        email,
        salle,
        lead_id: data.id,
        offre: isFriend
          ? 'Parrainage — Offre 29 € (ami)'
          : tunnel === 'offre_259'
            ? 'Lead — Offre 259 €'
            : 'Lead — Offre 29 €',
        logLabel: isFriend ? 'ami-parrainage' : 'tunnel-lead',
      });
    }

    return { ok: true, lead_id: data.id, portet_synced: Boolean(portet.synced), portet };
  } catch (err) {
    logWarn('tunnel_leads exception', { error: err.message });
    return { ok: false, error: err.message };
  }
}

module.exports = {
  insertTunnelLead,
  tunnelFromProductId,
  ALLOWED,
};
