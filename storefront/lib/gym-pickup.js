'use strict';

const { MANAGERS } = require('./welcome-knowledge');

/** Salles proposées au checkout matériel (libellés panier) + adresses de retrait. */
const PICKUP_GYMS = [
  { id: 'st-cyprien', label: 'Toulouse St-Cyprien', address: MANAGERS['st-cyprien'].address },
  { id: 'minimes', label: 'Barrière de Paris - Minimes', address: MANAGERS.minimes.address },
  { id: 'ramonville', label: 'Ramonville', address: MANAGERS.ramonville.address },
  { id: 'portet', label: 'Portet-sur-Garonne', address: MANAGERS.portet.address },
  { id: 'etats-unis', label: 'États-Unis', address: MANAGERS['etats-unis'].address },
];

function resolvePickupGym(pickupGym) {
  const raw = String(pickupGym || '').trim();
  if (!raw) return null;
  const key = raw.toLowerCase();
  const byId = PICKUP_GYMS.find((g) => g.id === key);
  if (byId) return byId;
  const byLabel = PICKUP_GYMS.find((g) => g.label.toLowerCase() === key);
  if (byLabel) return byLabel;
  const partial = PICKUP_GYMS.find(
    (g) => key.includes(g.id) || g.label.toLowerCase().includes(key) || key.includes(g.label.toLowerCase())
  );
  return partial || { id: null, label: raw, address: null };
}

function intersectPickupGyms(lists) {
  const all = PICKUP_GYMS.map((g) => g.label);
  if (!Array.isArray(lists) || !lists.length) return all;
  return lists.reduce((acc, list) => {
    const allowed = Array.isArray(list) && list.length ? list : all;
    return acc.filter((g) => allowed.includes(g));
  }, all);
}

function formatPickupLine(pickupGym) {
  const gym = resolvePickupGym(pickupGym);
  if (!gym) return '—';
  if (gym.address) return `${gym.label} — ${gym.address}`;
  return gym.label;
}

module.exports = {
  PICKUP_GYMS,
  resolvePickupGym,
  formatPickupLine,
  intersectPickupGyms,
};
