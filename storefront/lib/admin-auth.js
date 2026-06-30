const bcrypt = require('bcryptjs');
const { getSupabase } = require('./supabase');

function dbRole(role) {
  return role === 'super_admin' ? 'admin' : role || 'admin';
}

async function verifyAdminLogin(email, password) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !password) return null;

  const superEmail = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const superPass = process.env.SUPER_ADMIN_PASSWORD || '';
  if (superEmail && normalized === superEmail) {
    if (password === superPass) {
      return { email: normalized, role: 'super_admin', name: 'Super administrateur' };
    }
    return null;
  }

  try {
    const sb = getSupabase();
    const { data, error } = await sb.from('app_users').select('*').eq('email', normalized).maybeSingle();
    if (error || !data) return null;
    if (!bcrypt.compareSync(password, data.password_hash)) return null;
    return {
      email: data.email,
      role: dbRole(data.role),
      name: data.name || data.email,
    };
  } catch {
    return null;
  }
}

module.exports = { verifyAdminLogin };
