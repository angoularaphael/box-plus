const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ROOT } = require('../../lib/utils');

const LEGAL_DIR = path.join(ROOT, 'storefront', 'legal');
const DOCS_DIR = path.join(ROOT, 'data', 'storefront', 'documents');

function readLegal(name) {
  const file = path.join(LEGAL_DIR, name);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').replace(/^#.*\n/, '').trim();
}

function ensureDocsDir() {
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }
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

function generateContractPdf(order) {
  ensureDocsDir();
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};
  const filename = `contrat-${order.order_id}.pdf`;
  const filepath = path.join(DOCS_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    doc.fontSize(20).fillColor('#0B1F3A').text('Boxing Center', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).text("Contrat d'adhésion", { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(11).fillColor('#333');
    doc.text(`Référence : ${order.order_id}`);
    doc.text(`Date : ${new Date().toLocaleDateString('fr-FR')}`);
    doc.moveDown();

    doc.fontSize(12).fillColor('#0B1F3A').text('Adhérent');
    doc.fontSize(10).fillColor('#333');
    doc.text(`${short.first_name || ''} ${short.last_name || ''}`);
    doc.text(`Email : ${short.email || ''}`);
    doc.text(`Téléphone : ${short.phone || ''}`);
    if (short.birthdate) doc.text(`Date de naissance : ${short.birthdate}`);
    if (full.address) {
      doc.text(`Adresse : ${full.address}, ${full.postal_code || ''} ${full.city || ''}`);
    }
    doc.moveDown();

    doc.fontSize(12).fillColor('#0B1F3A').text('Offre souscrite');
    doc.fontSize(10).fillColor('#333');
    doc.text(`Formule : ${product.display_name || product.name || '—'}`);
    doc.text(`Tarif : ${((product.price_cents || 0) / 100).toFixed(2).replace('.', ',')} €`);
    doc.text(`Mode de paiement : ${order.payment?.method || 'CB'}`);
    if (full.gym) doc.text(`Salle principale : ${gymLabel(full.gym)}`);
    doc.text("Accès : selon formule — jusqu'à 5 salles Boxing Center");
    doc.moveDown();

    doc.fontSize(12).fillColor('#0B1F3A').text('Conditions');
    doc.fontSize(9).fillColor('#555');
    const cgv = readLegal('cgv.md').slice(0, 800);
    doc.text(cgv || 'CGV Boxing Center applicables.');
    doc.moveDown();

    if (order.signature) {
      doc.fontSize(10).fillColor('#333');
      doc.text(`Signé électroniquement le ${new Date(order.signature.signed_at).toLocaleString('fr-FR')}`);
      doc.text(`Consentement CGV : ${order.signature.consent_cgv ? 'Oui' : 'Non'}`);
      doc.text(`Consentement règlement : ${order.signature.consent_reglement ? 'Oui' : 'Non'}`);
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#888').text('Boxing Center — www.boxingcenter.fr — Document généré automatiquement', {
      align: 'center',
    });

    doc.end();
    stream.on('finish', () => resolve({ filepath, filename }));
    stream.on('error', reject);
  });
}

function streamContractPdf(order, res) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="contrat-${order.order_id}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  doc.fontSize(20).fillColor('#0B1F3A').text('Boxing Center', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(14).text("Contrat d'adhésion", { align: 'center' });
  doc.moveDown(1.5);
  doc.fontSize(11).fillColor('#333');
  doc.text(`Référence : ${order.order_id}`);
  doc.text(`Date : ${new Date().toLocaleDateString('fr-FR')}`);
  doc.moveDown();
  doc.fontSize(12).fillColor('#0B1F3A').text('Adhérent');
  doc.fontSize(10).fillColor('#333');
  doc.text(`${short.first_name || ''} ${short.last_name || ''}`);
  doc.text(`Email : ${short.email || ''}`);
  if (full.gym) doc.text(`Salle principale : ${gymLabel(full.gym)}`);
  doc.moveDown();
  doc.fontSize(12).fillColor('#0B1F3A').text('Offre');
  doc.fontSize(10).fillColor('#333');
  doc.text(`${product.display_name || product.name}`);
  doc.text(`Tarif : ${((product.price_cents || 0) / 100).toFixed(2).replace('.', ',')} €`);
  doc.end();
}

module.exports = { generateContractPdf, streamContractPdf, readLegal, DOCS_DIR };
