'use strict';

const crypto = require('crypto');
const { adultOfferAgeError } = require('../../lib/billing-plan');

const CLUB_CUSTOM_OFFER_EMAIL = 'boxingcenter31@gmail.com';

const GYM_SLUGS = new Set([
  'minimes',
  'ramonville',
  'portet',
  'etats-unis',
  'st-cyprien',
  'balma',
]);

const GYM_LABELS = {
  minimes: 'Minimes',
  ramonville: 'Ramonville',
  portet: 'Portet',
  'etats-unis': 'États-Unis',
  'st-cyprien': 'Saint-Cyprien',
  balma: 'Balma',
};

function formatPriceLabel(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n) || n <= 0) return '';
  const euros = n / 100;
  if (Number.isInteger(euros)) return `${euros} €`;
  return `${euros.toFixed(2).replace('.', ',')} €`;
}

function parsePriceCents(input = {}) {
  if (input.price_cents != null && input.price_cents !== '') {
    const cents = Math.round(Number(input.price_cents));
    if (Number.isFinite(cents) && cents > 0 && cents <= 500000) return cents;
  }
  const raw = String(input.price_euros ?? input.price ?? '').trim().replace(',', '.');
  const euros = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(euros) || euros <= 0 || euros > 5000) return null;
  return Math.round(euros * 100);
}

function normalizeMode(value) {
  const mode = String(value || '').toLowerCase().trim();
  if (mode === 'comptant_4x' || mode === 'comptant-4x' || mode === '4x' || mode === 'fourx') {
    return 'comptant_4x';
  }
  if (mode === 'comptant') return 'comptant';
  if (mode === 'abonnement' || mode === 'prelevement' || mode === 'prélèvement' || mode === 'rib') {
    return 'abonnement';
  }
  return null;
}

function parseAllow4x(input = {}, mode = '') {
  if (mode === 'abonnement') return false;
  if (mode === 'comptant_4x') return true;
  const raw = input.allow_4x ?? input.four_x ?? input.installments;
  if (raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'oui' || raw === 'on') return true;
  return false;
}

function parsePartySize(input = {}) {
  const raw = input.party_size ?? input.people ?? input.nb_personnes ?? input.persons;
  const n = Math.round(Number(raw == null || raw === '' ? 1 : raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(4, n);
}

function isCustomOfferOrder(order = {}) {
  if (!order) return false;
  if (String(order.source || '').toLowerCase() === 'custom_offer') return true;
  if (String(order.product_snapshot?.sale_type || '') === 'custom') return true;
  return String(order.product_id || order.product_snapshot?.id || '').startsWith('custom-');
}

function partySizeOf(order = {}) {
  return parsePartySize({
    party_size: order.party_size || order.product_snapshot?.party_size,
  });
}

function clubCustomOfferEmail() {
  return String(process.env.CUSTOM_OFFER_CLUB_EMAIL || CLUB_CUSTOM_OFFER_EMAIL).trim() || CLUB_CUSTOM_OFFER_EMAIL;
}

function normalizePerson(input = {}) {
  return {
    first_name: String(input.first_name || '').trim(),
    last_name: String(input.last_name || '').trim(),
    email: String(input.email || '').trim(),
    phone: String(input.phone || input.telephone || '').trim(),
    birthdate: String(input.birthdate || '').trim(),
    gender: String(input.gender || '').trim(),
  };
}

function parseCompanions(raw, partySize = 1) {
  const extra = Math.max(0, parsePartySize({ party_size: partySize }) - 1);
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (let i = 0; i < extra; i++) out.push(normalizePerson(list[i] || {}));
  return out;
}

function validateCompanion(person, index, product = {}) {
  const n = index + 2;
  const errors = [];
  if (!person.first_name) errors.push(`Personne ${n} : prénom requis`);
  if (!person.last_name) errors.push(`Personne ${n} : nom requis`);
  if (!person.birthdate) errors.push(`Personne ${n} : date de naissance requise`);
  else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(person.birthdate)) {
      errors.push(`Personne ${n} : date de naissance invalide`);
    } else {
      const ageErr = adultOfferAgeError(person.birthdate, product);
      if (ageErr) errors.push(`Personne ${n} : ${ageErr}`);
    }
  }
  if (!person.email && !person.phone) {
    errors.push(`Personne ${n} : email ou téléphone requis`);
  }
  return errors;
}

function validateCompanions(companions, partySize, product = {}) {
  const extra = Math.max(0, parsePartySize({ party_size: partySize }) - 1);
  const errors = [];
  const list = Array.isArray(companions) ? companions : [];
  if (list.length < extra) errors.push(`Il manque les infos de ${extra - list.length} personne(s)`);
  for (let i = 0; i < extra; i++) {
    errors.push(...validateCompanion(list[i] || {}, i, product));
  }
  return errors;
}

