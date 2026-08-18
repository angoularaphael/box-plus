#!/usr/bin/env node
/**
 * Recolle les photos manquantes / blanches (17–18 août 2026).
 * Essai gratuit → JPEG officiel. Boutique → selfie Cloudinary si dispo.
 * Ignore les fiches qui ont déjà une vraie photo (≥ 20 Ko).
 */
require('dotenv').config();
process.env.DECIPLUS_HEADLESS = process.env.DECIPLUS_HEADLESS || 'true';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { login, STORAGE_FILE } = require('../bot/auth');
const { processMemberPhotoJob } = require('../bot/index');
const { defaultSeancePhotoPath, memberHasRealPhoto } = require('../bot/member');
const { normalizeOrder } = require('../lib/normalize');

const JPG = defaultSeancePhotoPath();
const DEFAULT_B64 = JPG
  ? `data:image/jpeg;base64,${fs.readFileSync(JPG).toString('base64')}`
  : null;
const SINCE_MS = Date.parse('2026-08-17T00:00:00+02:00');
const SINCE_ISO = '2026-08-16T22:00:00Z';
const PAID_PRODUCTS = new Set(['seance-essai', 'dp-104', 'dp-100', 'offre-duo', 'offre-saison']);
const FORCE = new Set(['21240', '21241', '21242']);

function jpegSize(buf) {
  if (!buf || buf.length < 12 || buf[0] !== 0xff || buf[1] !== 0xd8) return 0;
  return buf.length;
}

function orderStamp(id) {
  const m = String(id).match(/(?:BC|SO|DEMO)-(\d{13})/);
  return m ? Number(m[1]) : 0;
}

