#!/usr/bin/env node
'use strict';
/**
 * 1) Mail demande RIB aux prélèvements bloqués SANS mandat (sauf Etogo).
 * 2) Résilie les contrats Impayé AVEC RIB (mandat) qui bloquent — hors Balma.
 *
 *   node scripts/mail-rib-and-resiliate-unpaid.js --apply
 *   node scripts/mail-rib-and-resiliate-unpaid.js --apply --mail-only
 *   node scripts/mail-rib-and-resiliate-unpaid.js --apply --resiliate-only
 *   node scripts/mail-rib-and-resiliate-unpaid.js --apply --limit=10
 */
require('dotenv').config();
process.env.DECIPLUS_FAST = '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.TEMP = process.env.TEMP || 'D:\\tmp-playwright';
process.env.TMP = process.env.TMP || 'D:\\tmp-playwright';
process.env.RESEND_SENDER_EMAIL = process.env.RESEND_SENDER_EMAIL || 'no-reply@boxingcenter.fr';
process.env.RESEND_SENDER_NAME = process.env.RESEND_SENDER_NAME || 'Boxing Center';
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { openMemberCheck, closeGreyboxIfOpen } = require('../bot/wallet');
const {
  searchMemberByName,
  openMemberEditForm,
  extractMemberId,
} = require('../bot/member');
const {
  findActiveContracts,
  cancelOneContract,
  isPendingOrFutureContract,
} = require('../bot/cancel-sale');
const { isStaleOrInactiveAbo } = require('../lib/replace-existing-abo');
const { isDeciplusBadgeLabel } = require('../lib/catalog-sale');
const { resolveSaleGymConfig, matchGymSlug } = require('../lib/gym-slugs');
const { sendEmailViaResend, isConfigured: resendOk } = require('../storefront/lib/resend-send');

const APPLY = process.argv.includes('--apply');
const MAIL_ONLY = process.argv.includes('--mail-only');
const RESILIATE_ONLY = process.argv.includes('--resiliate-only');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').slice(8) || 0);
const DATA_DIR = path.join(__dirname, '..', 'data');
const UNPAID_FILE = path.join(DATA_DIR, 'unpaid-one-1788996089487.json');
const MAIL_STATE = path.join(DATA_DIR, 'missing-rib-emails-sent.json');
const CANCEL_STATE = path.join(DATA_DIR, 'resiliate-unpaid-rib-state.json');
const OUT = path.join(DATA_DIR, `mail-rib-resiliate-${Date.now()}.json`);

const RIB_MAIL_TARGETS = [
  { name: 'Dalim Dalim', member: '20990', gym: 'minimes', last: 'Dalim', first: 'Dalim', product: 'Étudiant 36,99 €' },
  { name: 'Stéphane Bon', member: '21046', gym: 'minimes', last: 'Bon', first: 'Stephane', product: '44,99 €' },
  { name: 'Tapinoy Maximilien', member: '21042', gym: 'minimes', last: 'Tapinoy', first: 'Maximilien', product: '44,99 €' },
  { name: 'Thomas Stanislas', member: '21043', gym: 'minimes', last: 'Stanislas', first: 'Thomas', product: '44,99 €' },
  { name: 'Sofiane Beghennou', member: null, gym: 'minimes', last: 'Beghennou', first: 'Sofiane', product: '44,99 €' },
  { name: 'Sadek Mohammad', member: null, gym: 'ramonville', last: 'Mohammad', first: 'Sadek', product: '34,99 € étudiants' },
  { name: 'Tristan Bertreux', member: null, gym: 'ramonville', last: 'Bertreux', first: 'Tristan', product: 'Boxe éducative' },
];

const SKIP_RESILIATE_NAMES = [
  /etogo/i,
  /kavocop/i,
  /\bdalim\b/i,
  /bon stephane|stephane bon|st[eé]phane bon/i,
  /tapinoy/i,
  /stanislas/i,
  /beghennou/i,
  /mohammad sadek|sadek mohammad/i,
  /bertreux/i,
];

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function looksLikeComptant(label) {
  const t = String(label || '');
  if (/pr[ée]l[èe]vement|4\s*semaines|sans\s*engagement|iban|sepa/i.test(t)) return false;
  return /comptant|259\s*€|12\s*mois|promo\s*12|baby\s*boxe|boxe\s*[eé]ducative|forfait\s*annuel/i.test(t);
}

