#!/usr/bin/env node
'use strict';
/**
 * Audit abonnements prélèvement sans RIB Deciplus (depuis le 1er juin)
 * + export MD + envoi Resend transactionnel.
 *
 *   node scripts/audit-send-missing-rib.js --check
 *   node scripts/audit-send-missing-rib.js --check --since=2026-06-01
 *   node scripts/audit-send-missing-rib.js --test
 *   node scripts/audit-send-missing-rib.js --send
 *   node scripts/audit-send-missing-rib.js --send --limit=5
 */
require('dotenv').config();
process.env.BOXPLUS_ORDERS_REMOTE = '1';
process.env.DECIPLUS_FAST = process.env.DECIPLUS_FAST || '1';
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
process.env.TEMP = process.env.TEMP || 'D:\\tmp-playwright';
process.env.TMP = process.env.TMP || 'D:\\tmp-playwright';
delete process.env.BOXPLUS_BOT_URL;
delete process.env.BOXPLUS_BOT_URL_OPS;

const fs = require('fs');
const path = require('path');
const { getSupabase } = require('../storefront/lib/supabase');
const { getGymConfig } = require('../lib/normalize');
const { normalizeIban, isValidFrenchIban } = require('../lib/iban');
const {
  isPayplug4xPrelevementOrder,
  isComptantStyleProduct,
} = require('../lib/billing-plan');
const { isAnnualPromoProduct, isOffre29Product } = require('../lib/sale-contract-match');
const { login } = require('../bot/auth');
const { runWithSession, closeBrowser } = require('../bot/browser-pool');
const { openRibForm, closeGreyboxIfOpen } = require('../bot/wallet');
const { sendEmailViaResend, isConfigured: resendOk } = require('../storefront/lib/resend-send');

const SINCE_ARG = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8) || '2026-06-01';
const NO_MODE = !process.argv.slice(2).some((a) => /^--(check|send|test|send-only)/.test(a));
const CHECK = process.argv.includes('--check') || NO_MODE;
const SEND = process.argv.includes('--send');
const TEST = process.argv.includes('--test');
const SEND_ONLY = process.argv.includes('--send-only');
const SEARCH_NAMES = (process.argv.find((a) => a.startsWith('--names=')) || '')
  .slice(8)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const RUN_AUDIT = CHECK || ((SEND || TEST) && !SEND_ONLY && !fs.existsSync(OUT_JSON));
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').slice(8) || 0);
const DELAY_MS = Number((process.argv.find((a) => a.startsWith('--delay=')) || '').slice(8) || 500);
const OUT_JSON = path.join(__dirname, '..', 'data', 'audit-missing-rib-deciplus.json');
const OUT_MD = path.join(__dirname, '..', 'data', 'audit-missing-rib-deciplus.md');
const STATE_FILE = path.join(__dirname, '..', 'data', 'missing-rib-emails-sent.json');
const TEST_EMAIL = process.env.MISSING_RIB_TEST_EMAIL || 'boxingcentertls@gmail.com';

const TRANSACTIONAL_HEADERS = { 'X-Transactional': 'true' };
const TRANSACTIONAL_TAGS = [{ name: 'category', value: 'transactional' }];

function sinceIso() {
  const d = new Date(`${SINCE_ARG}T00:00:00+02:00`);
  if (Number.isNaN(d.getTime())) return '2026-06-01T00:00:00.000Z';
  return d.toISOString();
}

function nameOf(p) {
  const cs = p.customer_short || {};
  const cf = p.customer_full || {};
  const summary = p.summary || {};
  return `${cs.first_name || cf.first_name || summary.first_name || ''} ${
    cs.last_name || cf.last_name || summary.last_name || ''
  }`
    .replace(/\s+/g, ' ')
    .trim();
}

function emailOf(p) {
  return String(
    p.customer_short?.email || p.customer_full?.email || p.summary?.email || ''
  )
    .trim()
    .toLowerCase();
}

function orderPaidAt(p) {
  return p.payment?.paid_at || p.paid_at || p.created_at || null;
}

function needsRibSubscription(p) {
  if (String(p.payment?.status || '').toLowerCase() !== 'paid') return false;
  const snap = p.product_snapshot || {};
  const product = {
    id: p.product_id || snap.id,
    name: snap.name || p.product_name,
    display_name: snap.display_name,
    requires_iban: snap.requires_iban,
    supports_installment_choice: snap.supports_installment_choice,
  };
  if (isComptantStyleProduct(product) && !isPayplug4xPrelevementOrder(p)) return false;
  if (/essai|coaching|materiel|baby|educative/i.test(`${snap.name || ''} ${p.product_id || ''}`)) {
    return false;
  }
  const plan = String(p.payment?.billing_plan || p.billing_plan || '').toLowerCase();
  if (isPayplug4xPrelevementOrder(p)) return true;
  if (isOffre29Product(product) || isOffre29Product(p)) return true;
  if (/44,?99|4 semaines|sans engagement/i.test(`${snap.name || ''} ${snap.description || ''}`)) return true;
  if (snap.requires_iban === true) return true;
  if (plan === 'rib' || plan === 'paypal') return true;
  return false;
}

