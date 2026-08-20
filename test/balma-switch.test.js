const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const { normalizeOrder, validateOrder, getJobId } = require('../lib/normalize');
const { isOpsOrder } = require('../lib/bot-forward');
const {
  shouldGiftBadgeComptant,
  validateBalmaSwitchPayload,
  inscriptionUrl,
  isAventureHost,
  shouldServeAventurePreview,
  listBalmaPrelevementOffers,
} = require('../lib/balma');
const { parseFrDates, productSearchFromLabel } = require('../bot/migrate-gym');
const { findProductInCatalog } = require('../bot/catalog');
const { BALMA_WA, fill } = require('../lib/campaign-templates');
const { robotsTxt } = require('../storefront/lib/seo');

test('balma_switch — action, job_id, validation nom/prénom', () => {
  const order = normalizeOrder({
    action: 'balma_switch',
    order_id: 'BALMA-1',
    first_name: 'Lea',
    last_name: 'Martin',
  });
  assert.equal(order.action, 'balma_switch');
  assert.equal(order.gym, 'minimes');
  assert.equal(getJobId(order), 'BALMA-1#balma_switch');
  assert.deepEqual(validateOrder(order), []);
  assert.equal(isOpsOrder(order), true);
});

test('balma_switch — sans nom → erreurs', () => {
  const order = normalizeOrder({ action: 'balma_switch', order_id: 'BALMA-2' });
  const errors = validateOrder(order);
  assert.ok(errors.includes('prénom manquant'));
  assert.ok(errors.includes('nom manquant'));
});

test('isOpsOrder — sale balma_retour n’est pas ops', () => {
  assert.equal(isOpsOrder({ action: 'sale', source: 'balma_retour' }), false);
});

test('badge comptant uniquement source=balma_retour + offre 29', () => {
  assert.equal(
    shouldGiftBadgeComptant({ source: 'balma_retour' }, { id: 'offre-duo' }),
    true
  );
  assert.equal(
    shouldGiftBadgeComptant({ source: 'balma_retour' }, { id: 'offre-saison' }),
    false
  );
  assert.equal(
    shouldGiftBadgeComptant({ source: 'storefront-payplug' }, { id: 'offre-duo' }),
    false
  );
});

