const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ROOT, ensureDir } = require('../../lib/utils');
const {
  formatEuros,
  drawProHeader,
  drawTwoParties,
  clubEmitterRows,
  memberRecipientRows,
  drawSectionHeading,
  drawDetailTable,
  drawSignatureBlock,
  drawPageFooter,
} = require('./pdf-layout');

const LEGAL_DIR = path.join(ROOT, 'storefront', 'legal');
const DOCS_DIR =
  process.env.BOXPLUS_DOCS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-documents' : path.join(ROOT, 'data', 'storefront', 'documents'));

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

function renderContractBody(doc, order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};
  const contractDate = order.signature?.signed_at || order.updated_at || order.created_at;

  const recipient = memberRecipientRows(short, {
    ...full,
    gym: full.gym ? gymLabel(full.gym) : undefined,
  });

  drawProHeader(doc, {
    title: `Contrat ${order.order_id}`,
    date: contractDate,
    ref: order.order_id,
  });

  drawTwoParties(doc, clubEmitterRows(), recipient);

  drawSectionHeading(doc, 'Détail');
  drawDetailTable(doc, {
    columns: [
      { key: 'type', label: 'Type', width: 0.14 },
      { key: 'description', label: 'Description', width: 0.46 },
      { key: 'qty', label: 'Qté', width: 0.08, align: 'center' },
      { key: 'price', label: 'Prix TTC', width: 0.16, align: 'right' },
      { key: 'total', label: 'Total TTC', width: 0.16, align: 'right' },
    ],
    rows: [
      {
        type: 'Abonnement',
        description: product.display_name || product.name || 'Formule Boxing Center',
        qty: '1',
        price: formatEuros(product.price_cents),
        total: formatEuros(product.price_cents),
        height: 32,
      },
    ],
    totalLabel: 'Total TTC',
    totalValue: formatEuros(product.price_cents),
  });

  drawSignatureBlock(doc, order);
  drawPageFooter(doc);
}

function generateContractPdf(order) {
  ensureDocsDir();
  const filename = `contrat-${order.order_id}.pdf`;
  const filepath = path.join(DOCS_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
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
  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
  doc.pipe(res);
  renderContractBody(doc, order);
  doc.end();
}

module.exports = { generateContractPdf, streamContractPdf, readLegal, DOCS_DIR };
