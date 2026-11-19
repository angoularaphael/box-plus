'use strict';

/**
 * Billetterie FIGHT & Furious (Boxing Center x Moteka, 11-13 decembre 2026).
 * Paiement : PayPal Boxing Center (compte minimes) ou PayPlug uniquement.
 * Persistance : Supabase (table boxplus_billets) sur Vercel, fichiers en local.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const EVENEMENT = {
  nom: 'FIGHT & Furious',
  sous_titre: 'Boxing Center x Moteka',
  dates: '11, 12 et 13 décembre 2026',
  ville: 'Toulouse',
  lieu: 'Garage Moteka, 14 rue Seveso, 31150 Fenouillet',
};

const PRODUITS = {
  vendredi: {
    id: 'vendredi',
    nom: 'Vendredi 11 décembre',
    detail: 'Gala Boxe Amateur Élites - dès 19h00',
    jours: ['Vendredi 11 décembre'],
    prix_cents: 1500,
  },
  samedi: {
    id: 'samedi',
    nom: 'Samedi 12 décembre',
    detail: 'Boxing Trophy 20 - dès 19h00',
    jours: ['Samedi 12 décembre'],
    prix_cents: 1000,
  },
  dimanche: {
    id: 'dimanche',
    nom: 'Dimanche 13 décembre - place enfant',
    detail: 'Compétition de Boxe Éducative - dès 11h00',
    jours: ['Dimanche 13 décembre'],
    prix_cents: 500,
  },
  weekend: {
    id: 'weekend',
    nom: 'Pack week-end complet',
    detail: 'Accès aux 3 jours : vendredi, samedi et dimanche',
    jours: ['Vendredi 11 décembre', 'Samedi 12 décembre', 'Dimanche 13 décembre'],
    prix_cents: 2000,
  },
};

const METHODES = ['paypal', 'payplug'];
const QUANTITE_MAX = 10;
const TABLE = 'boxplus_billets';
const NOTIFY_DEFAULT = ['boxingcenter31@gmail.com', 'contact@moteka.fr'];

function listeProduits() {
  return Object.values(PRODUITS).map((p) => ({ ...p }));
}

function trouverProduit(id) {
  const key = String(id || '').trim().toLowerCase();
  return PRODUITS[key] || null;
}

function nettoyerTexte(value, max = 60) {
  return String(value || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function emailValide(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

/** Valide la demande d'achat. Retourne { errors, data }. */
function validerCommande(body = {}) {
  const errors = [];
  const produit = trouverProduit(body.produit);
  if (!produit) errors.push({ field: 'produit', message: 'Choisissez un billet.' });
  const prenom = nettoyerTexte(body.prenom);
  const nom = nettoyerTexte(body.nom);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  if (prenom.length < 2) errors.push({ field: 'prenom', message: 'Indiquez votre prénom.' });
  if (nom.length < 2) errors.push({ field: 'nom', message: 'Indiquez votre nom.' });
  if (!emailValide(email)) errors.push({ field: 'email', message: 'Adresse e-mail invalide.' });
  const methode = String(body.methode || body.payment_method || '').trim().toLowerCase();
  if (!METHODES.includes(methode)) {
    errors.push({ field: 'methode', message: 'Choisissez PayPal ou carte bancaire.' });
  }
  let quantite = Number.parseInt(body.quantite, 10);
  if (!Number.isFinite(quantite) || quantite < 1) quantite = 1;
  if (quantite > QUANTITE_MAX) {
    errors.push({ field: 'quantite', message: `${QUANTITE_MAX} billets maximum par commande.` });
  }
  const src = String(body.src || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 12);
  return {
    errors,
    data: { produit, prenom, nom, email, methode, quantite: Math.min(quantite, QUANTITE_MAX), src },
  };
}

function genererCode() {
  // 8 caracteres lisibles, sans 0/O/1/I.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `FF-${out.slice(0, 4)}-${out.slice(4)}`;
}