test('formulaire aventure — refuse comptant', () => {
  const bad = validateBalmaSwitchPayload({
    first_name: 'Lea',
    last_name: 'Martin',
    email: 'lea@test.local',
    birthdate: '1991-08-10',
    offer: '29',
    prelevement: false,
  });
  assert.ok(bad.errors.length);
  assert.match(bad.errors[0], /prélèvement|comptant|club/i);

  const ok = validateBalmaSwitchPayload({
    prenom: 'Lea',
    nom: 'Martin',
    email: 'lea@test.local',
    birthdate: '1991-08-10',
    offer: 'offre-duo',
    prelevement: true,
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.offer, 'offre-duo');
  assert.equal(ok.birthdate, '1991-08-10');
  assert.equal(ok.email, 'lea@test.local');

  const saison = validateBalmaSwitchPayload({
    first_name: 'Lea',
    last_name: 'Martin',
    email: 'lea@test.local',
    birthdate: '1991-08-10',
    offer: '259',
    prelevement: true,
  });
  assert.deepEqual(saison.errors, []);
  assert.equal(saison.offer, 'offre-saison');
});

test('formulaire aventure — sans offre active → skip restore', () => {
  const none = validateBalmaSwitchPayload({
    first_name: 'Lea',
    last_name: 'Martin',
    email: 'lea@test.local',
    birthdate: '1991-08-10',
    offer: 'none',
    prelevement: true,
  });
  assert.deepEqual(none.errors, []);
  assert.equal(none.offer, 'none');
  assert.equal(none.skip_restore, true);

  const empty = validateBalmaSwitchPayload({
    first_name: 'Lea',
    last_name: 'Martin',
    email: 'lea@test.local',
    birthdate: '1991-08-10',
    prelevement: true,
  });
  assert.ok(empty.errors.some((e) => /offre/i.test(e)));
});

test('balma_switch — skip_restore persisté', () => {
  const { buildBalmaSwitchOrder } = require('../lib/balma');
  const built = buildBalmaSwitchOrder({
    first_name: 'Lea',
    last_name: 'Martin',
    birthdate: '1991-08-10',
    offer: 'none',
  });
  const order = normalizeOrder(built);
  assert.equal(order.skip_restore, true);
  assert.equal(order.offer, 'none');
  assert.deepEqual(order.snapshots, []);
});

test('formulaire aventure — date de naissance requise', () => {
  const missing = validateBalmaSwitchPayload({
    first_name: 'Lea',
    last_name: 'Martin',
    email: 'lea@test.local',
    offer: '29',
    prelevement: true,
  });
  assert.ok(missing.errors.some((e) => /naissance/i.test(e)));
});

test('formulaire aventure — email requis, identique à la fiche Balma', () => {
  const missing = validateBalmaSwitchPayload({
    first_name: 'Lea',
    last_name: 'Martin',
    birthdate: '1991-08-10',
    offer: '29',
    prelevement: true,
  });
  assert.ok(missing.errors.some((e) => /email/i.test(e)));
  const ok = validateBalmaSwitchPayload({
    first_name: 'Lea',
    last_name: 'Martin',
    birthdate: '1991-08-10',
    email: 'lea@test.local',
    offer: '29',
    prelevement: true,
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.email, 'lea@test.local');
  const insc = fs.readFileSync(path.join(__dirname, '..', 'storefront', 'public', 'js', 'inscription.js'), 'utf8');
  assert.match(insc, /id="pay_email"/);
  const preview = fs.readFileSync(path.join(__dirname, '..', 'storefront', 'views', 'aventure.html'), 'utf8');
  assert.match(preview, /name="email"/);
  assert.match(preview, /Email de ta fiche Balma/);
});

test('Aventure — email PSP synthétique, jamais sur la fiche', () => {
  const { aventurePspEmail } = require('../lib/balma');
  assert.equal(aventurePspEmail({ order_id: 'BC-99' }), 'aventure.bc-99@boxplus-test.local');
  assert.match(aventurePspEmail({}), /@boxplus-test\.local$/);
});

test('redirect inscription 29/259 avec source, aventure et préfill', () => {
  const url = inscriptionUrl({
    productId: 'offre-duo',
    firstName: 'Léa',
    lastName: 'Martin',
    birthdate: '1991-08-10',
    boutiqueBase: 'https://boutique.boxingcenter.fr',
  });
  assert.match(url, /product=offre-duo/);
  assert.match(url, /source=balma_retour/);
  assert.match(url, /aventure=1/);
  assert.match(url, /step=4/);
  assert.match(url, /prenom=/);
  assert.match(url, /nom=Martin/);
  assert.match(url, /birthdate=1991-08-10/);
});

test('parseFrDates + productSearchFromLabel', () => {
  const d = parseFrDates('OFFRE A 29€ du 01/09/2025 au 29/09/2025');
  assert.equal(d.start, '01/09/2025');
  assert.equal(d.end, '29/09/2025');
  assert.ok(productSearchFromLabel('OFFRE A 29€ du 01/09/2025').includes('OFFRE A 29'));
  const cleaned = productSearchFromLabel(
    'OFFRE DUO 29€ CONTRAT N°C2026-042313 vendu le 18/08/2026'
  );
  assert.match(cleaned, /OFFRE DUO 29/i);
  assert.doesNotMatch(cleaned, /CONTRAT/i);
});

test('catalogue — étudiant 34,99 ne matche pas DUO 29', () => {
  const catalog = [
    { id: 12, title: 'Badge', price: 34.99, type: 'decipass' },
    { id: 104, title: 'OFFRE DUO 29€', price: 29, type: 'abo', categoryId: 'abo' },
    { id: 87, title: 'OFFRE PROMO 34.99€ ETUDIANTS', price: 34.99, type: 'abo', categoryId: 'abo' },
    { id: 88, title: 'OFFRE PROMO 38.99€ ADULTE', price: 38.99, type: 'abo', categoryId: 'abo' },
  ];
  const etu = findProductInCatalog(catalog, {
    product_name: 'OFFRE PROMO 34.99€ ETUDIANTS',
    deciplus_product_search: 'ETUDIANTS 34.99',
    payment: { amount: 34.99 },
  });
  assert.equal(etu?.id, 87);
  const adu = findProductInCatalog(catalog, {
    product_name: 'OFFRE PROMO 38.99€ ADULTE',
    deciplus_product_search: 'ADULTE 38.99',
    payment: { amount: 38.99 },
  });
  assert.equal(adu?.id, 88);
});

test('catalogue — OFFRE A 29 matche OFFRE DUO 29€', () => {
  const matched = findProductInCatalog(
    [
      { id: 12, title: 'Badge', price: 34.99, type: 'decipass' },
      { id: 104, title: 'OFFRE DUO 29€', price: 29, type: 'abo', categoryId: 'abo' },
    ],
    {
      product_name: 'OFFRE A 29',
      deciplus_product_search: 'OFFRE A 29',
      payment: { amount: 29 },
    }
  );
  assert.equal(matched?.id, 104);
});

test('offres aventure — prélèvement uniquement, pas 259', () => {
  const offers = listBalmaPrelevementOffers();
  assert.ok(offers.length >= 1);
  assert.ok(offers.every((o) => !/259|saison|comptant/i.test(`${o.id} ${o.name} ${o.price_label}`)));
  assert.ok(
    offers.some((o) => o.id === 'offre-duo' || o.product_id === 'offre-duo' || /29/.test(o.price_label || ''))
  );
});

test('robots.txt Disallow /aventure', () => {
  const txt = robotsTxt();
  assert.match(txt, /Disallow: \/aventure/);
});

test('isAventureHost', () => {
  assert.equal(isAventureHost({ headers: { host: 'aventure.boxingcenter.fr' } }), true);
  assert.equal(isAventureHost({ headers: { host: 'boutique.boxingcenter.fr' } }), false);
});

test('14 variantes WhatsApp {prenom}', () => {
  assert.equal(BALMA_WA.length, 14);
  for (const tpl of BALMA_WA) {
    assert.match(tpl, /\{prenom\}/);
    assert.doesNotMatch(tpl, /###/);
    const filled = fill(tpl, { prenom: 'Léa', lien: 'https://aventure.boxingcenter.fr' });
    assert.doesNotMatch(filled, /\{prenom\}/);
    assert.match(filled, /Léa/);
    assert.match(filled, /aventure\.boxingcenter\.fr/);
  }
});

test('selectors migration + impayés présents', () => {
  const sel = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'deciplus-selectors.json'), 'utf8')
  );
  assert.ok(sel.member_migrate?.icon);
  assert.ok(sel.member_migrate?.confirm);
  assert.ok(sel.member_unpaid?.delete);
});

