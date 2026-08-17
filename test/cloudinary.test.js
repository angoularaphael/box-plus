'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  signParams,
  imageUrl,
  isCloudinaryConfigured,
  cloudinaryCredentials,
} = require('../storefront/lib/cloudinary');

function snapshotCloudinaryEnv() {
  return {
    url: process.env.CLOUDINARY_URL,
    name: process.env.CLOUDINARY_CLOUD_NAME,
    key: process.env.CLOUDINARY_API_KEY,
    secret: process.env.CLOUDINARY_API_SECRET,
  };
}

function restoreCloudinaryEnv(prev) {
  for (const [envKey, value] of [
    ['CLOUDINARY_URL', prev.url],
    ['CLOUDINARY_CLOUD_NAME', prev.name],
    ['CLOUDINARY_API_KEY', prev.key],
    ['CLOUDINARY_API_SECRET', prev.secret],
  ]) {
    if (value) process.env[envKey] = value;
    else delete process.env[envKey];
  }
}

function clearCloudinaryEnv() {
  delete process.env.CLOUDINARY_URL;
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
}

test('signParams trie les champs et hash SHA-1', () => {
  const sig = signParams(
    { timestamp: 123, public_id: 'boxplus/photos/BC-1', overwrite: 'true' },
    'secret'
  );
  assert.equal(sig, signParams({ overwrite: 'true', public_id: 'boxplus/photos/BC-1', timestamp: 123 }, 'secret'));
  assert.match(sig, /^[a-f0-9]{40}$/);
});

test('imageUrl pose la transformation CDN', () => {
  const prev = snapshotCloudinaryEnv();
  clearCloudinaryEnv();
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  try {
    assert.equal(
      imageUrl('boxplus/photos/BC-1'),
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_900,c_limit/boxplus/photos/BC-1'
    );
  } finally {
    restoreCloudinaryEnv(prev);
  }
});

test('CLOUDINARY_URL suffit à configurer le compte', () => {
  const prev = snapshotCloudinaryEnv();
  clearCloudinaryEnv();
  process.env.CLOUDINARY_URL = 'cloudinary://key123:sec_ret@demo-cloud';
  try {
    assert.equal(isCloudinaryConfigured(), true);
    assert.deepEqual(cloudinaryCredentials(), {
      cloud: 'demo-cloud',
      apiKey: 'key123',
      apiSecret: 'sec_ret',
    });
  } finally {
    restoreCloudinaryEnv(prev);
  }
});

test('isCloudinaryConfigured exige les 3 clés', () => {
  const prev = snapshotCloudinaryEnv();
  clearCloudinaryEnv();
  try {
    assert.equal(isCloudinaryConfigured(), false);
  } finally {
    restoreCloudinaryEnv(prev);
  }
});
