const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ensureDir } = require('../../lib/utils');
const { NAVY, MUTED, formatDateFr, drawPageFooter, clubForOrder } = require('./pdf-layout');

const GYM_LABELS = {
  minimes: 'Minimes',
  ramonville: 'Ramonville',
  portet: 'Portet',
  'etats-unis': 'États-Unis',
  'st-cyprien': 'Saint-Cyprien',
  balma: 'Balma',
};

/** Toujours relatif à ce fichier — fiable sur Vercel (pas de dépendance à process.cwd). */
const LEGAL_DIR = path.join(__dirname, '..', 'legal');
const DOCS_DIR =
  process.env.BOXPLUS_DOCS_DIR ||
  (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join('/tmp', 'boxplus-documents')
    : path.join(__dirname, '..', '..', 'data', 'storefront', 'documents'));

const LEGAL_PDFS = [
  {
    key: 'cgv',
    md: 'cgv.md',
    filename: 'CGV-Boxing-Center.pdf',
    title: 'Conditions Générales de Vente et d’Abonnement',
  },
  {
    key: 'reglement',
    md: 'reglement.md',
    filename: 'Reglement-interieur-Boxing-Center.pdf',
    title: 'Règlement intérieur',
  },
  {
    key: 'medical',
    md: 'attestation-medicale.md',
    filename: 'Declaration-medicale-Boxing-Center.pdf',
    title: 'Déclaration relative à l’état de santé et à l’aptitude à la pratique sportive',
  },
];

function stripMdNoise(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/^#.*\n/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseBlocks(md) {
  const lines = stripMdNoise(md).split('\n');
  const blocks = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (!para.length) return;
    const text = para.join(' ').replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ type: 'p', text });
    para = [];
  };
  const flushList = () => {
    if (list?.length) blocks.push({ type: 'ul', items: list });
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: 'h2', text: line.replace(/^##\s+/, '').trim() });
      continue;
    }
    if (/^###\s+/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: 'h3', text: line.replace(/^###\s+/, '').trim() });
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      flushPara();
      if (!list) list = [];
      list.push(line.replace(/^[-*•]\s+/, '').trim());
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

function ensureBottomSpace(doc, needed = 72) {
  const bottom = doc.page.height - doc.page.margins.bottom - 24;
  if (doc.y + needed > bottom) doc.addPage();
}

function loadSignatureImage(order) {
  if (!order?.signature) return null;
  const imgPath = order.signature.image_path;
  if (imgPath && fs.existsSync(imgPath)) return { type: 'path', value: imgPath };
  if (order.signature.image_base64) {
    const b64 = String(order.signature.image_base64).split(',').pop();
    try {
      return { type: 'buffer', value: Buffer.from(b64, 'base64') };
    } catch {
      return null;
    }
  }
  return null;
}

function stampSignature(doc, order, { title = 'Signature électronique' } = {}) {
  if (!order?.signature) return;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const name = signerFullName(order) || 'Adhérent';
  const date = order.signature.signed_at
    ? new Date(order.signature.signed_at).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : new Date().toLocaleDateString('fr-FR');
  const img = loadSignatureImage(order);
  ensureBottomSpace(doc, img ? 140 : 70);
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(title, left, doc.y, { width });
  doc.moveDown(0.25);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#1A1A2E')
    .text(`Nom : ${name}`, { width })
    .text(`Date : ${date}`, { width });
  if (img) {
    doc.moveDown(0.3);
    const y = doc.y;
    try {
      const fit = [180, 70];
      if (img.type === 'path') doc.image(img.value, left, y, { fit, align: 'left', valign: 'center' });
      else doc.image(img.value, left, y, { fit, align: 'left', valign: 'center' });
      doc.y = y + 78;
    } catch {
      doc.fontSize(8).fillColor(MUTED).text('(Signature manuscrite)', { width });
    }
  }
}

function renderLegalPdf(doc, { title, md, order = null, stamp = true }) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const club = clubForOrder(order);

  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text(title, left, doc.y, { width });
  doc.moveDown(0.35);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`${club.name} — ${club.address}, ${club.city}`, { width });
  doc.moveDown(1);

  for (const block of parseBlocks(md)) {
    if (block.type === 'h2') {
      ensureBottomSpace(doc, 48);
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(block.text, { width });
      doc.moveDown(0.35);
      continue;
    }
    if (block.type === 'h3') {
      ensureBottomSpace(doc, 36);
      doc.moveDown(0.25);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(block.text, { width });
      doc.moveDown(0.25);
      continue;
    }
    if (block.type === 'ul') {
      for (const item of block.items) {
        ensureBottomSpace(doc, 28);
        doc.font('Helvetica').fontSize(9).fillColor('#1A1A2E').text(`• ${item}`, {
          width,
          align: 'left',
          lineGap: 2,
        });
        doc.moveDown(0.15);
      }
      doc.moveDown(0.25);
      continue;
    }
    ensureBottomSpace(doc, 40);
    doc.font('Helvetica').fontSize(9).fillColor('#1A1A2E').text(block.text, {
      width,
      align: 'justify',
      lineGap: 2,
    });
    doc.moveDown(0.45);
  }

  if (stamp && order) stampSignature(doc, order);
  drawPageFooter(doc, order || club);
}

