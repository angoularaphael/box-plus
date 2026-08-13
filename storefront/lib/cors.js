'use strict';

/**
 * CORS pour les endpoints publics consommés par le site vitrine WordPress
 * (boxingcenter.fr) : chat Chloe et places restantes.
 *
 * Liste blanche stricte : une origine inconnue ne reçoit aucun en-tête, donc le
 * navigateur bloque la réponse comme avant. Les credentials ne sont jamais
 * autorisés, ce qui empêche d'atteindre les routes authentifiées par cookie.
 */

const DEFAULT_ALLOWED_ORIGINS = 'https://boxingcenter.fr,https://www.boxingcenter.fr';

function parseAllowedOrigins(value) {
  return new Set(
    String(value == null || value === '' ? DEFAULT_ALLOWED_ORIGINS : value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function isAllowedOrigin(origin, allowed) {
  return Boolean(origin) && allowed.has(origin);
}

/**
 * @param {object} [options]
 * @param {string} [options.origins] liste séparée par des virgules
 * @returns {function} middleware express
 */
function corsMiddleware(options = {}) {
  const allowed = parseAllowedOrigins(
    options.origins != null ? options.origins : process.env.CORS_ALLOWED_ORIGINS
  );

  return function cors(req, res, next) {
    const origin = req.headers && req.headers.origin;
    if (isAllowedOrigin(origin, allowed)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Max-Age', '86400');
    }
    /* Le préflight tombait en 404 : on répond court-circuit, sans body. */
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  parseAllowedOrigins,
  isAllowedOrigin,
  corsMiddleware,
};