function splitUnpaidName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { last: '', first: '' };
  if (parts.length === 1) return { last: parts[0], first: '' };
  const last = parts[0];
  const first = parts.slice(1).join(' ');
  return { last, first };
}

function skipResiliateName(name) {
  const n = String(name || '');
  return SKIP_RESILIATE_NAMES.some((re) => re.test(n));
}

function buildRibEmail({ firstName, product }) {
  const who = firstName ? `${firstName},` : 'Bonjour,';
  const subject = 'Finalisation de votre dossier — coordonnées bancaires';
  const text = [
    who,
    '',
    'Nous finalisons votre dossier d’inscription au Boxing Center.',
    '',
    `Pour activer correctement votre abonnement (${product || 'prélèvement'}), il nous manque votre RIB (IBAN) sur notre logiciel de gestion.`,
    '',
    'Merci de nous répondre à ce message en indiquant :',
    '• le titulaire du compte',
    '• l’IBAN (27 caractères, commence par FR)',
    '',
    'Si vous préférez, vous pouvez aussi transmettre ces informations à l’accueil de votre salle Boxing Center.',
    '',
    'Merci pour votre confiance.',
    '',
    'L’équipe Boxing Center',
    'boxingcentertls@gmail.com',
  ].join('\n');
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:28px 24px;border-radius:8px;line-height:1.55;font-size:15px">
    <p style="margin:0 0 16px">${who}</p>
    <p style="margin:0 0 14px">Nous finalisons votre dossier d’inscription au <strong>Boxing Center</strong>.</p>
    <p style="margin:0 0 14px">Pour activer correctement votre abonnement <em>${product || 'prélèvement'}</em>, il nous manque votre <strong>RIB (IBAN)</strong> sur notre logiciel de gestion.</p>
    <p style="margin:0 0 8px">Merci de répondre à ce message en indiquant&nbsp;:</p>
    <ul style="margin:0 0 16px;padding-left:20px">
      <li>le titulaire du compte</li>
      <li>l’IBAN (27 caractères, commence par FR)</li>
    </ul>
    <p style="margin:0 0 14px">Vous pouvez aussi transmettre ces informations à l’accueil de votre salle Boxing Center.</p>
    <p style="margin:24px 0 0">Merci pour votre confiance.<br/><strong>L’équipe Boxing Center</strong><br/><a href="mailto:boxingcentertls@gmail.com" style="color:#111">boxingcentertls@gmail.com</a></p>
  </div>
</body></html>`;
  return { subject, text, html };
}

async function readFicheContact(page) {
  for (const ctx of [page, ...(page.frames?.() || [])]) {
    try {
      const meta = await ctx.evaluate(() => {
        const form = document.querySelector('form[name="db1_form"]');
        if (!form) return null;
        const val = (sel) => (form.querySelector(sel) || {}).value || '';
        return {
          email: val('input[name="email"]:not(#i_email)'),
          phone: val('input[name="telsms"]') || val('input[name="tel"]:not(#i_tel)'),
          nom: val('input[name="nom"]:not(#i_nom)'),
          prenom: val('input[name="prenom"]:not(#i_prenom)'),
        };
      });
      if (meta) return meta;
    } catch {
      /* frame */
    }
  }
  return { email: '', phone: '', nom: '', prenom: '' };
}

async function resolveMember(page, t) {
  if (t.member) return String(t.member);
  const hit = await searchMemberByName(page, t.last, t.first);
  if (hit?.found && hit.member_id) return String(hit.member_id);
  return null;
}

async function openFiche(page, memberId, gym) {
  await closeGreyboxIfOpen(page).catch(() => {});
  const gymCfg = resolveSaleGymConfig(gym || 'minimes', { gym });
  const edited = await openMemberEditForm(page, memberId).catch(() => false);
  if (!edited) await openMemberCheck(page, memberId, gymCfg);
}

async function scrapeUnpaidWithIds(page) {
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/nextgen/legacy?path=${encodeURIComponent('/presta_echeance.php')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(2000);
  let frame =
    page.frames().find((f) => /presta_echeance\.php\?_vue_iframe/i.test(f.url())) ||
    page.frames().find((f) => /presta_echeance\.php/i.test(f.url()) && !/legacy/i.test(f.url()));
  if (!frame) throw new Error('iframe échéances introuvable');
  await frame.evaluate(() => {
    const d1 = document.querySelector('input[name="datec1"]');
    const d2 = document.querySelector('input[name="datec2"]');
    const sel = document.querySelector('select[name="etat[]"]');
    if (d1) {
      d1.value = '01/06/2026';
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
  });
  await Promise.all([
    frame.waitForLoadState('domcontentloaded').catch(() => {}),
    frame.locator('#btFilter').click({ force: true }),
  ]);
  await frame.waitForTimeout(3500);
  frame = page.frames().find((f) => /presta_echeance\.php\?_vue_iframe/i.test(f.url())) || frame;
  console.log('FRAME', frame.url());

  const all = [];
  let lastSignature = '';
  for (let pageNo = 0; pageNo < 80; pageNo += 1) {
    const pack = await frame.evaluate(() => {
      const rows = [];
      let pending = null;
      const trs = [...document.querySelectorAll('table tr')];
      for (const tr of trs) {
        const oc = [...tr.querySelectorAll('a')].map((a) => a.getAttribute('onclick') || '').join(' ');
        const idm = ((oc.match(/showFiche\(['"](\d+)['"]\)/) || [])[1] || '');
        const name = (
          [...tr.querySelectorAll('a')]
            .map((a) => String(a.textContent || '').replace(/\s+/g, ' ').trim())
            .find((t) => t && !/^(detail|rib|impaye|suspendu)$/i.test(t)) || ''
        ).trim();
        const text = String(tr.innerText || '').replace(/\s+/g, ' ').trim();
        if (idm) {
          pending = { idm, name, text, oc };
        }
        const etatEl = tr.querySelector('select[name^="etat_"]');
        if (!etatEl || etatEl.value !== 'I' || !pending) continue;
        const eid = ((etatEl.name || '').match(/etat_(\d+)/) || [])[1] || '';
        const combined = `${pending.text} ${text}`;
        const gym = ((combined.match(/BOXING CENTER ([A-Za-zÉé\- ]+?)(?:\s+Non|\s+Oui|$)/i) || [])[1] || '').trim();
        const rum = ((combined.match(/RUM\s*:?\s*(MND-[A-Za-z0-9]+)/i) || [])[1] || '');
        const product = (
          (combined.match(
            /(OFFRE(?:\s+(?:PROMO|DUO|A))?[^\d]*\d[\d.,]*€?|Badge(?:\s+[\d.]+)?|Etudiants[^\d]*\d[\d.,]*€[^\s]*|44,?99€[^P]*|Abonnement[^P]{0,70}|259€[^P]{0,40})/i
          ) || [])[0] || ''
        )
          .replace(/\s+Prélèvement.*$/i, '')
          .trim();
        const activeEl = document.querySelector(`input[name="is_active_contract_${eid}"]`);
        rows.push({
          eid,
          idm: pending.idm,
          name: pending.name,
          gym,
          product,
          rum,
          active: String((activeEl && activeEl.value) || '') === '1',
          raw: combined.slice(0, 220),
        });
        pending = null;
      }
      return { rows };
    });
    const hits = pack.rows.filter((r) => r.idm && r.name && !/balma/i.test(r.gym) && !/balma/i.test(r.raw));
    const signature = hits.map((h) => `${h.eid}|${h.idm}`).join(';');
    if (signature && signature === lastSignature) break;
    lastSignature = signature;
    all.push(...hits);
    console.log(
      'unpaid page',
      pageNo + 1,
      'pairs',
      pack.rows.length,
      'hits',
      hits.length,
      'withRUM',
      hits.filter((h) => h.rum).length,
      'total',
      all.length
    );
    const nextNum = String(pageNo + 2);
    const numbered = frame.locator('a').filter({ hasText: new RegExp(`^\\s*${nextNum}\\s*$`) }).first();
    if ((await numbered.count()) === 0) break;
    await Promise.all([
      frame.waitForLoadState('domcontentloaded').catch(() => {}),
      numbered.click({ force: true }),
    ]);
    await frame.waitForTimeout(3500);
    frame = page.frames().find((f) => /presta_echeance\.php\?_vue_iframe/i.test(f.url())) || frame;
  }

  const byMember = {};
  for (const r of all) {
    if (!r.rum) continue;
    if (skipResiliateName(r.name)) continue;
    const key = r.idm;
    if (!byMember[key]) {
      byMember[key] = {
        name: r.name,
        member: r.idm,
        gym: r.gym,
        product: r.product,
        n: 0,
        active: false,
        badge: /^badge$/i.test(String(r.product || '').trim()),
        rum: r.rum,
      };
    }
    byMember[key].n += 1;
    if (r.active) byMember[key].active = true;
    if (r.product && !byMember[key].product) byMember[key].product = r.product;
    if (!/^badge$/i.test(String(r.product || '').trim())) byMember[key].badge = false;
  }
  return Object.values(byMember);
}

async function sendRibMails(page, report) {
  if (!resendOk()) throw new Error('RESEND_API_KEY manquant');
  const state = loadJson(MAIL_STATE, { sent: {} });
  for (const t of RIB_MAIL_TARGETS) {
    const row = { ...t, email: null, member_resolved: t.member, sent: false, skipped: null };
    try {
      const memberId = await resolveMember(page, t);
      row.member_resolved = memberId;
      if (!memberId) {
        row.skipped = 'member_not_found';
        console.log('MAIL_SKIP no member', t.name);
        report.mails.push(row);
        continue;
      }
      await openFiche(page, memberId, t.gym);
      const contact = await readFicheContact(page);
      row.email = String(contact.email || '').trim().toLowerCase();
      row.phone = contact.phone || null;
      if (!isValidEmail(row.email)) {
        row.skipped = 'no_email';
        console.log('MAIL_SKIP no email', t.name, `#${memberId}`, 'tel', row.phone || '—');
        report.mails.push(row);
        continue;
      }
      const key = `${memberId}:${row.email}`;
      if (state.sent[key]) {
        row.skipped = 'already_sent';
        row.sent = true;
        console.log('MAIL_SKIP already', t.name, row.email);
        report.mails.push(row);
        continue;
      }
      if (!APPLY) {
        row.skipped = 'dry_run';
        console.log('MAIL_DRY', t.name, row.email);
        report.mails.push(row);
        continue;
      }
      const mail = buildRibEmail({ firstName: firstNameOf(contact.prenom || t.name), product: t.product });
      const out = await sendEmailViaResend({
        to: row.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        fromName: 'Boxing Center',
        replyTo: 'boxingcentertls@gmail.com',
        headers: { 'X-Transactional': 'true' },
        tags: [{ name: 'category', value: 'transactional' }],
      });
      state.sent[key] = { at: new Date().toISOString(), messageId: out.messageId, order_id: `DECIPLUS-${memberId}` };
      saveJson(MAIL_STATE, state);
      row.sent = true;
      row.messageId = out.messageId;
      console.log('MAIL_OK', t.name, row.email, out.messageId);
    } catch (err) {
      row.error = String(err.message || err).slice(0, 180);
      console.error('MAIL_FAIL', t.name, row.error);
      await closeGreyboxIfOpen(page).catch(() => {});
    }
    report.mails.push(row);
  }
}

