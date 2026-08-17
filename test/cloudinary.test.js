'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { signParams, imageUrl, isCloudinaryConfigured } = require('../storefront/lib/cloudinary');

test('signParams trie les champs et hash SHA-1', () => {
  const sig = signParams(
    { timestamp: 123, public_id: 'boxplus/photos/BC-1', overwrite: 'true' },
    'secret'
  );
  assert.equal(sig, signParams({ overwrite: 'true', public_id: 'boxplus/photos/BC-1', timestamp: 123 }, 'secret'));
  assert.match(sig, /^[a-f0-9]{40}$/);
});

test('imageUrl pose la transformation CDN', () => {
  const prev = process.env.CLOUDINARY_CLOUD_NAME;
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  try {
    assert.equal(
      imageUrl('boxplus/photos/BC-1'),
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_900,c_limit/boxplus/photos/BC-1'
    );
  } finally {
    process.env.CLOUDINARY_CLOUD_NAME = prev;
  }
});

test('isCloudinaryConfigured exige les 3 clés', () => {
  const name = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
  try {
    assert.equal(isCloudinaryConfigured(), false);
  } finally {
    if (name) process.env.CLOUDINARY_CLOUD_NAME = name;
    if (key) process.env.CLOUDINARY_API_KEY = key;
    if (secret) process.env.CLOUDINARY_API_SECRET = secret;
  }
});
