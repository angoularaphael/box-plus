/**
 * Layout partagé — header, footer, navigation
 */
(function () {
  const NAV_ITEMS = [
    { href: '/', label: 'Accueil', match: (p) => p === '/' || p.endsWith('index.html') },
    { href: '/abonnements', label: 'Abonnements', match: (p) => p.includes('abonnements') },
    {
      href: '/gerer-abonnement',
      label: 'Gérer mon abo',
      match: (p) => p.includes('gerer-abonnement'),
    },
    { href: '/seance-essai', label: "Séance d'essai", match: (p) => p.includes('seance-essai') },
    { href: '/coachings', label: 'Coachings', match: (p) => p.includes('coachings') },
    { href: '/materiel', label: 'Matériel', match: (p) => p.includes('materiel') },
  ];

  function L(path) {
    return window.BCPaths?.link(path) || path;
  }

  function A(path) {
    return window.BCPaths?.asset(path) || path.replace(/^\//, '');
  }

  function currentPath() {
    if (location.protocol === 'file:') {
      const file = location.pathname.split('/').pop() || 'index.html';
      const map = {
        'index.html': '/',
        'abonnements.html': '/abonnements',
        'seance-essai.html': '/seance-essai',
        'coachings.html': '/coachings',
        'materiel.html': '/materiel',
        'materiel-produit.html': '/materiel/produit',
        'panier.html': '/panier',
        'inscription.html': '/inscription',
        'faq.html': '/faq',
        'confidentialite.html': '/politique-confidentialite',
        'cgv.html': '/cgv',
        'reglement-interieur.html': '/reglement-interieur',
        'mon-inscription.html': '/mon-inscription',
        'gerer-abonnement.html': '/gerer-abonnement',
      };
      if (map[file]) return map[file];
      if (location.pathname.includes('/admin/')) return '/admin';
      return '/';
    }
    return location.pathname.replace(/\/$/, '') || '/';
  }

  function renderHeader() {
    const path = currentPath();
    const navLinks = NAV_ITEMS.map(
      (item) =>
        `<a href="${L(item.href)}" class="${item.match(path) ? 'active' : ''}">${item.label}</a>`
    ).join('');
    return `
      <header class="topbar">
        <div class="topbar-inner">
          <a class="logo" href="${L('/')}">
            <img src="${A('/img/bc/logo/BC_Logo_Officiel_Transparent.png')}" alt="Boxing Center" width="214" height="100" />
          </a>
          <button class="nav-toggle" id="navToggle" aria-label="Menu" type="button">
            <span></span><span></span><span></span>
          </button>
          <nav class="main-nav" id="mainNav">
            ${navLinks}
            <a href="${L('/panier')}" class="nav-cart" id="navCart" aria-label="Panier">
              Panier <span class="cart-badge" id="cartBadge" hidden>0</span>
            </a>
            <a href="${L('/abonnements')}" class="nav-cta">Je m'inscris</a>
          </nav>
        </div>
      </header>`;
  }

  function renderFooter() {
    return `
      <footer class="site-footer">
        <div class="footer-inner">
          <div class="footer-brand">
            <img src="${A('/img/bc/logo/BC_Logo_Officiel_Transparent.png')}" alt="Boxing Center" height="40" style="height:40px;width:auto;filter:brightness(0) invert(1)" />
            <p>Club de boxe accessible à tous — 5 salles en région toulousaine. Encadrement professionnel, ambiance bienveillante.</p>
          </div>
          <div class="footer-links">
            <h4>Boutique</h4>
            <a href="${L('/abonnements')}">Abonnements</a>
            <a href="${L('/seance-essai')}">Séance d'essai</a>
            <a href="${L('/coachings')}">Coachings</a>
            <a href="${L('/materiel')}">Matériel</a>
          </div>
          <div class="footer-links">
            <h4>Informations</h4>
            <a href="${L('/faq')}">FAQ</a>
            <a href="${L('/cgv')}">CGV</a>
            <a href="${L('/reglement-interieur')}">Règlement intérieur</a>
            <a href="${L('/politique-confidentialite')}">Confidentialité</a>
            <a href="https://boxingcenter.fr" target="_blank" rel="noopener">boxingcenter.fr</a>
          </div>
        </div>
        <div class="footer-bottom">
          © ${new Date().getFullYear()} Boxing Center — Tous droits réservés
        </div>
      </footer>`;
  }

  function initNav() {
    const toggle = document.getElementById('navToggle');
    const nav = document.getElementById('mainNav');
    if (toggle && nav) {
      toggle.addEventListener('click', () => nav.classList.toggle('open'));
    }
  }

  function updateCartBadge() {
    const badge = document.getElementById('cartBadge');
    if (!badge || !window.BCCart) return;
    const n = window.BCCart.count();
    badge.textContent = String(n);
    badge.hidden = n <= 0;
    updateCartFab(n);
  }

  function renderBackTop() {
    if (document.getElementById('backTop')) return;
    if (currentPath().includes('/admin')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'backTop';
    btn.className = 'back-top';
    btn.setAttribute('aria-label', 'Revenir en haut');
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>
      </svg>
      <span class="back-top__label">Haut</span>`;
    btn.hidden = true;
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.appendChild(btn);

    let ticking = false;
    const sync = () => {
      ticking = false;
      const show = window.scrollY > 380;
      btn.hidden = !show;
      btn.classList.toggle('is-visible', show);
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(sync);
        }
      },
      { passive: true }
    );
    sync();
  }

  function renderCartFab() {
    const path = currentPath();
    if (path === '/panier' || path.includes('panier') || path.includes('checkout') || path.includes('inscription') || path.includes('/admin')) return;
    const fab = document.createElement('a');
    fab.id = 'cartFab';
    fab.href = L('/panier');
    fab.setAttribute('aria-label', 'Voir le panier');
    fab.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
      </svg>
      <span class="cart-fab-count" id="cartFabCount" hidden>0</span>`;
    fab.style.cssText = [
      'position:fixed', 'bottom:1.5rem', 'right:1.5rem', 'z-index:900',
      'display:none', 'align-items:center', 'justify-content:center',
      'width:52px', 'height:52px', 'border-radius:50%',
      'background:#B8282B', 'color:#fff',
      'box-shadow:0 4px 16px rgba(0,0,0,0.25)',
      'text-decoration:none', 'transition:transform .2s,box-shadow .2s',
    ].join(';');
    fab.onmouseenter = () => { fab.style.transform = 'scale(1.08)'; fab.style.boxShadow = '0 6px 24px rgba(0,0,0,0.35)'; };
    fab.onmouseleave = () => { fab.style.transform = ''; fab.style.boxShadow = '0 4px 16px rgba(0,0,0,0.25)'; };
    document.body.appendChild(fab);
  }

  function updateCartFab(n) {
    const fab = document.getElementById('cartFab');
    if (!fab) return;
    const cnt = document.getElementById('cartFabCount');
    if (n > 0) {
      fab.style.display = 'flex';
      if (cnt) { cnt.textContent = String(n); cnt.hidden = false; }
    } else {
      fab.style.display = 'none';
    }
  }

  function ensureTracking() {
    if (window.BCTrack) return;
    const s = document.createElement('script');
    s.src = (window.BCPaths?.asset('js/tracking.js') || 'js/tracking.js');
    s.defer = true;
    document.head.appendChild(s);
  }

  function ensureGiftPromo() {
    const p = currentPath();
    if (/inscription|checkout|panier|success|contrat|mon-inscription|gerer-abonnement|attestation|admin|confidentialite|cgv|reglement/i.test(p)) {
      return;
    }
    if (document.querySelector('script[data-gift-promo]')) return;
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = A('/css/gift-promo.css');
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = A('/js/gift-promo.js?v=30');
    s.defer = true;
    s.dataset.giftPromo = '1';
    document.body.appendChild(s);
  }

  function mountLayout() {
    const headerSlot = document.getElementById('site-header');
    const footerSlot = document.getElementById('site-footer');
    if (headerSlot) headerSlot.innerHTML = renderHeader();
    if (footerSlot) footerSlot.innerHTML = renderFooter();
    initNav();
    renderBackTop();
    renderCartFab();
    updateCartBadge();
    window.addEventListener('bccart:change', updateCartBadge);
    ensureTracking();
    ensureGiftPromo();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountLayout);
  } else {
    mountLayout();
  }

  window.BCLayout = { renderHeader, renderFooter, currentPath, L, A };
})();
