'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.BOXPLUS_BILLETS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'billets-'));
delete process.env.VERCEL;

const bil = require('../storefront/lib/billetterie');
const { confirmerCommande, montantPaypal } = require('../storefront/lib/billetterie-routes');

const BASE = 'https://boutique.boxingcenter.fr';

test('catalogue : 4 billets aux bons prix', () => {
  const prix = Object.fromEntries(bil.listeProduits().map((p) => [p.id, p.prix_cents]));
  assert.deepStrictEqual(prix, { vendredi: 1500, samedi: 1000, dimanche: 500, weekend: 2000 });
});

test('validation : nom, prenom, mail et moyen de paiement obligatoires', () => {
  const ko = bil.validerCommande({ produit: 'stripe', prenom: '', nom: 'x', email: 'pas-un-mail', methode: 'stripe' });
  const champs = ko.errors.map((e) => e.field).sort();
  assert.deepStrictEqual(champs, ['email', 'methode', 'nom', 'prenom', 'produit']);
  const ok = bil.validerCommande({ produit: 'weekend', prenom: 'Brad', nom: 'Bruel', email: 'Brad@Exemple.fr', methode: 'paypal', quantite: '3' });
  assert.strictEqual(ok.errors.length, 0);
  assert.strictEqual(ok.data.email, 'brad@exemple.fr');
  assert.strictEqual(ok.data.quantite, 3);
});

test('seuls PayPal et PayPlug sont acceptes', () => {
  assert.deepStrictEqual(bil.METHODES, ['paypal', 'payplug']);
  for (const m of ['stripe', 'scalapay', 'cawl', 'demo']) {
    const { errors } = bil.validerCommande({ produit: 'samedi', prenom: 'Al', nom: 'Bo', email: 'a@b.fr', methode: m });
    assert.ok(errors.some((e) => e.field === 'methode'), m);
  }
});

test('commande : conserve le code src court', () => {
  const { data } = bil.validerCommande({
    produit: 'samedi',
    prenom: 'Eddy',
    nom: 'Test',
    email: 'e@t.fr',
    methode: 'payplug',
    src: 'CBX!!!',
  });
  assert.equal(data.src, 'cbx');
  const c = bil.creerCommande(data);
  assert.equal(c.src, 'cbx');
});

test('commande : total, codes uniques, acces par jeton', () => {
  const { data } = bil.validerCommande({ produit: 'vendredi', prenom: 'Eddy', nom: 'Test', email: 'e@t.fr', methode: 'payplug', quantite: 4 });
  const c = bil.creerCommande(data);
  assert.strictEqual(c.total_cents, 6000);
  assert.strictEqual(c.billets.length, 4);
  assert.strictEqual(new Set(c.billets.map((b) => b.code)).size, 4);
  assert.match(c.billets[0].code, /^FF-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(bil.idSur(c.order_id));
  assert.ok(bil.verifierAcces(c, c.access_token));
  assert.ok(!bil.verifierAcces(c, 'mauvais'));
  const pub = bil.vuePublique(c);
  assert.strictEqual(pub.billets.length, 0, 'pas de codes avant paiement');
  assert.ok(!('access_token' in pub));
});

test('QR code PNG contenant le lien du billet', async () => {
  const { data } = bil.validerCommande({ produit: 'dimanche', prenom: 'Lea', nom: 'Petit', email: 'l@p.fr', methode: 'paypal' });
  const c = bil.creerCommande(data);
  const contenu = bil.contenuQr(BASE, c, c.billets[0]);
  assert.ok(contenu.startsWith(`${BASE}/billet?id=${c.order_id}&t=`));
  const png = await bil.qrPng(contenu);
  assert.deepStrictEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('confirmation : marque payee, envoie le billet une seule fois avec QR en piece jointe', async () => {
  const { data } = bil.validerCommande({ produit: 'weekend', prenom: 'Brad', nom: 'Bruel', email: 'brad@exemple.fr', methode: 'payplug', quantite: 2 });
  const c = bil.creerCommande(data);
  await bil.enregistrerCommande(c);

  const refus = await confirmerCommande(c, BASE, { verifier: async () => ({ paid: false, pending: true }) });
  assert.strictEqual(refus.ok, false);
  assert.strictEqual((await bil.chargerCommande(c.order_id)).status, 'pending');

  const envois = [];
  const brevo = require('../storefront/lib/brevo-send');
  const original = brevo.sendEmailViaBrevo;
  brevo.sendEmailViaBrevo = async (m) => { envois.push(m); return { sent: true }; };
  try {
    const ok = await confirmerCommande(c, BASE, { verifier: async () => ({ paid: true }) });
    assert.strictEqual(ok.ok, true);
    const relu = await bil.chargerCommande(c.order_id);
    assert.strictEqual(relu.status, 'paid');
    assert.ok(relu.emailed_at);
    await confirmerCommande(relu, BASE, { verifier: async () => ({ paid: true }) });
  } finally {
    brevo.sendEmailViaBrevo = original;
  }
  const client = envois.filter((m) => m.to === 'brad@exemple.fr');
  assert.strictEqual(client.length, 1, 'un seul mail client');
  assert.strictEqual(client[0].attachments.length, 2);
  assert.match(client[0].text, /Brad Bruel/);
  assert.match(client[0].text, /FF-/);
  const internes = envois.map((m) => m.to).filter((t) => t !== 'brad@exemple.fr').sort();
  assert.deepStrictEqual(internes, ['boxingcenter31@gmail.com', 'contact@moteka.fr']);
});

test('montant PayPal lu sur la capture', () => {
  const order = { purchase_units: [{ amount: { value: '20.00' }, payments: { captures: [{ status: 'COMPLETED', amount: { value: '20.00' } }] } }] };
  assert.strictEqual(montantPaypal(order), 2000);
});
