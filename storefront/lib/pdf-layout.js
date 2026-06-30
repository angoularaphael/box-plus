const fs = require('fs');
const path = require('path');
const { ROOT } = require('../../lib/utils');
const { SITE_URL } = require('./branding');

const LOGO_PATH = path.join(ROOT, 'storefront', 'public', 'assets', 'logo-boxing-center.jpg');

const NAVY = '#0B1F3A';
const TEAL = '#2EC4C6';
const MUTED = '#6B7280';
const LABEL = '#9CA3AF';
const BORDER = '#E5E7EB';
const ROW_ALT = '#F9FAFB';

const CLUB = {
  name: 'SAS BOXING CENTER',
  brand: 'Boxing Center',
  address: '12 rue de Fenouillet',
  city: '31200 Toulouse',
  country: 'France',
  rcs: 'Toulouse B 821 817 889',
  siret: '821 817 889 00016',
  tva: 'FR 82 821 817 889',
  phone: '09 54 14 74 72',
  email: 'boxingcenter31@gmail.com',
  web: 'boxingcenter.fr',
};

function formatEuros(cents) {
  return `${((cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
}

function formatDateFr(iso) {
  if (!iso) {
    return new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateShort(iso) {
  if (!iso) return new Date().toLocaleDateString('fr-FR');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR');
}

function memberDisplayName(short = {}) {
  const first = String(short.first_name || '').trim();
  const last = String(short.last_name || '').trim();
  const looksLikeEmail = (s) => s.includes('@');
  if (first && last && first !== last && !looksLikeEmail(first)) return `${first} ${last}`;
  if (first && !looksLikeEmail(first)) return first;
  if (last && !looksLikeEmail(last)) return last;
  return 'Adhérent';
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function drawProHeader(doc, { title, date, ref }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const top = doc.page.margins.top;

  doc.fontSize(22).fillColor(NAVY).font('Helvetica-Bold').text(title, left, top, { width: width * 0.62 });
  doc.fontSize(10).fillColor(MUTED).font('Helvetica').text(formatDateFr(date), left, doc.y + 4);
  if (ref) {
    doc.fontSize(9).fillColor(MUTED).text(`Réf. ${ref}`, left, doc.y + 2);
  }

  const logoW = 72;
  const logoX = left + width - logoW;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, logoX, top, { width: logoW });
    } catch {
      doc.fontSize(14).fillColor(NAVY).font('Helvetica-Bold').text(CLUB.brand, logoX, top + 8, {
        width: logoW,
        align: 'right',
      });
    }
  } else {
    doc.fontSize(14).fillColor(NAVY).font('Helvetica-Bold').text(CLUB.brand, logoX, top + 8, {
      width: logoW,
      align: 'right',
    });
  }

  doc.y = Math.max(doc.y, top + 78) + 12;
}

function drawPartyColumn(doc, x, y, width, heading, rows) {
  doc.fontSize(11).fillColor(NAVY).font('Helvetica-Bold').text(heading, x, y, { width });
  let cy = y + 18;
  for (const row of rows) {
    if (!row?.value) continue;
    doc.fontSize(8).fillColor(LABEL).font('Helvetica').text(`${row.label} :`, x, cy, { width });
    cy += 11;
    doc.fontSize(9).fillColor('#1F2937').font('Helvetica-Bold').text(row.value, x, cy, { width, lineGap: 1 });
    cy = doc.y + 8;
  }
  return cy;
}

function drawTwoParties(doc, emitterRows, recipientRows) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const colW = (width - 24) / 2;
  const y = doc.y;
  const h1 = drawPartyColumn(doc, left, y, colW, 'Émetteur', emitterRows);
  const h2 = drawPartyColumn(doc, left + colW + 24, y, colW, 'Destinataire', recipientRows);
  doc.y = Math.max(h1, h2) + 16;
}

function clubEmitterRows() {
  return [
    { label: 'Société', value: CLUB.name },
    { label: 'Adresse', value: `${CLUB.address}\n${CLUB.city}, ${CLUB.country}` },
    { label: 'SIRET', value: CLUB.siret },
    { label: 'TVA', value: CLUB.tva },
    { label: 'Téléphone', value: CLUB.phone },
    { label: 'Email', value: CLUB.email },
    { label: 'Site web', value: CLUB.web },
  ];
}

function memberRecipientRows(short = {}, full = {}) {
  const name = memberDisplayName(short);
  const rows = [{ label: 'Nom', value: name }];
  if (short.email) rows.push({ label: 'Email', value: short.email });
  if (short.phone) rows.push({ label: 'Téléphone', value: short.phone });
  if (short.birthdate) rows.push({ label: 'Date de naissance', value: formatDateShort(short.birthdate) });
  if (full.address) {
    rows.push({
      label: 'Adresse',
      value: `${full.address}\n${[full.postal_code, full.city].filter(Boolean).join(' ')}`.trim(),
    });
  }
  if (full.gym) rows.push({ label: 'Salle principale', value: full.gym });
  return rows;
}

function drawSectionHeading(doc, title) {
  if (doc.y > doc.page.height - 100) doc.addPage();
  doc.moveDown(0.2);
  doc.fontSize(12).fillColor(NAVY).font('Helvetica-Bold').text(title);
  doc.moveDown(0.35);
}

function drawDetailTable(doc, { columns, rows, totalLabel, totalValue, subtotalRows = [] }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  let y = doc.y;
  const colWidths = columns.map((c) => width * c.width);

  doc.rect(left, y, width, 24).fill(NAVY);
  doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
  let cx = left;
  for (let i = 0; i < columns.length; i += 1) {
    doc.text(columns[i].label, cx + 6, y + 7, {
      width: colWidths[i] - 12,
      align: columns[i].align || 'left',
    });
    cx += colWidths[i];
  }
  y += 24;

  rows.forEach((row, idx) => {
    const rowH = row.height || 28;
    doc.rect(left, y, width, rowH).fill(idx % 2 ? ROW_ALT : '#FFFFFF').stroke(BORDER);
    doc.fillColor('#374151').fontSize(8.5).font('Helvetica');
    cx = left;
    for (let i = 0; i < columns.length; i += 1) {
      const key = columns[i].key;
      doc.text(String(row[key] ?? ''), cx + 6, y + 8, {
        width: colWidths[i] - 12,
        align: columns[i].align || 'left',
        lineGap: 1,
      });
      cx += colWidths[i];
    }
    y += rowH;
  });

  const totalsX = left + width * 0.55;
  let ty = y + 10;
  for (const line of subtotalRows) {
    doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(line.label, totalsX, ty, { width: width * 0.22 });
    doc.fillColor('#374151').font('Helvetica').text(line.value, totalsX + width * 0.22, ty, {
      width: width * 0.23,
      align: 'right',
    });
    ty += 16;
  }

  if (totalLabel) {
    doc.fontSize(10).fillColor(NAVY).font('Helvetica-Bold').text(totalLabel, totalsX, ty + 4, {
      width: width * 0.22,
    });
    doc.text(totalValue, totalsX + width * 0.22, ty + 4, { width: width * 0.23, align: 'right' });
    ty += 22;
  }

  doc.y = ty + 8;
}

function drawConditions(doc, items) {
  drawSectionHeading(doc, 'Conditions');
  for (const item of items) {
    if (doc.y > doc.page.height - 60) doc.addPage();
    doc.fontSize(9).fillColor(LABEL).font('Helvetica-Bold').text(`${item.label} :`, { continued: true });
    doc.fillColor('#374151').font('Helvetica').text(` ${item.value}`);
    doc.moveDown(0.15);
  }
  doc.moveDown(0.3);
}

function drawArticle(doc, section) {
  drawSectionHeading(doc, section.title);
  if (section.paragraphs) {
    for (const p of section.paragraphs) {
      if (doc.y > doc.page.height - 70) doc.addPage();
      doc.fontSize(9).fillColor('#374151').font('Helvetica').text(p, {
        align: 'justify',
        lineGap: 3,
        width: contentWidth(doc),
      });
      doc.moveDown(0.25);
    }
  }
  if (section.bullets) {
    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    for (const item of section.bullets) {
      if (doc.y > doc.page.height - 60) doc.addPage();
      doc.fontSize(8.5).fillColor('#374151').font('Helvetica').text(`•  ${item}`, left + 6, doc.y, {
        width: width - 12,
        lineGap: 2,
      });
      doc.moveDown(0.12);
    }
  }
  doc.moveDown(0.2);
}

function drawSignatureBlock(doc, order) {
  const short = order.customer_short || {};
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  if (doc.y > doc.page.height - 110) doc.addPage();
  drawSectionHeading(doc, 'Signature électronique');

  if (order.signature) {
    const sigH = 82;
    doc.roundedRect(left, doc.y, width, sigH, 6).fill('#F0FAFB').stroke(TEAL);
    const sigY = doc.y + 12;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(10).text('Document signé électroniquement', left + 14, sigY);
    doc.font('Helvetica').fontSize(9).fillColor('#374151');
    doc.text(`Par : ${memberDisplayName(short)}`, left + 14, sigY + 16);
    if (short.email) doc.text(`Email : ${short.email}`, left + 14, sigY + 28);
    doc.text(`Le ${new Date(order.signature.signed_at).toLocaleString('fr-FR')}`, left + 14, sigY + 42);
    doc.text(
      `Acceptation CGV : ${order.signature.consent_cgv ? 'Oui' : 'Non'}  ·  Règlement intérieur : ${order.signature.consent_reglement ? 'Oui' : 'Non'}`,
      left + 14,
      sigY + 54
    );
    if (order.signature.ip) {
      doc.fontSize(7).fillColor(MUTED).text(`Preuve horodatée — adresse IP : ${order.signature.ip}`, left + 14, sigY + 66);
    }
    doc.y = sigY + sigH;
  } else {
    doc.fontSize(8.5).fillColor(MUTED).font('Helvetica').text(
      'Prévisualisation — la signature électronique sera apposée à la validation finale de l\'inscription en ligne.',
      { width, lineGap: 2 }
    );
  }
}

function clubEmitterRowsCompact() {
  return [
    { label: 'Société', value: CLUB.name },
    { label: 'Adresse', value: `${CLUB.address}, ${CLUB.city}` },
    { label: 'SIRET', value: CLUB.siret },
    { label: 'Contact', value: `${CLUB.phone} — ${CLUB.email}` },
  ];
}

function drawPartyColumnCompact(doc, x, y, width, heading, rows) {
  doc.fontSize(9).fillColor(NAVY).font('Helvetica-Bold').text(heading, x, y, { width });
  let cy = y + 14;
  for (const row of rows) {
    if (!row?.value) continue;
    doc.fontSize(7.5).fillColor(LABEL).font('Helvetica').text(`${row.label} : `, x, cy, {
      width,
      continued: true,
    });
    doc.fillColor('#1F2937').font('Helvetica-Bold').text(row.value.replace(/\n/g, ', '), { width });
    cy = doc.y + 4;
  }
  return cy;
}

function drawTwoPartiesCompact(doc, emitterRows, recipientRows) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const colW = (width - 16) / 2;
  const y = doc.y;
  const h1 = drawPartyColumnCompact(doc, left, y, colW, 'Émetteur', emitterRows);
  const h2 = drawPartyColumnCompact(doc, left + colW + 16, y, colW, 'Adhérent', recipientRows);
  doc.y = Math.max(h1, h2) + 8;
}

function drawProHeaderCompact(doc, { title, date, ref }) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const top = doc.page.margins.top;

  doc.fontSize(16).fillColor(NAVY).font('Helvetica-Bold').text(title, left, top, { width: width * 0.65 });
  doc.fontSize(8).fillColor(MUTED).font('Helvetica');
  doc.text(`${formatDateFr(date)}${ref ? `  ·  Réf. ${ref}` : ''}`, left, doc.y + 2);

  const logoW = 52;
  const logoX = left + width - logoW;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, logoX, top, { width: logoW });
    } catch {
      doc.fontSize(11).fillColor(NAVY).font('Helvetica-Bold').text(CLUB.brand, logoX, top + 4, {
        width: logoW,
        align: 'right',
      });
    }
  }
  doc.y = Math.max(doc.y, top + 56) + 6;
}

function drawDetailTableCompact(doc, opts) {
  return drawDetailTable(doc, {
    ...opts,
    rows: (opts.rows || []).map((r) => ({ ...r, height: r.height || 22 })),
  });
}

function drawSignatureBlockCompact(doc, order) {
  const short = order.customer_short || {};
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  doc.fontSize(10).fillColor(NAVY).font('Helvetica-Bold').text('Signature électronique', left, doc.y);
  doc.y += 14;

  if (order.signature) {
    const sigH = 58;
    doc.roundedRect(left, doc.y, width, sigH, 4).fill('#F0FAFB').stroke(TEAL);
    const sigY = doc.y + 8;
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8.5).text('Document signé électroniquement', left + 10, sigY);
    doc.font('Helvetica').fontSize(7.5).fillColor('#374151');
    const name = memberDisplayName(short);
    const line1 = `Par : ${name}${short.email ? ` — ${short.email}` : ''}`;
    const line2 = `Le ${new Date(order.signature.signed_at).toLocaleString('fr-FR')}  ·  CGV : ${order.signature.consent_cgv ? 'Oui' : 'Non'}  ·  Règlement : ${order.signature.consent_reglement ? 'Oui' : 'Non'}`;
    doc.text(line1, left + 10, sigY + 13, { width: width - 20 });
    doc.text(line2, left + 10, sigY + 26, { width: width - 20 });
    if (order.signature.ip) {
      doc.fontSize(6.5).fillColor(MUTED).text(`IP : ${order.signature.ip}`, left + 10, sigY + 40);
    }
    doc.y = doc.y + sigH;
  } else {
    doc.fontSize(7.5).fillColor(MUTED).font('Helvetica').text(
      'Prévisualisation — signature à la validation finale.',
      { width }
    );
  }
}

function drawPageFooter(doc) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const footerText = `${CLUB.name} — SIRET ${CLUB.siret} — ${CLUB.phone} — ${CLUB.web}`;

  for (let i = 0; i < total; i += 1) {
    doc.switchToPage(range.start + i);
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const footerY = doc.page.height - doc.page.margins.bottom - 16;

    doc.save();
    doc.lineWidth(0.5).strokeColor(BORDER).moveTo(left, footerY).lineTo(right, footerY).stroke();
    doc.fontSize(6.5).fillColor(MUTED).font('Helvetica');
    doc.text(footerText, left, footerY + 3, { width: width - 48, lineBreak: false });
    doc.text(`${i + 1}/${total}`, right - 40, footerY + 3, { width: 40, align: 'right', lineBreak: false });
    doc.restore();
  }
  doc.switchToPage(range.start + total - 1);
}

module.exports = {
  CLUB,
  NAVY,
  TEAL,
  MUTED,
  LOGO_PATH,
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
  drawProHeaderCompact,
  drawTwoPartiesCompact,
  clubEmitterRowsCompact,
  drawDetailTableCompact,
  drawSignatureBlockCompact,
  contentWidth,
};