test('boutique ne sert plus /aventure', () => {
  const htmlPath = path.join(__dirname, '..', 'storefront', 'public', 'aventure.html');
  assert.equal(fs.existsSync(htmlPath), false);
  const vercel = fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8');
  assert.match(vercel, /aventure\.boxingcenter\.fr/);
});

test('preview Aventure en local ou studio, pas en prod anonyme', () => {
  assert.equal(shouldServeAventurePreview({ headers: { host: 'localhost:3040' } }), true);
  assert.equal(shouldServeAventurePreview({ headers: { host: '127.0.0.1:3040' } }), true);
  assert.equal(
    shouldServeAventurePreview({ headers: { host: 'boutique.boxingcenter.fr' } }),
    false
  );
  assert.equal(
    shouldServeAventurePreview({ headers: { host: 'boutique.boxingcenter.fr' } }, { studio: true }),
    true
  );
  const preview = path.join(__dirname, '..', 'storefront', 'views', 'aventure.html');
  const studio = fs.readFileSync(path.join(__dirname, '..', 'storefront', 'views', 'dev.html'), 'utf8');
  assert.equal(fs.existsSync(preview), true);
  assert.match(studio, /\/dev\/aventure/);
  const aventureHtml = fs.readFileSync(preview, 'utf8');
  assert.match(aventureHtml, /name="email"/);
  assert.doesNotMatch(aventureHtml, /name="phone"/);
});

