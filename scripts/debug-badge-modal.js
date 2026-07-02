#!/usr/bin/env node
require('dotenv').config();
const { runWithSession } = require('../bot/browser-pool');
const { login } = require('../bot/auth');
const { openMemberCheck } = require('../bot/wallet');

(async () => {
  const memberId = process.argv[2] || '20926';
  await runWithSession('debug', async (page) => {
    await login(page);
    await openMemberCheck(page, memberId);
    await page.getByText(/Achat Carte/i).first().click().catch(() => {});
    await page.waitForURL(/vente/, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const search = page.locator('input[placeholder*="Rechercher"]').first();
    await search.fill('Badge');
    await page.waitForTimeout(2000);
    await page.locator('.product-wrapper-title').filter({ hasText: /^Badge$/i }).first().click();
    await page.waitForTimeout(3000);

    const ctx = page;
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
