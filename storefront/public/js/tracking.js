/**
 * Tracking conversions + analytics first-party BOXPLUS
 */
(function () {
  if (window.BCTrack) return;
  if (/^\/admin(\/|$)/i.test(location.pathname)) return;

  var CLE_SRC = 'bc_ff_src';

  function lireSrc() {
    var brut = '';
    try {
      brut = String(new URLSearchParams(location.search).get('src') || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 12);
    } catch {
      brut = '';
    }
    if (brut) {
      try {
        localStorage.setItem(CLE_SRC, brut);
      } catch {
        /* ignore */
      }
      return brut;
    }
    try {
      return String(localStorage.getItem(CLE_SRC) || '')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 12);
    } catch {
      return '';
    }
  }

  function visitorId() {
    const key = 'bc_vid';
    const match = document.cookie.match(/(?:^|;\s*)bc_vid=([^;]*)/);
    if (match && match[1] && match[1].length >= 8) return decodeURIComponent(match[1]);
    const id =
      (crypto.randomUUID && crypto.randomUUID()) ||
      `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    document.cookie = `${key}=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try {
      localStorage.setItem(key, id);
    } catch {
      /* ignore */
    }
    return id;
  }

  function post(bodyObj) {
    const body = JSON.stringify({ ...bodyObj, vid: visitorId() });
    const send = () =>
      fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    try {
      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon('/api/analytics/event', new Blob([body], { type: 'application/json' }));
        if (!ok) send();
        return;
      }
    } catch {
      /* fallback fetch */
    }
    send();
  }

  function track(event, props) {
    if (typeof window.plausible === 'function') {
      window.plausible(event, { props });
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', event, props || {});
    }
    const src = lireSrc();
    post({
      type: 'event',
      name: event,
      props: { ...(props || {}), src: src || undefined },
      path: location.pathname + location.search,
    });
  }

  function pageview() {
    const src = lireSrc();
    post({
      type: 'pageview',
      path: location.pathname + location.search,
      referrer: document.referrer || '',
      props: src ? { src } : {},
    });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-track]');
    if (btn) track(btn.dataset.track, { label: btn.textContent?.trim() });
  });

  document.querySelectorAll('.offer-card .btn, .decision-card').forEach((el) => {
    el.addEventListener('click', () => track('select_offer', { href: el.getAttribute('href') }));
  });

  pageview();

  window.BCTrack = { track, pageview };
})();
