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

/** Émetteur factures salle Portet — association Noble Art Portésien. */
const CLUB_PORTET = {
  name: 'NOBLE ART PORTESIEN',
  brand: 'Boxing Center Portet',
  legalForm: 'Association loi 1901',
  address: '61 route d\'Espagne',
  city: '31120 Portet-sur-Garonne',
  country: 'France',
  siren: '444 152 482',
  siret: '444 152 482 00022',
  tva: 'FR80444152482',
  naf: '9312Z',
  phone: '06 87 90 02 16',
  email: 'nobleartportesien@gmail.com',
  web: 'boxingcenter.fr',
};

function isPortetIssuerGym(gym) {
  return /portet/i.test(String(gym || ''));
}

function clubForGym(gym) {
  return isPortetIssuerGym(gym) ? CLUB_PORTET : CLUB;
}

function clubForOrder(order = {}) {
  const gym =
    order.customer_full?.gym ||
    order.gym ||
    order.pickup_gym ||
    order.customer?.pickup_gym ||
    order.customer?.gym ||
    '';
  return clubForGym(gym);
}

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

function clubEmitterRows(club = CLUB) {
  const rows = [
    { label: club.legalForm ? 'Association' : 'Société', value: club.name },
    club.legalForm ? { label: 'Forme juridique', value: club.legalForm } : null,
    { label: 'Adresse', value: `${club.address}\n${club.city}, ${club.country}` },
    club.siren ? { label: 'SIREN', value: club.siren } : null,
    { label: 'SIRET', value: club.siret },
    { label: 'TVA', value: club.tva },
    club.naf ? { label: 'NAF / APE', value: club.naf } : null,
    { label: 'Site web', value: club.web },
  ];
  return rows.filter((row) => row?.value);
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
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  if (doc.y > doc.page.height - 100) doc.addPage();
  doc.x = left;
  doc.moveDown(0.2);
  doc.fontSize(12).fillColor(NAVY).font('Helvetica-Bold').text(title, left, doc.y, { width });
  doc.x = left;
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

  doc.x = left;
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

  if (doc.y > doc.page.height - 160) doc.addPage();
  drawSectionHeading(doc, 'Signature');

  if (order.signature) {
    const imgPath = order.signature.image_path;
    const hasImg = (imgPath && fs.existsSync(imgPath)) || Boolean(order.signature.image_base64);
    const sigH = hasImg ? 130 : 70;
    doc.roundedRect(left, doc.y, width, sigH, 6).fill('#FFFFFF').stroke(BORDER);
    const sigY = doc.y + 10;
    doc.font('Helvetica').fontSize(9).fillColor('#374151');
    doc.text(`${memberDisplayName(short)}${short.email ? ` — ${short.email}` : ''}`, left + 14, sigY);
    doc.text(`Le ${new Date(order.signature.signed_at).toLocaleString('fr-FR')}`, left + 14, sigY + 14);
    doc.fontSize(8).fillColor(MUTED).text(
      `CGV : ${order.signature.consent_cgv ? 'Oui' : 'Non'}  ·  Règlement : ${order.signature.consent_reglement ? 'Oui' : 'Non'}  ·  Médical : ${order.signature.consent_medical ? 'Oui' : 'Non'}`,
      left + 14,
      sigY + 28
    );
    if (hasImg) {
      try {
        if (imgPath && fs.existsSync(imgPath)) {
          doc.image(imgPath, left + 14, sigY + 44, { height: 56, fit: [width - 40, 56] });
        } else if (order.signature.image_base64) {
          const b64 = String(order.signature.image_base64).split(',').pop();
          doc.image(Buffer.from(b64, 'base64'), left + 14, sigY + 44, {
            height: 56,
            fit: [width - 40, 56],
          });
        }
      } catch {
        doc.fontSize(9).fillColor(MUTED).text('(Signature manuscrite manquante)', left + 14, sigY + 48);
      }
    } else {
      doc.fontSize(9).fillColor(MUTED).text('(Signature manuscrite manquante)', left + 14, sigY + 48);
    }
    doc.y = sigY + sigH;
  } else {
    doc.fontSize(8.5).fillColor(MUTED).font('Helvetica').text(
      'Prévisualisation — signature à apposer à la validation.',
      { width, lineGap: 2 }
    );
  }
}

function clubEmitterRowsCompact(club = CLUB) {
  return [
    { label: club.legalForm ? 'Association' : 'Société', value: club.name },
    { label: 'Adresse', value: `${club.address}, ${club.city}` },
    { label: 'SIRET', value: club.siret },
    club.tva ? { label: 'TVA', value: club.tva } : null,
    { label: 'Site web', value: club.web },
  ].filter((row) => row?.value);
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

  doc.fontSize(10).fillColor(NAVY).font('Helvetica-Bold').text('Signature', left, doc.y);
  doc.y += 12;

  if (order.signature) {
    const imgPath = order.signature.image_path;
    const hasImg = (imgPath && fs.existsSync(imgPath)) || Boolean(order.signature.image_base64);
    const sigH = hasImg ? 100 : 48;
    doc.roundedRect(left, doc.y, width, sigH, 4).fill('#FFFFFF').stroke(BORDER);
    const sigY = doc.y + 8;
    doc.font('Helvetica').fontSize(8).fillColor('#374151');
    const name = memberDisplayName(short);
    doc.text(
      `${name}${short.email ? ` — ${short.email}` : ''}  ·  ${new Date(order.signature.signed_at).toLocaleString('fr-FR')}`,
      left + 10,
      sigY,
      { width: width - 20 }
    );
    doc.fontSize(7).fillColor(MUTED).text(
      `CGV : ${order.signature.consent_cgv ? 'Oui' : 'Non'}  ·  Règlement : ${order.signature.consent_reglement ? 'Oui' : 'Non'}  ·  Médical : ${order.signature.consent_medical ? 'Oui' : 'Non'}`,
      left + 10,
      sigY + 14,
      { width: width - 20 }
    );
    if (hasImg) {
      try {
        if (imgPath && fs.existsSync(imgPath)) {
          doc.image(imgPath, left + 10, sigY + 28, { height: 52, fit: [width - 30, 52] });
        } else if (order.signature.image_base64) {
          const b64 = String(order.signature.image_base64).split(',').pop();
          doc.image(Buffer.from(b64, 'base64'), left + 10, sigY + 28, {
            height: 52,
            fit: [width - 30, 52],
          });
        }
      } catch {
        /* ignore */
      }
    }
    doc.y = doc.y + sigH;
  } else {
    doc.fontSize(7.5).fillColor(MUTED).font('Helvetica').text(
      'Prévisualisation — signature à la validation.',
      { width }
    );
  }
}

function resolveClubArg(clubOrOrder) {
  if (!clubOrOrder) return CLUB;
  if (clubOrOrder.siret && clubOrOrder.name && !clubOrOrder.order_id && !clubOrOrder.customer_full) {
    return clubOrOrder;
  }
  if (
    clubOrOrder.order_id ||
    clubOrOrder.customer_full ||
    clubOrOrder.gym ||
    clubOrOrder.pickup_gym ||
    clubOrOrder.customer
  ) {
    return clubForOrder(clubOrOrder);
  }
  return CLUB;
}

function drawPageFooter(doc, clubOrOrder) {
  const club = resolveClubArg(clubOrOrder);
  const range = doc.bufferedPageRange();
  const total = range.count;
  const footerText = `${club.name} — SIRET ${club.siret} — ${club.web}`;

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
  CLUB_PORTET,
  clubForGym,
  clubForOrder,
  isPortetIssuerGym,
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
