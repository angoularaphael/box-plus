'use strict';

const crypto = require('crypto');
const { logWarn } = require('../../lib/logger');

function cloudinaryCredentials() {
  const fromUrl = String(process.env.CLOUDINARY_URL || '').trim();
  if (fromUrl) {
    try {
      const parsed = new URL(fromUrl);
      if (parsed.protocol === 'cloudinary:') {
        const cloud = String(parsed.hostname || '').trim();
        const apiKey = decodeURIComponent(parsed.username || '').trim();
        const apiSecret = decodeURIComponent(parsed.password || '').trim();
        if (cloud && apiKey && apiSecret) return { cloud, apiKey, apiSecret };
      }
    } catch {
      /* ignore malformed CLOUDINARY_URL */
    }
  }
  return {
    cloud: String(process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
    apiKey: String(process.env.CLOUDINARY_API_KEY || '').trim(),
    apiSecret: String(process.env.CLOUDINARY_API_SECRET || '').trim(),
  };
}

function cloudName() {
  return cloudinaryCredentials().cloud;
}

function isCloudinaryConfigured() {
  const { cloud, apiKey, apiSecret } = cloudinaryCredentials();
  return Boolean(cloud && apiKey && apiSecret);
}

function signParams(params, apiSecret) {
  const filtered = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return crypto.createHash('sha1').update(filtered + apiSecret).digest('hex');
}

function imageUrl(publicId, { transform = 'f_jpg,q_auto,w_900,c_limit' } = {}) {
  const cloud = cloudName();
  if (!cloud || !publicId) return null;
  const id = String(publicId).replace(/^\/+/, '');
  const t = transform ? `${transform}/` : '';
  return `https://res.cloudinary.com/${cloud}/image/upload/${t}${id}`;
}

async function uploadImageBuffer({
  buffer,
  mime = 'image/jpeg',
  filename = 'photo.jpg',
  folder = 'boxplus/photos',
  publicId,
} = {}) {
  const { cloud, apiKey, apiSecret } = cloudinaryCredentials();
  if (!cloud || !apiKey || !apiSecret) {
    throw new Error('cloudinary_not_configured');
  }
  if (!buffer || !buffer.length) throw new Error('empty_image');

  const timestamp = Math.floor(Date.now() / 1000);
  const id = publicId || `${folder}/${Date.now()}`;
  const toSign = {
    overwrite: 'true',
    public_id: id,
    timestamp,
  };
  const signature = signParams(toSign, apiSecret);

  const form = new FormData();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  form.append('file', new Blob([bytes], { type: mime }), filename);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);
  form.append('public_id', id);
  form.append('overwrite', 'true');

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const message = data.error?.message || `cloudinary_http_${res.status}`;
    throw new Error(message);
  }
  return {
    public_id: data.public_id,
    url: imageUrl(data.public_id),
    secure_url: data.secure_url || imageUrl(data.public_id),
    bytes: data.bytes,
    format: data.format,
    width: data.width,
    height: data.height,
  };
}

function photoPublicId(order) {
  const docs = order?.documents || {};
  if (docs.photo_public_id) return String(docs.photo_public_id);
  const url = String(docs.photo_url || '');
  const m = url.match(/(boxplus\/photos\/[A-Za-z0-9._-]+)/i);
  if (m) return m[1];
  if (order?.order_id) return `boxplus/photos/${order.order_id}`;
  return null;
}

function deciplusPhotoUrl(order) {
  const id = photoPublicId(order);
  return id ? imageUrl(id, { transform: 'f_jpg,q_auto,w_900,c_limit' }) : null;
}

async function downloadImageBuffer(url) {
  const src = String(url || '').trim();
  if (!/^https:\/\/res\.cloudinary\.com\//i.test(src) && !/^https:\/\/.+\.cloudinary\.com\//i.test(src)) {
    throw new Error('invalid_cloudinary_url');
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`download_failed_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) throw new Error('empty_download');
  return buf;
}

async function hydrateOrderMedia(order) {
  if (!order || typeof order !== 'object') return order;
  const next = { ...order, documents: { ...(order.documents || {}) }, signature: order.signature ? { ...order.signature } : order.signature };
  if (!next.documents.photo_base64) {
    const url = next.documents.photo_url || deciplusPhotoUrl(next);
    if (url) {
      try {
        const buf = await downloadImageBuffer(url);
        next.documents.photo_url = next.documents.photo_url || url;
        next.documents.photo_base64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
      } catch (err) {
        logWarn('Hydratation photo Cloudinary', { error: err.message, order_id: order.order_id });
      }
    }
  }
  if (next.signature?.image_url && !next.signature?.image_base64) {
    try {
      const buf = await downloadImageBuffer(next.signature.image_url);
      next.signature = {
        ...next.signature,
        image_base64: `data:image/png;base64,${buf.toString('base64')}`,
      };
    } catch (err) {
      logWarn('Hydratation signature Cloudinary', { error: err.message, order_id: order.order_id });
    }
  }
  return next;
}

module.exports = {
  cloudinaryCredentials,
  photoPublicId,
  deciplusPhotoUrl,
  isCloudinaryConfigured,
  signParams,
  imageUrl,
  uploadImageBuffer,
  downloadImageBuffer,
  hydrateOrderMedia,
};