function creerCommande({ produit, prenom, nom, email, methode, quantite, src }) {
  const now = new Date().toISOString();
  const source = String(src || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 12);
  return {
    order_id: `BIL-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    access_token: crypto.randomBytes(18).toString('hex'),
    produit: produit.id,
    produit_nom: produit.nom,
    produit_detail: produit.detail,
    jours: produit.jours,
    prix_unitaire_cents: produit.prix_cents,
    quantite,
    total_cents: produit.prix_cents * quantite,
    client: { prenom, nom, email },
    payment: { method: methode, status: 'pending' },
    billets: Array.from({ length: quantite }, (_, i) => ({ numero: i + 1, code: genererCode() })),
    status: 'pending',
    src: source,
    created_at: now,
    updated_at: now,
  };
}

function verifierAcces(commande, token) {
  if (!commande?.access_token || !token) return false;
  const a = Buffer.from(String(commande.access_token));
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Donnees publiques d'une commande (jamais le jeton ni les identifiants de paiement). */
function vuePublique(commande) {
  if (!commande) return null;
  return {
    order_id: commande.order_id,
    status: commande.status,
    paid: commande.status === 'paid',
    produit: commande.produit,
    produit_nom: commande.produit_nom,
    produit_detail: commande.produit_detail,
    jours: commande.jours,
    quantite: commande.quantite,
    total_cents: commande.total_cents,
    client: commande.client,
    methode: commande.payment?.method || null,
    paid_at: commande.paid_at || null,
    billets: commande.status === 'paid' ? commande.billets : [],
    evenement: EVENEMENT,
  };
}

function billetUrl(baseUrl, commande) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return `${base}/billet?id=${encodeURIComponent(commande.order_id)}&t=${encodeURIComponent(commande.access_token)}`;
}

/** Le QR code contient le lien du billet : scanne a l'entree, il affiche le billet et son statut. */
function contenuQr(baseUrl, commande, billet) {
  return `${billetUrl(baseUrl, commande)}&n=${billet.numero}&c=${encodeURIComponent(billet.code)}`;
}

async function qrPng(texte) {
  return QRCode.toBuffer(texte, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 480 });
}

function euros(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} EUR`;
}

/* ---------- Persistance ---------- */

const LOCAL_DIR =
  process.env.BOXPLUS_BILLETS_DIR ||
  (process.env.VERCEL
    ? path.join('/tmp', 'boxplus-billets')
    : path.join(__dirname, '..', '..', 'data', 'storefront', 'billets'));

function useRemote() {
  return Boolean(
    (process.env.VERCEL || process.env.BOXPLUS_BILLETS_REMOTE === '1') &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function idSur(orderId) {
  const id = String(orderId || '');
  return /^BIL-\d{10,16}-[a-f0-9]{6}$/.test(id) ? id : null;
}

async function chargerCommande(orderId) {
  const id = idSur(orderId);
  if (!id) return null;
  if (useRemote()) {
    const { getSupabase } = require('./supabase');
    const { data, error } = await getSupabase()
      .from(TABLE)
      .select('payload')
      .eq('order_id', id)
      .maybeSingle();
    if (error) throw error;
    return data?.payload || null;
  }
  const file = path.join(LOCAL_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function enregistrerCommande(commande) {
  commande.updated_at = new Date().toISOString();
  if (useRemote()) {
    const { getSupabase } = require('./supabase');
    const { error } = await getSupabase()
      .from(TABLE)
      .upsert(
        {
          order_id: commande.order_id,
          payload: commande,
          email: commande.client?.email || null,
          produit: commande.produit,
          status: commande.status,
          quantite: commande.quantite,
          total_cents: commande.total_cents,
          updated_at: commande.updated_at,
        },
        { onConflict: 'order_id' }
      );
    if (error) throw error;
    return commande;
  }
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(LOCAL_DIR, `${commande.order_id}.json`),
    JSON.stringify(commande, null, 2),
    'utf8'
  );
  return commande;
}

/* ---------- Mails (Brevo suzinabot) ---------- */

function texteMailClient(commande, lien) {
  const c = commande.client;
  const lignes = [
    `Bonjour ${c.prenom},`,
    '',
    `Votre paiement est bien reçu. Voici ${commande.quantite > 1 ? 'vos billets' : 'votre billet'} pour ${EVENEMENT.nom} (${EVENEMENT.sous_titre}).`,
    '',
    `Billet : ${commande.produit_nom}`,
    `${commande.produit_detail}`,
    `Nom : ${c.prenom} ${c.nom}`,
    `Quantité : ${commande.quantite}`,
    `Total payé : ${euros(commande.total_cents)}`,
    '',
    'Codes billets :',
    ...commande.billets.map((b) => `- Billet ${b.numero} : ${b.code}`),
    '',
    "Le QR code de chaque billet est en pièce jointe. Présentez-le à l'entrée, sur votre téléphone ou imprimé.",
    'Vous pouvez aussi retrouver vos billets ici :',
    lien,
    '',
    `Lieu : ${EVENEMENT.lieu}. Vendredi et samedi dès 19h00, dimanche dès 11h00.`,
    '',
    'À très vite au bord du ring,',
    'Boxing Center',
  ];
  return lignes.join('\n');
}

function texteMailInterne(commande) {
  const c = commande.client;
  return [
    `Nouvelle vente billetterie ${EVENEMENT.nom}`,
    '',
    `Commande : ${commande.order_id}`,
    `Billet : ${commande.produit_nom} x ${commande.quantite}`,
    `Total : ${euros(commande.total_cents)} (${commande.payment?.method === 'paypal' ? 'PayPal' : 'PayPlug'})`,
    `Client : ${c.prenom} ${c.nom} - ${c.email}`,
    `Codes : ${commande.billets.map((b) => b.code).join(', ')}`,
  ].join('\n');
}

function destinatairesInternes() {
  const raw = String(process.env.BILLETTERIE_NOTIFY_EMAILS || '').trim();
  const list = raw ? raw.split(/[,;\s]+/) : NOTIFY_DEFAULT;
  return list.map((e) => e.trim().toLowerCase()).filter(emailValide);
}

async function envoyerMails(commande, baseUrl, { send } = {}) {
  const sendEmail = send || require('./brevo-send').sendEmailViaBrevo;
  const lien = billetUrl(baseUrl, commande);
  const attachments = [];
  for (const b of commande.billets) {
    attachments.push({
      filename: `billet-${b.numero}-${b.code}.png`,
      content: await qrPng(contenuQr(baseUrl, commande, b)),
    });
  }
  const sujet = `Votre billet ${EVENEMENT.nom} - ${commande.produit_nom}`;
  const client = await sendEmail({
    to: commande.client.email,
    subject: sujet,
    text: texteMailClient(commande, lien),
    attachments,
    fromName: 'Boxing Center',
  });
  for (const to of destinatairesInternes()) {
    await sendEmail({
      to,
      subject: `Billetterie ${EVENEMENT.nom} : ${commande.client.prenom} ${commande.client.nom}`,
      text: texteMailInterne(commande),
      fromName: 'Boxing Center',
    }).catch(() => null);
  }
  return client;
}

module.exports = {
  EVENEMENT,
  PRODUITS,
  METHODES,
  QUANTITE_MAX,
  TABLE,
  listeProduits,
  trouverProduit,
  validerCommande,
  genererCode,
  creerCommande,
  verifierAcces,
  vuePublique,
  billetUrl,
  contenuQr,
  qrPng,
  euros,
  chargerCommande,
  enregistrerCommande,
  envoyerMails,
  texteMailClient,
  destinatairesInternes,
  idSur,
};
