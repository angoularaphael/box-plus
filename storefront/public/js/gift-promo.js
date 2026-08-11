/**
 * Entrée boutique — cadeau qui s'ouvre sur les offres promo (29,99 € ou 259 €).
 * Une fois par session navigateur.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'bc_gift_promo_seen';
  const DELAY_MS = 700;

  const OFFERS = [
    {
      id: 'offre-duo',
      price: '29,99',
      priceWas: '44,99',
      title: '29,99 € / 4 semaines',
      lead: '1ʳᵉ échéance CB · sans engagement · 5 salles',
      href: '/offre/29',
      track: 'gift_promo_cta_29',
    },
    {
      id: 'offre-saison-259',
      price: '259',
      priceWas: '400',
      title: '259 € / 12 mois',
      lead: '1× ou 4× sans frais · tarif annuel · 5 salles',
      href: '/offre/259',
      track: 'gift_promo_cta_259',
    },
  ];

  const SKIP_PATH =
    /inscription|checkout|panier|success|contrat|mon-inscription|gerer-abonnement|attestation|admin|confidentialite|cgv|reglement|offre/i;

  function path() {
    if (window.BCLayout?.currentPath) return window.BCLayout.currentPath();
    return location.pathname.replace(/\/$/, '') || '/';
  }

  function link(p) {
    return window.BCPaths?.link(p) || p;
  }

  function alreadySeen() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1' || sessionStorage.getItem('bc_gift29_seen') === '1';
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

  function track(name, props = {}) {
    if (typeof window.BCTrack?.track === 'function') {
      window.BCTrack.track(name, props);
      return;
    }
    try {
      const body = JSON.stringify({
        type: 'event',
        name,
        props,
        path: location.pathname,
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics/event', new Blob([body], { type: 'application/json' }));
      }
    } catch {
      /* ignore */
    }
  }

  function offerCardsHtml() {
    return OFFERS.map(
      (o, i) => `
        <a class="gift-promo__offer" href="${link(o.href)}" data-track="${o.track}" data-offer="${o.id}" style="--i:${i}">
          <span class="gift-promo__offer-prices">
            ${o.priceWas ? `<span class="gift-promo__offer-was" aria-hidden="true">${o.priceWas}<span>€</span></span>` : ''}
            <span class="gift-promo__offer-price">${o.price}<span>€</span></span>
          </span>
          <span class="gift-promo__offer-title">${o.title}</span>
          <span class="gift-promo__offer-lead">${o.lead}</span>
          <span class="gift-promo__offer-cta">Choisir cette offre</span>
        </a>`
    ).join('');
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
          <span class="gift-promo__eyebrow">Offres promo</span>
          <h2 class="gift-promo__title" id="giftPromoTitle">Choisis ton offre</h2>
          <p class="gift-promo__lead">Deux formules · accès illimité aux 5 salles Boxing Center</p>
          <div class="gift-promo__offers">${offerCardsHtml()}</div>
          <a class="gift-promo__all" href="${link('/offres-speciales')}" data-track="gift_promo_all">Comparer les deux offres</a>
          <button type="button" class="gift-promo__skip" data-gift-close>Plus tard</button>
        </div>
      </div>`;
    return root;
  }

  function openBox(root) {
    if (root.classList.contains('is-opened')) return;
    root.classList.add('is-opened');
    track('gift_promo_open');
    const first = root.querySelector('.gift-promo__offer');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 400);
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
    root.querySelectorAll('[data-track^="gift_promo_cta"]').forEach((el) => {
      el.addEventListener('click', () => {
        markSeen();
        track(el.getAttribute('data-track') || 'gift_promo_cta', {
          product: el.getAttribute('data-offer') || null,
        });
      });
    });
    root.querySelector('[data-track="gift_promo_all"]')?.addEventListener('click', () => markSeen());

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
