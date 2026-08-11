const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ROOT, ensureDir } = require('../../lib/utils');
const { CLUB, NAVY, MUTED, drawPageFooter } = require('./pdf-layout');

const LEGAL_DIR = path.join(ROOT, 'storefront', 'legal');
const DOCS_DIR =
  process.env.BOXPLUS_DOCS_DIR ||
  (process.env.VERCEL ? '/tmp/boxplus-documents' : path.join(ROOT, 'data', 'storefront', 'documents'));

const LEGAL_PDFS = [
  {
    md: 'cgv.md',
    filename: 'CGV-Boxing-Center.pdf',
    title: 'Conditions Générales de Vente et d’Abonnement',
  },
  {
    md: 'reglement.md',
    filename: 'Reglement-interieur-Boxing-Center.pdf',
    title: 'Règlement intérieur',
  },
  {
    md: 'attestation-medicale.md',
    filename: 'Declaration-medicale-Boxing-Center.pdf',
    title: 'Déclaration médicale',
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

function renderLegalPdf(doc, { title, md }) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font('Helvetica-Bold').fontSize(16).fillColor(NAVY).text(title, left, doc.y, { width });
  doc.moveDown(0.35);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`${CLUB.name} — ${CLUB.address}, ${CLUB.city}`, { width });
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

  drawPageFooter(doc);
}

async function writeLegalPdf(spec) {
  ensureDir(DOCS_DIR);
  const mdPath = path.join(LEGAL_DIR, spec.md);
  if (!fs.existsSync(mdPath)) {
    return null;
  }
  const mdStat = fs.statSync(mdPath);
  const filepath = path.join(DOCS_DIR, spec.filename);
  if (fs.existsSync(filepath)) {
    const pdfStat = fs.statSync(filepath);
    if (pdfStat.mtimeMs >= mdStat.mtimeMs && pdfStat.size > 500) {
      return { filepath, filename: spec.filename };
    }
  }

  const md = fs.readFileSync(mdPath, 'utf8');
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 56, left: 48, right: 48 },
    bufferPages: true,
    autoFirstPage: true,
  });
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);
  renderLegalPdf(doc, { title: spec.title, md });
  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return { filepath, filename: spec.filename };
}

async function generateInscriptionLegalPdfs() {
  const out = [];
  for (const spec of LEGAL_PDFS) {
    const pdf = await writeLegalPdf(spec);
    if (pdf) out.push(pdf);
  }
  return out;
}

module.exports = {
  LEGAL_PDFS,
  generateInscriptionLegalPdfs,
  writeLegalPdf,
};
