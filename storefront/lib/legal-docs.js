const fs = require('fs');
const path = require('path');
const { ROOT } = require('../../lib/utils');

const LEGAL_DIR = path.join(ROOT, 'storefront', 'legal');
const PUBLIC_DOCS_DIR = path.join(ROOT, 'storefront', 'public', 'documents');

function declarationMedicalePdfPath() {
  const candidates = [
    path.join(PUBLIC_DOCS_DIR, 'declaration-medicale.pdf'),
    path.join(LEGAL_DIR, 'declaration-medicale.pdf'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

module.exports = {
  LEGAL_DIR,
  PUBLIC_DOCS_DIR,
  declarationMedicalePdfPath,
};
