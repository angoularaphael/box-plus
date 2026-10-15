#!/usr/bin/env node
'use strict';
/**
 * Test visible : Reporter une echeance AM04 a J+72h sur une vraie fiche.
 *
 *   set DECIPLUS_HEADLESS=false
 *   set TEST_APPLY=1
 *   node scripts/test-am04-report-72h-visible.js
 *
 * Optionnel : MEMBER_ID=12345 (sinon premier AM04 eligible sans grace deja faite)
 */
require('dotenv').config();
process.env.DECIPLUS_FAST = '1';
process.env.DECIPLUS_HEADLESS = 'false';
process.env.DECIPLUS_BROWSER_CHANNEL = process.env.DECIPLUS_BROWSER_CHANNEL || 'chrome';
process.env.DECIPLUS_SLOW_MO = process.env.DECIPLUS_SLOW_MO || '250';
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const path = require('path');
const fs = require('fs');
const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

const { login, gotoDeciplus } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const {
  scrapeUnpaidMembers,
  resolveEcheanceFrame,
  openEcheancierPage,
  applyUnpaidDateFilter,
  openEcheanceDetail,
} = require('../lib/echeancier-unpaid');
const { decideUnpaidDailyAction, addHoursToFrDate } = require('../lib/unpaid-daily-policy');
const { classifySepaFromCandidate } = require('../lib/sepa-unpaid-policy');
const { reportUnpaidEcheance } = require('../bot/echeancier-report');
const { ROOT } = require('../lib/utils');
const { loadState, saveState } = require('../bot/unpaid-daily-ops');

const APPLY = String(process.env.TEST_APPLY || '') === '1';
const ONLY_MEMBER = String(process.env.MEMBER_ID || '').replace(/\D/g, '');
const SEARCH_NAME = String(process.env.SEARCH_NAME || 'DESIRE JUNIOR').trim();
const SEARCH_DATE = String(process.env.SEARCH_DATE || '07/10/2026').trim();

