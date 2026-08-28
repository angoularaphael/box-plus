#!/usr/bin/env node
'use strict';
/**
 * Répare Mathieu Aussenac (29 € sans badge) et Mehdi Haddoun (44,99 encore là, pas de 29).
 *   node scripts/fix-aussenac-haddoun.js
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig } = require('../lib/normalize');
const { classifyMemberContracts } = require('../lib/replace-existing-abo');
const { applyBillingPlanToProductConfig } = require('../lib/billing-plan');
const { isPendingOrFutureContract } = require('../bot/cancel-sale');

const TARGETS = [
  { match: /aussenac/i, product_id: 'dp-104', name: 'OFFRE A 29€' },
  { match: /haddoun/i, product_id: 'dp-104', name: 'OFFRE A 29€' },
];

function rowName(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  return `${cs.first_name || cf.first_name || ''} ${cs.last_name || cf.last_name || ''}`.replace(/\s+/g, ' ').trim();
}

async function loadTargets() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('boxplus_orders')
    .select('order_id, created_at, payload')
    .gte('created_at', '2026-08-01T00:00:00.000Z')
    .limit(800);
  if (error) throw error;
  const found = [];
  for (const spec of TARGETS) {
    const hits = (data || []).filter((r) => {
      const p = r.payload || {};
      const blob = `${rowName(p)} ${p.customer_short?.email || ''} ${p.customer_full?.email || ''}`;
      return spec.match.test(blob) && String(p.payment?.status || '').toLowerCase() === 'paid';
    });
    hits.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const r = hits[0];
    if (!r) {
      const fb =
        /aussenac/i.test(String(spec.match))
          ? {
              first_name: 'Mathieu',
              last_name: 'Aussenac',
              email: 'mathieuaussenac@gmail.com',
              gym: 'minimes',
            }
          : {
              first_name: 'Mehdi',
              last_name: 'Haddoun',
              birthdate: '1995-07-11',
              email: 'mehdihadd2@gmail.com',
              phone: '0771174621',
              gym: 'minimes',
            };
      found.push({
        spec,
        order_id: `FIX-${fb.last_name}`,
        name: `${fb.first_name} ${fb.last_name}`,
        email: fb.email || '',
        gym: fb.gym,
        amount: 29,
        member_id: null,
        source: null,
        aventure: /aussenac/i.test(fb.last_name),
        payload: { customer_short: fb, customer_full: fb },
      });
      continue;
    }
    const p = r.payload || {};
    found.push({
      spec,
      order_id: r.order_id,
      name: rowName(p),
      email: p.customer_short?.email || p.customer_full?.email,
      gym: p.customer_full?.gym || p.gym || 'minimes',
      amount: p.payment?.amount || 29,
      member_id: p.deciplus_member_id || (/aussenac/i.test(rowName(p)) ? '9545' : null),
      source: p.source,
      aventure: Boolean(p.aventure || p.skip_dossier || String(p.source || '').includes('balma')),
      payload: p,
    });
  }
  return found;
}

async function repairOne(page, catalog, target) {
  const { findMemberOnBoxingCenterGyms } = require('../bot/search-bc-gyms');
  const { openMemberCheck } = require('../bot/wallet');
  const { closeGreyboxIfOpen } = require('../bot/wallet');
  const { findActiveContracts } = require('../bot/cancel-sale');
  const { recordSale } = require('../bot/sale');
  const { resolveProductConfig, resolveBadgeProductConfig } = require('../bot/catalog');
  const {
    detectMemberGymConfig,
    CHANGE_MATCH_FIELDS,
    searchMember,
    searchMemberByName,
  } = require('../bot/member');

  const cs = target.payload?.customer_short || {};
  const cf = target.payload?.customer_full || {};
  let memberId = target.member_id;
  let gymConfig = getGymConfig(target.gym || 'minimes');
  const identity = {
    first_name: cs.first_name || cf.first_name,
    last_name: cs.last_name || cf.last_name,
    birthdate: cs.birthdate || cf.birthdate,
    phone: cs.phone || cf.phone,
    email: cs.email || cf.email || target.email,
  };
  if (!memberId) {
    // Aventure / commandes sans téléphone : nom + prénom + naissance (pas le tel).
    let match = await findMemberOnBoxingCenterGyms(page, identity, {
      preferredGym: target.gym,
      includeBalma: false,
      matchFields: CHANGE_MATCH_FIELDS,
    });
    if (!match.found && identity.email) {
      const byEmail = await searchMember(page, identity.email);
      if (byEmail.found) match = { ...byEmail, found: true };
    }
    if (!match.found && identity.last_name) {
      const byName = await searchMemberByName(page, identity.last_name, identity.first_name || '');
      if (byName.found) match = { ...byName, found: true };
    }
    if (!match.found) {
      throw new Error(
        `${target.name} introuvable Deciplus (${match.reason || 'not_found'} ${(match.mismatch_fields || []).join(',')})`
      );
    }
    memberId = match.member_id;
    if (match.gymConfig) gymConfig = match.gymConfig;
  }

  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig);
  const site = await detectMemberGymConfig(page, gymConfig).catch(() => null);
  if (site?.deciplus_label) gymConfig = site;

  const productConfig = applyBillingPlanToProductConfig(
    resolveProductConfig(
      {
        product_id: 'dp-104',
        product_name: 'OFFRE A 29€',
        payment: { status: 'paid', amount: target.amount || 29, billing_plan: 'rib' },
      },
      catalog
    ),
    { payment: { status: 'paid', amount: target.amount || 29, billing_plan: 'rib' } }
  );
  productConfig.auto_badge = true;
  const badgeProductConfig = resolveBadgeProductConfig(catalog, {
    badge_timing: 'deferred',
    badge_method: 'iban',
  });

  const before = await findActiveContracts(page).catch(() => []);
  const classified = classifyMemberContracts(before, productConfig, {
    isPendingOrFuture: isPendingOrFutureContract,
    skipCancel: false,
  });
  console.log(target.name, {
    member_id: memberId,
    gym: gymConfig.key,
    needsNewSale: classified.needsNewSale,
    needsBadge: classified.needsBadge,
    other: classified.otherActive.map((c) => String(c.label).slice(0, 70)),
    started29: classified.matchingStarted.map((c) => String(c.label).slice(0, 70)),
    badges: classified.badges.map((c) => String(c.label).slice(0, 70)),
  });

  const saleOrder = {
    order_id: target.order_id || `FIX-${memberId}`,
    product_id: 'dp-104',
    product_name: 'OFFRE A 29€',
    gym: gymConfig.key,
    source: target.source,
    aventure: target.aventure,
    payment: { status: 'paid', amount: target.amount || 29 },
  };
  const result = await recordSale(page, saleOrder, productConfig, memberId, gymConfig, {
    badgeProductConfig,
  });
  await closeGreyboxIfOpen(page).catch(() => {});
  await openMemberCheck(page, memberId, gymConfig).catch(() => {});
  const after = await findActiveContracts(page).catch(() => []);
  const check = classifyMemberContracts(after, productConfig, {
    isPendingOrFuture: isPendingOrFutureContract,
  });
  return { memberId, result, after: {
    needsNewSale: check.needsNewSale,
    needsBadge: check.needsBadge,
    other: check.otherActive.map((c) => String(c.label).slice(0, 70)),
    started29: check.matchingStarted.map((c) => String(c.label).slice(0, 70)),
    badges: check.badges.map((c) => String(c.label).slice(0, 70)),
  } };
}

async function main() {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const targets = await loadTargets();
  console.log(targets.map((t) => ({ name: t.name, order: t.order_id, gym: t.gym, aventure: t.aventure })));

  const { login } = require('../bot/auth');
  const { runWithSession, closeBrowser } = require('../bot/browser-pool');
  const { fetchDeciplusCatalog } = require('../bot/catalog');

  await runWithSession('fix-aussenac-haddoun', async (page) => {
    await login(page, { siteLabel: 'Minimes' });
    const catalog = await fetchDeciplusCatalog(page);
    for (const target of targets) {
      if (!target.order_id && !target.name) {
        console.error('Cible introuvable en commandes payées', target.spec.match);
        continue;
      }
      try {
        const out = await repairOne(page, catalog, target);
        console.log('REPAIRED', target.name, JSON.stringify(out, null, 2));
      } catch (err) {
        console.error('FAIL', target.name, err.message);
      }
    }
  });
  await closeBrowser().catch(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
