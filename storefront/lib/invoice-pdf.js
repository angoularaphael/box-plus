const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ensureDir } = require('../../lib/utils');
const {
  CLUB,
  formatEuros,
  formatDateFr,
  memberDisplayName,
  drawProHeader,
  drawTwoParties,
  clubEmitterRows,
  drawSectionHeading,
  drawDetailTable,
  drawConditions,
  drawPageFooter,
} = require('./pdf-layout');

const DOCS_DIR =
  process.env.BOXPLUS_DOCS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-documents' : path.join(__dirname, '../../data/storefront/documents'));

function paymentLabel(method) {
  if (method === 'stripe') return 'Carte bancaire (Stripe)';
  if (method === 'demo') return 'Paiement démo';
  return method || 'Carte bancaire';
}

function ensureDocsDir() {
  ensureDir(DOCS_DIR);
}

function invoiceRecipientRows(customer = {}) {
  const rows = [{ label: 'Nom', value: memberDisplayName(customer) }];
  if (customer.email) rows.push({ label: 'Email', value: customer.email });
  if (customer.address) {
    rows.push({
      label: 'Adresse',
      value: `${customer.address}\n${[customer.postal_code, customer.city].filter(Boolean).join(' ')}`.trim(),
    });
  }
  return rows;
}

function renderInscriptionInvoice(doc, order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};
  const invoiceDate = order.signature?.signed_at || order.payment?.paid_at || order.updated_at;
  const invoiceNo = `FAC-${order.order_id}`;
  const priceCents = product.price_cents || 0;
  const priceHt = priceCents / 1.2;

  drawProHeader(doc, {
    title: `Facture ${invoiceNo}`,
    date: invoiceDate,
    ref: order.order_id,
  });

  drawTwoParties(doc, clubEmitterRows(), invoiceRecipientRows({ ...short, ...full }));

  drawSectionHeading(doc, 'Détail');
  drawDetailTable(doc, {
    columns: [
      { key: 'type', label: 'Type', width: 0.12 },
      { key: 'description', label: 'Description', width: 0.4 },
      { key: 'unit', label: 'Prix unitaire HT', width: 0.16, align: 'right' },
      { key: 'qty', label: 'Qté', width: 0.08, align: 'center' },
      { key: 'vat', label: 'TVA', width: 0.08, align: 'center' },
      { key: 'total', label: 'Total HT', width: 0.16, align: 'right' },
    ],
    rows: [
      {
        type: 'Service',
        description: `${product.display_name || product.name || 'Abonnement Boxing Center'}\nRéf. ${order.order_id}`,
        unit: formatEuros(Math.round(priceHt)),
        qty: '1',
        vat: '20 %',
        total: formatEuros(Math.round(priceHt)),
        height: 36,
      },
    ],
    subtotalRows: [
      { label: 'Total HT', value: formatEuros(Math.round(priceHt)) },
      { label: 'TVA (20 %)', value: formatEuros(priceCents - Math.round(priceHt)) },
    ],
    totalLabel: 'Total TTC',
    totalValue: formatEuros(priceCents),
  });

  drawConditions(doc, [
    { label: 'Conditions de règlement', value: 'À réception' },
    { label: 'Mode de règlement', value: paymentLabel(order.payment?.method) },
    { label: 'Statut', value: 'Paiement acquitté' },
  ]);

  doc.fontSize(8).fillColor('#6B7280').font('Helvetica').text(
    'TVA non applicable selon régime applicable aux prestations sportives, ou taux en vigueur selon nature de l\'offre.',
    { align: 'justify', lineGap: 2 }
  );

  drawPageFooter(doc);
}

function renderMaterielInvoice(doc, order) {
  const customer = order.customer || {};
  const invoiceDate = order.payment?.paid_at || order.paid_at || order.created_at;
  const invoiceNo = `FAC-${order.order_id}`;
  const totalCents = order.total_cents || 0;
  const totalHt = Math.round(totalCents / 1.2);

  drawProHeader(doc, {
    title: `Facture ${invoiceNo}`,
    date: invoiceDate,
    ref: order.order_id,
  });

  drawTwoParties(doc, clubEmitterRows(), invoiceRecipientRows(customer));

  drawSectionHeading(doc, 'Détail');
  const rows = (order.items || []).map((item) => {
    const lineHt = Math.round((item.line_total_cents || 0) / 1.2);
    return {
      type: 'Produit',
      description: `${item.name}${item.variant_label ? ` (${item.variant_label})` : ''}`,
      unit: formatEuros(Math.round(lineHt / (item.qty || 1))),
      qty: String(item.qty || 1),
      vat: '20 %',
      total: formatEuros(lineHt),
      height: 32,
    };
  });

  drawDetailTable(doc, {
    columns: [
      { key: 'type', label: 'Type', width: 0.12 },
      { key: 'description', label: 'Description', width: 0.4 },
      { key: 'unit', label: 'Prix unitaire HT', width: 0.16, align: 'right' },
      { key: 'qty', label: 'Qté', width: 0.08, align: 'center' },
      { key: 'vat', label: 'TVA', width: 0.08, align: 'center' },
      { key: 'total', label: 'Total HT', width: 0.16, align: 'right' },
    ],
    rows,
    subtotalRows: [
      { label: 'Total HT', value: formatEuros(totalHt) },
      { label: 'TVA (20 %)', value: formatEuros(totalCents - totalHt) },
    ],
    totalLabel: 'Total TTC',
    totalValue: formatEuros(totalCents),
  });

  drawConditions(doc, [
    { label: 'Conditions de règlement', value: 'À réception' },
    { label: 'Mode de règlement', value: paymentLabel(order.payment?.method) },
    { label: 'Retrait', value: order.pickup_gym || customer.pickup_gym || 'En salle' },
  ]);

  drawPageFooter(doc);
}

function writeInvoicePdf(renderFn, order, suffix) {
  ensureDocsDir();
  const filename = `facture-${suffix}.pdf`;
  const filepath = path.join(DOCS_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);
    renderFn(doc, order);
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
