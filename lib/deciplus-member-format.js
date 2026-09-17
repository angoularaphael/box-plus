'use strict';

/**
 * Helpers purs (sans Playwright) — format téléphone + URLs Deciplus nextgen/legacy.
 */

/**
 * Normalise un téléphone FR en 10 chiffres (0XXXXXXXXX).
 * Ne tronque plus les numéros trop longs (sinon 07878787879 ≈ 0787878787).
 */
function phoneForDeciplus(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('33') && digits.length === 11) {
    digits = `0${digits.slice(2)}`;
  } else if (digits.startsWith('33') && digits.length === 12 && digits[2] === '0') {
    digits = digits.slice(2);
  }

  if (digits.length === 9 && /^[1-9]/.test(digits)) {
    digits = `0${digits}`;
  }

  if (/^0\d{9}$/.test(digits)) return digits;
  return '';
}

function expandDeciplusUrl(url = '') {
  const raw = String(url || '');
  const parts = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) parts.push(decoded);
  } catch {
    /* ignore */
  }
  try {
    const u = new URL(raw);
    const pathParam = u.searchParams.get('path');
    if (pathParam) {
      parts.push(pathParam);
      try {
        parts.push(decodeURIComponent(pathParam));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return parts.join('\n');
}

function extractMemberIdFromUrl(url = '') {
  const haystack = expandDeciplusUrl(url);
  const patterns = [
    /check\.php\?[^#\s]*idj=(\d+)/i,
    /select\.php\?[^#\s]*idjnew=(\d+)/i,
    /select\.php\?[^#\s]*idj=(\d+)/i,
    /joueurs\.php\?[^#\s]*idj=(\d+)/i,
    /[?&]idjnew=(\d+)/i,
    /[?&]idj=(\d+)/i,
  ];
  for (const re of patterns) {
    const m = haystack.match(re);
    if (m && m[1] !== 'new') return m[1];
  }
  return null;
}

function isNewMemberUrl(url = '') {
  return /idj=new|idj%3Dnew/i.test(expandDeciplusUrl(url));
}

/** Saisie recherche Deciplus : majuscules, espaces normalisés (la fiche stocke TEST, pas Test). */
function nameForDeciplusSearch(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizePerson(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function namesMatch(a, b) {
  const na = normalizePerson(a);
  const nb = normalizePerson(b);
  return Boolean(na && nb && na === nb);
}

function editDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i += 1) {
    let left = i;
    const cur = [i];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      const next = Math.min(prev[j] + 1, left + 1, prev[j - 1] + cost);
      cur.push(next);
      left = next;
    }
    for (let j = 0; j <= t.length; j += 1) prev[j] = cur[j];
  }
  return prev[t.length];
}

/** Typo de saisie (Duou / Dufou) — pas un conjoint (Yousfi / Derdour). */
function namesClose(a, b, maxDist = 2) {
  const na = normalizePerson(a);
  const nb = normalizePerson(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return Math.abs(na.length - nb.length) <= maxDist;
  return editDistance(na, nb) <= maxDist;
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function emailsMatch(a, b) {
  const na = normalizeEmail(a);
  const nb = normalizeEmail(b);
  return Boolean(na && nb && na === nb);
}

/** Normalise une date Deciplus / ISO vers JJ/MM/AAAA comparable. */
function normalizeBirthCompare(value) {
  const raw = String(value || '')
    .trim()
    .replace(/\s/g, '')
    .replace(/-/g, '/');
  if (!raw) return '';
  let m = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m) {
    const yy = Number(m[3]);
    const century = yy > 30 ? 1900 : 2000;
    return `${m[1]}/${m[2]}/${century + yy}`;
  }
  m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[1]}/${m[2]}/${m[3]}`;
  return raw;
}

function birthdatesMatch(a, b) {
  const na = normalizeBirthCompare(a);
  const nb = normalizeBirthCompare(b);
  return Boolean(na && nb && na === nb);
}

/**
 * Un hit recherche (email/tél) n’est la même personne que si nom + prénom collent.
 * Un mail de couple ne doit jamais réutiliser la fiche du conjoint (Derdour / Yousfi).
 */
function memberSearchHitMatches(form, customer = {}, opts = {}) {
  if (!form) return false;
  const custLast = String(customer.last_name || '').trim();
  const custFirst = String(customer.first_name || '').trim();
  const formLast = String(form.lastName || form.last_name || '').trim();
  const formFirst = String(form.firstName || form.first_name || '').trim();
  const wantEmail = normalizeEmail(customer.email);
  const formEmail = normalizeEmail(form.email);
  const wantPhone = phoneForDeciplus(customer.phone);
  const formPhone = phoneForDeciplus(form.phone);
  const contactMatch =
    Boolean(wantEmail && formEmail && emailsMatch(wantEmail, formEmail)) ||
    Boolean(wantPhone && formPhone && wantPhone === formPhone);

  if (opts.seanceOfferte && contactMatch) return true;

  if (custLast && (!formLast || !namesMatch(formLast, custLast))) {
    if (!(contactMatch && namesClose(formLast, custLast))) return false;
  }
  if (custFirst && (!formFirst || !namesMatch(formFirst, custFirst))) {
    if (!(contactMatch && namesClose(formFirst, custFirst))) return false;
  }

  const custBirth = String(customer.birthdate || '').trim();
  const formBirth = String(form.birth || form.birthdate || '').trim();
  if (custBirth && formBirth && !birthdatesMatch(formBirth, custBirth)) return false;

  if (wantEmail && formEmail) return emailsMatch(wantEmail, formEmail);
  if (wantPhone && formPhone) return wantPhone === formPhone;

  return Boolean((formLast || formFirst) && (custLast || custFirst));
}

/** Email réel d’adhérent — pas le mail PSP Aventure `aventure.<order>@boxplus-test.local`. */
function isSearchableMemberEmail(value) {
  const email = normalizeEmail(value);
  if (!email.includes('@')) return '';
  if (/^aventure\.[a-z0-9-]+@boxplus-test\.local$/.test(email)) return '';
  return email;
}

module.exports = {
  phoneForDeciplus,
  expandDeciplusUrl,
  extractMemberIdFromUrl,
  isNewMemberUrl,
  nameForDeciplusSearch,
  normalizePerson,
  namesMatch,
  namesClose,
  normalizeEmail,
  emailsMatch,
  isSearchableMemberEmail,
  normalizeBirthCompare,
  birthdatesMatch,
  memberSearchHitMatches,
};
