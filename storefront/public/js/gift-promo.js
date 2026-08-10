/**
 * Entrée boutique — cadeau qui s'ouvre sur l'offre 29 € (offre-duo).
 * Une fois par session navigateur.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'bc_gift29_seen';
  const PRODUCT_ID = 'offre-duo';
  const DELAY_MS = 700;

  const SKIP_PATH =
    /inscription|checkout|panier|success|contrat|mon-inscription|gerer-abonnement|attestation|admin|confidentialite|cgv|reglement/i;

  function path() {
    if (window.BCLayout?.currentPath) return window.BCLayout.currentPath();
    return location.pathname.replace(/\/$/, '') || '/';
  }

  function link(p) {
    return window.BCPaths?.link(p) || p;
  }

  function alreadySeen() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function markSeen() {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  function track(name) {
    if (typeof window.BCTrack?.track === 'function') {
      window.BCTrack.track(name, { product: PRODUCT_ID });
      return;
    }
    try {
      const body = JSON.stringify({
        type: 'event',
        name,
        props: { product: PRODUCT_ID },
        path: location.pathname,
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics/event', new Blob([body], { type: 'application/json' }));
      }
    } catch {
      /* ignore */
    }
  }

  function build() {
    const root = document.createElement('div');
    root.className = 'gift-promo';
    root.id = 'giftPromo';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'giftPromoTitle');
    root.innerHTML = `
      <div class="gift-promo__panel">
        <button type="button" class="gift-promo__close" data-gift-close aria-label="Fermer">×</button>
        <div class="gift-promo__stage">
          <div class="gift-promo__sparks" aria-hidden="true">
            <span class="gift-promo__spark"></span>
            <span class="gift-promo__spark"></span>
            <span class="gift-promo__spark"></span>
            <span class="gift-promo__spark"></span>
            <span class="gift-promo__spark"></span>
            <span class="gift-promo__spark"></span>
            <span class="gift-promo__spark"></span>
            <span class="gift-promo__spark"></span>
          </div>
          <button type="button" class="gift-box" data-gift-open aria-label="Ouvrir le cadeau">
            <span class="gift-box__lid" aria-hidden="true"></span>
            <span class="gift-box__bow" aria-hidden="true"></span>
            <span class="gift-box__knot" aria-hidden="true"></span>
            <span class="gift-box__body" aria-hidden="true">
              <span class="gift-box__ribbon-v"></span>
              <span class="gift-box__ribbon-h"></span>
            </span>
          </button>
        </div>
        <p class="gift-promo__hint">Un cadeau t’attend — ouvre-le</p>
        <div class="gift-promo__reveal">
          <span class="gift-promo__eyebrow">Offre limitée</span>
          <h2 class="gift-promo__title" id="giftPromoTitle">Offre à 29 €</h2>
          <p class="gift-promo__price">29<span>€</span></p>
          <p class="gift-promo__lead">29 € par personne · 4 semaines · accès aux 5 salles</p>
          <a class="gift-promo__cta" href="${link('/offre/29')}" data-track="gift_promo_cta">
            J’en profite
          </a>
          <button type="button" class="gift-promo__skip" data-gift-close>Plus tard</button>
        </div>
      </div>`;
    return root;
  }

  function openBox(root) {
    if (root.classList.contains('is-opened')) return;
    root.classList.add('is-opened');
    track('gift_promo_open');
    const cta = root.querySelector('.gift-promo__cta');
    if (cta) setTimeout(() => cta.focus({ preventScroll: true }), 400);
  }

  function dismiss(root) {
    markSeen();
    root.classList.remove('is-open');
    document.body.classList.remove('gift-promo-lock');
    track('gift_promo_dismiss');
    setTimeout(() => root.remove(), 480);
  }

  function show() {
    if (alreadySeen() || SKIP_PATH.test(path())) return;

    const root = build();
    document.body.appendChild(root);
    document.body.classList.add('gift-promo-lock');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => root.classList.add('is-open'));
    });
    track('gift_promo_view');

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) openBox(root);

    root.querySelector('[data-gift-open]')?.addEventListener('click', () => openBox(root));
    root.querySelectorAll('[data-gift-close]').forEach((el) => {
      el.addEventListener('click', () => dismiss(root));
    });
    root.addEventListener('click', (e) => {
      if (e.target === root) dismiss(root);
    });
    root.querySelector('.gift-promo__cta')?.addEventListener('click', () => {
      markSeen();
      track('gift_promo_cta');
    });

    document.addEventListener(
      'keydown',
      function onKey(e) {
        if (e.key === 'Escape') {
          dismiss(root);
          document.removeEventListener('keydown', onKey);
        }
      },
      { passive: true }
    );
  }

  function boot() {
    if (alreadySeen() || SKIP_PATH.test(path())) return;
    setTimeout(show, DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
