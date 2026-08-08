/**
 * Export session Deciplus — connexion auto (.env) + code email si demandé.
 * Produit data/session/storage-state.json
 */
require('dotenv').config();

process.env.DECIPLUS_HEADLESS = 'false';
delete process.env.PLAYWRIGHT_BROWSERS_PATH;
delete process.env.BOXPLUS_HOSTED;

const fs = require('fs');
const readline = require('readline');
const { launchBrowser, saveSession, STORAGE_FILE, login } = require('../bot/auth');
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
  console.log('1. Connexion automatique avec DECIPLUS_USER / DECIPLUS_PASSWORD');
  console.log('2. Si code email demandé : saisis-le dans le navigateur');
  console.log('3. Choisis Minimes si écran zone');
  console.log('4. Appuie sur Entrée ici quand le tableau de bord est OK\n');

  // Nouvelle session propre
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      fs.renameSync(STORAGE_FILE, `${STORAGE_FILE}.bak-${Date.now()}`);
      console.log('Ancienne session sauvegardée en .bak');
    }
  } catch {
    /* ignore */
  }

  const { browser, context, page } = await launchBrowser();
  try {
    await login(page, { siteLabel: process.env.DECIPLUS_DEFAULT_SITE || 'Minimes' });
    logInfo('Login Deciplus tenté — vérifie le navigateur si code email');
  } catch (err) {
    console.warn('Login auto incomplet:', err.message);
    console.log('Termine la connexion manuellement dans le navigateur.');
  }

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
  console.log('Upload BotHosting si besoin : /home/container/data/session/storage-state.json\n');

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
