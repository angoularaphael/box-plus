const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();

describe('supabase client (Node sans WebSocket natif)', () => {
  let saved;

  before(() => {
    saved = globalThis.WebSocket;
    delete globalThis.WebSocket;
  });

  after(() => {
    if (saved) globalThis.WebSocket = saved;
    else delete globalThis.WebSocket;
    delete require.cache[require.resolve('../storefront/lib/supabase')];
  });

  it('initialise le client avec le polyfill ws', () => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return;
    }
    delete require.cache[require.resolve('../storefront/lib/supabase')];
    const { getSupabase } = require('../storefront/lib/supabase');
    const sb = getSupabase();
    assert.ok(sb.from);
  });
});
