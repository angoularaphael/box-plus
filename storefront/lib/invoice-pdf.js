const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ensureDir } = require('../../lib/utils');
const {
  clubForOrder,
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
const { paymentModeLabel, invoiceTypeLabel, isComptantStyleProduct } = require('../../lib/billing-plan');
const { BADGE_FEE_AMOUNT } = require('./storefront-copy');
const { formatPickupLine } = require('./gym-pickup');

const DOCS_DIR =
  process.env.BOXPLUS_DOCS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-documents' : path.join(__dirname, '../../data/storefront/documents'));

const GYM_LABELS = {
  minimes: 'Minimes',
  ramonville: 'Ramonville',
  portet: 'Portet',
  'etats-unis': 'États-Unis',
  'st-cyprien': 'Saint-Cyprien',
};

function paymentLabel(order) {
  const method = order.payment?.method;
  const plan = order.payment?.billing_plan;
  const product = order.product_snapshot || {};
  if (plan) return paymentModeLabel(product, plan);
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
  if (customer.phone) rows.push({ label: 'Téléphone', value: customer.phone });
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
  const priceHt = Math.round(priceCents / 1.2);
  const vatCents = priceCents - priceHt;

  const badgeTiming = order.payment?.badge_timing || order.badge_timing;
  const badgeMethod = order.payment?.badge_method || order.badge_method;
  const badgeOnStripe = badgeTiming === 'immediate' && (badgeMethod === 'card' || badgeMethod === 'cb');
  const badgeCents = badgeOnStripe ? 3499 : 0;
  const badgeHt = Math.round(badgeCents / 1.2);
  const totalTtc = priceCents + badgeCents;
  const totalHt = priceHt + badgeHt;
  const totalVat = totalTtc - totalHt;

  drawProHeader(doc, {
    title: `Facture ${invoiceNo}`,
    date: invoiceDate,
    ref: order.order_id,
  });

  drawTwoParties(doc, clubEmitterRows(clubForOrder(order)), invoiceRecipientRows({ ...short, ...full }));

  drawSectionHeading(doc, 'Détail des prestations');

  const durationMatch = String(product.name || product.display_name || product.duration_label || '').match(
    /(\d+)\s*mois|4\s*semaines/i
  );
  const durationBit = durationMatch
    ? /semaine/i.test(durationMatch[0])
      ? '4 semaines'
      : `${durationMatch[1]} mois`
    : product.duration_label || '';
  const invoiceDesc = [
    `Abonnement cours collectifs + accès libre 5 salles Boxing Center${durationBit ? ` ${durationBit}` : ''}`,
    full.gym ? `Salle : ${GYM_LABELS[full.gym] || full.gym}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const rows = [
    {
      type: invoiceTypeLabel(product, order.payment?.billing_plan),
      description: invoiceDesc,
      unit: formatEuros(priceHt),
      qty: '1',
      vat: '20 %',
      total: formatEuros(priceHt),
      height: 48,
    },
  ];

  if (badgeCents > 0) {
    rows.push({
      type: 'Badge',
      description: `Badge d'accès — payé immédiatement par carte\n${BADGE_FEE_AMOUNT} TTC`,
      unit: formatEuros(badgeHt),
      qty: '1',
      vat: '20 %',
      total: formatEuros(badgeHt),
      height: 36,
    });
  } else if (
    !isComptantStyleProduct(product) &&
    (badgeTiming === 'deferred' || (!badgeTiming && product.requires_iban))
  ) {
    rows.push({
      type: 'Info',
      description: `Badge d'accès (${BADGE_FEE_AMOUNT}) — non inclus sur cette facture\nPrélèvement prévu ~72h après inscription (${badgeMethod === 'card' ? 'carte' : 'IBAN'})`,
      unit: '—',
      qty: '—',
      vat: '—',
      total: '—',
      height: 40,
    });
  }

  drawDetailTable(doc, {
    columns: [
      { key: 'type', label: 'Type', width: 0.1 },
      { key: 'description', label: 'Description', width: 0.42 },
      { key: 'unit', label: 'PU HT', width: 0.16, align: 'right' },
      { key: 'qty', label: 'Qté', width: 0.08, align: 'center' },
      { key: 'vat', label: 'TVA', width: 0.08, align: 'center' },
      { key: 'total', label: 'Total HT', width: 0.16, align: 'right' },
    ],
    rows,
    subtotalRows: [
      { label: 'Total HT', value: formatEuros(totalHt) },
      { label: 'TVA (20 %)', value: formatEuros(totalVat) },
    ],
    totalLabel: 'Total TTC',
    totalValue: formatEuros(totalTtc),
  });

  const conditions = [
    { label: 'Conditions de règlement', value: 'À réception' },
    { label: 'Mode de règlement', value: paymentLabel(order) },
    { label: 'Statut', value: order.payment?.status === 'paid' ? 'Acquitté' : order.payment?.status || '—' },
  ];
  if (order.payment?.stripe_session_id) {
    conditions.push({ label: 'Réf. Stripe', value: order.payment.stripe_session_id });
  }
  if (order.payment?.iban) {
    const iban = String(order.payment.iban).replace(/\s/g, '');
    conditions.push({ label: 'IBAN', value: `•••• ${iban.slice(-4)}` });
  }
  if (full.gym) {
    conditions.push({ label: 'Salle principale', value: GYM_LABELS[full.gym] || full.gym });
  }
  drawConditions(doc, conditions);

  doc.moveDown(0.4);
  doc.fontSize(8).fillColor('#6B7280').font('Helvetica').text(
    'Détail établi suite à l\'inscription en ligne Boxing Center. TVA au taux en vigueur selon la nature de l\'offre.',
    { align: 'justify', lineGap: 2 }
  );

  drawPageFooter(doc, clubForOrder(order));
}