function peopleLabel(n) {
  const size = parsePartySize({ party_size: n });
  if (size <= 1) return '1 personne';
  return `${size} personnes`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function personLines(person = {}, title) {
  const gender =
    person.gender === 'F' ? 'Femme' : person.gender === 'M' ? 'Homme' : person.gender || '—';
  return [
    title,
    `Nom : ${person.first_name || '—'} ${person.last_name || ''}`.trim(),
    `Email : ${person.email || '—'}`,
    `Téléphone : ${person.phone || '—'}`,
    `Naissance : ${person.birthdate || '—'}`,
    `Sexe : ${gender}`,
  ];
}

function buildCustomOfferClubRecap(order = {}) {
  const product = order.product_snapshot || {};
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const gym = full.gym || order.gym || '';
  const gymName = GYM_LABELS[gym] || gym || '—';
  const size = partySizeOf(order);
  const pay = order.payment || {};
  const plan =
    pay.payment_plan === '4x'
      ? '4× sans frais'
      : product.supports_installment_choice
        ? pay.payment_plan === 'once'
          ? 'Comptant 1×'
          : product.installments_note || 'Comptant (1× ou 4×)'
        : product.requires_iban
          ? 'Abonnement 4 semaines'
          : 'Comptant';
  const payer = {
    ...short,
    gender: full.gender,
    email: short.email || full.email,
    phone: short.phone || full.phone,
    birthdate: short.birthdate || full.birthdate,
  };
  const companions = Array.isArray(order.companions) ? order.companions : [];
  const address = [full.address, full.postal_code, full.city].filter(Boolean).join(', ') || '—';
  const peopleBlocks = [
    personLines(payer, 'Personne 1 (payeur)').concat([`Adresse : ${address}`]),
    ...companions.map((p, i) => personLines(p, `Personne ${i + 2}`)),
  ];
  const text = [
    'Offre personnalisée confirmée — à créer dans Deciplus',
    `Référence : ${order.order_id || ''}`,
    `Offre : ${product.display_name || product.name || 'Offre personnalisée'}`,
    `Prix : ${product.price_label || '—'}`,
    `Paiement : ${plan}`,
    `Statut paiement : ${pay.status || '—'}`,
    `Salle : ${gymName}`,
    `Personnes : ${peopleLabel(size)}`,
    '',
    ...peopleBlocks.flatMap((block) => [...block, '']),
  ].join('\n');
  const htmlPeople = peopleBlocks
    .map((block) => {
      const [title, ...rows] = block;
      return `<h3 style="margin:20px 0 8px;color:#0B1F3A">${escapeHtml(title)}</h3>
      <table style="width:100%;border-collapse:collapse">${rows
        .map((row) => {
          const [label, ...rest] = String(row).split(' : ');
          return `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;width:140px"><strong>${escapeHtml(
            label
          )}</strong></td><td style="padding:6px 8px;border-bottom:1px solid #eee">${escapeHtml(
            rest.join(' : ')
          )}</td></tr>`;
        })
        .join('')}</table>`;
    })
    .join('');
  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Offre perso ${escapeHtml(order.order_id || '')}</title></head>
<body style="font-family:Arial,sans-serif;color:#1A1A2E;max-width:640px;margin:0 auto;padding:24px">
  <p style="display:inline-block;background:#20254B;color:#fff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:6px 10px;border-radius:999px;margin:0 0 16px">Offre personnalisée</p>
  <h1 style="color:#0B1F3A;margin:0 0 12px">Dossier à créer (${escapeHtml(peopleLabel(size))})</h1>
  <p>Le paiement est passé. Voici les infos à reprendre pour ${escapeHtml(peopleLabel(size))}.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Référence</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(order.order_id || '')}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Offre</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(product.display_name || product.name || '')}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Prix</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(product.price_label || '')}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Paiement</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(plan)} — ${escapeHtml(pay.status || '')}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Salle</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(gymName)}</td></tr>
  </table>
  ${htmlPeople}
  <p style="color:#5C6370;font-size:13px">Boxing Center — offre personnalisée boutique</p>
