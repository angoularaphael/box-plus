/**
 * Export session Deciplus — à lancer en local après connexion manuelle (+ code email).
 * Produit data/session/storage-state.json à uploader sur BotHosting.
 */
require('dotenv').config();

// Export local Windows/Mac — navigateur visible, pas de deps Linux
process.env.DECIPLUS_HEADLESS = 'false';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { launchBrowser, saveSession, STORAGE_FILE } = require('../bot/auth');
const { logInfo } = require('../lib/logger');

async function waitForEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const url = process.env.DECIPLUS_URL;
  if (!url) {
    console.error('DECIPLUS_URL manquant dans .env');
    process.exit(1);
  }

  console.log('\n=== Export session Deciplus ===');
  console.log('1. Le navigateur va s\'ouvrir');
  console.log('2. Connecte-toi manuellement (login + code email si demandé)');
  console.log('3. Choisis le site Minimes si écran zone');
  console.log('4. Attends le tableau de bord Deciplus\n');

  const { browser, context, page } = await launchBrowser();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await waitForEnter('Appuie sur Entrée quand tu es connecté à Deciplus… ');

  const token = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('auth') || '{}').token || null;
    } catch {
      return null;
    }
  });

  if (!token) {
    console.warn('ATTENTION: pas de token auth dans localStorage — la session peut ne pas marcher sur le bot.');
  } else {
    console.log('Token auth OK');
  }

  await saveSession(context);
  console.log(`\nSession exportée → ${STORAGE_FILE}`);
  console.log('Upload ce fichier sur BotHosting : /home/container/data/session/storage-state.json\n');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
