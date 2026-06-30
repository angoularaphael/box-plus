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

const CLUB = {
  name: 'SAS BOXING CENTER',
  address: '12 rue de Fenouillet, 31200 Toulouse',
  rcs: 'Toulouse B 821 817 889',
  siret: '821 817 889 00016',
  phone: '09 54 14 74 72',
};

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

function formatEuros(cents) {
  return `${((cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
}

function formatDateFr(iso) {
  if (!iso) return new Date().toLocaleDateString('fr-FR');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR');
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
  if (method === 'free') return 'Offre gratuite — aucun prélèvement';
  if (method === 'demo') return 'Paiement démo';
  return method || 'Carte bancaire';
}

function drawSectionTitle(doc, title) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor(NAVY).font('Helvetica-Bold').text(title);
  doc.moveDown(0.2);
}

function drawBody(doc, text, opts = {}) {
  doc
    .fontSize(opts.size || 9)
    .fillColor(opts.color || '#333')
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .text(text, { align: opts.align || 'justify', lineGap: 3, width: opts.width });
  doc.moveDown(opts.gap ?? 0.25);
}

function drawBulletList(doc, items, { size = 8.5 } = {}) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (const item of items) {
    if (doc.y > doc.page.height - 80) doc.addPage();
    doc.fontSize(size).fillColor('#333').font('Helvetica');
    doc.text(`•  ${item}`, left + 8, doc.y, { width: width - 16, align: 'left', lineGap: 2 });
    doc.moveDown(0.15);
  }
}

function drawKeyValue(doc, label, value) {
  if (!value) return;
  doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(label, { continued: true });
  doc.fillColor('#333').font('Helvetica-Bold').text(` ${value}`);
}

function buildContractArticles(order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};
  const offerName = product.display_name || product.name || 'Formule Boxing Center';
  const memberName = `${short.first_name || ''} ${short.last_name || ''}`.trim();
  const address = full.address
    ? `${full.address}, ${full.postal_code || ''} ${full.city || ''}`.trim()
    : '—';

  const reglementBullets = legalBullets('reglement.md');
  const defaultReglement = [
    'Accès réservé aux adhérents en règle — badge personnel et incessible.',
    'Respect des consignes des coachs, des autres pratiquants et du matériel.',
    'Port des gants et bandages obligatoire ; protège-dents fortement recommandé.',
    'Résiliation selon la formule souscrite (voir CGV).',
    'L\'adhérent déclare être apte à la pratique sportive.',
  ];

  return [
    {
      title: 'Parties',
      paragraphs: [
        `D'une part, ${CLUB.name}, société au capital de la SAS Boxing Center, dont le siège social est situé ${CLUB.address}, immatriculée au RCS ${CLUB.rcs}, ci-après « le Club ».`,
        `D'autre part, ${memberName || 'l\'adhérent'}, né(e) le ${formatDateFr(short.birthdate)}, demeurant ${address}, joignable au ${short.phone || '—'} et ${short.email || '—'}, ci-après « l'Adhérent ».`,
        'Les parties conviennent ce qui suit.',
      ],
    },
    {
      title: 'Article 1 — Objet du contrat',
      paragraphs: [
        `Le présent contrat formalise l'adhésion de l'Adhérent à la formule « ${offerName} » pour la pratique des activités proposées par Boxing Center (boxe, sports de combat, remise en forme) dans le réseau des salles du Club.`,
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
        `Tarif de la formule : ${formatEuros(product.price_cents)} TTC (première échéance ou montant comptant selon l'offre).`,
        `Mode de règlement initial : ${paymentLabel(order)}.`,
        order.payment?.iban
          ? `Prélèvements ultérieurs : mandat SEPA sur le compte ${maskIban(order.payment.iban)}. L'Adhérent autorise Boxing Center à émettre les échéances liées à l'abonnement.`
          : 'Aucun prélèvement récurrent n\'est requis pour cette formule.',
        'Les frais de badge d\'accès, le cas échéant, sont réglés selon les modalités indiquées lors de l\'inscription (prélèvement différé sous 5 à 7 jours ouvrés).',
      ],
    },
    {
      title: 'Article 4 — Accès aux salles',
      paragraphs: [
        `Salle principale déclarée : ${full.gym ? gymLabel(full.gym) : '—'}.`,
        'Sous réserve de la formule souscrite, l\'Adhérent bénéficie de l\'accès au réseau Boxing Center (jusqu\'à 5 salles en région toulousaine : Minimes, Ramonville, États-Unis, Saint-Cyprien, Portet).',
        'L\'accès est conditionné au port du badge personnel, au respect du règlement intérieur et au paiement des cotisations.',
      ],
    },
    {
      title: 'Article 5 — Santé et sécurité',
      paragraphs: [
        'L\'Adhérent déclare sur l\'honneur être apte à la pratique sportive et ne pas présenter de contre-indication médicale connue.',
        full.medical_info
          ? `Informations médicales communiquées : ${full.medical_info}`
          : 'Aucune information médicale particulière n\'a été signalée.',
        'Le Club se réserve le droit de demander un certificat médical d\'aptitude à la boxe en cas de doute.',
        full.emergency_contact
          ? `Personne à contacter en cas d'urgence : ${full.emergency_contact}.`
          : null,
      ].filter(Boolean),
    },
    {
      title: 'Article 6 — Règlement intérieur',
      bullets: reglementBullets.length ? reglementBullets : defaultReglement,
    },
    {
      title: 'Article 7 — Données personnelles et CGV',
      paragraphs: [
        'Les données collectées sont traitées pour la gestion de l\'adhésion, de la facturation et de l\'accès aux salles, conformément au RGPD et à la politique de confidentialité du Club.',
        `Les Conditions Générales de Vente intégrales sont disponibles sur : ${CGV_URL}`,
        `Le règlement intérieur détaillé est consultable sur : ${REGLEMENT_URL}`,
        'L\'Adhérent reconnaît en avoir pris connaissance et les accepter sans réserve avant signature du présent contrat.',
      ],
    },
  ];
}

