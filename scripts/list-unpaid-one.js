#!/usr/bin/env node
'use strict';
require('dotenv').config();
process.env.DECIPLUS_FAST = '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.TEMP = process.env.TEMP || 'D:\\tmp-playwright';
delete process.env.BOXPLUS_BOT_URL;
const fs = require('fs');
const path = require('path');
const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');

const FROM = process.env.UNPAID_FROM || '01/06/2026';
const TO = process.env.UNPAID_TO || '';
const OUT = path.join(__dirname, '..', 'data', `unpaid-one-${Date.now()}.json`);

function isJunkName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (/^(encaisse|impaye|suspendu|detail|etat)$/i.test(n)) return true;
  if (/^BOX\d+\s+Test$/i.test(n)) return true;
  return n.length < 3;
}

(async () => {
  await runWithSession('list-unpaid-one', async (page) => {
    await login(page, { siteLabel: 'Minimes' });
    const origin = new URL(page.url()).origin;
    await page.goto(`${origin}/nextgen/legacy?path=${encodeURIComponent('/presta_echeance.php')}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(2500);
    let frame =
      page.frames().find((f) => /presta_echeance\.php\?_vue_iframe/i.test(f.url())) ||
      page.frames().find((f) => /presta_echeance\.php/i.test(f.url()) && !/legacy/i.test(f.url()));
    if (!frame) throw new Error('iframe échéances introuvable');

    await frame.evaluate((from) => {
      const d1 = document.querySelector('input[name="datec1"]');
      const d2 = document.querySelector('input[name="datec2"]');
      const sel = document.querySelector('select[name="etat[]"]');
      if (d1) {
        d1.value = from;
        d1.dispatchEvent(new Event('input', { bubbles: true }));
        d1.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (d2) d2.value = '';
      if (sel) {
        [...sel.options].forEach((o) => {
          o.selected = o.value === 'I';
        });
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, FROM);
    await Promise.all([
      frame.waitForLoadState('domcontentloaded').catch(() => {}),
      frame.locator('#btFilter').click({ force: true }),
    ]);
    await frame.waitForTimeout(3500);
    frame =
      page.frames().find((f) => /presta_echeance\.php\?_vue_iframe/i.test(f.url())) || frame;
    console.log('FRAME', frame.url());

    const all = [];
    let emptyStreak = 0;
    let lastSignature = '';
    for (let pageNo = 0; pageNo < 80; pageNo += 1) {
      const pack = await frame.evaluate(() => {
        const rows = [];
        for (const tr of document.querySelectorAll('table tr')) {
          const etatEl = tr.querySelector('select[name^="etat_"]');
          if (!etatEl || etatEl.value !== 'I') continue;
          const text = String(tr.innerText || '').replace(/\s+/g, ' ').trim();
          const href = ((tr.querySelector('a[href*="idm="], a[href*="membre"]') || {}).href || '');
          const idm = ((href.match(/idm=(\d+)/i) || [])[1] || '');
          const date = (text.match(/\d{2}\/\d{2}\/\d{4}/) || [])[0] || null;
          const gym = ((text.match(/BOXING CENTER ([A-Za-zÉé\- ]+?)(?:\s+Non|\s+Oui|$)/i) || [])[1] || '').trim();
          const name = (
            (text.match(
              /^\d{2}\/\d{2}\/\d{4}\s+(.+?)\s+(OFFRE|Badge|Etudiants|44,?99|259|Abo|COMPTANT|ENFANTS|BABY|BOXE|Sans engagement)/i
            ) || [])[1] || ''
          ).trim();
          const product = (
            (text.match(
              /(OFFRE(?:\s+(?:PROMO|DUO|A))?[^\d]*\d[\d.,]*€?|Badge(?:\s+[\d.]+)?|Etudiants[^\d]*\d[\d.,]*€[^\s]*|44,?99€[^P]*|Abonnement[^P]{0,60}|COMPTANT[^P]{0,40}|259€[^P]{0,30})/i
            ) || [])[0] || ''
          )
            .replace(/\s+Prélèvement.*$/i, '')
            .trim();
          rows.push({
            date,
            name,
            gym,
            product,
            idm,
            raw: text.slice(0, 220),
          });
        }
        const pagers = [...document.querySelectorAll('a')]
          .map((a) => String(a.textContent || '').trim())
          .filter((t) => /^(\d+|>|>>|suivant)$/i.test(t));
        return { rows, pagers, datec1: (document.querySelector('input[name="datec1"]') || {}).value };
      });
      const hits = pack.rows.filter((r) => r.name && !isJunkName(r.name) && !/balma/i.test(r.gym) && !/balma/i.test(r.raw));
      const signature = hits.map((h) => `${h.date}|${h.name}|${h.idm}`).join(';');
      if (signature && signature === lastSignature) {
        console.log('page', pageNo + 1, 'identique — stop');
        break;
      }
      lastSignature = signature;
      all.push(...hits);
      console.log('page', pageNo + 1, 'hits', hits.length, 'total', all.length, 'datec1', pack.datec1, 'pagers', pack.pagers.slice(0, 12).join(','));
      if (hits.length === 0) {
        emptyStreak += 1;
        if (emptyStreak >= 2) break;
      } else emptyStreak = 0;

      const nextNum = String(pageNo + 2);
      const numbered = frame.locator('a').filter({ hasText: new RegExp(`^\\s*${nextNum}\\s*$`) }).first();
      const next = frame.locator('a').filter({ hasText: /^\s*>\s*$|^suivant$/i }).first();
      if ((await numbered.count()) > 0) {
        await Promise.all([
          frame.waitForLoadState('domcontentloaded').catch(() => {}),
          numbered.click({ force: true }),
        ]);
        await frame.waitForTimeout(1200);
        frame =
          page.frames().find((f) => /presta_echeance\.php\?_vue_iframe/i.test(f.url())) || frame;
        continue;
      }
      if ((await next.count()) > 0 && (await next.isVisible().catch(() => false))) {
        await Promise.all([
          frame.waitForLoadState('domcontentloaded').catch(() => {}),
          next.click({ force: true }),
        ]);
        await frame.waitForTimeout(1200);
        frame =
          page.frames().find((f) => /presta_echeance\.php\?_vue_iframe/i.test(f.url())) || frame;
        continue;
      }
      break;
    }

    const byKey = {};
    for (const r of all) {
      const key = r.idm ? `idm:${r.idm}` : `name:${String(r.name).toLowerCase()}`;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(r);
    }
    const one = [];
    const more = [];
    for (const lines of Object.values(byKey)) {
      const row = {
        name: lines[0].name,
        idm: lines[0].idm || null,
        n: lines.length,
        gym: lines[0].gym,
        product: lines[0].product,
        dates: lines.map((l) => l.date),
        sample: lines[0].raw,
      };
      if (lines.length === 1) one.push(row);
      else more.push(row);
    }
    one.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    more.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'fr'));
    const report = {
      at: new Date().toISOString(),
      from: FROM,
      to: TO || null,
      total_rows: all.length,
      people: Object.keys(byKey).length,
      one,
      more: more.map((m) => ({
        name: m.name,
        idm: m.idm,
        n: m.n,
        gym: m.gym,
        dates: m.dates,
      })),
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log('écrit', OUT);
    console.log('total', all.length, 'personnes 1 impayé', one.length, 'plusieurs', more.length);
    for (const x of one) {
      console.log('ONE', x.name, '|', x.gym, '|', x.dates[0], '|', x.product, x.idm ? `| #${x.idm}` : '');
    }
  });
  await closeBrowser().catch(() => {});
})().catch(async (e) => {
  console.error(e);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
