/**
 * Layout partagé — header, footer, navigation
 */
(function () {
  const NAV_ITEMS = [
    { href: '/', label: 'Accueil', match: (p) => p === '/' || p.endsWith('index.html') },
    { href: '/abonnements', label: 'Abonnements', match: (p) => p.includes('abonnements') },
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
        'mon-inscription.html': '/mon-inscription',
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
  }

  function mountLayout() {
    const headerSlot = document.getElementById('site-header');
    const footerSlot = document.getElementById('site-footer');
    if (headerSlot) headerSlot.innerHTML = renderHeader();
    if (footerSlot) footerSlot.innerHTML = renderFooter();
    initNav();
    updateCartBadge();
    window.addEventListener('bccart:change', updateCartBadge);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountLayout);
  } else {
    mountLayout();
  }

  window.BCLayout = { renderHeader, renderFooter, currentPath, L, A };
})();
