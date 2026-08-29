'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'storefront', 'public', 'img', 'materiel', 'rentree');
const ASSETS = path.join(
  process.env.USERPROFILE || '',
  '.cursor',
  'projects',
  'c-Users-PC-Desktop-projet-actu-boutique',
  'assets'
);

const FILES = [
  {
    dir: 'blade',
    name: 'blade-nb-01.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1150779.jpg?v=1712236596',
  },
  {
    dir: 'blade',
    name: 'blade-nb-02.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1150793.jpg?v=1712236605',
  },
  {
    dir: 'blade',
    name: 'blade-or-01.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1150752.jpg?v=1712236998',
  },
  {
    dir: 'blade',
    name: 'blade-or-02.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1150765.jpg?v=1712237028',
  },
  {
    dir: 'mitaines',
    name: 'mitaine-01.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1152735.jpg?v=1713451980',
  },
  {
    dir: 'mitaines',
    name: 'mitaine-02.png',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/noir.png?v=1715067778',
  },
  {
    dir: 'sparring',
    name: 'sparring-01.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1151400.jpg?v=1712237756',
  },
  {
    dir: 'sparring',
    name: 'sparring-02.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1151402.jpg?v=1712237757',
  },
  {
    dir: 'sparring',
    name: 'sparring-03.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0663/0408/2139/files/gants-de-sparring-metal-boxe-mbgan010n-noirrougeblanc-boutique-des-arts-martiaux-1.jpg?v=1745702893',
  },
  {
    dir: 'ergo',
    name: 'ergo-01.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/gants_ergo_90_metal_boxe_olive_orange.jpg?v=1770201746',
  },
  {
    dir: 'ergo',
    name: 'ergo-02.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/gants_de_boxe_metal_ergo_90_kaki_orange.jpg?v=1770201701',
  },
  {
    dir: 'shell',
    name: 'shell-01.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1202075_593d7c85-5295-4520-910e-879e3668c2d4.jpg?v=1749561889',
  },
  {
    dir: 'shell',
    name: 'shell-02.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1202094.jpg?v=1749561889',
  },
  {
    dir: 'one',
    name: 'one-official.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0663/0408/2139/products/Gants-de-Boxe-Metal-Boxe-One-Noir-zoom.jpg?v=1752688208',
  },
  {
    dir: 'ensemble',
    name: 'ensemble-01.png',
    url: 'https://cdn.shopify.com/s/files/1/0663/0408/2139/products/pack-de-boxe-anglaise-metal-boxe-boutique-des-arts-martiaux-5.png?v=1752688026',
  },
  {
    dir: 'ensemble',
    name: 'ensemble-02.png',
    url: 'https://cdn.shopify.com/s/files/1/0663/0408/2139/products/pack-de-boxe-anglaise-metal-boxe-boutique-des-arts-martiaux-2.png?v=1752688026',
  },
  {
    dir: 'ensemble',
    name: 'ensemble-noir.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0663/0408/2139/files/Packdeboxeanglaise-MetalBoxeNOIRMB6473N.jpg?v=1752688026',
  },
  {
    dir: 'ensemble',
    name: 'ensemble-metal-01.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1138135_55e862b6-4aae-45e8-8cd1-055d1f4896c8.jpg?v=1712738515',
  },
  {
    dir: 'bandes',
    name: 'bandes-4m-01.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1150673.jpg?v=1718005468',
  },
  {
    dir: 'bandes',
    name: 'bandes-4m-02.png',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/BANDES_fae0bdbc-66a5-4a00-9ae2-eea59a1ba694.png?v=1718005468',
  },
  {
    dir: 'bandes',
    name: 'bandes-4m-03.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1150682_6b75543d-dc16-4edd-bbe7-252c673400f0.jpg?v=1718005440',
  },
  {
    dir: 'dents',
    name: 'dents-adulte-01.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0663/0408/2139/files/Prote-ge-dents-Metal-Boxe-Transparent-1-big.jpg?v=1752687490',
  },
  {
    dir: 'dents',
    name: 'dents-adulte-02.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0663/0408/2139/files/Prote-ge-dents-Metal-Boxe-Transparent-1-2-big.jpg?v=1752687490',
  },
  {
    dir: 'dents',
    name: 'dents-enfant-01.png',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/dents.png?v=1715092434',
  },
  {
    dir: 'dents',
    name: 'dents-enfant-02.png',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/dentsnoir.png?v=1715092434',
  },
  {
    dir: 'tibias',
    name: 'tibias-blanc-01.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/P1152819.jpg?v=1713511186',
  },
  {
    dir: 'tibias',
    name: 'tibias-blanc-02.png',
    url: 'https://cdn.shopify.com/s/files/1/0805/2480/4445/files/tibiapied-blanc.png?v=1715084692',
  },
  {
    dir: 'tibias',
    name: 'tibias-blanc-03.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0763/2797/7258/files/c408f356d36d5add1ee5ac43d4bb519641b1f60f_Dragon_Bleu___Protege_Tibia_Pied_Coton_Metal_Boxe___Blanc_01.jpg?v=1774626606',
  },
  {
    dir: 'tibias',
    name: 'tibias-blanc-04.jpg',
    url: 'https://cdn.shopify.com/s/files/1/0763/2797/7258/files/e48eee057dc0cb65474abb4a5a2497a0bd50072e_Dragon_Bleu___Protege_Tibia_Pied_Coton_Metal_Boxe___Blanc_02.jpg?v=1774626606',
  },
];

