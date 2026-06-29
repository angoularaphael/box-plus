/**
 * Base URL + liens compatibles file:// et serveur Express
 */
(function () {
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
    '/admin': 'admin/index.html',
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
