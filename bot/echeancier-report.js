'use strict';

const { randomDelay } = require('../lib/utils');
const { logInfo, logWarn } = require('../lib/logger');
const { resolveEcheanceFrame, openEcheancierPage } = require('../lib/echeancier-unpaid');

function frToIso(fr) {
  const m = String(fr || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function fillReportDate(page, { fr, iso }) {
  const scopes = [page, ...(page.frames?.() || [])];
  for (const ctx of scopes) {
    const filled = await ctx
      .evaluate(
        ({ frDate, isoDate }) => {
          const setVal = (el, value) => {
            const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
            const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, value);
            else el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const inputs = Array.from(document.querySelectorAll('input')).filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && !el.disabled && el.type !== 'hidden';
          });
          for (const el of inputs) {
            const hint = `${el.type} ${el.placeholder || ''} ${el.name || ''} ${el.id || ''} ${el.className || ''}`;
            if (el.type === 'date' && isoDate) {
              setVal(el, isoDate);
              return true;
            }
            if (/date|jj\/mm|echeance|échéance/i.test(hint) || /\d{2}\/\d{2}\/\d{4}/.test(el.value || '')) {
              setVal(el, frDate);
              return true;
            }
          }
          return false;
        },
        { frDate: fr, isoDate: iso }
      )
      .catch(() => false);
    if (filled) return true;
  }
  return false;
}

async function confirmReportModal(page) {
  const names = [/valider/i, /confirmer/i, /appliquer/i, /enregistrer/i, /^ok$/i];
  for (const ctx of [page, ...(page.frames?.() || [])]) {
    for (const re of names) {
      const btn = ctx.getByRole('button', { name: re }).first();
      if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
        await btn.click({ force: true }).catch(() => {});
        await randomDelay(600, 1000);
        return true;
      }
    }
    const inputBtn = ctx.locator('input[type="button"], input[type="submit"]').filter({ hasText: /valider|confirmer/i }).first();
    if ((await inputBtn.count()) > 0 && (await inputBtn.isVisible().catch(() => false))) {
      await inputBtn.click({ force: true }).catch(() => {});
      await randomDelay(600, 1000);
      return true;
    }
  }
  return false;
}

/**
 * Reporte une echeance impayee (bouton Reporter / handleReportEcheance) a newDueFr.
 */
async function reportUnpaidEcheance(page, { eid, newDueFr, reportOnclick = '' } = {}) {
  if (!eid || !newDueFr) return { ok: false, reason: 'missing_args' };
  const iso = frToIso(newDueFr);

  let frame = await resolveEcheanceFrame(page);
  if (!frame) {
    frame = await openEcheancierPage(page);
  }

  const payload = await frame.evaluate(
    ({ targetEid, onclickHint }) => {
      const sel = document.querySelector(`select[name="etat_${targetEid}"]`);
      if (!sel) return { ok: false, reason: 'row_not_found' };
      const row = sel.closest('tr');
      const btn = row?.querySelector('input[value="Reporter"]');
      const oc = onclickHint || btn?.getAttribute('onclick') || '';
      const m = oc.match(/handleReportEcheance\((\[.*\])\)/);
      return { ok: true, json: m ? m[1] : null, oc: oc.slice(0, 200) };
    },
    { targetEid: String(eid), onclickHint: String(reportOnclick || '') }
  );

  if (!payload.ok) {
    logWarn('Reporter — ligne introuvable', { eid, reason: payload.reason });
    return { ok: false, reason: payload.reason || 'row_not_found' };
  }

  page.once('dialog', async (d) => {
    await d.accept().catch(() => {});
  });

  if (payload.json) {
    await frame.evaluate((jsonStr) => {
      if (typeof handleReportEcheance === 'function' && jsonStr) {
        handleReportEcheance(JSON.parse(jsonStr));
      }
    }, payload.json);
  } else {
    const btn = frame.locator(`select[name="etat_${eid}"]`).locator('xpath=ancestor::tr[1]').locator('input[value="Reporter"]').first();
    if ((await btn.count()) === 0) return { ok: false, reason: 'reporter_button_missing' };
    await btn.click({ force: true }).catch(() => {});
  }

  await randomDelay(900, 1500);
  const filled = await fillReportDate(page, { fr: newDueFr, iso });
  if (!filled) {
    logWarn('Reporter — champ date introuvable', { eid, newDueFr });
  }
  await confirmReportModal(page);
  await randomDelay(1200, 1800);

  logInfo('Echeance reportee (grace AM04)', { eid, new_due: newDueFr, date_filled: filled });
  return { ok: true, new_due: newDueFr, date_filled: filled };
}

module.exports = {
  reportUnpaidEcheance,
};
