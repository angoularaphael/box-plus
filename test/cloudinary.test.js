'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  signParams,
  imageUrl,
  isCloudinaryConfigured,
  cloudinaryCredentials,
  photoPublicId,
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
      'https://res.cloudinary.com/demo/image/upload/f_jpg,q_auto,w_600,h_600,c_fill,g_auto/boxplus/photos/BC-1'
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

test('photoPublicId dérive du public_id, de l’URL ou de l’order_id', () => {
  assert.equal(
    photoPublicId({ documents: { photo_public_id: 'boxplus/photos/BC-9' } }),
    'boxplus/photos/BC-9'
  );
  assert.equal(
    photoPublicId({
      documents: { photo_url: 'https://res.cloudinary.com/demo/image/upload/f_jpg/boxplus/photos/BC-8' },
    }),
    'boxplus/photos/BC-8'
  );
  assert.equal(photoPublicId({ order_id: 'BC-7', documents: {} }), 'boxplus/photos/BC-7');
});

test('deciplusPhotoUrl utilise le JPEG carré 600×600', () => {
  const prev = snapshotCloudinaryEnv();
  clearCloudinaryEnv();
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  try {
    const { deciplusPhotoUrl, applyDeciplusPhoto } = require('../storefront/lib/cloudinary');
    assert.equal(
      deciplusPhotoUrl({ documents: { photo_public_id: 'boxplus/photos/BC-10' } }),
      'https://res.cloudinary.com/demo/image/upload/f_jpg,q_auto,w_600,h_600,c_fill,g_auto/boxplus/photos/BC-10'
    );
    const payload = applyDeciplusPhoto(
      { photo_url: 'https://res.cloudinary.com/demo/image/upload/raw/boxplus/photos/BC-10' },
      { documents: { photo_public_id: 'boxplus/photos/BC-10' } }
    );
    assert.match(payload.photo_url, /c_fill,g_auto\/boxplus\/photos\/BC-10$/);
  } finally {
    restoreCloudinaryEnv(prev);
  }
});
