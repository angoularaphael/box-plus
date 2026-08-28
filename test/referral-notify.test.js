'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeFriend,
  isOffre29Order,
  buildReferralCopy,
} = require('../storefront/lib/referral-notify');
const { toWhatsAppPhone } = require('../storefront/lib/whatsapp-bot');

describe('referral-notify', () => {
  it('keeps friend prenom + phone', () => {
    const friend = sanitizeFriend({ prenom: 'Léa', nom: 'Martin', telephone: '06 12 34 56 78' });
    assert.equal(friend.prenom, 'Léa');
    assert.equal(friend.telephone, '06 12 34 56 78');
    assert.equal(sanitizeFriend(null), null);
  });

  it('detects offre 29', () => {
    assert.equal(isOffre29Order({ product_id: 'offre-duo' }), true);
    assert.equal(isOffre29Order({ product_id: 'offre-saison' }), false);
  });

  it('builds congratulation copy with offer link', () => {
    const copy = buildReferralCopy({
      friendPrenom: 'Léa',
      referrerFirst: 'Hugo',
      referrerLast: 'Durand',
    });
    assert.match(copy.text, /Félicitations Léa/);
    assert.match(copy.text, /Hugo Durand/);
    assert.match(copy.text, /29 €/);
    assert.match(copy.text, /~44 €~/);
    assert.match(copy.text, /\*29 €\*/);
    assert.match(copy.text, /quelques places/);
    assert.match(copy.text, /offre\/29/);
  });

  it('formats French mobile for WhatsApp', () => {
    assert.equal(toWhatsAppPhone('06 12 34 56 78'), '33612345678');
    assert.equal(toWhatsAppPhone('+33 6 12 34 56 78'), '33612345678');
  });
});
