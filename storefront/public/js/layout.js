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
        '404.html': '/404',
      };
      if (map[file]) return map[file];
      if (location.pathname.includes('/admin/')) return '/admin';
      return '/';
    }
    return location.pathname.replace(/\/$/, '') || '/';
  }

  const RESUME_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function readResumeProgress() {
    const fromLs = () => {
      try {
        return JSON.parse(localStorage.getItem('bc_inscription_progress') || 'null');
      } catch {
        return null;
      }
    };
    const fromCookie = () => {
      try {
        const match = document.cookie.match(/(?:^|;\s*)bc_resume=([^;]*)/);
        if (!match) return null;
        const c = JSON.parse(decodeURIComponent(match[1]));
        if (!c?.o || !c?.t) return null;
        return {
          orderId: c.o,
          token: c.t,
          step: Number(c.s) || 1,
          productId: c.p || null,
          savedAt: c.at || Date.now(),
        };
      } catch {
        return null;
      }
    };
    const saved = fromLs() || fromCookie();
    if (!saved?.orderId || !saved?.token) return null;
    if (saved.savedAt && Date.now() - Number(saved.savedAt) > RESUME_TTL_MS) return null;
    const step = Number(saved.step) || 1;
    if (step < 2 || step >= 8 || saved.tunnelComplete) return null;
    return saved;
  }

  function resumeInscriptionHref() {
    const saved = readResumeProgress();
    if (!saved) return '';
    const qs = new URLSearchParams();
    if (saved.productId) qs.set('product', saved.productId);
    qs.set('order', saved.orderId);
    qs.set('token', saved.token);
    qs.set('bc_token', saved.token);
    qs.set('step', String(saved.step || 2));
    return `${L('/inscription')}?${qs}`;
  }

  function renderResumeBar() {
    const path = currentPath();
    if (/inscription|admin|\/dev|success|contrat|mon-inscription/i.test(path)) return;
    const href = resumeInscriptionHref();
    if (!href || document.getElementById('resumeBar')) return;
    const bar = document.createElement('div');
    bar.id = 'resumeBar';
    bar.className = 'resume-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = `
      <p>Votre inscription est en cours. Reprenez exactement où vous vous êtes arrêté.</p>
      <a class="btn" href="${href}">Continuer</a>`;
    const topbar = document.querySelector('#site-header .topbar');
    if (topbar) {
      topbar.appendChild(bar);
      return;
    }
    const header = document.getElementById('site-header');
    if (header && header.parentNode) {
      header.parentNode.insertBefore(bar, header.nextSibling);
    } else {
      document.body.prepend(bar);
    }
  }

  function renderHeader() {
    const path = currentPath();
    const resumeHref = resumeInscriptionHref();
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
            <a href="${resumeHref || L('/abonnements')}" class="nav-cta">${resumeHref ? 'Continuer' : "Je m'inscris"}</a>
          </nav>
        </div>
      </header>`;
  }

  function renderFfSection() {
    return `
      <section class="ff-section" id="fight-and-furious" aria-label="FIGHT and Furious">
        <div class="ff-section__in">
          <p class="ff-section__k">11 au 13 decembre 2026</p>
          <h2 class="ff-section__t">FIGHT &amp; Furious</h2>
          <p class="ff-section__p">Gala de boxe Boxing Center x Moteka. Billets en ligne et jeu concours avec tirages jusqu'au 28 novembre.</p>
          <div class="ff-section__row">
            <a class="ff-btn ff-btn--on" href="https://fight-and-furious.boxingcenter.fr/?src=btq">Voir l'evenement</a>
            <a class="ff-btn ff-btn--ghost" href="${L('/billetterie')}?src=btq">Acheter un billet</a>
            <a class="ff-btn ff-btn--line" href="https://fight-and-furious.boxingcenter.fr/?src=btq#concours">Jeu concours</a>
          </div>
        </div>
      </section>`;
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
            <a href="https://fight-and-furious.boxingcenter.fr/?src=btq" target="_blank" rel="noopener">FIGHT &amp; Furious</a>
            <a href="${L('/billetterie')}?src=btq">Billetterie FIGHT &amp; Furious</a>
          </div>
        </div>
        <div class="footer-bottom">
          © ${new Date().getFullYear()} Boxing Center — Tous droits réservés
        </div>
        <p class="ai-dev-credit" aria-hidden="true">chef equipe dev : <a href="https://fr.linkedin.com/in/germain-raphael-angoula-onambele-a6b858395" rel="noopener noreferrer">Angoula Onambele Germain Raphael</a> · dev : mbosseu brad bruel</p>
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
    let shown = null;
    const sync = () => {
      ticking = false;
      const show = window.scrollY > 380;
      // Le bouton n'est touché que quand il change d'état, plus à chaque image du défilement.
      if (show === shown) return;
      shown = show;
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
    if (document.querySelector('script[data-bc-track], script[src*="tracking.js"]')) return;
    const p = currentPath();
    if (/^\/admin(\/|$)/i.test(p) || /\/admin\//i.test(location.pathname)) return;
    const s = document.createElement('script');
    s.src = '/js/tracking.js?v=2';
    s.async = false;
    s.dataset.bcTrack = '1';
    document.head.appendChild(s);
  }

  function ensureChloe() {
    const p = currentPath();
    if (/gerer-abonnement|regulariser|inscription|checkout|panier|success|contrat|mon-inscription|admin|attestation|\/404|\/dev/i.test(p)) {
      return;
    }
    if (document.querySelector('script[data-chloe]')) return;
    const s = document.createElement('script');
    s.src = A('/js/counselor-chloe.js?v=4');
    s.defer = true;
    s.dataset.chloe = '1';
    document.body.appendChild(s);
  }

  function parisDay() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch (e) {
      return '';
    }
  }

  function ensureHalloween() {
    if (document.querySelector('link[data-halloween], script[data-halloween]')) return;
    let flag = '';
    try {
      flag = new URLSearchParams(location.search).get('halloween') || '';
    } catch (e) {
      flag = '';
    }
    if (flag === '0') return;
    const day = parisDay();
    const inWindow = day >= '2026-10-25' && day <= '2026-11-02';
    // ?halloween=1 (ou v2) force la scène hors fenêtre ; ?halloween=v1 remet le premier décor.
    const forced = flag === '1' || flag === 'v1' || flag === 'v2';
    if (!forced && !inWindow) return;
    const legacy = flag === 'v1';
    const p = currentPath();
    if (/inscription|checkout|panier|paiement|contrat|success|regulariser|gerer-abonnement|attestation|certificat|admin|\/404|\/dev/i.test(p)) {
      return;
    }
    const soft = /boxe-enfant/i.test(p);
    document.documentElement.classList.add('bc-halloween');
    if (soft) document.documentElement.classList.add('bc-halloween--soft');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = A(legacy ? '/css/halloween.css?v=1' : '/css/halloween-ring.css?v=1');
    link.dataset.halloween = '1';
    document.head.appendChild(link);
    const s = document.createElement('script');
    s.src = A(legacy ? '/js/halloween.js?v=1' : '/js/halloween-ring.js?v=1');
    s.defer = true;
    s.dataset.halloween = '1';
    if (soft) s.dataset.halloweenSoft = '1';
    document.body.appendChild(s);
    if (!legacy) {
      // La nuit sur toute la page (zombie, citrouilles, chauves-souris, sang) en plus du hero.
      const pl = document.createElement('link');
      pl.rel = 'stylesheet';
      pl.href = A('/css/halloween-page.css?v=1');
      pl.dataset.halloween = '1';
      document.head.appendChild(pl);
      const ps = document.createElement('script');
      ps.src = A('/js/halloween-page.js?v=1');
      ps.defer = true;
      ps.dataset.halloween = '1';
      document.body.appendChild(ps);
    }
  }

  // Noël : du 26 novembre au 4 janvier, heure de Paris. ?noel=1 force la scène hors fenêtre,
  // ?noel=0 la coupe, ?noel=v1 montre le premier décor seul (sac-cadeau, Père Noël, sans la
  // boutique gelée). Jusqu'au 10 décembre le bandeau FIGHT & Furious est encore en bas de
  // l'écran : le Père Noël marche juste au-dessus, puis redescend quand le bandeau s'en va.
  //
  // Le décor est partout où le site a son en-tête (accueil, offres, panier, gérer mon abonnement,
  // régulariser, billetterie, pages légales, 404…), sauf :
  //  - le tunnel d'inscription, dès l'étape 1 (on lit l'offre, on remplit ses informations, on
  //    paie, on signe) : rien ne doit distraire ;
  //  - le billet du gala (son QR code doit rester net) et l'administration.
  // Quand un dossier est complet ou un paiement confirmé — étape « Confirmé » de l'inscription,
  // page de confirmation d'une commande —, le décor arrive et fait la fête : layout.js pose
  // html.bc-noel-party et envoie « bc:noel-party », chaque script du décor y répond à sa façon.
  // Jamais sur un paiement refusé ni encore en cours de validation.
  function ensureNoel() {
    if (document.querySelector('link[data-noel], script[data-noel]')) return;
    let flag = '';
    try {
      flag = new URLSearchParams(location.search).get('noel') || '';
    } catch (e) {
      flag = '';
    }
    if (flag === '0') return;
    const day = parisDay();
    const inWindow = day >= '2026-11-26' && day <= '2027-01-04';
    const forced = flag === '1' || flag === 'v1' || flag === 'v2';
    if (!forced && !inWindow) return;
    const legacy = flag === 'v1';
    const p = currentPath();
    if (/(^|\/)admin(\/|$)|(^|\/)dev(\/|$)|(^|\/)(billet|checkout|contrat|paiement-redirect)(\.html)?$/i.test(p)) return;
    const funnel = /(^|\/)inscription(\.html)?$/i.test(p);
    // Une confirmation est-elle affichée ? Le bloc de fête du site est là, le paiement n'est ni
    // refusé ni encore en cours de validation.
    const confirmed = () => {
      const s = document.querySelector('.success-page--celebrate');
      if (!s || s.classList.contains('payment-failed')) return false;
      return !/validation du paiement|en cours de validation/i.test(s.textContent || '');
    };
    let partyOn = false;
    const party = () => {
      if (partyOn || !confirmed()) return false;
      partyOn = true;
      document.documentElement.classList.add('bc-noel-party');
      document.dispatchEvent(new CustomEvent('bc:noel-party'));
      return true;
    };
    const soft = /boxe-enfant/i.test(p);
    const sheet = (href) => new Promise((done) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = A(href);
      link.dataset.noel = '1';
      link.onload = link.onerror = done;
      document.head.appendChild(link);
      setTimeout(done, 3000);
    });
    const script = (src) => {
      const s = document.createElement('script');
      s.src = A(src);
      s.dataset.noel = '1';
      // Dans l'ordre où on les pose (un script ajouté à la main s'exécute sinon dès qu'il arrive).
      s.async = false;
      document.body.appendChild(s);
    };
    const boot = () => {
      if (document.querySelector('link[data-noel], script[data-noel]')) return;
      document.documentElement.classList.add('bc-noel');
      if (soft) document.documentElement.classList.add('bc-noel--soft');
      // Une page de confirmation : la fête part quand le paiement est confirmé (tout de suite, ou
      // quand le texte « Validation du paiement… » laisse la place à la confirmation).
      const done = document.querySelector('.success-page');
      if (done && !party()) {
        const mo = new MutationObserver(() => {
          if (party() || done.classList.contains('payment-failed')) mo.disconnect();
        });
        mo.observe(done, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
        setTimeout(() => mo.disconnect(), 120000);
      }
      // Les scripts n'arrivent qu'avec leurs styles : rien ne s'affiche brut, rien n'est mesuré de travers.
      if (legacy) {
        Promise.all([sheet('/css/noel-ring.css?v=4'), sheet('/css/noel-page.css?v=3')]).then(() => {
          script('/js/noel-ring.js?v=4');
          script('/js/noel-page.js?v=3');
        });
        return;
      }
      // Le cadeau à ouvrir à la boxe (hero), le Père Noël et son traîneau (page), et la boutique
      // gelée que les coups sur le cadeau réchauffent (givre, neige posée sur le site, guirlande).
      document.documentElement.classList.add('bc-noel-hiver');
      Promise.all([sheet('/css/noel-ring.css?v=4'), sheet('/css/noel-page.css?v=3'), sheet('/css/noel-hiver.css?v=2')]).then(() => {
        script('/js/noel-ring.js?v=4');
        script('/js/noel-hiver.js?v=2');
        script('/js/noel-page.js?v=3');
      });
    };
    // Le site d'abord : le décor n'arrive qu'une fois la page affichée et le navigateur au repos.
    // Il ne doit jamais retarder l'ouverture d'une page.
    const later = () => (window.requestIdleCallback ? window.requestIdleCallback(boot, { timeout: 2500 }) : setTimeout(boot, 700));
    if (funnel) {
      // Le tunnel reste nu. Le jour où l'étape « Confirmé » s'affiche, le décor arrive pour la fête.
      const host = document.getElementById('stepContent') || document.body;
      let mo = null;
      const seen = () => {
        if (!confirmed()) return;
        if (mo) mo.disconnect();
        later();
      };
      mo = new MutationObserver(seen);
      mo.observe(host, { childList: true, subtree: true });
      seen();
      return;
    }
    if (document.readyState === 'complete') later();
    else {
      window.addEventListener('load', later, { once: true });
      // Une vidéo lente peut retarder « load » : le décor arrive quand même.
      setTimeout(later, 6000);
    }
  }

  function mountLayout() {
    const headerSlot = document.getElementById('site-header');
    const footerSlot = document.getElementById('site-footer');
    if (headerSlot) headerSlot.innerHTML = renderHeader();
    if (footerSlot) {
      const p = currentPath();
      // La section FIGHT & Furious s'arrête le 13 décembre 2026 (dernier jour du gala), heure de Paris.
      const ffOver = parisDay() >= '2026-12-13';
      const skipFf = ffOver || /billet|checkout|inscription|paiement|contrat|success|admin/i.test(p);
      footerSlot.innerHTML = (skipFf ? '' : renderFfSection()) + renderFooter();
    }
    initNav();
    renderResumeBar();
    renderBackTop();
    renderCartFab();
    updateCartBadge();
    window.addEventListener('bccart:change', updateCartBadge);
    ensureTracking();
    ensureFfPromo();
    ensureChloe();
    ensureHalloween();
    ensureNoel();
    ensureFavicon();
  }

  function ensureFfPromo() {
    if (document.querySelector('script[data-ff-promo]')) return;
    // Le bandeau FIGHT & Furious s'arrête le 10 décembre 2026 (heure de Paris) : à partir de ce
    // jour, il n'est plus chargé, et le Père Noël redescend courir en bas de l'écran.
    const day = parisDay();
    if (day && day >= '2026-12-10') return;
    const p = currentPath();
    if (/^\/admin(\/|$)/i.test(p) || /\/admin\//i.test(location.pathname)) return;
    if (/billet|checkout|inscription|paiement|contrat|success/i.test(p)) return;
    const s = document.createElement('script');
    s.src = 'https://fight-and-furious.boxingcenter.fr/ff-promo.js?v=3';
    s.defer = true;
    s.dataset.ffPromo = '1';
    s.dataset.src = 'btq';
    document.body.appendChild(s);
  }

  function ensureFavicon() {
    if (document.querySelector('link[rel="icon"]')) return;
    const svg = document.createElement('link');
    svg.rel = 'icon';
    svg.type = 'image/svg+xml';
    svg.href = A('/assets/favicon.svg');
    document.head.appendChild(svg);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountLayout);
  } else {
    mountLayout();
  }

  window.BCLayout = { renderHeader, renderFooter, currentPath, L, A };

  ensureTracking();
})();
