'use strict';

const crypto = require('crypto');
const { sendEmailViaBrevo, isConfigured, defaultReplyTo } = require('./brevo-send');
const { getManagerContact } = require('./membership');
const { getStoreUrl } = require('../../lib/app-urls');
const { logInfo, logWarn } = require('../../lib/logger');

const COACHING_SESSION_PRICE_CENTS = 5500;

function coachingInvoicePath(orderId, accessToken) {
  const q = accessToken ? `?token=${encodeURIComponent(accessToken)}` : '';
  return `/api/orders/${encodeURIComponent(orderId)}/contract.pdf${q}`;
}

function coachingInvoiceUrl(orderId, accessToken) {
  return `${getStoreUrl()}${coachingInvoicePath(orderId, accessToken)}`;
}

const GYMS = [
  { id: 'minimes', label: 'Minimes' },
  { id: 'ramonville', label: 'Ramonville' },
  { id: 'portet', label: 'Portet' },
  { id: 'etats-unis', label: 'États-Unis' },
  { id: 'st-cyprien', label: 'St-Cyprien' },
];

const ACTIVITIES = [
  { id: 'mma-sols', label: 'MMA / Sols' },
  { id: 'preparation-physique', label: 'Préparation physique' },
  { id: 'boxing-fitness', label: 'Boxing Fitness' },
];

function isCoachingPackProduct(product = {}) {
  return product.tab === 'coachings' || product.subsection === 'coaching';
}

function isCoachingOrder(order = {}) {
  if (order.action === 'coaching_booking' || String(order.order_id || '').startsWith('COACH-')) return true;
  return isCoachingPackProduct(order.product_snapshot || {});
}

function isCoachingAdminOrder(order = {}) {
  if (order.action === 'coaching_booking' || String(order.order_id || '').startsWith('COACH-')) return true;
  return isCoachingPackProduct(order.product_snapshot || {}) && Boolean(order.booking_date);
}

/** Créneaux 1 h de 10h–11h à 20h–21h */
function listSlots() {
  const slots = [];
  for (let h = 10; h <= 20; h += 1) {
    const start = `${String(h).padStart(2, '0')}:00`;
    const end = `${String(h + 1).padStart(2, '0')}:00`;
    slots.push({ id: `${h}-${h + 1}`, label: `${start} – ${end}`, startHour: h });
  }
  return slots;
}

function minBookingDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4);
  return d;
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(raw) {
  const s = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function formatFrDate(iso) {
  const dt = parseIsoDate(iso);
  if (!dt) return iso;
  return dt.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function labelsForBooking(data = {}) {
  const activityLabel = ACTIVITIES.find((a) => a.id === data.activity)?.label || data.activity;
  const slotLabel = listSlots().find((s) => s.id === data.slot)?.label || data.slot;
  const gymLabel = GYMS.find((g) => g.id === data.gym)?.label || data.gym;
  return { activityLabel, slotLabel, gymLabel, dateLabel: formatFrDate(data.date || data.booking_date) };
}

function validateBookingDetails(body = {}) {
  const errors = [];
  const gym = String(body.gym || '').trim().toLowerCase();
  const activity = String(body.activity || '').trim().toLowerCase();
  const slot = String(body.slot || '').trim();
  const dateIso = String(body.date || body.booking_date || '').trim();

  if (!GYMS.some((g) => g.id === gym)) errors.push('Choisissez une salle');
  if (!ACTIVITIES.some((a) => a.id === activity)) errors.push('Choisissez une activité');
  if (!listSlots().some((s) => s.id === slot)) errors.push('Choisissez un créneau');

  const chosen = parseIsoDate(dateIso);
  const min = minBookingDate();
  if (!chosen) errors.push('Date invalide');
  else if (chosen < min) errors.push('La réservation est possible à partir de J+4');

  return {
    ok: errors.length === 0,
    errors,
    data: { gym, activity, slot, date: dateIso },
  };
}

function validateBooking(body = {}) {
  const errors = [];
  const name = String(body.name || body.full_name || '').trim();
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const phone = String(body.phone || '').trim();

  if (!name || name.length < 2) errors.push('Indiquez votre nom');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email invalide');
  if (!phone || phone.replace(/\D/g, '').length < 8) errors.push('Téléphone invalide');

  const details = validateBookingDetails(body);
  if (!details.ok) errors.push(...details.errors);

  return {
    ok: errors.length === 0,
    errors,
    data: { name, email, phone, ...details.data },
  };
}

function bookingFromOrder(order = {}) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const customer = order.customer || {};
  const name =
    [short.first_name, short.last_name].filter(Boolean).join(' ') ||
    customer.name ||
    [customer.first_name, customer.last_name].filter(Boolean).join(' ') ||
    [full.first_name, full.last_name].filter(Boolean).join(' ');
  return {
    name,
    email: short.email || customer.email || full.email || '',
    phone: short.phone || customer.phone || full.phone || full.mobile || '',
    gym: order.gym || full.gym || '',
    activity: order.activity || '',
    slot: order.slot || '',
    date: order.booking_date || '',
  };
}

function applyBookingFieldsToOrder(order, data = {}) {
  const labels = labelsForBooking(data);
  order.gym = data.gym;
  order.customer_full = { ...(order.customer_full || {}), gym: data.gym };
  order.activity = data.activity;
  order.activity_label = labels.activityLabel;
  order.slot = data.slot;
  order.slot_label = labels.slotLabel;
  order.booking_date = data.date;
  return order;
}

async function sendCoachingBookingEmail(booking, { orderId, access_token, paid = false, packLabel = '' } = {}) {
  const manager = getManagerContact(booking.gym);
  if (!manager?.email) return { sent: false, reason: 'no_manager' };

  const { activityLabel, slotLabel, gymLabel, dateLabel } = labelsForBooking(booking);
  const packLine = packLabel ? `<tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Pack</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${packLabel}</td></tr>` : '';
  const paidLine = paid
    ? '<p style="color:#0B7A3B;font-weight:600">Paiement en ligne confirmé.</p>'
    : '<p style="color:#5C6370;font-size:13px">Merci de confirmer ou recontacter le client rapidement.</p>';

  const html = `<!DOCTYPE html><html lang="fr"><body style="font-family:Arial,sans-serif;padding:24px;color:#1A1A2E">
    <h2 style="color:#0B1F3A;margin:0 0 16px">Nouvelle réservation coaching</h2>
    <p>Une demande de cours particulier a été envoyée depuis la boutique Boxing Center.</p>
    <table style="border-collapse:collapse;width:100%;max-width:520px;margin:16px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Nom</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${booking.name}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Email</strong></td><td style="padding:8px;border-bottom:1px solid #eee"><a href="mailto:${booking.email}">${booking.email}</a></td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Téléphone</strong></td><td style="padding:8px;border-bottom:1px solid #eee"><a href="tel:${booking.phone}">${booking.phone}</a></td></tr>
      ${packLine}
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Salle</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${gymLabel}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Activité</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${activityLabel}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Date</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${dateLabel}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Créneau</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${slotLabel}</td></tr>
    </table>
    ${paidLine}
  </body></html>`;

  if (!isConfigured()) {
    logInfo('Réservation coaching (mode log)', { gym: booking.gym, to: manager.email, email: booking.email });
    return { sent: false, reason: 'brevo_not_configured', manager };
  }

  try {
    await sendEmailViaBrevo({
      to: manager.email,
      subject: `[Coaching] ${booking.name} — ${gymLabel} · ${dateLabel} · ${slotLabel}`,
      html,
      replyTo: booking.email || defaultReplyTo(),
    });
    const priceCents = Number(packLabel ? 0 : COACHING_SESSION_PRICE_CENTS);
    const invoiceLink =
      orderId && access_token
        ? `<p><a href="${coachingInvoiceUrl(orderId, access_token)}" style="color:#C41E3A;font-weight:600">Télécharger votre facture</a>${priceCents ? ` (séance ${(priceCents / 100).toFixed(0)}&nbsp;€ TTC).` : '.'}</p>`
        : '';
    const clientIntro = paid
      ? `Votre coaching <strong>${activityLabel}</strong> à <strong>${gymLabel}</strong> le <strong>${dateLabel}</strong> (${slotLabel}) est confirmé.`
      : `Nous avons bien reçu votre demande de coaching <strong>${activityLabel}</strong> à <strong>${gymLabel}</strong> le <strong>${dateLabel}</strong> (${slotLabel}).`;
    const clientFollow = paid
      ? 'Votre paiement a bien été enregistré. Le responsable de votre salle vous recontactera si besoin.'
      : 'Le responsable de votre salle va vous recontacter pour confirmer.';
    await sendEmailViaBrevo({
      to: booking.email,
      subject: paid
        ? 'Coaching confirmé — Boxing Center'
        : 'Demande de coaching bien reçue — Boxing Center',
      html: `<p>Bonjour ${booking.name},</p>
        <p>${clientIntro}</p>
        <p>${clientFollow}</p>
        ${invoiceLink}
        <p>Sportivement,<br/>Boxing Center</p>`,
      replyTo: defaultReplyTo(),
    }).catch(() => null);
    logInfo('Email réservation coaching envoyé', { to: manager.email, gym: booking.gym, paid });
    return { sent: true, manager };
  } catch (err) {
    logWarn('Email réservation coaching échoué', { error: err.message });
    return { sent: false, reason: 'brevo_error', error: err.message, manager };
  }
}

async function notifyCoachingPaidOrder(order) {
  if (!isCoachingOrder(order) || !order.booking_date) return { sent: false, reason: 'not_coaching' };
  if (order.manager_notify?.coaching_sent_at) return { sent: false, reason: 'already_sent' };

  const booking = bookingFromOrder(order);
  if (!booking.name || !booking.email) return { sent: false, reason: 'missing_customer' };

  const packLabel =
    order.product_snapshot?.display_name || order.product_snapshot?.name || order.product_name || '';
  const mail = await sendCoachingBookingEmail(booking, {
    orderId: order.order_id,
    access_token: order.access_token,
    paid: true,
    packLabel,
  });

  const { saveOrderAsync } = require('./order-persistence');
  order.booking_status = mail.sent ? 'sent' : mail.reason || 'queued';
  order.manager_email = mail.manager?.email || order.manager_email || null;
  order.email_sent_at = mail.sent ? new Date().toISOString() : order.email_sent_at || null;
  order.manager_notify = {
    ...(order.manager_notify || {}),
    coaching_sent_at: mail.sent ? new Date().toISOString() : null,
    coaching_status: mail.sent ? 'sent' : mail.reason || 'queued',
  };
  await saveOrderAsync(order);
  return mail;
}

async function persistCoachingBooking(booking, mail = {}, ids = {}) {
  const orderId = ids.orderId || `COACH-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const access_token = ids.access_token || crypto.randomBytes(16).toString('hex');
  const { activityLabel, slotLabel, gymLabel } = labelsForBooking(booking);
  const nameParts = String(booking.name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first_name = nameParts[0] || booking.name;
  const last_name = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  try {
    const { saveOrderAsync } = require('./order-persistence');
    await saveOrderAsync({
      order_id: orderId,
      access_token,
      action: 'coaching_booking',
      booking_status: mail.sent ? 'sent' : mail.reason || 'queued',
      customer: {
        name: booking.name,
        first_name,
        last_name,
        email: booking.email,
        phone: booking.phone,
      },
      customer_short: {
        first_name,
        last_name,
        email: booking.email,
        phone: booking.phone,
      },
      gym: booking.gym,
      activity: booking.activity,
      activity_label: activityLabel,
      slot: booking.slot,
      slot_label: slotLabel,
      booking_date: booking.date,
      manager_email: mail.manager?.email || null,
      product_name: `Coaching · ${activityLabel}`,
      product_snapshot: {
        name: `Coaching · ${activityLabel}`,
        display_name: `${activityLabel} · ${gymLabel} · ${formatFrDate(booking.date)} · ${slotLabel}`,
        price_cents: COACHING_SESSION_PRICE_CENTS,
      },
      step: 8,
      payment: { status: 'n/a' },
      email_sent_at: mail.sent ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    logWarn('Réservation coaching non persistée', { order_id: orderId, error: err.message });
    return { order_id: orderId, access_token, persisted: false };
  }
  return { order_id: orderId, access_token, persisted: true };
}

async function bookCoaching(body = {}) {
  const check = validateBooking(body);
  if (!check.ok) return { ok: false, errors: check.errors };
  const orderId = `COACH-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const access_token = crypto.randomBytes(16).toString('hex');
  const mail = await sendCoachingBookingEmail(check.data, { orderId, access_token });
  if (!mail.sent && mail.reason === 'brevo_error') {
    return { ok: false, errors: ['Envoi impossible pour le moment. Réessayez ou contactez votre salle.'] };
  }
  const saved = await persistCoachingBooking(check.data, mail, { orderId, access_token });
  return {
    ok: true,
    order_id: saved.order_id,
    access_token: saved.access_token,
    invoice_url: coachingInvoicePath(saved.order_id, saved.access_token),
    gym: check.data.gym,
    manager_label: mail.manager?.label || null,
    queued: !mail.sent && mail.reason === 'brevo_not_configured',
  };
}

function bookingOptions() {
  return {
    gyms: GYMS,
    activities: ACTIVITIES,
    slots: listSlots().map(({ id, label }) => ({ id, label })),
    min_date: toIsoDate(minBookingDate()),
  };
}

module.exports = {
  COACHING_SESSION_PRICE_CENTS,
  GYMS,
  ACTIVITIES,
  listSlots,
  minBookingDate,
  toIsoDate,
  bookingOptions,
  validateBooking,
  validateBookingDetails,
  labelsForBooking,
  applyBookingFieldsToOrder,
  bookingFromOrder,
  isCoachingPackProduct,
  isCoachingOrder,
  isCoachingAdminOrder,
  bookCoaching,
  sendCoachingBookingEmail,
  notifyCoachingPaidOrder,
  coachingInvoicePath,
  coachingInvoiceUrl,
};