function get(url) {
  const lib = url.startsWith('http://') ? http : https;
  return new Promise((resolve, reject) => {
    lib
      .get(url, { headers: { 'User-Agent': 'BoxingCenterBoutique/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(res.headers.location).then(resolve, reject);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            return reject(new Error(`${res.statusCode} ${url}`));
          }
          resolve(buf);
        });
      })
      .on('error', reject);
  });
}

async function download(url, dest) {
  const buf = await get(url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

async function ogImage(pageUrl) {
  const html = (await get(pageUrl)).toString('utf8');
  const match =
    html.match(/property=["']og:image["']\s+content=["']([^"']+)/i) ||
    html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i);
  return match ? match[1].replace(/&amp;/g, '&') : null;
}

async function main() {
  fs.mkdirSync(DEST, { recursive: true });
  for (const item of FILES) {
    const dest = path.join(DEST, item.dir, item.name);
    process.stdout.write(`↓ ${item.dir}/${item.name}\n`);
    await download(item.url, dest);
  }

  const wrapPage =
    'https://combatcorner.ch/protections/bandes-sous-gants/bandes-de-boxe/bande-de-boxe-2-50-rouge-blanc-bleu-blanc-rouge.html';
  try {
    const img = await ogImage(wrapPage);
    if (img) {
      process.stdout.write(`↓ bandes/bandes-250-combatcorner (og:image)\n`);
      await download(img, path.join(DEST, 'bandes', 'bandes-250-01.jpg'));
    }
  } catch (err) {
    console.warn('combatcorner wraps:', err.message);
  }
  const wraps250 = path.join(DEST, 'bandes', 'bandes-250-01.jpg');
  if (!fs.existsSync(wraps250)) {
    fs.copyFileSync(path.join(DEST, 'bandes', 'bandes-4m-01.jpg'), wraps250);
    console.log('copied 4m wraps photo → bandes-250-01.jpg');
  }

  const desktopPack = path.join(process.env.USERPROFILE || '', 'Desktop', 'pack enfant.jpeg');
  if (fs.existsSync(desktopPack)) {
    const destDir = path.join(DEST, 'pack');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(desktopPack, path.join(destDir, 'pack-enfant.jpg'));
    console.log('copied Desktop pack enfant.jpeg → pack/pack-enfant.jpg');
  }

  const shots = fs.existsSync(ASSETS) ? fs.readdirSync(ASSETS).filter((f) => f.endsWith('.png')) : [];
  const userShots = [
    ['image-e7c8cb56', 'pack', 'pack-keychain.png'],
    ['image-44ceef60', 'one', 'one-jr.png'],
  ];
  for (const [needle, dir, name] of userShots) {
    const match = shots.find((f) => f.includes(needle));
    if (!match) continue;
    fs.mkdirSync(path.join(DEST, dir), { recursive: true });
    fs.copyFileSync(path.join(ASSETS, match), path.join(DEST, dir, name));
    console.log(`copied screenshot → ${dir}/${name}`);
  }
  console.log('ok', DEST);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