async function cloudinaryJpeg(orderId) {
  const url = `https://res.cloudinary.com/onomsb6u/image/upload/f_jpg,q_auto,w_600,h_600,c_fill,g_auto/boxplus/photos/${orderId}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (jpegSize(buf) < 10000) return null;
  return { url, b64: `data:image/jpeg;base64,${buf.toString('base64')}`, bytes: buf.length };
}

async function botJob(bot, secret, id) {
  const jr = await fetch(`${bot}/api/jobs/${encodeURIComponent(id)}`, {
    headers: { 'x-sync-secret': secret },
  }).catch(() => null);
  return jr ? jr.json().catch(() => ({})) : {};
}

async function main() {
  if (!DEFAULT_B64) throw new Error('assets/seance-essai-photo.jpg manquant');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bot = process.env.BOXPLUS_BOT_URL;
  const secret = process.env.SYNC_SECRET;

  const r = await fetch(
    `${url}/rest/v1/boxplus_orders?select=order_id,updated_at,summary&updated_at=gte.${SINCE_ISO}&order=updated_at.desc&limit=120`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const rows = await r.json();
  const paid = (Array.isArray(rows) ? rows : []).filter((o) => o.summary?.payment?.status === 'paid');

  const jobs = [];
  const seenMembers = new Set();

  const tests = [
    { member: '21240', gym: 'minimes', first: 'TestOffre29', last: 'Photo75528' },
    { member: '21241', gym: 'minimes', first: 'TestGratuit', last: 'Photo75529' },
    { member: '21242', gym: 'minimes', first: 'TestEssai10', last: 'Photo75530' },
  ];
  for (const t of tests) {
    jobs.push({
      order_id: `BACKFILL-${t.member}-${Date.now()}`,
      deciplus_member_id: t.member,
      gym: t.gym,
      customer: { first_name: t.first, last_name: t.last },
      photo_base64: DEFAULT_B64,
      photo_url: 'https://seance-offerte.boxingcenter.fr/seance-essai-photo.jpg',
      label: `${t.first} ${t.last} (défaut)`,
      force: true,
    });
    seenMembers.add(t.member);
  }

  for (const o of paid) {
    const product = String(o.summary?.product_id || '');
    if (!PAID_PRODUCTS.has(product)) continue;
    if (orderStamp(o.order_id) && orderStamp(o.order_id) < SINCE_MS) continue;
    const name = [o.summary?.customer_short?.first_name, o.summary?.customer_short?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!name || /testoffre|testgratuit|testessai|testofferte/i.test(name)) continue;
    const j = await botJob(bot, secret, o.order_id);
    const member =
      j.processed?.deciplus_member_id ||
      o.summary?.deciplus_member_id ||
      o.summary?.customer_full?.deciplus_member_id;
    if (!member || seenMembers.has(String(member))) continue;
    seenMembers.add(String(member));
    const gym = o.summary?.gym || o.summary?.customer_full?.gym || 'minimes';
    const media = await cloudinaryJpeg(o.order_id);
    jobs.push({
      order_id: `${o.order_id}-bfphoto`,
      deciplus_member_id: String(member),
      gym,
      customer: {
        first_name: o.summary.customer_short.first_name,
        last_name: o.summary.customer_short.last_name,
      },
      photo_base64: media?.b64 || DEFAULT_B64,
      photo_url: media?.url || 'https://seance-offerte.boxingcenter.fr/seance-essai-photo.jpg',
      label: `${name} · ${product} · ${member}${media ? '' : ' (défaut)'}`,
    });
  }

  const leadsRes = await fetch(
    `${url}/rest/v1/tunnel_leads?select=id,prenom,nom,salle,created_at,meta&tunnel=eq.seance_essai&created_at=gte.${SINCE_ISO}&order=created_at.desc&limit=80`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const leads = await leadsRes.json().catch(() => []);
  for (const lead of Array.isArray(leads) ? leads : []) {
    const meta = lead.meta && typeof lead.meta === 'object' ? lead.meta : {};
    const jobIds = Array.isArray(meta.jobs) ? meta.jobs : [];
    for (const jobId of jobIds) {
      const j = await botJob(bot, secret, jobId);
      const member = j.processed?.deciplus_member_id;
      if (!member || seenMembers.has(String(member))) continue;
      const isAmi = /ami$/i.test(String(jobId));
      const first = isAmi ? meta.ami?.prenom || lead.prenom : lead.prenom || meta.prenom;
      const last = isAmi ? meta.ami?.nom || lead.nom : lead.nom || meta.nom;
      if (!first || !last) continue;
      if (/testoffre|testgratuit|testessai|testofferte|photocheck|camille/i.test(`${first} ${last}`)) continue;
      seenMembers.add(String(member));
      jobs.push({
        order_id: `${jobId}-bfphoto`,
        deciplus_member_id: String(member),
        gym: meta.salle || 'minimes',
        customer: { first_name: first, last_name: last },
        photo_base64: DEFAULT_B64,
        photo_url: 'https://seance-offerte.boxingcenter.fr/seance-essai-photo.jpg',
        label: `${first} ${last} · offerte · ${member}`,
      });
    }
  }

  console.log(`Candidats photo: ${jobs.length}`);
  const browser = await chromium.launch({ headless: process.env.DECIPLUS_HEADLESS !== 'false', slowMo: 40 });
  const ctx = await browser.newContext({
    storageState: STORAGE_FILE,
    locale: 'fr-FR',
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  await login(page, { siteLabel: 'Minimes' });

  const out = [];
  for (const job of jobs) {
    if (!job.force && !FORCE.has(String(job.deciplus_member_id))) {
      const already = await memberHasRealPhoto(page, job.deciplus_member_id).catch(() => false);
      if (already) {
        console.log('skip (photo déjà réelle)', job.label);
        out.push({ label: job.label, member: job.deciplus_member_id, status: 'skipped', error: null });
        continue;
      }
    }
    const order = normalizeOrder({ action: 'member_photo', ...job });
    console.log('→', job.label);
    const result = await processMemberPhotoJob(page, order);
    console.log('  ', result.status, result.deciplus_member_id, result.error || 'ok');
    out.push({
      label: job.label,
      member: result.deciplus_member_id,
      status: result.status,
      error: result.error || null,
    });
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'photo-backfill.json'), JSON.stringify(out, null, 2));
  await browser.close();
  const failed = out.filter((x) => x.status !== 'success' && x.status !== 'skipped');
  const ok = out.filter((x) => x.status === 'success').length;
  const skipped = out.filter((x) => x.status === 'skipped').length;
  console.log(`OK ${ok} · skip ${skipped} · fail ${failed.length} / ${out.length}`);
  process.exit(failed.length ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