async function loadCandidates() {
  const sb = getSupabase();
  const since = sinceIso();
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('boxplus_orders')
      .select('order_id, created_at, payload')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const byMember = new Map();
  for (const row of all) {
    const p = row.payload || {};
    if (!needsRibSubscription(p)) continue;
    const member = String(p.deciplus_member_id || '').trim();
    if (!/^\d+$/.test(member)) continue;
    const email = emailOf(p);
    const paidAt = orderPaidAt(p) || row.created_at;
    const prev = byMember.get(member);
    const rowData = {
      order_id: row.order_id,
      name: nameOf(p),
      email,
      member,
      gym: p.customer_full?.gym || p.gym || 'minimes',
      product: p.product_snapshot?.display_name || p.product_snapshot?.name || p.product_name || 'Abonnement',
      paid_at: paidAt,
      iban_in_order: normalizeIban(p.payment?.iban || p.customer_full?.iban || ''),
    };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      rowData.no_email = true;
    }
    if (!prev || new Date(paidAt) > new Date(prev.paid_at)) {
      byMember.set(member, rowData);
    }
  }
  return { since, candidates: [...byMember.values()] };
}

async function searchDeciplusByNames(page, existingMembers) {
  if (!SEARCH_NAMES.length) return [];
  const { searchMemberByName } = require('../bot/member');
  const extra = [];
  const seen = new Set(existingMembers.map((c) => String(c.member)));
  for (const raw of SEARCH_NAMES) {
    const parts = raw.trim().split(/\s+/);
    const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    try {
      const hit = await searchMemberByName(page, last, first);
      if (!hit?.found || !hit.member_id) continue;
      const member = String(hit.member_id);
      if (!/^\d+$/.test(member) || seen.has(member)) continue;
      seen.add(member);
      extra.push({
        order_id: `DECIPLUS-SEARCH-${member}`,
        name: hit.name || raw,
        email: hit.email || '',
        member,
        gym: 'minimes',
        product: 'Recherche Deciplus',
        paid_at: null,
        iban_in_order: '',
        source: 'deciplus_search',
      });
    } catch (err) {
      console.error('SEARCH_FAIL', raw, err.message);
    }
  }
  return extra;
}

async function readMandate(page, memberId) {
  const ctx = await openRibForm(page, memberId, { forceFresh: true });
  const meta = await ctx
    .evaluate(() => ({
      iban: document.querySelector('input[name="iban"]')?.value || '',
      rum: document.querySelector('input[name="rum"]')?.value || '',
    }))
    .catch(() => ({ iban: '', rum: '' }));
  await closeGreyboxIfOpen(page).catch(() => {});
  const iban = normalizeIban(meta.iban);
  return { iban, rum: meta.rum || '', valid: isValidFrenchIban(iban) };
}