test('Aventure — doublon Minimes, jamais migrer ni résilier', () => {
  const { aventureBotPolicy, isAventureOrder } = require('../lib/aventure-policy');
  const p = aventureBotPolicy();
  assert.equal(p.skip_cancel, true);
  assert.equal(p.skip_migrate, true);
  assert.equal(p.skip_restore, true);
  assert.equal(p.create_duplicate, true);
  assert.equal(p.search_gym, 'balma');
  assert.equal(p.create_gym, 'minimes');
  assert.equal(p.dispatch_after, 'payment');
  assert.equal(isAventureOrder({ source: 'balma_retour' }), true);
  const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'aventure-clone.js'), 'utf8');
  assert.doesNotMatch(src, /cancelSale\s*\(/);
  assert.doesNotMatch(src, /migrateMemberToGym\s*\(/);
  assert.doesNotMatch(src, /allowDuplicate/);
  assert.doesNotMatch(src, /clickCreerQuandMeme/);
  assert.match(src, /applyMinimesDuplicateIdentity/);
  assert.match(src, /sans mail ni téléphone/);
  assert.match(src, /resolveCreatedMemberId\(page, patched/);
  assert.match(src, /AVENTURE_MATCH_FIELDS/);
  assert.match(src, /clearMinimesContactFields/);
  assert.match(src, /downloadMemberPhoto/);
  assert.match(src, /setMemberIban/);
  const memberSrc = fs.readFileSync(path.join(__dirname, '..', 'bot', 'member.js'), 'utf8');
  assert.match(memberSrc, /prenom"]:not\(#i_prenom\)/);
  assert.match(src, /createMinimesMember/);
  assert.match(src, /Impossible d’ouvrir la salle Balma/);
  assert.match(src, /Impossible d’ouvrir la salle Minimes/);
});

test('Aventure — vente 29 et 259 après création Minimes, pas si unpaid / none', () => {
  const { shouldCreateChosenOfferSale } = require('../bot/aventure-clone');
  assert.equal(
    shouldCreateChosenOfferSale({
      payment: { status: 'paid' },
      product_id: 'offre-duo',
      offer: '29',
    }),
    true
  );
  assert.equal(
    shouldCreateChosenOfferSale({
      payment: { status: 'paid' },
      product_id: 'offre-saison',
      offer: '259',
    }),
    true
  );
  assert.equal(
    shouldCreateChosenOfferSale({
      payment: { status: 'unpaid' },
      product_id: 'offre-duo',
      offer: '29',
    }),
    false
  );
  assert.equal(
    shouldCreateChosenOfferSale({
      payment: { status: 'paid' },
      product_id: 'none',
      offer: 'none',
    }),
    false
  );
  const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'aventure-clone.js'), 'utf8');
  assert.match(src, /shouldGiftBadgeComptant/);
  assert.match(src, /paiement_comptant = true/);
  assert.match(src, /auto_badge = false/);
});

test('badge Aventure immédiat — CB, pas d’échec Clôturer obligatoire', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'sale.js'), 'utf8');
  assert.match(src, /async function finalizeImmediateBadgeCheckout/);
  assert.match(src, /finalizeBadgePayment\(page, productConfig, gymConfig\)/);
  const start = src.indexOf('async function finalizeImmediateBadgeCheckout');
  const end = src.indexOf('async function finalizeBadgePayment');
  const immediate = src.slice(start, end);
  assert.match(immediate, /Carte Bancaire/);
  assert.doesNotMatch(immediate, /throw new Error\('Badge — « Clôturer la note » introuvable'\)/);
  const gate = src.slice(end, end + 900);
  assert.match(gate, /finalizeImmediateBadgeCheckout/);
});

test('Aventure — mismatch email si la fiche ne correspond pas', () => {
  const { computeIdentityMismatches, AVENTURE_MATCH_FIELDS } = require('../bot/member');
  const mismatch = computeIdentityMismatches(
    {
      lastName: 'MARTIN',
      firstName: 'LEA',
      birth: '10/08/1991',
      email: 'lea@balma.test',
    },
    {
      last_name: 'Martin',
      first_name: 'Lea',
      birthdate: '1991-08-10',
      email: 'autre@balma.test',
    },
    { fields: AVENTURE_MATCH_FIELDS }
  );
  assert.deepEqual(mismatch.mismatchFields, ['email']);
  const ok = computeIdentityMismatches(
    {
      lastName: 'MARTIN',
      firstName: 'LEA',
      birth: '10/08/1991',
      email: 'Lea@Balma.test',
    },
    {
      last_name: 'Martin',
      first_name: 'Lea',
      birthdate: '1991-08-10',
      email: 'lea@balma.test',
    },
    { fields: AVENTURE_MATCH_FIELDS }
  );
  assert.deepEqual(ok.mismatchFields, []);
});

