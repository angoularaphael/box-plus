#!/usr/bin/env node
/**
 * Lance stripe listen sans dépendre du PATH Windows.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const candidates = [
  process.env.STRIPE_CLI_PATH,
  path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft/WinGet/Packages/Stripe.StripeCli_Microsoft.Winget.Source_8wekyb3d8bbwe/stripe.exe'
  ),
  'stripe',
].filter(Boolean);

const stripeExe = candidates.find((p) => p === 'stripe' || fs.existsSync(p));

if (!stripeExe) {
  console.error('Stripe CLI introuvable. Installez : winget install Stripe.StripeCli');
  console.error('Ou utilisez Option A (pas de CLI) : paiement Stripe → page Merci → BOXPLUS auto.');
  process.exit(1);
}

const port = process.env.STORE_PORT || 3040;
const args = ['listen', '--forward-to', `localhost:${port}/api/stripe/webhook`];

console.log(`Stripe listen → localhost:${port}/api/stripe/webhook`);
console.log('Copiez le whsec_... dans .env → STRIPE_WEBHOOK_SECRET\n');

const child = spawn(stripeExe, args, { stdio: 'inherit', shell: stripeExe === 'stripe' });
child.on('exit', (code) => process.exit(code ?? 0));
