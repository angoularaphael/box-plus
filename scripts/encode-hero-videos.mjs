#!/usr/bin/env node
/**
 * Réencode les héros vidéo boutique.
 * Recette standard : YouTube 720p, CRF 22/23.
 * Recette premium (accueil) : YouTube 1080p, sortie 1920×1080, CRF 17.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(__dirname, '..', 'storefront', 'public', 'media');
const TMP = path.join(MEDIA, '_reencode');

/** @type {{ out: string, yt: string, start: number; dur?: number; premium?: boolean }[]} */
const CLIPS = [
  { out: 'hero-ambient', yt: '4PiVQVie3l0', start: 5, premium: true },
  { out: 'offre-29-hero', yt: 'XXkuDeW0nLc', start: 0 },
  { out: 'offres-hero', yt: 'wO781gt7uTU', start: 5 },
  { out: 'abonnements-hero', yt: '0gUSKD0GmXk', start: 5 },
  { out: 'scrub-ambiance', yt: '4PiVQVie3l0', start: 18 },
];

const DUR = 8;
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function encodeVariant(input, output, { width, crf, preset, unsharp = '5:5:0.4:5:5:0.0', denoise = true }) {
  const filters = [];
  if (denoise) filters.push('hqdn3d=1:0.7:4:4');
  filters.push(`scale=${width}:-2:flags=lanczos`, `unsharp=${unsharp}`);
  run('ffmpeg', [
    '-y',
    '-i',
    input,
    '-an',
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    preset,
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

function profileFor(clip) {
  if (clip.premium) {
    return {
      ytdlpFormat: '137/136/bestvideo[height<=1080]',
      rawSuffix: '1080p',
      desktop: { width: 1920, crf: 17, preset: 'slow', unsharp: '5:5:0.55:5:5:0.0' },
      mobile: { width: 1280, crf: 19, preset: 'slow', unsharp: '5:5:0.45:5:5:0.0' },
    };
  }
  return {
    ytdlpFormat: '136/135/bestvideo[height<=720]',
    rawSuffix: '720p',
    desktop: { width: 1280, crf: 22, preset: 'slow' },
    mobile: { width: 960, crf: 23, preset: 'slow' },
  };
}

fs.mkdirSync(TMP, { recursive: true });

const queue = ONLY ? CLIPS.filter((c) => c.out === ONLY) : CLIPS;
if (!queue.length) {
  console.error(`Clip inconnu: ${ONLY}`);
  process.exit(1);
}

for (const clip of queue) {
  const dur = clip.dur ?? DUR;
  const profile = profileFor(clip);
  const raw = path.join(TMP, `${clip.out}-${profile.rawSuffix}.mp4`);
  const desktop = path.join(MEDIA, `${clip.out}.mp4`);
  const mobile = path.join(MEDIA, `${clip.out}-mobile.mp4`);
  const url = `https://www.youtube.com/watch?v=${clip.yt}`;

  console.log(`\n>>> ${clip.out} (${clip.yt} @${clip.start}s${clip.premium ? ', premium 1080p' : ''})`);

  run('yt-dlp', [
    '-f',
    profile.ytdlpFormat,
    '--download-sections',
    `*${clip.start}-${clip.start + dur}`,
    '-o',
    raw,
    url,
  ]);

  encodeVariant(raw, desktop, profile.desktop);
  encodeVariant(raw, mobile, profile.mobile);

  const desk = fs.statSync(desktop);
  const mob = fs.statSync(mobile);
  console.log(`    desktop ${(desk.size / 1024).toFixed(0)} KiB · mobile ${(mob.size / 1024).toFixed(0)} KiB`);
}

console.log('\n[ok] Héros vidéo réencodés.');