function renderContractBody(doc, order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;
  const contractDate = formatDateFr(order.signature?.signed_at || order.updated_at || order.created_at);

  doc.rect(0, 0, doc.page.width, 92).fill(NAVY);
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, left, 20, { height: 40 });
    } catch {
      doc.fillColor('#fff').fontSize(20).font('Helvetica-Bold').text('Boxing Center', left, 28);
    }
  } else {
    doc.fillColor('#fff').fontSize(20).font('Helvetica-Bold').text('Boxing Center', left, 28);
  }
  doc.fillColor(TEAL).fontSize(9).font('Helvetica-Bold').text("CONTRAT D'ADHÉSION SPORTIVE", left, 68);
  doc.fillColor('#fff').fontSize(8).font('Helvetica').text(
    `Réf. ${order.order_id}  ·  Fait à Toulouse, le ${contractDate}`,
    left,
    68,
    { width: pageW, align: 'right' }
  );

  doc.y = 108;

  drawSectionTitle(doc, 'Récapitulatif adhérent');
  const memberLines = [
    short.email ? `Email : ${short.email}` : null,
    short.phone ? `Téléphone : ${short.phone}` : null,
    short.birthdate ? `Date de naissance : ${formatDateFr(short.birthdate)}` : null,
    full.address
      ? `Adresse : ${full.address}, ${full.postal_code || ''} ${full.city || ''}`.trim()
      : null,
    full.gym ? `Salle principale : ${gymLabel(full.gym)}` : null,
  ].filter(Boolean);
  const boxH = 28 + memberLines.length * 14;
  doc.roundedRect(left, doc.y, pageW, boxH, 6).fill(LIGHT);
  const boxY = doc.y + 12;
  doc
    .fillColor(NAVY)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(`${short.first_name || ''} ${short.last_name || ''}`.trim(), left + 14, boxY);
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  let lineY = boxY + 18;
  for (const line of memberLines) {
    doc.text(line, left + 14, lineY);
    lineY += 14;
  }
  doc.y = boxY + boxH - 12;

  drawSectionTitle(doc, 'Formule souscrite');
  drawKeyValue(doc, 'Offre :', product.display_name || product.name || '—');
  drawKeyValue(doc, 'Tarif :', formatEuros(product.price_cents));
  drawKeyValue(doc, 'Paiement :', paymentLabel(order));
  if (order.payment?.iban) drawKeyValue(doc, 'IBAN (masqué) :', maskIban(order.payment.iban));
  doc.moveDown(0.3);

  const articles = buildContractArticles(order);
  for (const section of articles) {
    drawSectionTitle(doc, section.title);
    if (section.paragraphs) {
      for (const p of section.paragraphs) {
        drawBody(doc, p);
      }
    }
    if (section.bullets) {
      drawBulletList(doc, section.bullets);
    }
  }

  if (order.signature) {
    if (doc.y > doc.page.height - 100) doc.addPage();
    drawSectionTitle(doc, 'Signature électronique');
    const sigH = 78;
    doc.roundedRect(left, doc.y, pageW, sigH, 6).fill('#f0fafb').stroke(TEAL);
    const sigY = doc.y + 12;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text('Document signé électroniquement', left + 14, sigY);
    doc.font('Helvetica').fontSize(9).fillColor('#333');
    doc.text(`Par : ${short.first_name || ''} ${short.last_name || ''}`.trim(), left + 14, sigY + 16);
    doc.text(`Le ${new Date(order.signature.signed_at).toLocaleString('fr-FR')}`, left + 14, sigY + 30);
    doc.text(
      `Acceptation CGV : ${order.signature.consent_cgv ? 'Oui' : 'Non'}  ·  Règlement intérieur : ${order.signature.consent_reglement ? 'Oui' : 'Non'}`,
      left + 14,
      sigY + 44
    );
    if (order.signature.ip) {
      doc.fontSize(7).fillColor(MUTED).text(`Preuve horodatée — adresse IP : ${order.signature.ip}`, left + 14, sigY + 58);
    }
    doc.y = sigY + sigH;
  } else {
    drawSectionTitle(doc, 'Signature');
    drawBody(
      doc,
      'Le présent document est une prévisualisation. La signature électronique sera apposée à la validation finale de l\'inscription en ligne.',
      { color: MUTED, size: 8.5 }
    );
  }

  const footerY = doc.page.height - 45;
  doc.moveTo(left, footerY).lineTo(left + pageW, footerY).stroke('#E2E5EA');
  doc.fontSize(7).fillColor(MUTED).text(
    `${CLUB.name} — ${CLUB.address} — RCS ${CLUB.rcs} — Secrétariat : ${CLUB.phone} — ${SITE_URL}`,
    left,
    footerY + 8,
    { width: pageW, align: 'center', lineGap: 1 }
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

module.exports = { generateContractPdf, streamContractPdf, readLegal, DOCS_DIR, buildContractArticles };
