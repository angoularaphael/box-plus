const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ROOT, ensureDir } = require('../../lib/utils');
const { CGV_URL, REGLEMENT_URL, SITE_URL } = require('./branding');

const LEGAL_DIR = path.join(ROOT, 'storefront', 'legal');
const DOCS_DIR =
  process.env.BOXPLUS_DOCS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-documents' : path.join(ROOT, 'data', 'storefront', 'documents'));
const LOGO_PATH = path.join(ROOT, 'storefront', 'public', 'assets', 'logo-boxing-center.jpg');

const NAVY = '#0B1F3A';
const TEAL = '#2EC4C6';
const MUTED = '#5C6370';
const LIGHT = '#F4F5F7';

function readLegal(name) {
  const file = path.join(LEGAL_DIR, name);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').replace(/^#.*\n/, '').trim();
}

function ensureDocsDir() {
  ensureDir(DOCS_DIR);
}

function gymLabel(slug) {
  const labels = {
    'st-cyprien': 'Saint-Cyprien',
    minimes: 'Minimes',
    ramonville: 'Ramonville',
    portet: 'Portet',
    'etats-unis': 'États-Unis',
    balma: 'Balma',
  };
  return labels[slug] || slug;
}

function formatEuros(cents) {
  return `${((cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
}

function drawSectionTitle(doc, title) {
  doc.moveDown(0.6);
  doc.fontSize(11).fillColor(NAVY).font('Helvetica-Bold').text(title);
  doc.moveDown(0.25);
}

function drawKeyValue(doc, label, value) {
  if (!value) return;
  doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(label, { continued: true });
  doc.fillColor('#333').font('Helvetica-Bold').text(` ${value}`);
}

function renderContractBody(doc, order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  doc.rect(0, 0, doc.page.width, 88).fill(NAVY);
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, left, 18, { height: 42 });
    } catch {
      doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('Boxing Center', left, 28);
    }
  } else {
    doc.fillColor('#fff').fontSize(22).font('Helvetica-Bold').text('Boxing Center', left, 28);
  }
  doc.fillColor(TEAL).fontSize(10).font('Helvetica-Bold').text("CONTRAT D'ADHÉSION", left, 66, { align: 'left' });
  doc.fillColor('#fff').fontSize(8).text(
    `Réf. ${order.order_id} · ${new Date().toLocaleDateString('fr-FR')}`,
    left,
    66,
    { width: pageW, align: 'right' }
  );

  doc.y = 108;

  drawSectionTitle(doc, 'Adhérent');
  doc.roundedRect(left, doc.y, pageW, 108, 6).fill(LIGHT);
  const boxY = doc.y + 12;
  doc.fillColor('#333').font('Helvetica-Bold').fontSize(11).text(
    `${short.first_name || ''} ${short.last_name || ''}`.trim(),
    left + 14,
    boxY
  );
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  let lineY = boxY + 18;
  const lines = [
    short.email ? `Email : ${short.email}` : null,
    short.phone ? `Téléphone : ${short.phone}` : null,
    short.birthdate ? `Naissance : ${short.birthdate}` : null,
    full.address
      ? `Adresse : ${full.address}, ${full.postal_code || ''} ${full.city || ''}`.trim()
      : null,
    full.gym ? `Salle principale : ${gymLabel(full.gym)}` : null,
    full.emergency_contact ? `Contact d'urgence : ${full.emergency_contact}` : null,
  ].filter(Boolean);
  for (const line of lines) {
    doc.text(line, left + 14, lineY);
    lineY += 14;
  }
  doc.y = boxY + 96;

  drawSectionTitle(doc, 'Formule souscrite');
  drawKeyValue(doc, 'Offre :', product.display_name || product.name || '—');
  drawKeyValue(doc, 'Tarif :', formatEuros(product.price_cents));
  drawKeyValue(doc, 'Paiement :', order.payment?.method === 'stripe' ? 'Carte bancaire (Stripe)' : order.payment?.method || 'CB');
  if (order.payment?.iban) {
    const iban = String(order.payment.iban).replace(/\s/g, '');
    drawKeyValue(doc, 'IBAN :', `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}`);
  }
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text("Accès selon formule — jusqu'à 5 salles Boxing Center en région toulousaine.");

  drawSectionTitle(doc, 'Engagements');
  doc.fontSize(8.5).fillColor('#444').font('Helvetica');
  const cgvExcerpt = readLegal('cgv.md').slice(0, 500);
  doc.text(
    cgvExcerpt ||
      "L'adhérent reconnaît avoir pris connaissance des conditions générales de vente et du règlement intérieur du club.",
    { align: 'justify', lineGap: 2 }
  );
  doc.moveDown(0.4);
  doc.fillColor(TEAL).fontSize(8).text(`CGV : ${CGV_URL}`, { link: CGV_URL, underline: true });
  doc.text(`Règlement intérieur : ${REGLEMENT_URL}`, { link: REGLEMENT_URL, underline: true });

  if (order.signature) {
    drawSectionTitle(doc, 'Signature électronique');
    doc.roundedRect(left, doc.y, pageW, 72, 6).stroke('#E2E5EA');
    const sigY = doc.y + 12;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text('✓ Signé électroniquement', left + 14, sigY);
    doc.font('Helvetica').fontSize(9).fillColor('#444');
    doc.text(
      `Le ${new Date(order.signature.signed_at).toLocaleString('fr-FR')}`,
      left + 14,
      sigY + 16
    );
    doc.text(
      `CGV acceptées : ${order.signature.consent_cgv ? 'Oui' : 'Non'} · Règlement intérieur : ${order.signature.consent_reglement ? 'Oui' : 'Non'}`,
      left + 14,
      sigY + 30
    );
    if (order.signature.ip) {
      doc.fontSize(7).fillColor(MUTED).text(`Horodatage IP : ${order.signature.ip}`, left + 14, sigY + 44);
    }
    doc.y = sigY + 64;
  }

  const footerY = doc.page.height - 50;
  doc.moveTo(left, footerY).lineTo(left + pageW, footerY).stroke('#E2E5EA');
  doc.fontSize(7.5).fillColor(MUTED).text(
    `SAS Boxing Center — 12 rue de Fenouillet, 31200 Toulouse — ${SITE_URL}`,
    left,
    footerY + 10,
    { width: pageW, align: 'center' }
  );
}

function generateContractPdf(order) {
  ensureDocsDir();
  const filename = `contrat-${order.order_id}.pdf`;
  const filepath = path.join(DOCS_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);
    renderContractBody(doc, order);
    doc.end();
    stream.on('finish', () => resolve({ filepath, filename }));
    stream.on('error', reject);
  });
}

function streamContractPdf(order, res) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="contrat-${order.order_id}.pdf"`);
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);
  renderContractBody(doc, order);
  doc.end();
}

module.exports = { generateContractPdf, streamContractPdf, readLegal, DOCS_DIR };
