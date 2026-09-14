const { logWarn } = require('./logger');

const DEFAULT_FR_ADDRESS = {
  address: '12 rue de Fenouillet',
  postal_code: '31200',
  city: 'Toulouse',
  country: 'France',
};

function parseGymAddress(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/^(.+?),\s*(\d{5})\s+(.+)$/);
  if (m) {
    return { address: m[1].trim(), postal_code: m[2], city: m[3].trim(), country: 'France' };
  }
  return { ...DEFAULT_FR_ADDRESS };
}

function isUsableRibCity(city, postalDigits) {
  const c = String(city || '').trim();
  if (!c) return false;
  if (/^\d+$/.test(c)) return false;
  const cityDigits = c.replace(/\D/g, '');
  if (cityDigits.length === 5 && cityDigits === String(postalDigits || '')) return false;
  return true;
}

function isValidFrenchPostalCode(postalCode) {
  const postalDigits = String(postalCode || '').replace(/\D/g, '');
  return postalDigits.length === 5;
}

function hasValidFrenchAddress(customer = {}) {
  const postalDigits = String(customer.postal_code || customer.code_postal || '').replace(/\D/g, '');
  const address = customer.address || customer.adresse;
  const city = customer.city || customer.ville;
  return (
    isValidFrenchPostalCode(postalDigits) &&
    Boolean(address) &&
    isUsableRibCity(city, postalDigits)
  );
}

function ribAddressFields(customer = {}, gymConfig = {}) {
  const postalDigits = String(customer.postal_code || customer.code_postal || '').replace(/\D/g, '');
  const validFrPostal = postalDigits.length === 5;
  const address = customer.address || customer.adresse;
  const city = customer.city || customer.ville;

  if (validFrPostal && address && isUsableRibCity(city, postalDigits)) {
    return {
      address,
      postal_code: postalDigits,
      city: String(city).trim(),
      country: 'France',
    };
  }

  if (gymConfig?.address) {
    logWarn('Adresse client invalide pour Deciplus — repli adresse salle', {
      gym: gymConfig.label || gymConfig.deciplus_label,
    });
    return parseGymAddress(gymConfig.address);
  }

  return {
    address: address || DEFAULT_FR_ADDRESS.address,
    postal_code: validFrPostal ? postalDigits : DEFAULT_FR_ADDRESS.postal_code,
    city: city || DEFAULT_FR_ADDRESS.city,
    country: 'France',
  };
}

function originalAddressLine(customer = {}) {
  return [
    customer.address || customer.adresse,
    customer.postal_code || customer.code_postal,
    customer.city || customer.ville,
    customer.country || customer.pays,
  ]
    .filter(Boolean)
    .join(', ');
}

function applyFrenchAddressFallback(customer = {}, gymConfig = {}, { preserveOriginalInAddress2 = true } = {}) {
  if (!customer || typeof customer !== 'object') return customer;
  if (hasValidFrenchAddress(customer)) {
    return { ...customer, country: customer.country || customer.pays || 'FR' };
  }

  const addr = ribAddressFields(customer, gymConfig);
  const originalLine = originalAddressLine(customer);
  const out = {
    ...customer,
    address: addr.address,
    postal_code: addr.postal_code,
    city: addr.city,
    country: 'FR',
    pays: 'FR',
  };

  if (preserveOriginalInAddress2 && originalLine) {
    const note = `Adresse saisie: ${originalLine}`;
    const existing = customer.address2 || customer.adr2;
    out.address2 = existing ? `${existing} — ${note}` : note;
  }

  return out;
}

module.exports = {
  DEFAULT_FR_ADDRESS,
  parseGymAddress,
  isUsableRibCity,
  isValidFrenchPostalCode,
  hasValidFrenchAddress,
  ribAddressFields,
  applyFrenchAddressFallback,
};
