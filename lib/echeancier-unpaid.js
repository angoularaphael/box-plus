'use strict';

const { classifySepaFromCandidate } = require('./sepa-unpaid-policy');
const { formatFrDate } = require('./sepa-unpaid-policy');
const { logWarn } = require('./logger');

const SKIP_RESILIATE_NAMES = [
  /etogo/i,
  /kavocop/i,
];

function skipResiliateName(name) {
  const n = String(name || '');
  return SKIP_RESILIATE_NAMES.some((re) => re.test(n));
}

function unpaidFilterStartDate(now = new Date()) {
  const d = new Date(now.getTime() - 180 * 86400000);
  return formatFrDate(d);
}

async function readEcheanceDetailModal(page) {
  for (const ctx of [page, ...(page.frames?.() || [])]) {
    const text = await ctx
      .evaluate(() => {
        const nodes = [...document.querySelectorAll('div, table, form, section, .modal')];
        const hit = nodes.find((el) => {
          const t = String(el.innerText || '');
          return (
            /D[ée]tail de l['’]éch[ée]ance/i.test(t) &&
            /Remarques|Status|Id SEPA/i.test(t) &&
            t.length < 5000
          );
        });
        return hit ? String(hit.innerText || '') : '';
      })
      .catch(() => '');
    if (text) return text;
  }
  return '';
}

async function closeEcheanceDetailModal(page) {
  for (const ctx of [page, ...(page.frames?.() || [])]) {
    const ok = ctx.getByRole('button', { name: /^OK$/i }).first();
    if ((await ok.count()) > 0 && (await ok.isVisible().catch(() => false))) {
      await ok.click({ force: true }).catch(() => {});
      await page.waitForTimeout(250);
      return;
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function openEcheanceDetail(frame, page, eid) {
  const etat = frame.locator(`select[name="etat_${eid}"]`).first();
  if ((await etat.count()) === 0) return '';
  const row = etat.locator('xpath=ancestor::tr[1]');
  const link = row.locator('a, button').filter({ hasText: /d[ée]tail/i }).first();
  if ((await link.count()) === 0) return '';
  await link.click({ force: true }).catch(() => {});
  await page.waitForTimeout(700);
  const text = await readEcheanceDetailModal(page);
  await closeEcheanceDetailModal(page);
  return text;
}

async function resolveEcheanceFrame(page, { needRows = false } = {}) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const frames = page
      .frames()
      .filter((f) => /presta_echeance\.php/i.test(f.url()) && !/legacy/i.test(f.url()));
    for (const f of frames) {
      const meta = await f
        .evaluate(() => ({
          d1: (document.querySelector('input[name="datec1"]') || {}).value || '',
          tr: document.querySelectorAll('table tr').length,
        }))
        .catch(() => null);
      if (!meta) continue;
      if (needRows && meta.tr < 5) continue;
      if (meta.d1 || meta.tr > 0) return f;
    }
    await page.waitForTimeout(400);
  }
  return (
    page.frames().find((f) => /presta_echeance\.php\?_vue_iframe/i.test(f.url())) ||
    page.frames().find((f) => /presta_echeance\.php/i.test(f.url()) && !/legacy/i.test(f.url())) ||
    null
  );
}

async function findEcheanceContext(page) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const frame = await resolveEcheanceFrame(page);
    if (frame) {
      const ready = await frame
        .locator('input[name="datec1"], #btFilter')
        .first()
        .isVisible()
        .catch(() => false);
      if (ready) return frame;
    }
    const hasForm = await page.locator('input[name="datec1"], #btFilter').count();
    if (hasForm > 0) return page;
    await page.waitForTimeout(500);
  }
  return null;
}

