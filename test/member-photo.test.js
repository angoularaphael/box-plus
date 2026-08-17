const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildOrderFromLifecycle } = require('../storefront/lib/orders');
const { createDraft, saveOrder, loadOrder } = require('../storefront/lib/order-lifecycle');
const { findEnrichedProduct } = require('../storefront/lib/merch');
const { resolvePhotoFile } = require('../bot/member');

describe('member photo pipeline', () => {
  it('resolvePhotoFile materializes base64 to temp file', async () => {
    // 1x1 jpeg
    const tiny =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z';
    const resolved = await resolvePhotoFile(null, tiny);
    assert.ok(resolved?.path);
    assert.equal(resolved.cleanup, true);
    assert.ok(fs.existsSync(resolved.path));
    assert.ok(fs.statSync(resolved.path).size > 10);
    fs.unlinkSync(resolved.path);
  });

  it('URL morte → repli sur le base64', async () => {
    const tiny =
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z';
    const resolved = await resolvePhotoFile(null, tiny, 'http://127.0.0.1:1/missing.png');
    assert.ok(resolved?.path);
    assert.equal(resolved.cleanup, true);
    assert.ok(fs.existsSync(resolved.path));
    fs.unlinkSync(resolved.path);
  });

  it('resolvePhotoFile keeps existing path', async () => {
    const p = path.join(os.tmpdir(), `bc-photo-exist-${Date.now()}.jpg`);
    fs.writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const resolved = await resolvePhotoFile(p, null);
    assert.equal(resolved.path, p);
    assert.equal(resolved.cleanup, false);
    fs.unlinkSync(p);
  });

  it('buildOrderFromLifecycle inclut photo_url Cloudinary', () => {
    const product = findEnrichedProduct('seance-essai');
    const draft = createDraft({
      product_id: 'seance-essai',
      product,
      customer_short: {
        first_name: 'Photo',
        last_name: 'Test',
        email: 'photo-test@boxplus.local',
        phone: '0611111111',
        birthdate: '1990-01-01',
      },
    });
    draft.customer_full = {
      gender: 'M',
      gym: 'minimes',
      address: '1 rue Test',
      postal_code: '31000',
      city: 'Toulouse',
    };
    draft.payment = { status: 'paid', amount: 10, billing_plan: 'once' };
    draft.documents = {
      photo: '/tmp/fake.jpg',
      photo_base64: 'data:image/jpeg;base64,AAAA',
      photo_url: 'https://res.cloudinary.com/demo/image/upload/boxplus/photos/BC-1',
    };
    saveOrder(draft);
    const order = loadOrder(draft.order_id);
    const payload = buildOrderFromLifecycle(order, product);
    assert.equal(payload.photo_path, '/tmp/fake.jpg');
    assert.equal(payload.photo_base64, 'data:image/jpeg;base64,AAAA');
    assert.equal(payload.photo_url, 'https://res.cloudinary.com/demo/image/upload/boxplus/photos/BC-1');
  });
});