async function resiliateUnpaid(page, report) {
  const targets = await scrapeUnpaidWithIds(page);
  const state = loadJson(CANCEL_STATE, { done: {} });
  let n = 0;
  console.log('Résiliation impayés avec RIB', targets.length, 'cibles');
  for (const t of targets) {
    if (LIMIT > 0 && n >= LIMIT) break;
    n += 1;
    const stateKey = String(t.member);
    if (state.done[stateKey]?.ok) {
      report.resiliate.push({ ...t, skipped: 'already_done' });
      continue;
    }
    const row = { ...t, cancelled: [], error: null };
    try {
      const memberId = String(t.member);
      const gymSlug = matchGymSlug(t.gym) || 'minimes';
      const gymCfg = resolveSaleGymConfig(gymSlug, { gym: gymSlug });
      await closeGreyboxIfOpen(page).catch(() => {});
      await openMemberCheck(page, memberId, gymCfg);
      const contracts = await findActiveContracts(page, { includeExpiredPrestation: true }).catch(() => []);
      const live = contracts.filter((c) => !isStaleOrInactiveAbo(c.label));
      const badge = Boolean(t.badge);
      const pick = live.filter((c) => {
        const isBadge = Boolean(c.isBadge) || isDeciplusBadgeLabel(c.label);
        if (looksLikeComptant(c.label) && !isBadge) return false;
        if (badge) return isBadge;
        return !isBadge;
      });
      if (!pick.length) {
        row.error = 'no_active_prelev_contract';
        console.log('CANCEL_SKIP no abo', t.name, `#${memberId}`);
        state.done[stateKey] = { ok: true, at: new Date().toISOString(), reason: row.error, member: memberId };
        saveJson(CANCEL_STATE, state);
        report.resiliate.push(row);
        continue;
      }
      if (!APPLY) {
        row.skipped = 'dry_run';
        row.would_cancel = pick.map((c) => ({ idc: c.idc, label: String(c.label || '').slice(0, 120) }));
        console.log('CANCEL_DRY', t.name, pick.length, pick.map((c) => c.idc).join(','));
        report.resiliate.push(row);
        continue;
      }
      for (const c of pick) {
        const forceVoid = Boolean(c.isBadge) || isPendingOrFutureContract(c.label);
        const result = await cancelOneContract(page, c, { forceVoid });
        row.cancelled.push({
          idc: c.idc,
          ok: Boolean(result.cancelled),
          reason: result.reason || null,
          label: String(c.label || '').slice(0, 120),
        });
        await closeGreyboxIfOpen(page).catch(() => {});
        await openMemberCheck(page, memberId, gymCfg).catch(() => {});
      }
      const ok = row.cancelled.some((x) => x.ok);
      state.done[stateKey] = {
        ok,
        at: new Date().toISOString(),
        member: memberId,
        cancelled: row.cancelled,
      };
      saveJson(CANCEL_STATE, state);
      console.log(ok ? 'CANCEL_OK' : 'CANCEL_FAIL', t.name, `#${memberId}`, JSON.stringify(row.cancelled.map((x) => x.reason)));
    } catch (err) {
      row.error = String(err.message || err).slice(0, 180);
      console.error('CANCEL_ERR', t.name, row.error);
      await closeGreyboxIfOpen(page).catch(() => {});
    }
    report.resiliate.push(row);
    if (report.resiliate.length % 5 === 0) saveJson(OUT, report);
  }
}

(async () => {
  if (!APPLY) console.log('DRY RUN — passer --apply pour envoyer / résilier');
  const report = {
    at: new Date().toISOString(),
    apply: APPLY,
    mails: [],
    resiliate: [],
  };
  await runWithSession('mail-rib-resiliate', async (page) => {
    await login(page, { siteLabel: 'Minimes' }).catch(() => login(page, { siteLabel: 'Saint-Cyprien' }));
    if (!RESILIATE_ONLY) await sendRibMails(page, report);
    if (!MAIL_ONLY) await resiliateUnpaid(page, report);
  });
  await closeBrowser().catch(() => {});
  saveJson(OUT, report);
  console.log('écrit', OUT);
  console.log(
    JSON.stringify(
      {
        mails_sent: report.mails.filter((m) => m.sent && !m.skipped).length,
        mails_skip: report.mails.filter((m) => m.skipped).map((m) => `${m.name}:${m.skipped}`),
        resiliate_ok: report.resiliate.filter((r) => (r.cancelled || []).some((c) => c.ok)).length,
        resiliate_fail: report.resiliate.filter((r) => r.error).length,
      },
      null,
      2
    )
  );
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