async function scrapeByNameOnDate(page, name, dateFr) {
  let frame = await openEcheancierPage(page);
  await frame.locator('input[name="datec1"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await frame.evaluate(
    ({ d, label }) => {
      const d1 = document.querySelector('input[name="datec1"]');
      const d2 = document.querySelector('input[name="datec2"]');
      const sel = document.querySelector('select[name="etat[]"]');
      if (d1) {
        d1.value = d;
        d1.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (d2) {
        d2.value = d;
        d2.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (sel) {
        [...sel.options].forEach((o) => {
          o.selected = o.value === 'I';
        });
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const parts = label.split(/\s+/).filter(Boolean);
      const jnom = document.querySelector('input[name="jnom"]');
      const jprenom = document.querySelector('input[name="jprenom"]');
      if (jnom && parts.length >= 2) jnom.value = parts[0];
      if (jprenom && parts.length >= 2) jprenom.value = parts.slice(1).join(' ');
    },
    { d: dateFr, label: name }
  );
  await frame.locator('#btFilter').first().click({ force: true });
  await frame.waitForTimeout(3500);
  frame = (await resolveEcheanceFrame(page, { needRows: true })) || frame;
  const fold = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const want = fold(name);
  const hit = await frame.evaluate((wantFold) => {
    let pending = null;
    for (const tr of [...document.querySelectorAll('table tr')]) {
      const oc = [...tr.querySelectorAll('a')].map((a) => a.getAttribute('onclick') || '').join(' ');
      const idm = (oc.match(/showFiche\(['"](\d+)['"]\)/) || [])[1] || '';
      const linkName = (
        [...tr.querySelectorAll('a')]
          .map((a) => String(a.textContent || '').replace(/\s+/g, ' ').trim())
          .find((t) => t && !/^(detail|rib|impaye|suspendu)$/i.test(t)) || ''
      ).trim();
      if (idm) pending = { idm, name: linkName };
      const etatEl = tr.querySelector('select[name^="etat_"]');
      if (!etatEl || etatEl.value !== 'I' || !pending) continue;
      const rowText = String(tr.innerText || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      if (!rowText.includes(wantFold)) continue;
      const eid = ((etatEl.name || '').match(/etat_(\d+)/) || [])[1] || '';
      const date = ((String(tr.innerText || '').match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '');
      const gym = ((String(tr.innerText || '').match(/BOXING CENTER ([A-Za-zÉé\- ]+?)(?:\s+Non|\s+Oui|$)/i) || [])[1] || '').trim();
      const reportOnclick = tr.querySelector('input[value="Reporter"]')?.getAttribute('onclick') || '';
      return {
        member: pending.idm,
        name: pending.name,
        gym,
        unpaid_count: 1,
        n: 1,
        dates: date ? [date] : [],
        entries: [{ eid, date, reportOnclick }],
        remarks: [],
      };
    }
    return null;
  }, want);
  if (!hit) return null;
  for (const row of hit.entries) {
    const remark = await openEcheanceDetail(frame, page, row.eid);
    if (remark) hit.remarks.push(remark);
  }
  return hit;
}

async function scrapeOneMemberUnpaid(page, memberId) {
  let frame = await openEcheancierPage(page);
  await applyUnpaidDateFilter(frame, '01/06/2026');
  frame = (await resolveEcheanceFrame(page, { needRows: true })) || frame;
  const target = String(memberId);
  for (let pageNo = 0; pageNo < 40; pageNo += 1) {
    const pack = await frame.evaluate((idm) => {
      const rows = [];
      let pending = null;
      for (const tr of [...document.querySelectorAll('table tr')]) {
        const oc = [...tr.querySelectorAll('a')].map((a) => a.getAttribute('onclick') || '').join(' ');
        const mid = (oc.match(/showFiche\(['"](\d+)['"]\)/) || [])[1] || '';
        const name = (
          [...tr.querySelectorAll('a')]
            .map((a) => String(a.textContent || '').replace(/\s+/g, ' ').trim())
            .find((t) => t && !/^(detail|rib|impaye|suspendu)$/i.test(t)) || ''
        ).trim();
        if (mid) pending = { idm: mid, name };
        const etatEl = tr.querySelector('select[name^="etat_"]');
        if (!etatEl || etatEl.value !== 'I' || !pending || pending.idm !== idm) continue;
        const eid = ((etatEl.name || '').match(/etat_(\d+)/) || [])[1] || '';
        const text = String(tr.innerText || '').replace(/\s+/g, ' ').trim();
        const gym = ((text.match(/BOXING CENTER ([A-Za-zÉé\- ]+?)(?:\s+Non|\s+Oui|$)/i) || [])[1] || '').trim();
        const date = ((text.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '');
        const reportOnclick = tr.querySelector('input[value="Reporter"]')?.getAttribute('onclick') || '';
        rows.push({ eid, idm: pending.idm, name: pending.name, gym, date, reportOnclick, raw: text.slice(0, 220) });
        pending = null;
      }
      return rows;
    }, target);
    if (pack.length) {
      const byMember = {
        member: target,
        name: pack[0].name,
        gym: pack[0].gym,
        unpaid_count: pack.length,
        n: pack.length,
        dates: [...new Set(pack.map((r) => r.date).filter(Boolean))],
        entries: pack.map((r) => ({ eid: r.eid, date: r.date, reportOnclick: r.reportOnclick })),
        remarks: [],
      };
      for (const row of pack) {
        const remark = await openEcheanceDetail(frame, page, row.eid);
        if (remark && !byMember.remarks.includes(remark)) byMember.remarks.push(remark);
      }
      return byMember;
    }
    const nextNum = String(pageNo + 2);
    const numbered = frame.locator('a').filter({ hasText: new RegExp(`^\\s*${nextNum}\\s*$`) }).first();
    if ((await numbered.count()) === 0) break;
    await numbered.click({ force: true });
    await page.waitForTimeout(2500);
    frame = (await resolveEcheanceFrame(page, { needRows: true })) || frame;
  }
  return null;
}

function loadGraceState() {
  const p = path.join(process.env.BOT_DATA_DIR || path.join(ROOT, 'data'), 'unpaid-daily-ops-state.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).am04_grace || {};
  } catch {
    return {};
  }
}

async function readRowForEid(frame, eid) {
  return frame.evaluate((targetEid) => {
    const sel = document.querySelector(`select[name="etat_${targetEid}"]`);
    if (!sel) return null;
    const row = sel.closest('tr');
    const text = String(row?.innerText || '').replace(/\s+/g, ' ').trim();
    const date = (text.match(/(\d{2}\/\d{2}\/\d{4})/g) || []).pop() || '';
    return { eid: targetEid, etat: sel.value, text: text.slice(0, 280), date };
  }, String(eid));
}

async function findRowOnEcheancier(page, eid) {
  let frame = await resolveEcheanceFrame(page);
  if (!frame) {
    frame = await openEcheancierPage(page);
  }
  return readRowForEid(frame, eid);
}

function pickCandidate(targets, graceState) {
  const out = [];
  for (const t of targets) {
    if (ONLY_MEMBER && String(t.member) !== ONLY_MEMBER) continue;
    const sepa = classifySepaFromCandidate(t);
    if (!sepa.onlyInsufficientFunds) continue;
    const decision = decideUnpaidDailyAction(t, graceState[String(t.member)] || null, new Date());
    if (decision.action !== 'grace') continue;
    out.push({ member: t, decision });
  }
  return out;
}

(async () => {
  const graceState = loadGraceState();
  console.log('Mode navigateur visible. TEST_APPLY=', APPLY ? 'OUI (Reporter reel)' : 'NON (dry)');
  console.log('Grace deja enregistree pour', Object.keys(graceState).length, 'membres');

  await runWithSession('test-am04-72h-visible', async (page) => {
    await gotoDeciplus(page, 'nextgen/home').catch(() => {});
    await login(page, { siteLabel: process.env.DECIPLUS_DEFAULT_SITE || 'Minimes' });
    let t = null;
    let decision = null;
    if (SEARCH_NAME) {
      console.log('Recherche', SEARCH_NAME, 'date', SEARCH_DATE);
      t = await scrapeByNameOnDate(page, SEARCH_NAME, SEARCH_DATE);
    }
    if (!t && ONLY_MEMBER) {
      console.log('Recherche membre #' + ONLY_MEMBER);
      t = await scrapeOneMemberUnpaid(page, ONLY_MEMBER);
    }
    if (t) {
      decision = decideUnpaidDailyAction(t, graceState[String(t.member)] || null, new Date());
    } else if (!ONLY_MEMBER && !SEARCH_NAME) {
      console.log('Connecte. Scan impayes (detail SEPA)...');
      const targets = await scrapeUnpaidMembers(page, { fetchRemarks: true });
      const candidates = pickCandidate(targets, graceState);
      if (!candidates.length) {
        console.log('Aucun candidat AM04 sans grace.');
        await page.waitForTimeout(20000);
        return;
      }
      t = candidates[0].member;
      decision = candidates[0].decision;
    } else if (!t) {
      console.log('Introuvable. Ajustez SEARCH_NAME / SEARCH_DATE / MEMBER_ID.');
      await page.waitForTimeout(30000);
      return;
    }

    if (!decision || decision.action !== 'grace') {
      console.log('Decision', decision.action, decision.why, '— pas de test Reporter (deja en grace ou autre motif)');
      await page.waitForTimeout(60000);
      return;
    }
    const entry = (t.entries || []).find((x) => String(x.eid) === String(decision.eid)) || t.entries?.[0] || {};
    console.log('\n--- Cible ---');
    console.log('Membre', t.member, t.name, '|', t.gym);
    console.log('EID', decision.eid, '| echeance ratee', decision.failedDue, '| nouvelle date (+72h)', decision.newDue);
    console.log('Attendu addHours', addHoursToFrDate(decision.failedDue).fr);

    const before = await findRowOnEcheancier(page, decision.eid);
    console.log('\n--- Avant ---', JSON.stringify(before, null, 2));

    if (!APPLY) {
      console.log('\nDry run : pas de clic Reporter. Relancez avec TEST_APPLY=1');
      await page.waitForTimeout(60000);
      return;
    }

    console.log('\n--- Reporter (modal visible) ---');
    const rep = await reportUnpaidEcheance(page, {
      eid: decision.eid,
      newDueFr: decision.newDue,
      reportOnclick: entry.reportOnclick,
    });
    console.log('Resultat report', rep);
    if (rep.ok) {
      const st = loadState();
      st.am04_grace[String(t.member)] = {
        eid: decision.eid,
        failed_due: decision.failedDue,
        new_due: decision.newDue,
        new_due_ms: decision.newDueMs,
        reported_at: new Date().toISOString(),
        source: 'test-am04-report-72h-visible',
      };
      saveState(st);
      console.log('Etat grace enregistre pour membre', t.member);
    }

    await page.waitForTimeout(3000);
    let frame = await resolveEcheanceFrame(page);
    if (!frame) frame = await openEcheancierPage(page);
    const detailAfter = await openEcheanceDetail(frame, page, decision.eid);
    const detailPayDate = (detailAfter.match(/Date Paiement\s*:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1] || '';
    const after = await findRowOnEcheancier(page, decision.eid);
    console.log('\n--- Apres ---', JSON.stringify(after, null, 2));
    console.log('Detail Date Paiement', detailPayDate);

    const okDate =
      detailPayDate === decision.newDue ||
      after?.date === decision.newDue ||
      (after?.text && after.text.includes(decision.newDue));
    console.log('\n--- Verdict ---');
    console.log('Date attendue', decision.newDue, '| lue', after?.date, '| OK=', okDate);

    console.log('\nFenetre laissee ouverte 90s pour controle visuel...');
    await page.waitForTimeout(90000);
  });

  await closeBrowser().catch(() => {});
})().catch(async (e) => {
  console.error(e);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
