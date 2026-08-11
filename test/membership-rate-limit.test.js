'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = path.join(os.tmpdir(), `boxplus-rl-${Date.now()}`);
fs.mkdirSync(tmp, { recursive: true });
process.env.BOXPLUS_ORDERS_DIR = tmp;
process.env.VERCEL = '';
process.env.BOXPLUS_ORDERS_REMOTE = '';

const {
  assertMembershipAttemptAllowed,
  identityKey,
  lockDurationMs,
  MAX_ATTEMPTS,
} = require('../storefront/lib/membership-rate-limit');

const person = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  birthdate: '1990-01-15',
  email: 'ada.rate@example.com',
  phone: '0612345678',
};

describe('membership rate-limit', () => {
  before(() => {
    assert.ok(fs.existsSync(tmp));
  });

  it('identityKey stable for same member', () => {
    const a = identityKey(person, 'change');
    const b = identityKey(
      {
        ...person,
        first_name: 'ADA',
        last_name: ' lovelace ',
        email: 'ADA.RATE@EXAMPLE.COM',
      },
      'change'
    );
    assert.equal(a, b);
    assert.notEqual(identityKey(person, 'change'), identityKey(person, 'cancel'));
  });

  it('autorise 5 tentatives puis lock 10 min', async () => {
    const body = { ...person, email: `ada5-${Date.now()}@example.com` };
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const r = await assertMembershipAttemptAllowed(body, 'change');
      assert.equal(r.ok, true, `tentative ${i}`);
      assert.equal(r.remaining, MAX_ATTEMPTS - i);
    }
    const blocked = await assertMembershipAttemptAllowed(body, 'change');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'rate_limited');
    assert.ok(blocked.retry_after_sec > 9 * 60);
    assert.ok(blocked.retry_after_sec <= 10 * 60);
    assert.match(blocked.error, /Réessayez dans/i);
  });

  it('peek lit le quota sans consommer de tentative', async () => {
    const body = { ...person, email: `peek-${Date.now()}@example.com` };
    const { peekMembershipRateLimit } = require('../storefront/lib/membership-rate-limit');
    const before = await peekMembershipRateLimit(body, 'change');
    assert.equal(before.remaining, MAX_ATTEMPTS);
    await assertMembershipAttemptAllowed(body, 'change');
    const after = await peekMembershipRateLimit(body, 'change');
    assert.equal(after.remaining, MAX_ATTEMPTS - 1);
    const again = await peekMembershipRateLimit(body, 'change');
    assert.equal(again.remaining, MAX_ATTEMPTS - 1, 'peek ne doit pas décrémenter');
  });

  it('2e lock → 20 min', async () => {
    assert.equal(lockDurationMs(1), 10 * 60 * 1000);
    assert.equal(lockDurationMs(2), 20 * 60 * 1000);
    assert.equal(lockDurationMs(9), 20 * 60 * 1000);

    const body = { ...person, email: `ada20-${Date.now()}@example.com` };
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      assert.equal((await assertMembershipAttemptAllowed(body, 'cancel')).ok, true);
    }
    const firstLock = await assertMembershipAttemptAllowed(body, 'cancel');
    assert.equal(firstLock.ok, false);
    assert.ok(firstLock.retry_after_sec <= 10 * 60);

    const { loadOrder, saveOrderAsync } = require('../storefront/lib/order-persistence');
    const id = identityKey(body, 'cancel');
    const rec = await loadOrder(id);
    rec.lock_until = new Date(Date.now() - 1000).toISOString();
    rec.attempts = [];
    await saveOrderAsync(rec);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      assert.equal((await assertMembershipAttemptAllowed(body, 'cancel')).ok, true);
    }
    const secondLock = await assertMembershipAttemptAllowed(body, 'cancel');
    assert.equal(secondLock.ok, false);
    assert.ok(secondLock.retry_after_sec > 19 * 60);
    assert.ok(secondLock.retry_after_sec <= 20 * 60);
  });
});
