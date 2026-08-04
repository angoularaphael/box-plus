/**
 * Tracking conversions + analytics first-party BOXPLUS
 */
(function () {
  function track(event, props) {
    if (typeof window.plausible === 'function') {
      window.plausible(event, { props });
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', event, props || {});
    }
    try {
      const body = JSON.stringify({
        type: 'event',
        name: event,
        props: props || {},
        path: location.pathname,
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics/event', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }

  function pageview() {
    try {
      const body = JSON.stringify({
        type: 'pageview',
        path: location.pathname + location.search,
        referrer: document.referrer || '',
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics/event', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
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
