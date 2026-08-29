'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

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
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { headers: { 'User-Agent': 'BoxingCenterBoutique/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          return download(res.headers.location, dest).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`${res.statusCode} ${url}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      })
      .on('error', (err) => {
        file.close();
        try {
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        reject(err);
      });
  });
}

function copyUser(srcName, dir, destName) {
  const matches = fs.existsSync(ASSETS)
    ? fs.readdirSync(ASSETS).filter((f) => f.includes(srcName) || f.endsWith('.png'))
    : [];
  const preferred = matches.find((f) => f.includes(srcName)) || null;
  if (!preferred) return false;
  const destDir = path.join(DEST, dir);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(path.join(ASSETS, preferred), path.join(destDir, destName));
  return true;
}

async function main() {
  fs.mkdirSync(DEST, { recursive: true });
  for (const item of FILES) {
    const dir = path.join(DEST, item.dir);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, item.name);
    process.stdout.write(`↓ ${item.dir}/${item.name}\n`);
    await download(item.url, dest);
  }

  const userShots = [
    ['image-e7c8cb56', 'pack', 'pack-keychain.png'],
    ['image-44ceef60', 'one', 'one-jr.png'],
    ['image-83d8643f', 'blade', 'blade-or-shot.png'],
  ];
  const shots = fs.existsSync(ASSETS) ? fs.readdirSync(ASSETS).filter((f) => f.endsWith('.png')) : [];
  for (const [needle, dir, name] of userShots) {
    const match = shots.find((f) => f.includes(needle));
    if (!match) continue;
    const dirPath = path.join(DEST, dir);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.copyFileSync(path.join(ASSETS, match), path.join(dirPath, name));
    console.log(`copied screenshot → ${dir}/${name}`);
  }
  console.log('ok', DEST);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
