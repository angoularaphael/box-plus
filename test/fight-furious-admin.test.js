'use strict';

/**
 * Back-office FIGHT & Furious : logique pure (agregats, CSV, tables absentes)
 * et protection des endpoints (401 sans session).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ff = require('../storefront/lib/fight-furious-admin');

const BASE = 'https://boutique.boxingcenter.fr';

function row({ id, produit, status = 'paid', quantite = 1, total, methode = 'paypal', paid_at = '2026-11-10T10:00:00.000Z', codes = ['FF-AAAA-BBBB'], src = '' }) {
  return {
    order_id: id,
    produit,
    status,
    quantite,
    total_cents: total,
    email: 'brad@exemple.fr',
    created_at: '2026-11-10T09:00:00.000Z',
    payload: {
      order_id: id,
      access_token: 'tok123',
      produit,
      produit_nom: `Billet ${produit}`,
      client: { prenom: 'Brad', nom: 'Bruel', email: 'brad@exemple.fr' },
      billets: codes.map((code, i) => ({ numero: i + 1, code })),
      payment: { method: methode, status },
      paid_at: status === 'paid' ? paid_at : undefined,
      status,
      src,
    },
  };
}

test('ligneCommande et stats : source src conservee', () => {
  const c = ff.ligneCommande(row({ id: 'BIL-src', produit: 'samedi', total: 1000, src: 'cbx' }), BASE);
  assert.equal(c.src, 'cbx');
  const s = ff.statsBillets([c]);
  assert.equal(s.par_source.length, 1);
  assert.equal(s.par_source[0].src, 'cbx');
  assert.equal(s.par_source[0].label, 'Combat Boxe');
  assert.equal(s.par_source[0].billets, 1);
});

test('ligneCommande : champs a plat et lien du billet avec le jeton', () => {
  const c = ff.ligneCommande(row({ id: 'BIL-1763000000000-abcdef', produit: 'weekend', quantite: 2, total: 4000, codes: ['FF-A', 'FF-B'] }), BASE);
  assert.equal(c.prenom, 'Brad');
  assert.equal(c.quantite, 2);
  assert.equal(c.total_cents, 4000);
  assert.deepEqual(c.codes, ['FF-A', 'FF-B']);
  assert.equal(c.lien, `${BASE}/billet?id=BIL-1763000000000-abcdef&t=tok123`);
});

test('statsBillets : billets par produit, CA, PayPal/PayPlug, en attente', () => {
  const commandes = [
    row({ id: 'a', produit: 'vendredi', quantite: 2, total: 3000, methode: 'paypal' }),
    row({ id: 'b', produit: 'samedi', quantite: 1, total: 1000, methode: 'payplug' }),
    row({ id: 'c', produit: 'weekend', quantite: 3, total: 6000, methode: 'payplug' }),
    row({ id: 'd', produit: 'dimanche', quantite: 5, total: 2500, status: 'pending' }),
  ].map((r) => ff.ligneCommande(r, BASE));
  const s = ff.statsBillets(commandes);
  assert.equal(s.commandes_payees, 3);
  assert.equal(s.billets_payes, 6);
  assert.equal(s.ca_cents, 10000);
  assert.equal(s.en_attente, 1);
  const p = Object.fromEntries(s.par_produit.map((x) => [x.id, x.billets]));
  assert.deepEqual(p, { vendredi: 2, samedi: 1, dimanche: 0, weekend: 3 });
  assert.deepEqual(s.methodes.paypal, { commandes: 1, ca_cents: 3000 });
  assert.deepEqual(s.methodes.payplug, { commandes: 2, ca_cents: 7000 });
});

test('ventesParJour : 14 jours, ventes payees uniquement', () => {
  const maintenant = new Date('2026-11-18T12:00:00.000Z');
  const commandes = [
    row({ id: 'a', produit: 'samedi', quantite: 2, total: 2000, paid_at: '2026-11-18T08:00:00.000Z' }),
    row({ id: 'b', produit: 'samedi', quantite: 1, total: 1000, paid_at: '2026-11-17T08:00:00.000Z' }),
    row({ id: 'c', produit: 'samedi', quantite: 9, total: 9000, status: 'pending' }),
  ].map((r) => ff.ligneCommande(r, BASE));
  const jours = ff.ventesParJour(commandes, { maintenant });
  assert.equal(jours.length, 14);
  assert.equal(jours.at(-1).jour, '2026-11-18');
  assert.equal(jours.at(-1).billets, 2);
  assert.equal(jours.at(-2).billets, 1);
  assert.equal(jours.reduce((n, j) => n + j.billets, 0), 3);
});

const participants = [
  { id: 'p1', prenom: 'Ali', nom: 'Ben', telephone: '0600000001', email: 'ali@x.fr', amis: [{ prenom: 'Zoe', email: 'zoe@x.fr' }, { prenom: 'Max' }], avis_statut: 'a_verifier', tickets: 4 },
  { id: 'p2', prenom: 'Eva', nom: 'Doe', telephone: '0600000002', email: 'eva@x.fr', amis: [], avis_statut: 'valide', tickets: 2 },
  { id: 'p3', prenom: 'Leo', nom: 'Roy', telephone: '', email: 'leo@x.fr', amis: null, avis_statut: null, tickets: 1 },
];
const tickets = [
  { numero: 3, participant_id: 'p1', motif: 'amis' },
  { numero: 1, participant_id: 'p1', motif: 'inscription' },
  { numero: 2, participant_id: 'p2', motif: 'inscription' },
  { numero: 4, participant_id: 'p2', motif: 'avis' },
  { numero: 5, participant_id: 'p3', motif: 'inscription' },
];
const lots = [{ id: 'l1', ordre: 1, nom: 'Casque moto', actif: true }];
const tirages = [{ id: 't1', date_tirage: '2026-11-23', numero: 4, participant_id: 'p2', lot_id: 'l1' }];

test('lignesParticipants et statsConcours : tickets tries, amis, avis, gagnants', () => {
  const lignes = ff.lignesParticipants(participants, tickets, tirages, lots);
  assert.deepEqual(lignes[0].tickets.map((t) => t.numero), [1, 3]);
  assert.equal(lignes[0].amis.length, 2);
  assert.equal(lignes[2].avis_statut, 'aucun');
  assert.equal(lignes[1].gains[0].lot, 'Casque moto');
  const s = ff.statsConcours(lignes, tickets);
  assert.equal(s.inscrits, 3);
  assert.equal(s.tickets, 5);
  assert.equal(s.avec_amis, 1);
  assert.equal(s.amis_invites, 2);
  assert.equal(s.gagnants, 1);
  assert.deepEqual(s.avis, { aucun: 1, a_verifier: 1, valide: 1, refuse: 0 });
});

test('planningTirages : 6 dates du 23 au 28 novembre, gagnant et lot renseignes', () => {
  const plan = ff.planningTirages(tirages, lots, participants);
  assert.equal(plan.length, 6);
  assert.deepEqual(plan.map((t) => t.date_tirage), ff.DATES_TIRAGE);
  assert.equal(plan[0].gagnant, 'Eva Doe');
  assert.equal(plan[0].lot, 'Casque moto');
  assert.equal(plan[0].a_venir, false);
  assert.ok(plan.slice(1).every((t) => t.a_venir));
});

test('CSV : separateur ;, BOM, guillemets, pas de formule', () => {
  assert.equal(ff.celluleCsv('a;b'), '"a;b"');
  assert.equal(ff.celluleCsv('il a dit "oui"'), '"il a dit ""oui"""');
  assert.equal(ff.celluleCsv('=SUM(A1)'), "'=SUM(A1)");
  const csv = ff.csvBillets([ff.ligneCommande(row({ id: 'BIL-1763000000000-abcdef', produit: 'samedi', total: 1050, codes: ['FF-1', 'FF-2'] }), BASE)]);
  assert.ok(csv.startsWith('﻿Date;Commande;Prenom;Nom;Email;Produit'));
  const ligne = csv.split('\r\n')[1];
  assert.match(ligne, /;10,50;PayPal;FF-1 FF-2;;https:\/\/boutique\.boxingcenter\.fr\/billet\?id=/);
  const csvP = ff.csvParticipants(ff.lignesParticipants(participants, tickets, tirages, lots));
  const lignes = csvP.trim().split('\r\n');
  assert.equal(lignes.length, 4);
  assert.match(lignes[1], /1 \(inscription\), 3 \(amis\)/);
  assert.match(lignes[2], /2026-11-23 Casque moto/);
});

test('tableManquante : relation absente et cache de schema PostgREST', () => {
  assert.equal(ff.tableManquante({ code: '42P01', message: 'x' }), true);
  assert.equal(ff.tableManquante({ code: 'PGRST205', message: 'x' }), true);
  assert.equal(ff.tableManquante({ message: 'relation "public.moteka_concours" does not exist' }), true);
  assert.equal(ff.tableManquante({ message: "Could not find the table 'public.moteka_lots' in the schema cache" }), true);
  assert.equal(ff.tableManquante({ message: 'timeout' }), false);
  assert.equal(ff.TABLES_MANQUANTES, 'Tables a creer : executer les SQL');
});

test('liensMoteka : URL configurable par MOTEKA_ADMIN_URL', () => {
  const avant = process.env.MOTEKA_ADMIN_URL;
  delete process.env.MOTEKA_ADMIN_URL;
  assert.deepEqual(ff.liensMoteka(), {
    admin: 'https://fight-and-furious.boxingcenter.fr/admin',
    tirage: 'https://fight-and-furious.boxingcenter.fr/admin/tirage',
  });
  process.env.MOTEKA_ADMIN_URL = 'https://autre.exemple/admin/';
  assert.equal(ff.liensMoteka().tirage, 'https://autre.exemple/admin/tirage');
  if (avant === undefined) delete process.env.MOTEKA_ADMIN_URL;
  else process.env.MOTEKA_ADMIN_URL = avant;
});

test('resumeStats ne leve jamais, meme sans Supabase', async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pub = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    const r = await ff.resumeStats();
    assert.equal(r.ok, false);
    assert.equal(r.billetterie.ok, false);
    assert.equal(r.concours.ok, false);
    assert.equal(r.page, '/admin/fight-furious');
  } finally {
    if (url !== undefined) process.env.SUPABASE_URL = url;
    if (key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    if (pub !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = pub;
  }
});

test('HTTP : endpoints FIGHT & Furious en 401 sans session, page /admin/fight-furious en no-store', async () => {
  process.env.NODE_ENV = 'test';
  process.env.VERCEL = '';
  process.env.BOXPLUS_ORDERS_REMOTE = '0';
  process.env.BOXPLUS_ORDERS_DIR = path.join(os.tmpdir(), `boxplus-ff-${Date.now()}`);
  process.env.BOXPLUS_MERCH_FILE = path.join(os.tmpdir(), `boxplus-ff-merch-${Date.now()}.json`);
  process.env.BOXPLUS_MATERIEL_CATALOG_FILE = path.join(os.tmpdir(), `boxplus-ff-catalog-${Date.now()}.json`);
  const envVide = path.join(os.tmpdir(), `boxplus-ff-env-${Date.now()}`);
  fs.writeFileSync(envVide, '');
  process.env.BOXPLUS_TEST_ENV_FILE = envVide;
  require('../storefront/lib/test-env').resetTestFileCache();

  const { createApp } = require('../storefront/server');
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const appels = [
      ['GET', '/api/admin/fight-furious/resume'],
      ['GET', '/api/admin/fight-furious/billetterie'],
      ['GET', '/api/admin/fight-furious/billetterie/export.csv'],
      ['POST', '/api/admin/fight-furious/billetterie/BIL-1763000000000-abcdef/renvoyer'],
      ['GET', '/api/admin/fight-furious/concours'],
      ['GET', '/api/admin/fight-furious/concours/export.csv'],
      ['GET', '/api/admin/fight-furious/concours/00000000-0000-0000-0000-000000000000/preuve'],
      ['GET', '/api/admin/fight-furious/tirages'],
    ];
    for (const [method, url] of appels) {
      const res = await fetch(`${base}${url}`, { method });
      assert.equal(res.status, 401, `${method} ${url}`);
      const data = await res.json();
      assert.equal(data.ok, false);
    }
    const page = await fetch(`${base}/admin/fight-furious`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(await page.text(), /FIGHT &amp; Furious/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
