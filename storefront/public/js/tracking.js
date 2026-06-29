/**
 * Tracking conversions — Plausible / GTM compatible
 */
(function () {
  function track(event, props) {
    if (typeof window.plausible === 'function') {
      window.plausible(event, { props });
    }
    if (typeof window.gtag === 'function') {
      window.gtag('event', event, props || {});
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-track]');
    if (btn) track(btn.dataset.track, { label: btn.textContent?.trim() });
  });

  document.querySelectorAll('.offer-card .btn, .decision-card').forEach((el) => {
    el.addEventListener('click', () => track('select_offer', { href: el.getAttribute('href') }));
  });

  window.BCTrack = { track };
})();