function signerFullName(order) {
  const short = order?.customer_short || {};
  const full = order?.customer_full || {};
  const first = String(short.first_name || full.first_name || '').trim();
  const last = String(short.last_name || full.last_name || '').trim();
  return [first, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function personalizeMedicalMarkdown(md, fullName) {
  const name = String(fullName || '').trim();
  if (!name) return md;
  let out = String(md || '');
  out = out.replace(/Je soussigné\(e\),\s*/g, `Je soussigné(e) ${name}, `);
  if (!/Signataire/i.test(out)) {
    const date = new Date().toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
    out += `\n\n## Signataire\n\nNom : ${name}\n\nDate d'acceptation électronique : ${date}\n`;
  }
  return out;
}

function readLegalMarkdown(spec) {
  const candidates = [
    path.join(LEGAL_DIR, spec.md),
    path.join(process.cwd(), 'storefront', 'legal', spec.md),
    path.join(process.cwd(), 'legal', spec.md),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return { path: p, md: fs.readFileSync(p, 'utf8') };
  }
  return null;
}

async function renderMdToPdfFile(title, md, filepath, order = null) {
  ensureDir(path.dirname(filepath));
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 56, left: 48, right: 48 },
    bufferPages: true,
    autoFirstPage: true,
  });
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);
  renderLegalPdf(doc, { title, md, order, stamp: Boolean(order) });
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return filepath;
}

async function writeLegalPdf(spec, { mdOverride = null, filenameOverride = null, order = null } = {}) {
  ensureDir(DOCS_DIR);
  const filename = filenameOverride || spec.filename;
  const filepath = path.join(DOCS_DIR, filename);

  let md = mdOverride;
  if (!md) {
    const loaded = readLegalMarkdown(spec);
    if (!loaded) return null;
    md = loaded.md;
  }

  await renderMdToPdfFile(spec.title, md, filepath, order);
  const size = fs.statSync(filepath).size;
  if (size < 500) return null;
  return { filepath, filename, source: mdOverride ? 'personalized' : 'generated', size };
}

async function generatePersonalizedMedicalPdf(order) {
  const spec = LEGAL_PDFS.find((s) => s.key === 'medical');
  if (!spec) return null;
  const loaded = readLegalMarkdown(spec);
  if (!loaded) return null;

  const name = signerFullName(order);
  const md = personalizeMedicalMarkdown(loaded.md, name);
  const safeId = String(order?.order_id || 'adh')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80);
  const filename = `Declaration-medicale-${safeId}.pdf`;
  return writeLegalPdf(spec, { mdOverride: md, filenameOverride: filename, order });
}

