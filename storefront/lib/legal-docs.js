const path = require('path');
const { ROOT } = require('../../lib/utils');

const LEGAL_DIR = path.join(ROOT, 'storefront', 'legal');
const PUBLIC_DOCS_DIR = path.join(ROOT, 'storefront', 'public', 'documents');

module.exports = {
  LEGAL_DIR,
  PUBLIC_DOCS_DIR,
};