test('Aventure — prénom + Balma sur le doublon Minimes', () => {
  const {
    appendBalmaToFirstName,
    applyMinimesDuplicateIdentity,
  } = require('../lib/aventure-duplicate-address');
  assert.equal(appendBalmaToFirstName('Clara'), 'Clara Balma');
  assert.equal(appendBalmaToFirstName('Clara Balma'), 'Clara Balma');
  assert.equal(appendBalmaToFirstName(''), 'Balma');
  const balma = {
    last_name: 'Dup56075',
    first_name: 'Aventure',
    birthdate: '1992-03-15',
    email: 'aventure.dup56075@boxplus-test.local',
    phone: '0617871642',
    address: '8 rue Theron de Montauge',
    postal_code: '31130',
    city: 'Balma',
  };
  const minimes = applyMinimesDuplicateIdentity(balma);
  assert.equal(minimes.last_name, balma.last_name);
  assert.equal(minimes.first_name, 'Aventure Balma');
  assert.equal(minimes.birthdate, balma.birthdate);
  assert.equal(minimes.email, '');
  assert.equal(minimes.phone, '');
  assert.equal(minimes.address, balma.address);
  assert.equal(balma.first_name, 'Aventure');
  assert.equal(balma.email, 'aventure.dup56075@boxplus-test.local');
});

test('salles Boxing Center — Balma exclue de la vérif résil / changement', () => {
  const {
    boxingCenterGymsExceptBalma,
    isBalmaGymSlug,
    BOXING_CENTER_GYM_SLUGS,
  } = require('../lib/gym-slugs');
  assert.equal(isBalmaGymSlug('balma'), true);
  assert.equal(isBalmaGymSlug('minimes'), false);
  assert.ok(!BOXING_CENTER_GYM_SLUGS.includes('balma'));
  assert.equal(boxingCenterGymsExceptBalma('minimes')[0], 'minimes');
  assert.ok(!boxingCenterGymsExceptBalma('balma').includes('balma'));
  assert.ok(boxingCenterGymsExceptBalma().includes('portet'));
  const { isBalmaSaleTarget, assertNotBalmaSale, BALMA_SALE_ERROR } = require('../lib/gym-slugs');
  assert.equal(isBalmaSaleTarget({ key: 'balma' }), true);
  assert.equal(isBalmaSaleTarget({ key: 'minimes' }), false);
  assert.throws(() => assertNotBalmaSale({ deciplus_label: 'Balma' }, {}), (e) => e.message === BALMA_SALE_ERROR);
});

test('David, backoffice et tunnel Aventure — hors Balma / pas de retour', () => {
  const david = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'public', 'js', 'counselor-david.js'),
    'utf8'
  );
  const adminHtml = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'public', 'admin', 'index.html'),
    'utf8'
  );
  const ai = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'lib', 'counselor-ai.js'),
    'utf8'
  );
  const insc = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'public', 'js', 'inscription.js'),
    'utf8'
  );
  assert.match(david, /pas Balma/);
  assert.match(adminHtml, /Aventure Balma/);
  assert.match(adminHtml, />Origine</);
  const adminJs = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'public', 'js', 'admin.js'),
    'utf8'
  );
  assert.match(adminJs, /badge aventure/);
  const shell = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'public', 'js', 'admin-shell.js'),
    'utf8'
  );
  assert.match(shell, /pan-tag--aventure/);
  const mailer = fs.readFileSync(
    path.join(__dirname, '..', 'storefront', 'lib', 'mailer.js'),
    'utf8'
  );
  assert.match(mailer, /Confirmation Aventure Boxing Center/);
  assert.match(ai, /JAMAIS sur Balma/);
  assert.match(insc, /lockAventureBackNav/);
  assert.match(insc, /if \(isBalmaRetour\(\)\) return ''/);
  assert.match(insc, /id="pay_email"/);
  assert.doesNotMatch(insc, /pay_phone/);
  assert.doesNotMatch(insc, /needAventureContact/);
});

test('toAdminSummary — flag Aventure', () => {
  const { toAdminSummary } = require('../storefront/lib/order-lifecycle');
  const s = toAdminSummary({
    order_id: 'AV-1',
    source: 'balma_retour',
    aventure: true,
    customer_short: { first_name: 'Lea', last_name: 'Martin' },
    gym: 'minimes',
  });
  assert.equal(s.aventure, true);
  assert.equal(s.source, 'balma_retour');
  assert.equal(s.origine, 'Aventure Balma');
});
