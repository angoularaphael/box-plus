const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ROOT, ensureDir } = require('../../lib/utils');
const {
  clubForOrder,
  formatEuros,
  drawProHeaderCompact,
  drawTwoPartiesCompact,
  clubEmitterRowsCompact,
  memberRecipientRows,
  drawDetailTableCompact,
  drawSignatureBlockCompact,
  drawPageFooter,
  drawSectionHeading,
} = require('./pdf-layout');
const { invoiceTypeLabel, paymentModeLabel, isComptantStyleProduct } = require('../../lib/billing-plan');

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

function slugifyName(value) {
  return String(value || 'adherent')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'adherent';
}

function contractFilename(order) {
  const short = order.customer_short || {};
  const name = slugifyName(`${short.first_name || ''}-${short.last_name || ''}`);
  return `Contrat-${name}-Boxing-Center.pdf`;
}

function offerDescription(product, full) {
  const durationMatch = String(product.name || product.display_name || product.duration_label || '').match(
    /(\d+)\s*mois|4\s*semaines/i
  );
  const durationBit = durationMatch
    ? /semaine/i.test(durationMatch[0])
      ? '4 semaines'
      : `${durationMatch[1]} mois`
    : product.duration_label || '';
  return [
    `Abonnement cours collectifs + accès libre 5 salles Boxing Center${durationBit ? ` ${durationBit}` : ''}`,
    product.display_name || product.name || null,
    full.gym ? `Salle principale : ${gymLabel(full.gym)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function createContractDoc() {
  return new PDFDocument({
    size: 'A4',
    margins: { top: 40, bottom: 48, left: 40, right: 40 },
  });
}

function renderContractBody(doc, order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};
  const contractDate = order.signature?.signed_at || order.updated_at || order.created_at;
  const priceCents = product.price_cents || 0;

  const recipient = memberRecipientRows(short, {
    ...full,
    gym: full.gym ? gymLabel(full.gym) : undefined,
  });

  drawProHeaderCompact(doc, {
    title: "Contrat d'adhésion — Boxing Center",
    date: contractDate,
    ref: order.order_id,
  });

  drawTwoPartiesCompact(doc, clubEmitterRowsCompact(clubForOrder(order)), recipient);

  doc.fontSize(10).fillColor('#0B1F3A').font('Helvetica-Bold').text('Détail de l\'offre', doc.page.margins.left, doc.y);
  doc.y += 12;

  drawDetailTableCompact(doc, {
    columns: [
      { key: 'type', label: 'Type', width: 0.18 },
      { key: 'description', label: 'Description', width: 0.46 },
      { key: 'qty', label: 'Qté', width: 0.08, align: 'center' },
      { key: 'price', label: 'Prix TTC', width: 0.14, align: 'right' },
      { key: 'total', label: 'Total', width: 0.14, align: 'right' },
    ],
    rows: [
      {
        type: invoiceTypeLabel(product, order.payment?.billing_plan),
        description: offerDescription(product, full),
        qty: '1',
        price: formatEuros(priceCents),
        total: formatEuros(priceCents),
        height: 52,
      },
    ],
  });

  drawSectionHeading(doc, 'Conditions & paiement');
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const lines = [
    `Mode de paiement : ${paymentModeLabel(product, order.payment?.billing_plan)}`,
    order.payment?.stripe_session_id
      ? `Référence Stripe : ${order.payment.stripe_session_id}`
      : null,
    order.payment?.iban
      ? `IBAN enregistré : ****${String(order.payment.iban).replace(/\s/g, '').slice(-4)}`
      : isComptantStyleProduct(product)
        ? 'Paiement comptant — pas de prélèvement SEPA'
        : 'Prélèvement SEPA pour les échéances suivantes',
    !isComptantStyleProduct(product)
      ? 'Badge d\'accès : prélèvement différé ~72h après inscription (si applicable)'
      : 'Pas de badge automatique sur les formules comptant',
    `Accès : cours collectifs + accès libre 6j/7 (10h–21h) sur les 5 salles Boxing Center`,
    `Médical : ${order.signature?.consent_medical ? 'Oui — attestation sur l\'honneur' : 'Non'}`,
    `CGV : ${order.signature?.consent_cgv ? 'Oui' : 'Non'} · Règlement : ${order.signature?.consent_reglement ? 'Oui' : 'Non'}`,
  ].filter(Boolean);

  doc.font('Helvetica').fontSize(9).fillColor('#374151');
  for (const line of lines) {
    doc.text(`• ${line}`, left, doc.y, { width, lineGap: 2 });
    doc.y += 2;
  }
  doc.y += 8;

  drawSignatureBlockCompact(doc, order);
  drawPageFooter(doc, order);
}

function generateContractPdf(order) {
  ensureDocsDir();
  const filename = contractFilename(order);
  const filepath = path.join(DOCS_DIR, filename);

  return new Promise((resolve, reject) => {
    const doc = createContractDoc();
    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);
    renderContractBody(doc, order);
    doc.end();
    stream.on('finish', () => resolve({ filepath, filename }));
    stream.on('error', reject);
  });
}

function streamContractPdf(order, res) {
  const filename = contractFilename(order);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  const doc = createContractDoc();
  doc.pipe(res);
  renderContractBody(doc, order);
  doc.end();
}

module.exports = { generateContractPdf, streamContractPdf, readLegal, DOCS_DIR, contractFilename };