</body>
</html>`;
  const sizeLabel = peopleLabel(size);
  return {
    to: clubCustomOfferEmail(),
    subject: `Offre perso ${order.order_id || ''} — ${sizeLabel} — ${product.price_label || ''}`.trim(),
    text,
    html,
  };
}

function normalizeGym(value) {
  const gym = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  return GYM_SLUGS.has(gym) ? gym : null;
}

function normalizeCustomerShort(input = {}) {
  const first_name = String(input.first_name || '').trim();
  const last_name = String(input.last_name || '').trim();
  const email = String(input.email || '').trim();
  const phone = String(input.phone || input.telephone || '').trim();
  const birthdate = String(input.birthdate || '').trim();
  if (!first_name && !last_name && !email && !phone) return null;
  return { first_name, last_name, email, phone, birthdate };
}

function buildCustomOfferProduct(input = {}) {
  const cents = parsePriceCents(input);
  if (!cents) {
    const err = new Error('Indique un prix valide (ex. 39 ou 39,90)');
    err.status = 400;
    throw err;
  }
  const mode = normalizeMode(input.mode || input.payment_mode);
  if (!mode) {
    const err = new Error('Choisis comptant, 1× ou 4×, ou abonnement');
    err.status = 400;
    throw err;
  }
  const allow4x = parseAllow4x(input, mode);
  const comptant = mode === 'comptant' || mode === 'comptant_4x';
  const priceLabel = formatPriceLabel(cents);
  const customName = String(input.label || input.name || '').trim();
  const id = `custom-${crypto.randomBytes(4).toString('hex')}`;
  const name =
    customName ||
    (!comptant
      ? `Offre personnalisée ${priceLabel} / 4 semaines`
      : allow4x
        ? `Offre personnalisée ${priceLabel} (1× ou 4×)`
        : `Offre personnalisée ${priceLabel} comptant`);
  const quartLabel = formatPriceLabel(Math.round(cents / 4));
  const partySize = parsePartySize(input);
  const people = peopleLabel(partySize);
  const peopleNote =
    partySize > 1
      ? ` Offre pour ${people} : au dossier, chaque personne complète les infos manquantes.`
      : ' Au dossier, complétez uniquement les infos encore manquantes.';
  return {
    id,
    name,
    display_name: name,
    description: (!comptant
      ? 'Offre négociée avec Boxing Center. 1ʳᵉ échéance CB, puis prélèvement toutes les 4 semaines, sans engagement.'
      : allow4x
        ? `Offre négociée avec Boxing Center. Paiement ${priceLabel} en une fois ou en 4× sans frais (${quartLabel} par échéance), puis dossier d’inscription.`
        : 'Offre négociée avec Boxing Center. Paiement comptant, puis dossier d’inscription.') + peopleNote,
    price_cents: cents,
    price_label: priceLabel,
    stripe_price_label: priceLabel,
    requires_iban: !comptant,
    requires_payment: true,
    supports_billing_choice: false,
    supports_installment_choice: Boolean(comptant && allow4x),
    installments_note: comptant && allow4x ? 'En une fois ou en 4× sans frais' : null,
    tab: 'abonnements',
    subsection: comptant ? 'comptant' : 'prelevement',
    duration_label: comptant ? (allow4x ? '1× ou 4× sans frais' : 'Comptant') : 'Toutes les 4 semaines',
    badge: !comptant ? 'Sans engagement' : allow4x ? '1× ou 4×' : 'Comptant',
    party_size: partySize,
    benefits: [
      'Accès aux 5 salles Boxing Center',
      'Cours illimités toutes disciplines',
      !comptant
        ? `${priceLabel} toutes les 4 semaines, sans engagement`
        : allow4x
          ? `${priceLabel} en 1×, ou 4× sans frais (${quartLabel} × 4)`
          : `Paiement unique ${priceLabel}`,
      partySize > 1 ? `Pour ${people} (infos de chacun au dossier)` : 'Dossier : uniquement les infos encore manquantes',
    ],
    sale_type: 'custom',
  };
}

function prepareCustomOffer(input = {}) {
  const product = buildCustomOfferProduct(input);
  return {
    product_id: product.id,
    product,
    customer_short: normalizeCustomerShort(input),
    gym: normalizeGym(input.gym),
    source: 'custom_offer',
    party_size: product.party_size,
  };
}

function landingUrl(order, storeUrl) {
  const base = String(storeUrl || '').replace(/\/+$/, '');
  const qs = new URLSearchParams({
    order: String(order?.order_id || ''),
    token: String(order?.access_token || ''),
  });
  return `${base}/offre-perso?${qs}`;
}

module.exports = {
  CLUB_CUSTOM_OFFER_EMAIL,
  formatPriceLabel,
  parsePriceCents,
  normalizeMode,
  normalizeGym,
  normalizeCustomerShort,
  parseAllow4x,
  parsePartySize,
  parseCompanions,
  validateCompanions,
  partySizeOf,
  peopleLabel,
  isCustomOfferOrder,
  clubCustomOfferEmail,
  buildCustomOfferClubRecap,
  buildCustomOfferProduct,
  prepareCustomOffer,
  landingUrl,
};
