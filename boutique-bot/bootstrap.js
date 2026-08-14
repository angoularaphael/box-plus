#!/usr/bin/env node
/**
 * Bot Hosting (us3:21819) — copier ce fichier en /home/container/index.js
 * Startup panel : node index.js
 *
 * 1) charge /home/container/.env
 * 2) git clone/pull du repo box-plus
 * 3) npm install dans boutique-bot
 * 4) lance boutique-bot/index.js
 *
 * Modifie le bloc « RÉGLAGES » ci-dessous si le repo, la branche
 * ou le dossier du bot changent.
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/* =====================================================================
   RÉGLAGES — à modifier sur le serveur si besoin
   ===================================================================== */
const GITHUB_REPO_URL =
  process.env.BOT_GITHUB_REPO ||
  process.env.BOT_REPO_URL ||
  'https://github.com/angoularaphael/box-plus.git';
const BRANCH = process.env.BOT_REPO_BRANCH || 'main';
const APP_DIR_NAME = process.env.BOT_APP_DIR || 'boxplus-app';
/** Dossier du bot dans le repo (fichiers appelés après le clone). */
const BOT_REL_DIR = process.env.BOT_REL_DIR || 'boutique-bot';
const BOT_ENTRY = process.env.BOT_ENTRY || 'index.js';
/** Sparse checkout : uniquement ce dossier (évite de tirer tout le site). */
const SPARSE_PATHS = String(process.env.BOT_SPARSE_PATHS || 'boutique-bot')
  .split(/[,;\s]+/)
  .filter(Boolean);
/* ===================================================================== */

const ROOT = __dirname;
const ROOT_ENV = path.join(ROOT, '.env');
const APP_DIR = path.join(ROOT, APP_DIR_NAME);
const BOT_DIR = path.join(APP_DIR, BOT_REL_DIR);
const AUTH_DIR = path.join(ROOT, 'data', 'auth_info_baileys');

function loadRootEnv() {
  if (!fs.existsSync(ROOT_ENV)) {
    console.warn('[boutique-bot bootstrap] .env manquant à côté de index.js');
    return;
  }
  for (const line of fs.readFileSync(ROOT_ENV, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val;
  }
}

function run(cmd, cwd = ROOT) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: process.env, shell: true });
}

function resolvePort() {
  const raw = process.env.SERVER_PORT || process.env.PORT || '21819';
  const port = String(raw).trim();
  if (!/^\d+$/.test(port)) {
    console.error('[boutique-bot bootstrap] PORT / SERVER_PORT invalide');
    process.exit(1);
  }
  return port;
}

function cloneOrUpdate() {
  const gitDir = path.join(APP_DIR, '.git');
  if (!fs.existsSync(gitDir)) {
    if (fs.existsSync(APP_DIR)) fs.rmSync(APP_DIR, { recursive: true, force: true });
    console.log(`[boutique-bot bootstrap] clone ${GITHUB_REPO_URL} (${BRANCH})`);
    run(
      `git clone --depth 1 --filter=blob:none --sparse --branch ${BRANCH} ${GITHUB_REPO_URL} "${APP_DIR_NAME}"`
    );
    try {
      run(`git sparse-checkout set ${SPARSE_PATHS.map((p) => `"${p}"`).join(' ')}`, APP_DIR);
    } catch (err) {
      console.warn('[boutique-bot bootstrap] sparse-checkout ignoré:', err.message);
    }
    return;
  }
  console.log('[boutique-bot bootstrap] mise à jour repo…');
  try {
    run('git fetch origin', APP_DIR);
    run(`git reset --hard origin/${BRANCH}`, APP_DIR);
  } catch (err) {
    console.warn('[boutique-bot bootstrap] git update ignoré:', err.message);
  }
}

function syncEnv() {
  if (!fs.existsSync(BOT_DIR)) {
    console.error(`[boutique-bot bootstrap] dossier introuvable: ${BOT_DIR}`);
    process.exit(1);
  }
  if (fs.existsSync(ROOT_ENV)) {
    fs.copyFileSync(ROOT_ENV, path.join(BOT_DIR, '.env'));
    console.log('[boutique-bot bootstrap] .env copié vers', BOT_REL_DIR);
  }
}

loadRootEnv();
const BOT_PORT = resolvePort();
process.env.PORT = BOT_PORT;
process.env.SERVER_PORT = process.env.SERVER_PORT || BOT_PORT;
process.env.WA_AUTH_DIR = process.env.WA_AUTH_DIR || AUTH_DIR;
fs.mkdirSync(AUTH_DIR, { recursive: true });

console.log('=== BOXPLUS BOUTIQUE-BOT — BOTHOSTING ===');
console.log(`repo    ${GITHUB_REPO_URL}#${BRANCH}`);
console.log(`app     ${APP_DIR}`);
console.log(`entry   ${BOT_REL_DIR}/${BOT_ENTRY}`);
console.log(`port    ${BOT_PORT}`);
console.log(`session ${process.env.WA_AUTH_DIR}`);

cloneOrUpdate();
syncEnv();

run('npm install --omit=dev', BOT_DIR);

const entry = path.join(BOT_DIR, BOT_ENTRY);
if (!fs.existsSync(entry)) {
  console.error(`[boutique-bot bootstrap] fichier introuvable: ${entry}`);
  process.exit(1);
}

console.log('[boutique-bot bootstrap] démarrage…');
process.chdir(BOT_DIR);
require(entry);
