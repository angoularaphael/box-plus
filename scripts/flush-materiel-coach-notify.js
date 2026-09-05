#!/usr/bin/env node
'use strict';

/**
 * Renvoie au coach toutes les ventes matériel payées dont la notification
 * n’est pas encore partie (en attente Signal/SMS).
 *
 * Usage :
 *   node scripts/flush-materiel-coach-notify.js
 *
 * Branchez d’abord les téléphones Signal/SMS, puis lancez ce script
 * ou le bouton admin « Renvoyer au coach (Signal) ».
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function main() {
  const { flushPendingMaterielCoachNotifies } = require('../storefront/lib/gym-materiel-managers');
  const result = await flushPendingMaterielCoachNotifies();
  console.log(
    JSON.stringify(
      {
        ok: true,
        flushed: result.flushed,
        sent: result.sent,
        results: result.results,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
