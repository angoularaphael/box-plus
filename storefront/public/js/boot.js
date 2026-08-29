/**
 * Base URL + liens compatibles file:// et serveur Express
 */
(function () {
  function isMaterielReturn(pathname, searchParams) {
    const p =
      searchParams instanceof URLSearchParams
        ? searchParams
        : new URLSearchParams(searchParams || '');
    const order = String(p.get('order') || '');
    const type = String(p.get('type') || '');
    return type === 'materiel' || /^MAT-/i.test(order);
  }

  /**
   * Les retours PSP inscription peuvent atterrir hors /inscription.
   * Ne jamais y envoyer une commande matériel (MAT-…) : le tunnel abo
   * répond 403 forbidden alors que le paiement est déjà encaissé.
   */
  function shouldRedirectToInscription(pathname, searchParams) {
    const p =
      searchParams instanceof URLSearchParams
        ? searchParams
        : new URLSearchParams(searchParams || '');
    const order = p.get('order');
    const token = p.get('token');
    const product = p.get('product');
    const step = p.get('step');
    const onInscription = /^\/inscription(\/|$)/.test(pathname || '');
    const onContrat = /^\/contrat(\/|$)/.test(pathname || '');
    const onMonInscription = /^\/mon-inscription(\/|$)/.test(pathname || '');
    if (onInscription || onContrat || onMonInscription) return false;
    if (isMaterielReturn(pathname, p)) return false;
    if (order && token) return true;
    if (product && (order || (step && Number(step) > 1))) return true;
    return false;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { shouldRedirectToInscription, isMaterielReturn };
    return;
  }

  // Préremplissage inter-sites (assistant des sites Boxing Center) : les
  // coordonnées arrivent en FRAGMENT (#bcp=..., jamais envoyé au serveur ni
  // aux logs), sont rangées en sessionStorage puis effacées de l'URL — le
  // reste du hash (#promo...) est préservé pour les onglets.
  try {
    const m = location.hash.match(/[#&]bcp=([A-Za-z0-9\-_]+)/);
    if (m) {
      const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
      const p = JSON.parse(json);
      if (p && typeof p === 'object') sessionStorage.setItem('bcp_prefill', JSON.stringify(p));
      const rest = location.hash.replace(/[#&]bcp=[A-Za-z0-9\-_]+/, '').replace(/^&/, '#');
      history.replaceState(null, '', location.pathname + location.search + (rest && rest !== '#' ? rest : ''));
    }
  } catch (e) { /* fragment invalide : ignoré */ }

  if (location.protocol !== 'file:') {
    const qs = location.search;
    const onSuccess = /^\/success(\.html)?(\/|$)/i.test(location.pathname);
    if (qs && isMaterielReturn(location.pathname, qs) && !onSuccess) {
      location.replace(`/success.html${qs}`);
      return;
    }
    if (qs && shouldRedirectToInscription(location.pathname, qs)) {
      location.replace(`/inscription${qs}`);
      return;
    }
  }

  const baseEl = document.createElement('base');
  if (location.protocol === 'file:') {
    let href = location.href.split(/[?#]/)[0];
    let base = href.slice(0, href.lastIndexOf('/') + 1);
    if (/\/legal\/|\/admin\//i.test(href)) {
      base = base.replace(/[^/]+\/$/, '');
    }
    baseEl.href = base;
  } else {
    baseEl.href = `${location.origin}/`;
  }
  document.head.prepend(baseEl);

  const FILE_PAGES = {
    '/': 'index.html',
    '/abonnements': 'abonnements.html',
    '/seance-essai': 'seance-essai.html',
    '/coachings': 'coachings.html',
    '/materiel': 'materiel.html',
    '/inscription': 'inscription.html',
    '/faq': 'faq.html',
    '/politique-confidentialite': 'legal/confidentialite.html',
    '/mon-inscription': 'mon-inscription.html',
    '/gerer-abonnement': 'gerer-abonnement.html',
    '/regulariser': 'regulariser.html',
    '/admin': 'admin/index.html',
    '/admin/contrats': 'admin/index.html',
  };

  function link(path) {
    if (!path || path.startsWith('http')) return path;
    if (location.protocol === 'file:') {
      if (FILE_PAGES[path]) return FILE_PAGES[path];
      if (path.startsWith('/api/')) return path;
      return path.replace(/^\//, '');
    }
    return path;
  }

  function asset(path) {
    return path.replace(/^\//, '');
  }

  window.BCPaths = { link, asset };

  function injectFavicon() {
    if (document.querySelector('link[rel="icon"]')) return;
    const svg = document.createElement('link');
    svg.rel = 'icon';
    svg.type = 'image/svg+xml';
    svg.href = asset('/assets/favicon.svg');
    document.head.appendChild(svg);
    const ico = document.createElement('link');
    ico.rel = 'shortcut icon';
    ico.type = 'image/x-icon';
    ico.href = asset('/assets/favicon.ico');
    document.head.appendChild(ico);
  }
  injectFavicon();

  document.addEventListener('DOMContentLoaded', () => {
    if (location.protocol !== 'file:') return;
    document.querySelectorAll('a[href^="/"]').forEach((a) => {
      const raw = a.getAttribute('href');
      const [path, hash] = raw.split('#');
      if (path.startsWith('/api/')) return;
      a.setAttribute('href', link(path) + (hash ? `#${hash}` : ''));
    });
  });
})();