/**
 * Génère toujours les PDF depuis les .md (dans /tmp sur Vercel).
 * La déclaration médicale est personnalisée avec le nom du client.
 * Signature manuscrite incrustée si order.signature présent.
 */
async function generateInscriptionLegalPdfs(order = null) {
  const out = [];
  const errors = [];
  for (const spec of LEGAL_PDFS) {
    try {
      let pdf = null;
      if (spec.key === 'medical') {
        pdf = order
          ? await generatePersonalizedMedicalPdf(order)
          : await writeLegalPdf(spec);
      } else {
        pdf = await writeLegalPdf(spec, { order });
      }
      if (pdf) out.push(pdf);
      else errors.push(`${spec.filename}: markdown introuvable (${LEGAL_DIR})`);
    } catch (err) {
      errors.push(`${spec.filename}: ${err.message}`);
    }
  }
  return { pdfs: out, errors, legalDir: LEGAL_DIR, docsDir: DOCS_DIR };
}

function orderHasSignedDossier(order) {
  return Boolean(order?.signature?.signed_at);
}

function dossierFilename(order) {
  const safeId = String(order?.order_id || 'adh')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80);
  return `dossier-inscription-${safeId}.pdf`;
}

function createDossierDoc() {
  return new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 56, left: 48, right: 48 },
    bufferPages: true,
    autoFirstPage: true,
  });
}

function loadBufferImage(raw) {
  const b64 = String(raw || '').split(',').pop();
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length > 32 ? { type: 'buffer', value: buf } : null;
  } catch {
    return null;
  }
}

function loadPhotoImage(order) {
  const docs = order?.documents || {};
  const filePath = docs.photo;
  if (filePath && fs.existsSync(filePath)) return { type: 'path', value: filePath };
  return loadBufferImage(docs.photo_base64);
}

function loadIdImage(order) {
  const docs = order?.documents || {};
  const filePath = docs.id_document;
  if (filePath && fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
      return { type: 'path', value: filePath };
    }
  }
  return loadBufferImage(docs.id_document_base64);
}

function gymLabelForDossier(order) {
  const slug = String(order?.customer_full?.gym || order?.gym || '').trim();
  if (!slug) return '—';
  return GYM_LABELS[slug] || GYM_LABELS[slug.toLowerCase()] || slug;
}

function offerLabelForDossier(order) {
  return (
    order?.product_snapshot?.display_name ||
    order?.product_snapshot?.name ||
    order?.product_name ||
    'Inscription'
  );
}

function drawFittedImage(doc, img, x, y, fit) {
  if (!img) return false;
  try {
    if (img.type === 'path') doc.image(img.value, x, y, { fit, align: 'center', valign: 'center' });
    else doc.image(img.value, x, y, { fit, align: 'center', valign: 'center' });
    return true;
  } catch {
    return false;
  }
}

