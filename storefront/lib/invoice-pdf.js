const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ensureDir } = require('../../lib/utils');
const { SITE_URL } = require('./branding');

const DOCS_DIR =
  process.env.BOXPLUS_DOCS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-documents' : path.join(__dirname, '../../data/storefront/documents'));

const NAVY = '#0B1F3A';
const TEAL = '#2EC4C6';
const MUTED = '#5C6370';

const CLUB = {
  name: 'SAS BOXING CENTER',
  address: '12 rue de Fenouillet, 31200 Toulouse',
  rcs: 'Toulouse B 821 817 889',
  siret: '821 817 889 00016',
  tva: 'FR 82 821 817 889',
  phone: '09 54 14 74 72',
  email: 'boxingcenter31@gmail.com',
};

function formatEuros(cents) {
  return `${((cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
}

function formatDateFr(iso) {
  if (!iso) return new Date().toLocaleDateString('fr-FR');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR');
}

function paymentLabel(method) {
  if (method === 'stripe') return 'Carte bancaire (Stripe)';
  if (method === 'demo') return 'Paiement démo';
  return method || 'Carte bancaire';
}

function ensureDocsDir() {
  ensureDir(DOCS_DIR);
}

function drawHeader(doc) {
  const left = doc.page.margins.left;
  doc.fontSize(18).fillColor(NAVY).font('Helvetica-Bold').text('FACTURE', left, 50);
  doc.fontSize(10).fillColor(MUTED).font('Helvetica');
  doc.text(CLUB.name, left, 78);
  doc.text(CLUB.address);
  doc.text(`SIRET : ${CLUB.siret} — TVA : ${CLUB.tva}`);
  doc.text(`RCS ${CLUB.rcs}`);
  doc.text(`Tél. ${CLUB.phone} — ${CLUB.email}`);
}

function drawCustomerBlock(doc, customer, yStart) {
  const right = doc.page.width - doc.page.margins.right - 200;
  doc.fontSize(9).fillColor(MUTED).font('Helvetica-Bold').text('FACTURÉ À', right, yStart);
  doc.font('Helvetica').fillColor('#333');
  const name = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Client';
  doc.text(name, right, yStart + 14);
  if (customer.email) doc.text(customer.email, right);
  if (customer.address) {
    doc.text(customer.address, right);
    doc.text(`${customer.postal_code || ''} ${customer.city || ''}`.trim(), right);
  }
}

function drawLinesTable(doc, lines, totalCents) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  let y = doc.y + 10;

  doc.rect(left, y, width, 22).fill(NAVY);
  doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold');
  doc.text('Désignation', left + 8, y + 6, { width: width * 0.55 });
  doc.text('Qté', left + width * 0.58, y + 6, { width: 40, align: 'center' });
  doc.text('Prix TTC', left + width * 0.72, y + 6, { width: width * 0.24, align: 'right' });
  y += 22;

  for (const line of lines) {
    doc.rect(left, y, width, 24).fill('#fff').stroke('#E2E5EA');
    doc.fillColor('#333').font('Helvetica').fontSize(9);
    doc.text(line.label, left + 8, y + 7, { width: width * 0.55 });
    doc.text(String(line.qty), left + width * 0.58, y + 7, { width: 40, align: 'center' });
    doc.text(formatEuros(line.total_cents), left + width * 0.72, y + 7, {
      width: width * 0.24,
      align: 'right',
    });
    y += 24;
  }

  doc.rect(left, y, width, 28).fill('#f4f6f8');
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10);
  doc.text('Total TTC', left + 8, y + 9);
  doc.text(formatEuros(totalCents), left + width * 0.72, y + 9, {
    width: width * 0.24,
    align: 'right',
  });
  doc.y = y + 40;
}

function renderInscriptionInvoice(doc, order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};
  const invoiceDate = order.signature?.signed_at || order.payment?.paid_at || order.updated_at;
  const invoiceNo = `FAC-${order.order_id}`;

  drawHeader(doc);
  drawCustomerBlock(doc, { ...short, ...full }, 50);

  doc.fontSize(9).fillColor(MUTED).font('Helvetica');
  const metaX = doc.page.width - doc.page.margins.right - 200;
  doc.text(`N° facture : ${invoiceNo}`, metaX, 130);
  doc.text(`Date : ${formatDateFr(invoiceDate)}`, metaX);
  doc.text(`Réf. commande : ${order.order_id}`, metaX);

  doc.y = 175;
  drawLinesTable(doc, [
    {
      label: product.display_name || product.name || 'Abonnement Boxing Center',
      qty: 1,
      total_cents: product.price_cents || 0,
    },
  ], product.price_cents || 0);

  doc.fontSize(9).fillColor('#333').font('Helvetica');
  doc.text(`Mode de paiement : ${paymentLabel(order.payment?.method)}`);
  if (order.payment?.stripe_session_id) {
    doc.fontSize(8).fillColor(MUTED).text(`Réf. paiement : ${order.payment.stripe_session_id}`);
  }
  doc.moveDown();
  doc.fontSize(8).fillColor(MUTED).text(
    'TVA non applicable, art. 293 B du CGI (association / prestations sportives selon régime applicable). Paiement acquitté.',
    { align: 'justify', lineGap: 2 }
  );
}

function renderMaterielInvoice(doc, order) {
  const customer = order.customer || {};
  const invoiceDate = order.payment?.paid_at || order.paid_at || order.created_at;
  const invoiceNo = `FAC-${order.order_id}`;

  drawHeader(doc);
  drawCustomerBlock(doc, customer, 50);

  const metaX = doc.page.width - doc.page.margins.right - 200;
  doc.fontSize(9).fillColor(MUTED).font('Helvetica');
  doc.text(`N° facture : ${invoiceNo}`, metaX, 130);
  doc.text(`Date : ${formatDateFr(invoiceDate)}`, metaX);
  doc.text(`Réf. commande : ${order.order_id}`, metaX);

  doc.y = 175;
  const lines = (order.items || []).map((item) => ({
    label: `${item.name}${item.variant_label ? ` (${item.variant_label})` : ''}`,
    qty: item.qty,
    total_cents: item.line_total_cents,
  }));
  drawLinesTable(doc, lines, order.total_cents || 0);

  doc.fontSize(9).fillColor('#333').font('Helvetica');
  doc.text(`Mode de paiement : ${paymentLabel(order.payment?.method)}`);
  doc.text(`Retrait en salle : ${order.pickup_gym || customer.pickup_gym || '—'}`);
  doc.moveDown();
  doc.fontSize(8).fillColor(MUTED).text('Paiement acquitté — matériel à retirer à l\'accueil de la salle indiquée.', {
    align: 'justify',
  });
}

function writeInvoicePdf(renderFn, order, suffix) {
  ensureDocsDir();
  const filename = `facture-${suffix}.pdf`;
  const filepath = path.join(DOCS_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);
    renderFn(doc, order);
    const footerY = doc.page.height - 45;
    doc.fontSize(7).fillColor(MUTED).text(
      `${CLUB.name} — ${SITE_URL}`,
      doc.page.margins.left,
      footerY,
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' }
    );
    doc.end();
    stream.on('finish', () => resolve({ filepath, filename }));
    stream.on('error', reject);
  });
}

async function generateInscriptionInvoicePdf(order) {
  const product = order.product_snapshot || {};
  if (order.payment?.status !== 'paid' || !(product.price_cents > 0)) return null;
  return writeInvoicePdf(renderInscriptionInvoice, order, order.order_id);
}

async function generateMaterielInvoicePdf(order) {
  if (order.payment?.status !== 'paid') return null;
  return writeInvoicePdf(renderMaterielInvoice, order, order.order_id);
}

module.exports = {
  generateInscriptionInvoicePdf,
  generateMaterielInvoicePdf,
};
