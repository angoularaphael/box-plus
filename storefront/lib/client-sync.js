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

function compactRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

function buildRowVariants(fields) {
  const core = compactRow({
    prenom: fields.prenom,
    nom: fields.nom,
    email: fields.email,
    telephone: fields.telephone,
    salle: fields.salle,
    source: 'boxplus',
  });
  const extended = compactRow({
    ...core,
    date_naissance: fields.date_naissance,
    adresse: fields.adresse,
    code_postal: fields.code_postal,
    ville: fields.ville,
    contact_urgence: fields.contact_urgence,
    info_medicale: fields.info_medicale,
    offre: fields.offre,
  });
  return [
    extended,
    core,
    { ...core, source: 'manual' },
  ];
}

function isSchemaOrConstraintError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('schema cache') ||
    msg.includes('could not find') ||
    msg.includes('column') ||
    msg.includes('portet_clients_source_check') ||
    msg.includes('check constraint') ||
    msg.includes('23514')
  );
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

async function upsertPortetClient(sb, fields, { orderId, logLabel }) {
  const now = new Date().toISOString();
  const existingId = await findExistingClientId(sb, {
    email: fields.email,
    telephone: fields.telephone,
  });

  let lastError = null;
  for (const variant of buildRowVariants(fields)) {
    const row = { ...variant, updated_at: now };
    try {
      if (existingId) {
        const { data, error } = await sb.from(TABLE).update(row).eq('id', existingId).select('id').single();
        if (error) throw error;
        logInfo(`Client gestion-manager mis à jour (${logLabel})`, {
          order_id: orderId,
          client_id: data.id,
          source: row.source,
        });
        return { synced: true, client_id: data.id, updated: true, source: row.source };
      }

      const { data, error } = await sb
        .from(TABLE)
        .insert({ ...row, created_at: now })
        .select('id')
        .single();
      if (error) throw error;
      logInfo(`Client gestion-manager créé (${logLabel})`, {
        order_id: orderId,
        client_id: data.id,
        source: row.source,
      });
      return { synced: true, client_id: data.id, created: true, source: row.source };
    } catch (err) {
      lastError = err;
      if (!isSchemaOrConstraintError(err)) break;
    }
  }

  throw lastError || new Error('Sync client impossible');
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
    date_naissance: full.birth_date || short.birthdate || null,
    adresse: full.address || null,
    code_postal: full.postal_code || null,
    ville: full.city || null,
    contact_urgence: full.emergency_contact || null,
    info_medicale: full.medical_info || null,
    offre: product.display_name || product.name || null,
    source: 'boxplus',
  };
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

  try {
    return await upsertPortetClient(getSupabase(), fields, {
      orderId: order.order_id,
      logLabel: 'inscription',
    });
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
    salle: gymToSalle(order.pickup_gym || c.pickup_gym || c.gym),
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

  try {
    return await upsertPortetClient(getSupabase(), fields, {
      orderId: order.order_id,
      logLabel: 'matériel',
    });
  } catch (err) {
    logWarn('Sync client matériel échouée', { order_id: order.order_id, error: err.message });
    return { synced: false, reason: 'db_error', error: err.message };
  }
}

module.exports = {
  clientFieldsFromOrder,
  upsertClientFromInscription,
  upsertMaterielClient,
  buildRowVariants,
  isSchemaOrConstraintError,
};