function renderDossierCover(doc, order) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const club = clubForOrder(order);
  const short = order?.customer_short || {};
  const full = order?.customer_full || {};
  const name = signerFullName(order) || 'Adhérent';
  const signedAt = order?.signature?.signed_at;
  const photo = loadPhotoImage(order);
  const hasId = Boolean(loadIdImage(order) || order?.documents?.id_document || order?.documents?.id_document_url);

  doc.font('Helvetica-Bold').fontSize(18).fillColor(NAVY).text('Dossier d’inscription signé', left, doc.y, { width });
  doc.moveDown(0.35);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`${club.name} — ${club.address}, ${club.city}`, { width });
  doc.moveDown(0.9);

  const photoW = 118;
  const photoH = 148;
  const textW = photo ? width - photoW - 18 : width;
  const infoY = doc.y;
  const rows = [
    ['Référence', order.order_id],
    ['Adhérent', name],
    ['E-mail', short.email || full.email || '—'],
    ['Téléphone', short.phone || full.phone || '—'],
    ['Offre', offerLabelForDossier(order)],
    ['Salle', gymLabelForDossier(order)],
    ['Signé le', signedAt ? formatDateFr(signedAt) : '—'],
  ];
  let y = infoY;
  for (const [label, value] of rows) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, left, y, { width: textW });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1A1A2E').text(String(value || '—'), left, y + 11, {
      width: textW,
    });
    y = doc.y + 8;
  }

  if (photo) {
    const px = left + width - photoW;
    doc.rect(px - 4, infoY - 4, photoW + 8, photoH + 8).strokeColor('#E5E7EB').lineWidth(0.8).stroke();
    drawFittedImage(doc, photo, px, infoY, [photoW, photoH]);
  }
  doc.y = Math.max(y, photo ? infoY + photoH + 12 : y);

  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('Documents inclus', left, doc.y, { width });
  doc.moveDown(0.25);
  const included = [
    'Conditions générales de vente (signées)',
    'Règlement intérieur (signé)',
    'Déclaration médicale (signée)',
    'Facture',
  ];
  if (hasId) included.push('Pièce d’identité');
  for (const item of included) {
    doc.font('Helvetica').fontSize(9).fillColor('#1A1A2E').text(`• ${item}`, { width });
    doc.moveDown(0.12);
  }

  stampSignature(doc, order, { title: 'Signature électronique du dossier' });
  drawPageFooter(doc, order || club);
}

function renderIdDocumentPage(doc, order) {
  const img = loadIdImage(order);
  if (!img) return false;
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const height = doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 80;
  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text('Pièce d’identité', left, doc.y, { width });
  doc.moveDown(0.6);
  const drew = drawFittedImage(doc, img, left, doc.y, [width, height]);
  if (!drew) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Pièce d’identité enregistrée (aperçu indisponible).', { width });
  }
  drawPageFooter(doc, order);
  return true;
}

function renderInscriptionDossier(doc, order) {
  const { renderInscriptionInvoice } = require('./invoice-pdf');
  renderDossierCover(doc, order);
  for (const spec of LEGAL_PDFS) {
    const loaded = readLegalMarkdown(spec);
    if (!loaded) continue;
    doc.addPage();
    let md = loaded.md;
    if (spec.key === 'medical') {
      md = personalizeMedicalMarkdown(md, signerFullName(order));
    }
    renderLegalPdf(doc, { title: spec.title, md, order, stamp: true });
  }
  doc.addPage();
  renderInscriptionInvoice(doc, order);
  renderIdDocumentPage(doc, order);
}

async function prepareDossierOrder(order) {
  if (!order?.order_id) throw new Error('order requis');
  const { hydrateOrderMedia } = require('./cloudinary');
  return hydrateOrderMedia(order);
}

/**
 * Un seul PDF : page de garde + CGV + règlement + déclaration médicale (signés) + facture.
 */
async function generateInscriptionDossierPdf(order) {
  order = await prepareDossierOrder(order);
  ensureDir(DOCS_DIR);
  const filename = dossierFilename(order);
  const filepath = path.join(DOCS_DIR, filename);
  const doc = createDossierDoc();
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);
  renderInscriptionDossier(doc, order);
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  const size = fs.statSync(filepath).size;
  return { filepath, filename, size };
}

async function streamInscriptionDossierPdf(order, res) {
  order = await prepareDossierOrder(order);
  const filename = dossierFilename(order);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const doc = createDossierDoc();
  doc.pipe(res);
  renderInscriptionDossier(doc, order);
  doc.end();
}

module.exports = {
  LEGAL_PDFS,
  LEGAL_DIR,
  DOCS_DIR,
  generateInscriptionLegalPdfs,
  generatePersonalizedMedicalPdf,
  generateInscriptionDossierPdf,
  streamInscriptionDossierPdf,
  orderHasSignedDossier,
  dossierFilename,
  personalizeMedicalMarkdown,
  signerFullName,
  writeLegalPdf,
  stampSignature,
};
