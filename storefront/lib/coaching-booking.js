'use strict';

const crypto = require('crypto');
const { sendEmailViaBrevo, isConfigured, defaultReplyTo } = require('./brevo-send');
const { getManagerContact } = require('./membership');
const { logInfo, logWarn } = require('../../lib/logger');

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

function validateBooking(body = {}) {
  const errors = [];
  const name = String(body.name || body.full_name || '').trim();
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const phone = String(body.phone || '').trim();
  const gym = String(body.gym || '').trim().toLowerCase();
  const activity = String(body.activity || '').trim().toLowerCase();
  const slot = String(body.slot || '').trim();
  const dateIso = String(body.date || '').trim();

  if (!name || name.length < 2) errors.push('Indiquez votre nom');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email invalide');
  if (!phone || phone.replace(/\D/g, '').length < 8) errors.push('Téléphone invalide');
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
    data: {
      name,
      email,
      phone,
      gym,
      activity,
      slot,
      date: dateIso,
    },
  };
}

async function sendCoachingBookingEmail(booking) {
  const manager = getManagerContact(booking.gym);
  if (!manager?.email) return { sent: false, reason: 'no_manager' };

  const gymLabel = manager.label;
  const activityLabel = ACTIVITIES.find((a) => a.id === booking.activity)?.label || booking.activity;
  const slotLabel = listSlots().find((s) => s.id === booking.slot)?.label || booking.slot;
  const dateLabel = formatFrDate(booking.date);

  const html = `<!DOCTYPE html><html lang="fr"><body style="font-family:Arial,sans-serif;padding:24px;color:#1A1A2E">
    <h2 style="color:#0B1F3A;margin:0 0 16px">Nouvelle réservation coaching</h2>
    <p>Une demande de cours particulier a été envoyée depuis la boutique Boxing Center.</p>
    <table style="border-collapse:collapse;width:100%;max-width:520px;margin:16px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Nom</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${booking.name}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Email</strong></td><td style="padding:8px;border-bottom:1px solid #eee"><a href="mailto:${booking.email}">${booking.email}</a></td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Téléphone</strong></td><td style="padding:8px;border-bottom:1px solid #eee"><a href="tel:${booking.phone}">${booking.phone}</a></td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Salle</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${gymLabel}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Activité</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${activityLabel}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Date</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${dateLabel}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><strong>Créneau</strong></td><td style="padding:8px;border-bottom:1px solid #eee">${slotLabel}</td></tr>
    </table>
    <p style="color:#5C6370;font-size:13px">Merci de confirmer ou recontacter le client rapidement.</p>
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
    // Accusé au client
    await sendEmailViaBrevo({
      to: booking.email,
      subject: 'Demande de coaching bien reçue — Boxing Center',
      html: `<p>Bonjour ${booking.name},</p>
        <p>Nous avons bien reçu votre demande de coaching <strong>${activityLabel}</strong> à <strong>${gymLabel}</strong> le <strong>${dateLabel}</strong> (${slotLabel}).</p>
        <p>Le responsable de votre salle va vous recontacter pour confirmer.</p>
        <p>Sportivement,<br/>Boxing Center</p>`,
      replyTo: defaultReplyTo(),
    }).catch(() => null);
    logInfo('Email réservation coaching envoyé', { to: manager.email, gym: booking.gym });
    return { sent: true, manager };
  } catch (err) {
    logWarn('Email réservation coaching échoué', { error: err.message });
    return { sent: false, reason: 'brevo_error', error: err.message, manager };
  }
}

async function persistCoachingBooking(booking, mail = {}) {
  const orderId = `COACH-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const activityLabel = ACTIVITIES.find((a) => a.id === booking.activity)?.label || booking.activity;
  const slotLabel = listSlots().find((s) => s.id === booking.slot)?.label || booking.slot;
  const gymLabel = mail.manager?.label || GYMS.find((g) => g.id === booking.gym)?.label || booking.gym;
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
      access_token: crypto.randomBytes(16).toString('hex'),
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
      },
      step: 8,
      payment: { status: 'n/a' },
      email_sent_at: mail.sent ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    logWarn('Réservation coaching non persistée', { order_id: orderId, error: err.message });
    return { order_id: orderId, persisted: false };
  }
  return { order_id: orderId, persisted: true };
}

async function bookCoaching(body = {}) {
  const check = validateBooking(body);
  if (!check.ok) return { ok: false, errors: check.errors };
  const mail = await sendCoachingBookingEmail(check.data);
  if (!mail.sent && mail.reason === 'brevo_error') {
    return { ok: false, errors: ['Envoi impossible pour le moment. Réessayez ou contactez votre salle.'] };
  }
  const saved = await persistCoachingBooking(check.data, mail);
  return {
    ok: true,
    order_id: saved.order_id,
    gym: check.data.gym,
    manager_label: mail.manager?.label || null,
    // En mode log (Brevo off), on considère quand même OK pour ne pas bloquer en local
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
  GYMS,
  ACTIVITIES,
  listSlots,
  minBookingDate,
  toIsoDate,
  bookingOptions,
  validateBooking,
  bookCoaching,
  sendCoachingBookingEmail,
};
