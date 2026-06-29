#!/usr/bin/env node
/**
 * Import catalogue matériel depuis le miroir statique prestashop/
 */
const fs = require('fs');
const path = require('path');
const { ROOT, ensureDir } = require('../lib/utils');

const PS_PAGES = path.join(ROOT, 'prestashop', 'pages', 'materiel-de-boxe');
const PS_ASSETS = path.join(ROOT, 'prestashop', 'assets');
const OUT_CATALOG = path.join(ROOT, 'data', 'storefront', 'materiel-catalog.json');
const OUT_IMAGES = path.join(ROOT, 'storefront', 'public', 'img', 'materiel');

const CATEGORY_MAP = {
  16: { slug: 'materiel', label: 'Matériel de boxe' },
  17: { slug: 'gants', label: 'Gants de boxe ou MMA' },
  18: { slug: 'protege-tibias', label: 'Protège tibias-pieds' },
  19: { slug: 'sous-gants', label: 'Sous-gants' },
  20: { slug: 'bandes', label: 'Bandes de boxe' },
  21: { slug: 'casque', label: 'Casque' },
  22: { slug: 'short', label: 'Short de Boxe ou MMA' },
  23: { slug: 'accessoires', label: 'Accessoires' },
  24: { slug: 'protege-dents', label: 'Protège dents' },
  25: { slug: 'entrainement', label: "Matériel d'entraînement" },
  26: { slug: 'destockage', label: 'Déstockage' },
};

const PICKUP_GYMS = [
  'Toulouse St-Cyprien',
  'Barrière de Paris - Minimes',
  'Balma-Gramont',
  'Ramonville',
  'Portet-sur-Garonne',
];

