/**
 * Lazy background video — poster first, YouTube iframe only when near viewport.
 * Keeps initial page load light (no third-party embed on first paint).
 */
(function () {
  'use strict';

  function buildYoutubeSrc(id) {
    var q = [
      'autoplay=1',
      'mute=1',
      'loop=1',
      'playlist=' + id,
      'controls=0',
      'showinfo=0',
      'rel=0',
      'modestbranding=1',
      'playsinline=1',
      'disablekb=1',
      'iv_load_policy=3',
    ].join('&');
    return 'https://www.youtube-nocookie.com/embed/' + id + '?' + q;
  }

  function loadWrap(wrap) {
    if (wrap.dataset.lazyLoaded) return;
    wrap.dataset.lazyLoaded = '1';
    var id = wrap.getAttribute('data-youtube-id');
    if (!id) return;
    var iframe = document.createElement('iframe');
    iframe.src = buildYoutubeSrc(id);
    iframe.title = '';
    iframe.tabIndex = -1;
    iframe.setAttribute('allow', 'autoplay; encrypted-media');
    wrap.appendChild(iframe);
    wrap.classList.add('lazy-video-bg--loaded');
  }

  function init() {
    var wraps = document.querySelectorAll('[data-lazy-video]');
    if (!wraps.length) return;

    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            loadWrap(entry.target);
            obs.unobserve(entry.target);
          });
        },
        { rootMargin: '120px 0px', threshold: 0.01 }
      );
      wraps.forEach(function (w) {
        obs.observe(w);
      });
    } else {
      setTimeout(function () {
        wraps.forEach(loadWrap);
      }, 2500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