function renderMaterielInvoice(doc, order) {
  const customer = order.customer || {};
  const invoiceDate = order.payment?.paid_at || order.paid_at || order.created_at;
  const invoiceNo = `FAC-${order.order_id}`;
  const lines = order.lines || order.items || [];
  const totalCents = order.total_cents || 0;

  drawProHeader(doc, {
    title: `Facture ${invoiceNo}`,
    date: invoiceDate,
    ref: order.order_id,
  });

  drawTwoParties(doc, clubEmitterRows(clubForOrder(order)), invoiceRecipientRows(customer));

  drawSectionHeading(doc, 'Détail des articles');

  const rows =
    lines.length > 0
      ? lines.map((line) => {
          const lineTtc = line.total_cents || line.price_cents * (line.qty || line.quantity || 1) || 0;
          const lineHt = Math.round(lineTtc / 1.2);
          return {
            type: 'Art.',
            description: `${line.name || line.title || 'Article'}${line.sku ? `\nRéf. ${line.sku}` : ''}`,
            unit: formatEuros(Math.round((line.price_cents || lineTtc) / 1.2)),
            qty: String(line.qty || line.quantity || 1),
            vat: '20 %',
            total: formatEuros(lineHt),
            height: 32,
          };
        })
      : [
          {
            type: 'Art.',
            description: `Commande matériel\nRéf. ${order.order_id}`,
            unit: formatEuros(Math.round(totalCents / 1.2)),
            qty: '1',
            vat: '20 %',
            total: formatEuros(Math.round(totalCents / 1.2)),
            height: 32,
          },
        ];

  const totalHt = Math.round(totalCents / 1.2);
  drawDetailTable(doc, {
    columns: [
      { key: 'type', label: 'Type', width: 0.1 },
      { key: 'description', label: 'Description', width: 0.42 },
      { key: 'unit', label: 'PU HT', width: 0.16, align: 'right' },
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
    { label: 'Mode de règlement', value: paymentLabel(order) },
    { label: 'Statut', value: 'Paiement acquitté' },
    {
      label: 'Salle de retrait',
      value: formatPickupLine(order.pickup_gym || order.customer?.pickup_gym),
    },
  ]);

  drawPageFooter(doc, clubForOrder(order));
}

async function writePdf(renderFn, order, suffix) {
  ensureDocsDir();
  const filename = `facture-${suffix}.pdf`;
  const filepath = path.join(DOCS_DIR, filename);
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);
  renderFn(doc, order);
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return { filepath, filename };
}

function inscriptionInvoiceFilename(order) {
  return `facture-${order.order_id}.pdf`;
}

function streamInscriptionInvoicePdf(order, res) {
  const filename = order.documents?.invoice_filename || inscriptionInvoiceFilename(order);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  doc.pipe(res);
  renderInscriptionInvoice(doc, order);
  doc.end();
}

async function generateInscriptionInvoicePdf(order) {
  return writePdf(renderInscriptionInvoice, order, order.order_id);
}

async function generateMaterielInvoicePdf(order) {
  return writePdf(renderMaterielInvoice, order, order.order_id);
}

module.exports = {
  generateInscriptionInvoicePdf,
  generateMaterielInvoicePdf,
  streamInscriptionInvoicePdf,
  inscriptionInvoiceFilename,
  renderInscriptionInvoice,
};
