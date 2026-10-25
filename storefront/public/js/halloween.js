/**
 * Decor Halloween : sang sous le header, citrouilles, zombie, chauves-souris.
 * Charge seulement par layout.js pendant la fenetre, hors tunnel de vente.
 */
(function () {
  if (document.getElementById('bcHalloween')) return;

  const root = document.documentElement;
  const soft = root.classList.contains('bc-halloween--soft')
    || (document.currentScript && document.currentScript.dataset.halloweenSoft === '1');
  root.classList.add('bc-halloween');
  if (soft) root.classList.add('bc-halloween--soft');

  const pumpkin = function (extra) {
    return (
      '<svg class="bc-hw-pumpkin ' + extra + '" viewBox="0 0 64 76" aria-hidden="true">' +
        '<path fill="#2f6b32" d="M32 14c1-8 8-12 12-8-5 1-8 6-8 10-2-1-3-1-4-2z"/>' +
        '<ellipse cx="22" cy="44" rx="12" ry="24" fill="#f08a22"/>' +
        '<ellipse cx="32" cy="44" rx="14" ry="26" fill="#e86a12"/>' +
        '<ellipse cx="42" cy="44" rx="12" ry="24" fill="#d4550c"/>' +
        '<path fill="#3a1608" d="M24 36h6l-3 7zM36 36h6l-3 7z"/>' +
        '<path fill="#3a1608" d="M24 52c3 5 13 5 16 0-2 3-14 3-16 0z"/>' +
        '<ellipse cx="27" cy="32" rx="4" ry="2" fill="#ffd7a8" opacity="0.55"/>' +
      '</svg>'
    );
  };

  const topbar = document.querySelector('#site-header .topbar') || document.querySelector('.topbar');
  if (topbar && !topbar.querySelector('.bc-hw-blood')) {
    const blood = document.createElement('div');
    blood.className = 'bc-hw-blood';
    blood.setAttribute('aria-hidden', 'true');
    topbar.appendChild(blood);
  }

  const stage = document.createElement('div');
  stage.id = 'bcHalloween';
  stage.setAttribute('aria-hidden', 'true');
  stage.innerHTML =
    '<div class="bc-hw-bats">' +
      '<svg class="bc-hw-bat bc-hw-bat--a" viewBox="0 0 64 28" aria-hidden="true">' +
        '<path fill="#1a1024" d="M32 14C28 6 20 3 12 6c4 2 6 5 6 7-6 2-12 2-18 0 6 5 14 7 22 5-2 3-2 7-6 9 6-2 10-5 12-9 2 4 6 7 12 9-4-2-4-6-6-9 8 2 16 0 22-5-6 2-12 2-18 0 0-2 2-5 6-7-8-3-16 0-20 8z"/>' +
      '</svg>' +
      '<svg class="bc-hw-bat bc-hw-bat--b" viewBox="0 0 64 28" aria-hidden="true">' +
        '<path fill="#241428" d="M32 14C28 6 20 3 12 6c4 2 6 5 6 7-6 2-12 2-18 0 6 5 14 7 22 5-2 3-2 7-6 9 6-2 10-5 12-9 2 4 6 7 12 9-4-2-4-6-6-9 8 2 16 0 22-5-6 2-12 2-18 0 0-2 2-5 6-7-8-3-16 0-20 8z"/>' +
      '</svg>' +
    '</div>' +
    pumpkin('bc-hw-pumpkin--a') +
    pumpkin('bc-hw-pumpkin--b') +
    '<div class="bc-hw-zombie">' +
      '<svg viewBox="0 0 70 100" aria-hidden="true">' +
        '<g class="bc-hw-leg">' +
          '<rect x="22" y="68" width="10" height="26" rx="4" fill="#5f6b52"/>' +
          '<rect x="20" y="90" width="14" height="7" rx="2" fill="#2c241c"/>' +
        '</g>' +
        '<g class="bc-hw-leg bc-hw-leg--r">' +
          '<rect x="40" y="68" width="10" height="26" rx="4" fill="#556348"/>' +
          '<rect x="38" y="90" width="14" height="7" rx="2" fill="#2c241c"/>' +
        '</g>' +
        '<rect x="20" y="40" width="30" height="32" rx="8" fill="#6d7a5c"/>' +
        '<g class="bc-hw-arm">' +
          '<rect x="6" y="44" width="16" height="8" rx="4" fill="#5f6b52"/>' +
          '<circle cx="8" cy="48" r="7" fill="#c23b3b"/>' +
        '</g>' +
        '<g class="bc-hw-arm">' +
          '<rect x="48" y="46" width="16" height="8" rx="4" fill="#5f6b52"/>' +
          '<circle cx="62" cy="50" r="7" fill="#c23b3b"/>' +
        '</g>' +
        '<circle cx="35" cy="24" r="16" fill="#8a9874"/>' +
        '<path stroke="#f4f1ea" stroke-width="3" fill="none" d="M24 18h10M40 16h12M22 28h8"/>' +
        '<circle cx="29" cy="24" r="3" fill="#1a120c"/>' +
        '<circle cx="42" cy="24" r="3" fill="#1a120c"/>' +
        '<path d="M28 32c2 3 8 3 11 0" stroke="#1a120c" stroke-width="2" fill="none"/>' +
      '</svg>' +
    '</div>';
  document.body.appendChild(stage);
})();