function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtml(html) {
  return decodeHtmlEntities(String(html || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePriceCents(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  const s = String(value || '').replace(/[^\d,.-]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function formatPriceLabel(cents) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

function extractDataProduct(html) {
  const match =
    html.match(/data-product="(\{&quot;.+?&quot;\})"/s) ||
    html.match(/data-product='(\{.+?\})'/s);
  if (!match) return null;
  try {
    return JSON.parse(decodeHtmlEntities(match[1]));
  } catch {
    return null;
  }
}

function extractImgFromHtml(html) {
  const imgMatch = html.match(
    /src="\.\.\/\.\.\/assets\/(\d+)-(?:home_default|large_default)\/([^"]+\.jpg)"/i
  );
  if (imgMatch) {
    return { id_image: imgMatch[1], filename: imgMatch[2] };
  }
  return null;
}

function copyImage(idImage, filename, psId, linkRewrite) {
  const candidates = [
    filename,
    filename ? null : linkRewrite ? `${linkRewrite}.jpg` : null,
    `${psId}.jpg`,
  ].filter(Boolean);

  for (const fname of candidates) {
    for (const size of ['home_default', 'large_default', 'medium_default']) {
      const src = path.join(PS_ASSETS, `${idImage}-${size}`, fname);
      if (!fs.existsSync(src)) continue;
      const destDir = path.join(OUT_IMAGES, String(psId));
      ensureDir(destDir);
      const dest = path.join(destDir, fname);
      fs.copyFileSync(src, dest);
      return `/img/materiel/${psId}/${fname}`;
    }
  }
  return null;
}

function attributesFromProduct(data) {
  const attrs = data.attributes || {};
  const out = {};
  for (const a of Object.values(attrs)) {
    if (a.group && a.name) out[a.group] = a.name;
  }
  return out;
}

function variantLabel(attrs) {
  const parts = Object.entries(attrs)
    .filter(([g]) => g !== 'Lieu retrait produits')
    .map(([, v]) => v);
  return parts.length ? parts.join(' — ') : 'Standard';
}

function inferCategoryFromName(name) {
  const n = String(name).toLowerCase();
  if (/gant|mma|adidas/i.test(n)) return 'gants';
  if (/tibia|pieds?/i.test(n) && !/enfant/i.test(n)) return 'protege-tibias';
  if (/sous.?gant/i.test(n)) return 'sous-gants';
  if (/bande/i.test(n)) return 'bandes';
  if (/casque/i.test(n)) return 'casque';
  if (/short/i.test(n)) return 'short';
  if (/dent/i.test(n)) return 'protege-dents';
  if (/coquille|slip/i.test(n)) return 'accessoires';
  if (/corde|pao|patte|sac|bouclier|round|coudière/i.test(n)) return 'entrainement';
  if (/destock/i.test(n)) return 'destockage';
  return 'materiel';
}

function loadCategoryAssignments() {
  const assignments = new Map();
  const pagesDir = path.join(ROOT, 'prestashop', 'pages');
  for (const [catId, meta] of Object.entries(CATEGORY_MAP)) {
    if (Number(catId) === 16) continue;
    const file = path.join(pagesDir, `${catId}-${meta.slug.replace(/_/g, '-')}.html`);
    const altFiles = fs.readdirSync(pagesDir).filter((f) => f.startsWith(`${catId}-`) && f.endsWith('.html'));
    const targets = fs.existsSync(file) ? [file] : altFiles.map((f) => path.join(pagesDir, f));
    for (const htmlFile of targets) {
      if (!fs.existsSync(htmlFile)) continue;
      const html = fs.readFileSync(htmlFile, 'utf8');
      const ids = [...html.matchAll(/data-id-product="(\d+)"/g)].map((m) => Number(m[1]));
      for (const id of ids) assignments.set(id, meta.slug);
    }
  }
  return assignments;
}

function mergeProduct(map, data, html, categoryAssignments) {
  const psId = Number(data.id_product || data.id);
  if (!psId) return;

  const slug =
    categoryAssignments.get(psId) ||
    inferCategoryFromName(data.name) ||
    'materiel';
  const categoryId =
    Number(Object.entries(CATEGORY_MAP).find(([, c]) => c.slug === slug)?.[0]) || 16;
  const cat = CATEGORY_MAP[categoryId] || CATEGORY_MAP[16];
  const priceCents = parsePriceCents(data.price_amount ?? data.price_without_reduction ?? data.price);
  const variantId = Number(data.id_product_attribute || 0);
  const attrs = attributesFromProduct(data);
  const imgInfo =
    extractImgFromHtml(html) ||
    (data.cover?.id_image
      ? {
          id_image: data.cover.id_image,
          filename: data.cover.large?.url?.split('/').pop() || null,
        }
      : data.images?.[0]?.id_image
        ? {
            id_image: data.images[0].id_image,
            filename: data.images[0].large?.url?.split('/').pop() || null,
          }
        : null);

  let imagePath = null;
  if (imgInfo?.id_image) {
    imagePath = copyImage(
      imgInfo.id_image,
      imgInfo.filename,
      psId,
      data.link_rewrite
    );
  }

  const combo = {
    id: variantId || psId,
    prestashop_attribute_id: variantId || null,
    label: variantLabel(attrs),
    attributes: attrs,
    reference: data.reference || '',
    price_cents: priceCents,
    price_label: formatPriceLabel(priceCents),
    stock: Number(data.quantity ?? 0),
    image: imagePath,
  };

  if (!map.has(psId)) {
    map.set(psId, {
      id: `mat-${psId}`,
      prestashop_id: psId,
      name: data.name,
      slug: data.link_rewrite || `produit-${psId}`,
      reference: data.reference || '',
      price_cents: priceCents,
      price_label: formatPriceLabel(priceCents),
      stock: Number(data.quantity_all_versions ?? data.quantity ?? 0),
      category: cat.slug,
      category_label: cat.label,
      category_id: categoryId,
      description_short: stripHtml(data.description_short),
      description: stripHtml(data.description),
      image: imagePath,
      images: imagePath ? [imagePath] : [],
      combinations: [],
      pickup_gyms: PICKUP_GYMS,
      active: String(data.available_for_order ?? '1') !== '0',
      pickup_only: true,
      minimal_quantity: Number(data.minimal_quantity || 1),
    });
  }

  const product = map.get(psId);
  if (imagePath && !product.image) {
    product.image = imagePath;
    product.images = [imagePath];
  }
  if (priceCents > 0 && (!product.price_cents || combo.stock > 0)) {
    product.price_cents = priceCents;
    product.price_label = formatPriceLabel(priceCents);
  }
  product.stock = Math.max(product.stock, Number(data.quantity_all_versions ?? 0));

  const existing = product.combinations.find((c) => c.id === combo.id);
  if (existing) {
    Object.assign(existing, combo);
  } else {
    product.combinations.push(combo);
  }
}

function dedupeCombinations(product) {
  const byKey = new Map();
  for (const c of product.combinations) {
    const key = `${c.label}|${c.reference}|${c.price_cents}`;
    const prev = byKey.get(key);
    if (!prev || c.stock > prev.stock) byKey.set(key, c);
  }
  product.combinations = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (product.combinations.length === 1) {
    product.default_variant_id = product.combinations[0].id;
  }
  product.stock = product.combinations.reduce((s, c) => s + (c.stock || 0), 0) || product.stock;
}

function main() {
  if (!fs.existsSync(PS_PAGES)) {
    console.error('Dossier introuvable:', PS_PAGES);
    process.exit(1);
  }

  const map = new Map();
  const categoryAssignments = loadCategoryAssignments();
  const files = fs.readdirSync(PS_PAGES).filter((f) => f.endsWith('.html'));

  for (const file of files) {
    const html = fs.readFileSync(path.join(PS_PAGES, file), 'utf8');
    const data = extractDataProduct(html);
    if (data) mergeProduct(map, data, html, categoryAssignments);
  }

  const products = [...map.values()].map((p) => {
    dedupeCombinations(p);
    return p;
  });

  products.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const catalog = {
    synced_at: new Date().toISOString(),
    source: 'prestashop-mirror',
    count: products.length,
    categories: Object.entries(CATEGORY_MAP).map(([id, c]) => ({
      id: Number(id),
      ...c,
    })),
    products,
  };

  ensureDir(path.dirname(OUT_CATALOG));
  fs.writeFileSync(OUT_CATALOG, JSON.stringify(catalog, null, 2), 'utf8');

  console.log(`Import terminé: ${products.length} produits → ${OUT_CATALOG}`);
  console.log(`Images → ${OUT_IMAGES}`);
}

main();
