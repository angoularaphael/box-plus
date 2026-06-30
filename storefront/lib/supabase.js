const { createClient } = require('@supabase/supabase-js');

function ensureWebSocketPolyfill() {
  if (typeof globalThis.WebSocket !== 'undefined') return;
  try {
    // Vercel Node 20 n'a pas WebSocket natif ; @supabase/supabase-js en a besoin à l'init.
    globalThis.WebSocket = require('ws');
  } catch {
    // ws absent — createClient échouera avec un message explicite.
  }
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase non configuré');
  ensureWebSocketPolyfill();
  return createClient(url, key, { auth: { persistSession: false } });
}

module.exports = { getSupabase };
