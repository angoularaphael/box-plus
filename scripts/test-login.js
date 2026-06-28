#!/usr/bin/env node
/** Test rapide connexion Deciplus — node scripts/test-login.js */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { launchBrowser, login, saveSession, isLoggedIn } = require('../bot/auth');

async function main() {
  const { browser, context, page } = await launchBrowser();
  try {
    await login(page);
    const ok = await isLoggedIn(page);
    console.log(ok ? '✅ Connexion OK' : '❌ Connexion échouée');
    console.log('URL:', page.url());
    if (ok) await saveSession(context);
    process.exit(ok ? 0 : 1);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
