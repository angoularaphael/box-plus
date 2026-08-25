#!/usr/bin/env node
/**
 * Réencode les héros vidéo boutique avec la même recette que l’offre 259 :
 * source YouTube 720p, hqdn3d léger, lanczos + unsharp, CRF 22 desktop / 23 mobile.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(__dirname, '..', 'storefront', 'public', 'media');
const TMP = path.join(MEDIA, '_reencode');

/** @type {{ out: string, yt: string, start: number, dur?: number }[]} */
const CLIPS = [
  { out: 'hero-ambient', yt: '4PiVQVie3l0', start: 5 },
  { out: 'offre-29-hero', yt: 'XXkuDeW0nLc', start: 0 },
  { out: 'offres-hero', yt: 'wO781gt7uTU', start: 5 },
  { out: 'abonnements-hero', yt: '0gUSKD0GmXk', start: 5 },
  { out: 'scrub-ambiance', yt: '4PiVQVie3l0', start: 18 },
];

const DUR = 8;
const DESKTOP_W = 1280;
const MOBILE_W = 960;

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function encodeVariant(input, output, width, crf) {
  const vf = `hqdn3d=1:0.7:4:4,scale=${width}:-2:flags=lanczos,unsharp=5:5:0.4:5:5:0.0`;
  run('ffmpeg', [
    '-y',
    '-i',
    input,
    '-an',
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high',
    '-movflags',
    '+faststart',
    output,
  ]);
}

fs.mkdirSync(TMP, { recursive: true });

for (const clip of CLIPS) {
  const dur = clip.dur ?? DUR;
  const raw = path.join(TMP, `${clip.out}-720p.mp4`);
  const desktop = path.join(MEDIA, `${clip.out}.mp4`);
  const mobile = path.join(MEDIA, `${clip.out}-mobile.mp4`);
  const url = `https://www.youtube.com/watch?v=${clip.yt}`;

  console.log(`\n>>> ${clip.out} (${clip.yt} @${clip.start}s)`);

  run('yt-dlp', [
    '-f',
    '136/135/bestvideo[height<=720]',
    '--download-sections',
    `*${clip.start}-${clip.start + dur}`,
    '-o',
    raw,
    url,
  ]);

  encodeVariant(raw, desktop, DESKTOP_W, 22);
  encodeVariant(raw, mobile, MOBILE_W, 23);

  const desk = fs.statSync(desktop);
  const mob = fs.statSync(mobile);
  console.log(`    desktop ${(desk.size / 1024).toFixed(0)} KiB · mobile ${(mob.size / 1024).toFixed(0)} KiB`);
}

console.log('\n[ok] Héros vidéo réencodés.');
