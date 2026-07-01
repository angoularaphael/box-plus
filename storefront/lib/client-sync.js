/**
 * Synchronise un adhérent BOXPLUS vers portet_clients (gestion-manager / Supabase).
 */
const { logInfo, logWarn } = require('../../lib/logger');
const { getSupabase } = require('./supabase');

const TABLE = 'portet_clients';

const GYM_LABELS = {
  minimes: 'Les Minimes',
  ramonville: 'Ramonville',
  'st-cyprien': 'Saint-Cyprien',
  portet: 'Portet-sur-Garonne',
  'etats-unis': 'États-Unis',
  balma: 'Balma',
};

function normalizeEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

function normalizeFrenchPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('33') && digits.length >= 11) return `0${digits.slice(-9)}`;
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  if (digits.length === 9 && /^[1-9]/.test(digits)) return `0${digits}`;
  return digits;
}

function phoneLookupVariants(phone) {
  const normalized = normalizeFrenchPhone(phone);
  if (!normalized) return [];
  const digits = normalized.replace(/\D/g, '');
  const variants = new Set([normalized, digits]);
  if (digits.length === 10 && digits.startsWith('0')) {
    const national = digits.slice(1);
    variants.add(national);
    variants.add(`33${national}`);
  }
  if (digits.length === 9) variants.add(`0${digits}`);
  return [...variants];
}

function gymToSalle(gym) {
  if (!gym) return null;
  const key = String(gym).trim().toLowerCase();
  return GYM_LABELS[key] || gym;
}

function cleanNamePart(value) {
  const s = String(value || '').trim();
  if (!s || s.includes('@')) return null;
  return s;
}

function clientFieldsFromOrder(order) {
  const short = order.customer_short || {};
  const full = order.customer_full || {};
  const product = order.product_snapshot || {};

  return {
    prenom: cleanNamePart(short.first_name),
    nom: cleanNamePart(short.last_name),
    email: normalizeEmail(short.email),
    telephone: normalizeFrenchPhone(short.phone),
    salle: gymToSalle(full.gym),
    date_naissance: full.birth_date || null,
    adresse: full.address || null,
    code_postal: full.postal_code || null,
    ville: full.city || null,
    contact_urgence: full.emergency_contact || null,
    info_medicale: full.medical_info || null,
    offre: product.display_name || product.name || null,
    source: 'boxplus',
  };
}

async function findExistingClientId(sb, { email, telephone }) {
  if (email) {
    const { data } = await sb.from(TABLE).select('id').ilike('email', email).maybeSingle();
    if (data?.id) return data.id;
  }
  if (telephone) {
    const variants = phoneLookupVariants(telephone);
    if (variants.length) {
      const { data } = await sb.from(TABLE).select('id').in('telephone', variants).limit(1).maybeSingle();
      if (data?.id) return data.id;
    }
  }
  return null;
}

async function upsertClientFromInscription(order) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { synced: false, reason: 'supabase_not_configured' };
  }

  const fields = clientFieldsFromOrder(order);
  if (!fields.email && !fields.telephone) {
    logWarn('Sync client ignorée — pas de contact', { order_id: order.order_id });
    return { synced: false, reason: 'no_contact' };
  }

  const sb = getSupabase();
  const now = new Date().toISOString();
  const row = {
    prenom: fields.prenom,
    nom: fields.nom,
    email: fields.email,
    telephone: fields.telephone,
    salle: fields.salle,
    date_naissance: fields.date_naissance,
    adresse: fields.adresse,
    code_postal: fields.code_postal,
    ville: fields.ville,
    contact_urgence: fields.contact_urgence,
    info_medicale: fields.info_medicale,
    offre: fields.offre,
    source: 'boxplus',
    updated_at: now,
  };

  try {
    const existingId = await findExistingClientId(sb, {
      email: fields.email,
      telephone: fields.telephone,
    });

    if (existingId) {
      const { data, error } = await sb.from(TABLE).update(row).eq('id', existingId).select('id').single();
      if (error) throw error;
      logInfo('Client gestion-manager mis à jour', { order_id: order.order_id, client_id: data.id });
      return { synced: true, client_id: data.id, updated: true };
    }

    const { data, error } = await sb
      .from(TABLE)
      .insert({ ...row, created_at: now })
      .select('id')
      .single();
    if (error) throw error;
    logInfo('Client gestion-manager créé', { order_id: order.order_id, client_id: data.id });
    return { synced: true, client_id: data.id, created: true };
  } catch (err) {
    logWarn('Sync client gestion-manager échouée', { order_id: order.order_id, error: err.message });
    return { synced: false, reason: 'db_error', error: err.message };
  }
}

function clientFieldsFromMaterielOrder(order) {
  const c = order.customer || {};
  return {
    prenom: cleanNamePart(c.first_name),
    nom: cleanNamePart(c.last_name),
    email: normalizeEmail(c.email),
    telephone: normalizeFrenchPhone(c.phone),
    salle: gymToSalle(c.pickup_gym || c.gym),
    source: 'boxplus',
    offre: 'Matériel',
  };
}

async function upsertMaterielClient(order) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { synced: false, reason: 'supabase_not_configured' };
  }

  const fields = clientFieldsFromMaterielOrder(order);
  if (!fields.email && !fields.telephone) {
    return { synced: false, reason: 'no_contact' };
  }

  const sb = getSupabase();
  const now = new Date().toISOString();
  const row = {
    prenom: fields.prenom,
    nom: fields.nom,
    email: fields.email,
    telephone: fields.telephone,
    salle: fields.salle,
    offre: fields.offre,
    source: 'boxplus',
    updated_at: now,
  };

  try {
    const existingId = await findExistingClientId(sb, {
      email: fields.email,
      telephone: fields.telephone,
    });

    if (existingId) {
      const { data, error } = await sb.from(TABLE).update(row).eq('id', existingId).select('id').single();
      if (error) throw error;
      logInfo('Client gestion-manager mis à jour (matériel)', { order_id: order.order_id, client_id: data.id });
      return { synced: true, client_id: data.id, updated: true };
    }

    const { data, error } = await sb
      .from(TABLE)
      .insert({ ...row, created_at: now })
      .select('id')
      .single();
    if (error) throw error;
    logInfo('Client gestion-manager créé (matériel)', { order_id: order.order_id, client_id: data.id });
    return { synced: true, client_id: data.id, created: true };
  } catch (err) {
    logWarn('Sync client matériel échouée', { order_id: order.order_id, error: err.message });
    return { synced: false, reason: 'db_error', error: err.message };
  }
}

module.exports = {
  clientFieldsFromOrder,
  upsertClientFromInscription,
  upsertMaterielClient,
};
