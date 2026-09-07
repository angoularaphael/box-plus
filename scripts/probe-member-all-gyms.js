#!/usr/bin/env node
'use strict';
/**
 * Localise une fiche Deciplus sur toutes les salles BC.
 *   node scripts/probe-member-all-gyms.js 14370
 *   node scripts/probe-member-all-gyms.js --email=cyrildemaria9@gmail.com
 */
require('dotenv').config();
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { switchDeciplusSite } = require('../bot/deciplus-zone');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const { searchMember, detectMemberGymConfig } = require('../bot/member');
const { findActiveContracts, isPendingOrFutureContract } = require('../bot/cancel-sale');
const { getGymConfig } = require('../lib/normalize');
const { existingSiteConfig } = require('../lib/deciplus-sites');

const MEMBER_ID = (process.argv.find((a) => /^\d+$/.test(a)) || '').trim();
const EMAIL = (process.argv.find((a) => a.startsWith('--email=')) || '').slice(8).trim();

const SITES = [
  'Minimes',
  'Balma',
  'Etats-Unis',
  'St-Cyprien',
  'Portet',
  'Ramonville',
];

function slim(c) {
  return {
    idc: c.idc,
    badge: Boolean(c.isBadge),
    pending: !c.isBadge && isPendingOrFutureContract(c.label),
    label: String(c.label || '').replace(/\s+/g, ' ').slice(0, 160),
  };
}

(async () => {
  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  const hits = [];
  await runWithSession('probe-member-all-gyms', async (page) => {
    for (const site of SITES) {
      try {
        await login(page, { siteLabel: site });
        break;
      } catch {
        /* next */
      }
    }

    for (const site of SITES) {
      await closeGreyboxIfOpen(page).catch(() => {});
      const switched = await switchDeciplusSite(page, site).catch(() => false);
      if (!switched) continue;
      let memberId = MEMBER_ID;
      if (!memberId && EMAIL) {
        const found = await searchMember(page, EMAIL).catch(() => null);
        if (found?.found && found.member_id) memberId = String(found.member_id);
      }
      if (!memberId) continue;
      const gymCfg =
        site === 'Etats-Unis'
          ? existingSiteConfig(getGymConfig('etats-unis')) || getGymConfig('etats-unis')
          : getGymConfig(
              {
                Minimes: 'minimes',
                Balma: 'balma',
                'St-Cyprien': 'st-cyprien',
                Portet: 'portet',
                Ramonville: 'ramonville',
              }[site] || 'minimes'
            );
      await openMemberCheck(page, memberId, gymCfg).catch(() => {});
      await page.waitForTimeout(800);
      const body = ((await page.locator('body').innerText().catch(() => '')) || '').slice(0, 500);
      const looksOpen = /Achat Abonnement|fiche membre|Coordonnées/i.test(body);
      if (!looksOpen) continue;
      const live = await detectMemberGymConfig(page, gymCfg).catch(() => null);
      const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
      hits.push({
        site,
        member_id: memberId,
        zone: live?.deciplus_zone_id || null,
        label: live?.deciplus_label || null,
        contracts: contracts.map(slim),
        abo: contracts.filter((c) => !c.isBadge).length,
        pending: contracts.filter((c) => !c.isBadge && isPendingOrFutureContract(c.label)).length,
        badges: contracts.filter((c) => c.isBadge).length,
      });
    }
  });

  await closeBrowser().catch(() => {});
  console.log(JSON.stringify({ member_id: MEMBER_ID || null, email: EMAIL || null, hits }, null, 2));
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
