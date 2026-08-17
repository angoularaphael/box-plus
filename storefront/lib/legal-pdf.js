const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ensureDir } = require('../../lib/utils');
const { NAVY, MUTED, drawPageFooter, clubForOrder } = require('./pdf-layout');

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

/**
 * Un seul PDF : CGV + règlement + déclaration médicale (signés) + facture.
 */
async function generateInscriptionDossierPdf(order) {
  if (!order?.order_id) throw new Error('order requis');
  const { hydrateOrderMedia } = require('./cloudinary');
  order = await hydrateOrderMedia(order);
  ensureDir(DOCS_DIR);
  const { renderInscriptionInvoice } = require('./invoice-pdf');
  const safeId = String(order.order_id).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
  const filename = `dossier-inscription-${safeId}.pdf`;
  const filepath = path.join(DOCS_DIR, filename);

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 56, left: 48, right: 48 },
    bufferPages: true,
    autoFirstPage: true,
  });
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  let first = true;
  for (const spec of LEGAL_PDFS) {
    const loaded = readLegalMarkdown(spec);
    if (!loaded) continue;
    if (!first) doc.addPage();
    first = false;
    let md = loaded.md;
    if (spec.key === 'medical') {
      md = personalizeMedicalMarkdown(md, signerFullName(order));
    }
    renderLegalPdf(doc, { title: spec.title, md, order, stamp: true });
  }

  doc.addPage();
  renderInscriptionInvoice(doc, order);

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  const size = fs.statSync(filepath).size;
  return { filepath, filename, size };
}

module.exports = {
  LEGAL_PDFS,
  LEGAL_DIR,
  DOCS_DIR,
  generateInscriptionLegalPdfs,
  generatePersonalizedMedicalPdf,
  generateInscriptionDossierPdf,
  personalizeMedicalMarkdown,
  signerFullName,
  writeLegalPdf,
  stampSignature,
};
