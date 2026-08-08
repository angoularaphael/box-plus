#!/usr/bin/env node
require('dotenv').config();
const { runWithSession } = require('../bot/browser-pool');
const { login } = require('../bot/auth');
const { openMemberCheck } = require('../bot/wallet');
const { fetchDeciplusCatalog, resolveBadgeProductConfig } = require('../bot/catalog');
const { openSaleFlow, togglePaiementComptantOff } = require('../bot/sale');
const { getGymConfig } = require('../lib/normalize');

(async () => {
  const memberId = process.argv[2] || '20926';
  await runWithSession('debug', async (page) => {
    await login(page);
    await openMemberCheck(page, memberId);
    const catalog = await fetchDeciplusCatalog(page);
    const badgeConfig = resolveBadgeProductConfig(catalog, {
      badge_timing: 'deferred',
      badge_method: 'iban',
    });
    await openSaleFlow(page, badgeConfig, getGymConfig('minimes'), 'carte');
    await togglePaiementComptantOff(page);
    await page.waitForTimeout(3000);

    let saleScope = [page, ...page.frames()].find((scope) => /nextgen\/vente/i.test(scope.url())) || page;
    const ctx = saleScope;
    const probe = await ctx.evaluate(() => {
      function deepText(node) {
        if (!node) return '';
        let text = node.innerText || node.textContent || '';
        if (node.shadowRoot) text += ` ${deepText(node.shadowRoot)}`;
        for (const child of node.children || []) text += ` ${deepText(child)}`;
        return text;
      }
      const text = deepText(document.body);
      return {
        url: location.href,
        len: text.length,
        hasConfig: /Configuration de Badge/i.test(text),
        hasComptant: /Paiement Comptant/i.test(text),
        hasValide: /Valide\s+du/i.test(text),
        idxConfig: text.search(/Configuration/i),
        snippet: text.slice(Math.max(0, text.search(/Configuration/i) - 20), text.search(/Configuration/i) + 120),
        inputs: Array.from(document.querySelectorAll('input'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((el) => ({
            value: el.value,
            placeholder: el.placeholder,
            type: el.type,
            outer: el.outerHTML.slice(0, 300),
            parent: el.parentElement?.parentElement?.innerText?.slice(0, 180) || '',
          })),
      };
    });

    const visibleCount = await ctx.getByText(/Configuration de Badge/i).count();
    let visibleAny = false;
    for (let i = 0; i < visibleCount; i += 1) {
      if (await ctx.getByText(/Configuration de Badge/i).nth(i).isVisible().catch(() => false)) {
        visibleAny = true;
        break;
      }
    }

    console.log(JSON.stringify({ probe, visibleCount, visibleAny }, null, 2));
    await page.screenshot({ path: 'data/logs/debug-badge-modal.png', fullPage: true });
  });
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
