const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ROOT, ensureDir } = require('../../lib/utils');
const { CGV_URL, REGLEMENT_URL } = require('./branding');
const {
  CLUB,
  formatEuros,
  formatDateFr,
  formatDateShort,
  memberDisplayName,
  drawProHeader,
  drawTwoParties,
  clubEmitterRows,
  memberRecipientRows,
  drawSectionHeading,
  drawDetailTable,
  drawConditions,
  drawArticle,
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

function legalBullets(name) {
  const raw = readLegal(name);
  if (!raw) return [];
  return raw
    .split(/\n+/)
    .map((line) => line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter((line) => line && !/^Boxing Center/i.test(line));
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

function maskIban(iban) {
  const clean = String(iban).replace(/\s/g, '');
  if (clean.length < 8) return '••••';
  return `${clean.slice(0, 4)} •••• •••• ${clean.slice(-4)}`;
}

function engagementLabel(product = {}) {
  const name = `${product.display_name || ''} ${product.name || ''}`.toLowerCase();
  if (/sans engagement|seance|essai|coaching|comptant|10\s*€|10€/.test(name)) {
    return 'Formule sans engagement de durée — résiliation selon conditions de l\'offre.';
  }
  if (/12\s*mois|annuel|an\b/.test(name)) {
    return 'Engagement annuel (12 mois) — reconduction tacite selon les conditions Deciplus et les CGV.';
  }
  if (/6\s*mois/.test(name)) {
    return 'Engagement de 6 mois — reconduction tacite selon les conditions Deciplus et les CGV.';
  }
  return 'Durée et conditions de résiliation selon la fiche produit et les CGV Boxing Center.';
}

function paymentLabel(order) {
  const method = order.payment?.method;
  if (method === 'stripe') return 'Carte bancaire sécurisée (Stripe)';
  if (method === 'free') return 'Offre gratuite';
  if (method === 'demo') return 'Paiement démo';
  return method || 'Carte bancaire';
}

function buildContractArticles(order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};
  const offerName = product.display_name || product.name || 'Formule Boxing Center';
  const memberName = memberDisplayName(short);
  const address = full.address
    ? `${full.address}, ${full.postal_code || ''} ${full.city || ''}`.trim()
    : '—';

  const reglementBullets = legalBullets('reglement.md');
  const defaultReglement = [
    'Accès réservé aux adhérents en règle — badge personnel et incessible.',
    'Respect des consignes des coachs, des autres pratiquants et du matériel.',
    'Port des gants et bandages obligatoire ; protège-dents fortement recommandé.',
    'Résiliation selon la formule souscrite (voir CGV).',
    'L\'adhérent déclare être apte à la pratique sportique.',
  ];

  return [
    {
      title: 'Parties',
      paragraphs: [
        `D'une part, ${CLUB.name}, dont le siège social est situé ${CLUB.address}, ${CLUB.city}, immatriculée au RCS ${CLUB.rcs}, ci-après « le Club ».`,
        `D'autre part, ${memberName}, né(e) le ${formatDateShort(short.birthdate)}, demeurant ${address}, joignable au ${short.phone || '—'} et ${short.email || '—'}, ci-après « l'Adhérent ».`,
        'Les parties conviennent ce qui suit.',
      ],
    },
    {
      title: 'Article 1 — Objet du contrat',
      paragraphs: [
        `Le présent contrat formalise l'adhésion de l'Adhérent à la formule « ${offerName} » pour la pratique des activités proposées par Boxing Center dans le réseau des salles du Club.`,
        'L\'adhérent reconnaît avoir pris connaissance de la description de l\'offre sur la boutique en ligne avant souscription.',
      ],
    },
    {
      title: 'Article 2 — Durée et résiliation',
      paragraphs: [engagementLabel(product)],
    },
    {
      title: 'Article 3 — Conditions financières',
      paragraphs: [
        `Tarif de la formule : ${formatEuros(product.price_cents)} TTC.`,
        `Mode de règlement initial : ${paymentLabel(order)}.`,
        order.payment?.iban
          ? `Prélèvements ultérieurs : mandat SEPA sur le compte ${maskIban(order.payment.iban)}.`
          : 'Aucun prélèvement récurrent n\'est requis pour cette formule.',
      ],
    },
    {
      title: 'Article 4 — Accès aux salles',
      paragraphs: [
        `Salle principale déclarée : ${full.gym ? gymLabel(full.gym) : '—'}.`,
        'L\'adhérent bénéficie de l\'accès au réseau Boxing Center (jusqu\'à 5 salles en région toulousaine).',
        'L\'accès est conditionné au port du badge personnel et au respect du règlement intérieur.',
      ],
    },
    {
      title: 'Article 5 — Santé et sécurité',
      paragraphs: [
        'L\'Adhérent déclare sur l\'honneur être apte à la pratique sportique.',
        full.medical_info ? `Informations médicales : ${full.medical_info}` : null,
        full.emergency_contact ? `Contact d\'urgence : ${full.emergency_contact}.` : null,
      ].filter(Boolean),
    },
    {
      title: 'Article 6 — Règlement intérieur',
      bullets: reglementBullets.length ? reglementBullets : defaultReglement,
    },
    {
      title: 'Article 7 — Données personnelles et CGV',
      paragraphs: [
        'Les données collectées sont traitées pour la gestion de l\'adhésion, conformément au RGPD.',
        `CGV : ${CGV_URL}`,
        `Règlement intérieur : ${REGLEMENT_URL}`,
        'L\'Adhérent reconnaît en avoir pris connaissance et les accepter sans réserve.',
      ],
    },
  ];
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

  drawConditions(doc, [
    { label: 'Conditions de règlement', value: paymentLabel(order) },
    {
      label: 'Prélèvements suivants',
      value: order.payment?.iban ? `SEPA — IBAN ${maskIban(order.payment.iban)}` : 'Non applicable',
    },
    { label: 'Durée / résiliation', value: engagementLabel(product).replace(/\.$/, '') },
    { label: 'CGV', value: CGV_URL },
  ]);

  drawSectionHeading(doc, 'Clauses contractuelles');
  for (const section of buildContractArticles(order)) {
    drawArticle(doc, section);
  }

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

module.exports = { generateContractPdf, streamContractPdf, readLegal, DOCS_DIR, buildContractArticles };