function buildRibRequestEmail({ firstName, product }) {
  const who = firstName || 'Bonjour';
  const subject = 'Finalisation de votre dossier — coordonnées bancaires';
  const text = [
    `${who},`,
    '',
    'Nous finalisons votre dossier d’inscription au Boxing Center.',
    '',
    `Pour activer correctement votre abonnement (${product || 'prélèvement'}), il nous manque votre RIB (IBAN) sur notre logiciel de gestion.`,
    '',
    'Merci de nous répondre à ce message en indiquant :',
    '• le titulaire du compte',
    '• l’IBAN (27 caractères, commence par FR)',
    '',
    'Si vous préférez, vous pouvez aussi transmettre ces informations directement à l’accueil de votre salle Boxing Center.',
    '',
    'Merci pour votre confiance.',
    '',
    'L’équipe Boxing Center',
    'boxingcentertls@gmail.com',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:28px 24px;border-radius:8px;line-height:1.55;font-size:15px">
    <p style="margin:0 0 16px">${who},</p>
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
</body>
</html>`;

  return { subject, text, html };
}

function firstName(name) {
  const n = String(name || '').trim();
  return n.split(/\s+/)[0] || '';
}

function loadSentState() {
  if (!fs.existsSync(STATE_FILE)) return { sent: {} };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveSentState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function writeMarkdown(report) {
  const lines = [
    '# Abonnements prélèvement — RIB manquant dans Deciplus',
    '',
    `Généré le ${report.at}`,
    `Période commandes : depuis le ${SINCE_ARG}`,
    `Candidats analysés : ${report.scanned}`,
    `RIB manquant Deciplus : **${report.missing.length}**`,
    '',
    '| Nom | Email | Membre | Produit | Commande |',
    '|-----|-------|--------|---------|----------|',
  ];
  for (const r of report.missing) {
    const mail = r.email ? r.email : '— (pas d’email)';
    lines.push(`| ${r.name || '—'} | ${mail} | ${r.member} | ${r.product || '—'} | ${r.order_id} |`);
  }
  if (!report.missing.length) {
    lines.push('| — | — | — | — | — |');
  }
  lines.push('', '---', '', '_Liste pour relance RIB — Boxing Center_');
  fs.writeFileSync(OUT_MD, lines.join('\n'), 'utf8');
}

async function runAudit(candidates) {
  const missing = [];
  const ok = [];
  const failed = [];

  const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;

  await runWithSession('audit-missing-rib', async (page) => {
    await login(page, { siteLabel: 'Minimes' }).catch(() => login(page, { siteLabel: 'Saint-Cyprien' }));

    for (const c of candidates) {
      try {
        const gym = getGymConfig(c.gym || 'minimes');
        const mandate = await readMandate(page, c.member);
        const row = { ...c, mandate_iban: mandate.iban || null, rum: mandate.rum || null };
        if (mandate.valid) {
          ok.push(row);
          console.log('OK', c.email, c.member);
        } else {
          missing.push(row);
          console.log('MISSING', c.name, c.email, c.member);
        }
      } catch (err) {
        failed.push({ ...c, error: err.message.slice(0, 160) });
        console.error('FAIL', c.email, err.message);
        await closeGreyboxIfOpen(page).catch(() => {});
      }
    }
  });

  await closeBrowser().catch(() => {});
  return { missing, ok, failed };
}

async function sendEmails(targets) {
  if (!resendOk()) throw new Error('RESEND_API_KEY manquant');
  const state = loadSentState();
  const results = [];
  let sent = 0;

  for (const row of targets) {
    if (LIMIT > 0 && sent >= LIMIT) break;
    const to = TEST ? TEST_EMAIL : row.email;
    const key = `${row.member}:${row.email}`;
    if (!TEST && state.sent[key]) {
      results.push({ ...row, skipped: 'already_sent' });
      continue;
    }

    const mail = buildRibRequestEmail({
      firstName: firstName(row.name) ? `${firstName(row.name)},` : 'Bonjour,',
      product: row.product,
    });

    try {
      const out = await sendEmailViaResend({
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        fromName: 'Boxing Center',
        replyTo: 'boxingcentertls@gmail.com',
        headers: TRANSACTIONAL_HEADERS,
        tags: TRANSACTIONAL_TAGS,
      });
      if (!TEST) {
        state.sent[key] = { at: new Date().toISOString(), messageId: out.messageId, order_id: row.order_id };
        saveSentState(state);
      }
      sent += 1;
      results.push({ ...row, to, sent: true, messageId: out.messageId, test: TEST });
      console.log('EMAIL', TEST ? `test→${to}` : to, row.name);
      await new Promise((r) => setTimeout(r, DELAY_MS));
    } catch (err) {
      results.push({ ...row, to, sent: false, error: err.message });
      console.error('EMAIL_FAIL', to, err.message);
    }
  }
  return results;
}

(async () => {
  if (require.main !== module) return;
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  const { since, candidates: loaded } = await loadCandidates();
  let candidates = loaded;
  console.log(`Depuis ${since} — ${candidates.length} membre(s) prélèvement avec email (commandes)`);

  if (RUN_AUDIT && SEARCH_NAMES.length) {
    const browsers = path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright');
    if (fs.existsSync(browsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
    await runWithSession('audit-search-names', async (page) => {
      await login(page, { siteLabel: 'Minimes' }).catch(() => login(page, { siteLabel: 'Saint-Cyprien' }));
      const extra = await searchDeciplusByNames(page, candidates);
      if (extra.length) {
        candidates = [...candidates, ...extra];
        console.log(`+ ${extra.length} membre(s) via recherche Deciplus`);
      }
    });
    await closeBrowser().catch(() => {});
  }

  let report = {
    at: new Date().toISOString(),
    since: SINCE_ARG,
    scanned: candidates.length,
    missing: [],
    ok_count: 0,
    failed: [],
  };

  if (RUN_AUDIT) {
    const audit = await runAudit(candidates);
    report.missing = audit.missing;
    report.ok_count = audit.ok.length;
    report.failed = audit.failed;
    fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
    writeMarkdown(report);
    console.log(`Rapport : ${OUT_MD}`);
    console.log(`JSON : ${OUT_JSON}`);
    console.log(`Manquants : ${audit.missing.length} / OK : ${audit.ok.length} / Échecs : ${audit.failed.length}`);
  } else if (fs.existsSync(OUT_JSON)) {
    const saved = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
    report.missing = saved.missing || [];
    report.ok_count = saved.ok_count || 0;
    report.failed = saved.failed || [];
    report.scanned = saved.scanned || candidates.length;
    console.log(`Rapport existant chargé — ${report.missing.length} RIB manquant(s)`);
  }

  if (SEND || TEST || SEND_ONLY) {
    const targets = report.missing.filter((r) => r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
    if (!targets.length) {
      console.log('Aucun mail à envoyer.');
      return;
    }
    const emailResults = await sendEmails(targets);
    report.email_results = emailResults;
    fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
    console.log(
      `Emails : ${emailResults.filter((r) => r.sent).length} envoyé(s), ${emailResults.filter((r) => r.skipped).length} ignoré(s)`
    );
  }
})().catch(async (err) => {
  console.error(err);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
