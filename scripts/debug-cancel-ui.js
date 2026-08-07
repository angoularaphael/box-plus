#!/usr/bin/env node
require('dotenv').config();
const path = require('path');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { openMemberCheck } = require('../bot/wallet');
const { findActiveContractBlocks } = require('../bot/cancel-sale');

(async () => {
  await runWithSession('dbg2', async (page) => {
    await login(page, { siteLabel: 'Minimes' });
    await openMemberCheck(page, '21080');
    await page.waitForTimeout(2000);
    const blocks = await findActiveContractBlocks(page);
    let target = blocks[0];
    for (const b of blocks) {
      const t =
        ((await b.wrapper?.innerText?.().catch(() => '')) ||
          (await b.item.innerText().catch(() => '')) ||
          '').replace(/\s+/g, ' ');
      console.log('LABEL', t.slice(0, 140));
      if (!/badge/i.test(t) && /abo|4\s*sem|44/i.test(t)) target = b;
    }
    await target.item.click({ force: true });
    await page.waitForTimeout(500);
    await target.consulter.click({ force: true });
    await page.waitForTimeout(3500);
    console.log('url', page.url());

    const info = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        const al = el.getAttribute('aria-label') || '';
        const ti = el.getAttribute('title') || '';
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const blob = `${al} ${ti} ${txt}`;
        if (/annul|résil|resil|Action souhait/i.test(blob)) {
          out.push({
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 80),
            al,
            ti,
            txt,
          });
        }
      }
      return out.slice(0, 60);
    });
    console.log(JSON.stringify(info, null, 2));

    // Try frames too
    for (const frame of page.frames()) {
      try {
        const fInfo = await frame.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('[aria-label], [title], button, a, [role="button"]')) {
            const al = el.getAttribute('aria-label') || '';
            const ti = el.getAttribute('title') || '';
            const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
            if (/annul|résil|resil/i.test(`${al} ${ti} ${txt}`)) {
              out.push({ al, ti, txt, tag: el.tagName });
            }
          }
          return out;
        });
        if (fInfo.length) console.log('frame', frame.url(), fInfo);
      } catch {
        /* ignore */
      }
    }

    await page.screenshot({
      path: path.join('data', 'logs', 'cancel-debug-21080.png'),
      fullPage: true,
    });
  });
  await closeBrowser();
})().catch(async (e) => {
  console.error(e);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