async function openEcheancierPage(page) {
  const origin = new URL(page.url()).origin;
  const paths = [
    'nextgen/legacy?path=' + encodeURIComponent('/presta_echeance.php'),
    'nextgen/presta_echeance.php',
    'nextgen/manager/payments-schedules',
  ];
  for (const rel of paths) {
    await page
      .goto(`${origin}/${rel}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(() => {});
    const ctx = await findEcheanceContext(page);
    if (ctx) return ctx;
  }
  const frames = page.frames().map((f) => f.url()).slice(0, 8);
  throw new Error(`iframe echeances introuvable url=${page.url()} frames=${frames.join(' | ')}`);
}

async function applyUnpaidDateFilter(frame, startFr) {
  const d1 = startFr || unpaidFilterStartDate();
  await frame.locator('input[name="datec1"]').first().waitFor({ state: 'visible', timeout: 15000 });
  await frame.evaluate((start) => {
    const d1El = document.querySelector('input[name="datec1"]');
    const d2 = document.querySelector('input[name="datec2"]');
    const sel = document.querySelector('select[name="etat[]"]');
    if (d1El) {
      d1El.value = start;
      d1El.dispatchEvent(new Event('input', { bubbles: true }));
      d1El.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (d2) {
      d2.value = '';
      d2.dispatchEvent(new Event('input', { bubbles: true }));
      d2.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (sel) {
      [...sel.options].forEach((o) => {
        o.selected = o.value === 'I';
      });
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, d1);
  await frame.locator('#btFilter').first().click({ force: true });
  await frame.waitForTimeout(4000);
}

/**
 * Tourne la page sans locator.click : ce clic attend la navigation de l'iframe,
 * et Deciplus la laisse souvent en suspens (timeout 30s qui tue le job 15h).
 * Un echec conserve les lignes deja lues.
 */
async function goToNextEcheancePage(frame, page, nextNum) {
  let outcome = 'missing';
  try {
    outcome = await Promise.race([
      frame.evaluate((n) => {
        const want = String(n);
        const hit = [...document.querySelectorAll('a')].find(
          (a) => String(a.textContent || '').replace(/\s+/g, ' ').trim() === want
        );
        if (!hit) return 'missing';
        const href = hit.getAttribute('href') || '';
        if (href && !/^javascript:/i.test(href)) {
          location.assign(new URL(href, location.href).href);
          return 'nav';
        }
        hit.click();
        return 'click';
      }, nextNum),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000)),
    ]);
  } catch (err) {
    const msg = String(err.message || err);
    if (/context was destroyed|navigation|frame was detached|Execution context/i.test(msg)) {
      await page.waitForTimeout(2500).catch(() => {});
      return true;
    }
    logWarn('Echeancier page suivante interrompue', {
      page: nextNum,
      error: msg.slice(0, 180),
    });
    return false;
  }
  if (outcome === 'missing') return false;
  if (outcome !== 'nav' && outcome !== 'click') {
    logWarn('Echeancier page suivante ignoree, scan partiel conserve', {
      page: nextNum,
      outcome,
    });
    return false;
  }
  await page.waitForTimeout(2500).catch(() => {});
  return true;
}

async function scrapeUnpaidMembers(page, { fetchRemarks = true } = {}) {
  let frame = await openEcheancierPage(page);
  await applyUnpaidDateFilter(frame);
  frame = (await resolveEcheanceFrame(page, { needRows: true })) || frame;

  const all = [];
  let lastSignature = '';
  for (let pageNo = 0; pageNo < 80; pageNo += 1) {
    const pack = await frame.evaluate(() => {
      const rows = [];
      let pending = null;
      const trs = [...document.querySelectorAll('table tr')];
      for (const tr of trs) {
        const oc = [...tr.querySelectorAll('a')]
          .map((a) => a.getAttribute('onclick') || '')
          .join(' ');
        const idm = (oc.match(/showFiche\(['"](\d+)['"]\)/) || [])[1] || '';
        const name = (
          [...tr.querySelectorAll('a')]
            .map((a) => String(a.textContent || '').replace(/\s+/g, ' ').trim())
            .find((t) => t && !/^(detail|rib|impaye|suspendu)$/i.test(t)) || ''
        ).trim();
        const text = String(tr.innerText || '').replace(/\s+/g, ' ').trim();
        if (idm) pending = { idm, name, text, oc };
        const etatEl = tr.querySelector('select[name^="etat_"]');
        if (!etatEl || etatEl.value !== 'I' || !pending) continue;
        const eid = ((etatEl.name || '').match(/etat_(\d+)/) || [])[1] || '';
        const combined = `${pending.text} ${text}`;
        const gym = (
          (combined.match(/BOXING CENTER ([A-Za-zÉé\- ]+?)(?:\s+Non|\s+Oui|$)/i) || [])[1] || ''
        ).trim();
        const date = ((combined.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '');
        const rum = ((combined.match(/RUM\s*:?\s*(MND-[A-Za-z0-9]+)/i) || [])[1] || '');
        const reportBtn = tr.querySelector('input[value="Reporter"]');
        const reportOnclick = reportBtn?.getAttribute('onclick') || '';
        const product = (
          (combined.match(
            /(OFFRE(?:\s+(?:PROMO|DUO|A))?[^\d]*\d[\d.,]*€?|Badge(?:\s+[\d.]+)?|Etudiants[^\d]*\d[\d.,]*€[^\s]*|44,?99€[^P]*|Abonnement[^P]{0,70}|259€[^P]{0,40})/i
          ) || [])[0] || ''
        )
          .replace(/\s+Prélèvement.*$/i, '')
          .trim();
        rows.push({
          eid,
          idm: pending.idm,
          name: pending.name,
          gym,
          product,
          date,
          rum,
          reportOnclick,
          raw: combined.slice(0, 220),
        });
        pending = null;
      }
      return { rows };
    });

    const hits = pack.rows.filter(
      (r) => r.idm && r.name && !/balma/i.test(r.gym) && !/balma/i.test(r.raw)
    );
    const signature = hits.map((h) => `${h.eid}|${h.idm}`).join(';');
    if (signature && signature === lastSignature) break;
    lastSignature = signature;
    all.push(...hits);

    if (fetchRemarks) {
      for (const h of hits) {
        if (skipResiliateName(h.name)) continue;
        const memberRows = all.filter((x) => x.idm === h.idm);
        const remarks = memberRows.flatMap((x) => x.remarks || []);
        const sepa = classifySepaFromCandidate({ remarks, unpaid_count: memberRows.length });
        if (remarks.length && sepa.policy.cancelAt === 1) continue;
        if (remarks.length >= 2) continue;
        const remark = await openEcheanceDetail(frame, page, h.eid);
        if (remark) h.remarks = [remark];
      }
    }

    const nextNum = String(pageNo + 2);
    const turned = await goToNextEcheancePage(frame, page, nextNum);
    if (!turned) break;
    frame = (await resolveEcheanceFrame(page, { needRows: true })) || frame;
  }

  const byMember = {};
  for (const r of all) {
    const key = r.idm;
    if (!byMember[key]) {
      byMember[key] = {
        name: r.name,
        member: r.idm,
        gym: r.gym,
        product: r.product,
        n: 0,
        unpaid_count: 0,
        dates: [],
        entries: [],
        active: false,
        rum: r.rum,
        remarks: [],
      };
    }
    byMember[key].n += 1;
    byMember[key].unpaid_count += 1;
    if (r.date && !byMember[key].dates.includes(r.date)) byMember[key].dates.push(r.date);
    byMember[key].entries.push({
      eid: r.eid,
      date: r.date,
      reportOnclick: r.reportOnclick,
      remarks: r.remarks || [],
    });
    for (const remark of r.remarks || []) {
      if (!byMember[key].remarks.includes(remark)) byMember[key].remarks.push(remark);
    }
    if (r.product && !byMember[key].product) byMember[key].product = r.product;
  }

  return Object.values(byMember).filter((t) => t.unpaid_count >= 1 && !skipResiliateName(t.name));
}

module.exports = {
  skipResiliateName,
  unpaidFilterStartDate,
  openEcheancierPage,
  applyUnpaidDateFilter,
  resolveEcheanceFrame,
  scrapeUnpaidMembers,
  openEcheanceDetail,
};
