/**
 * Boxing Center — motion engine (vanilla, dependency-free).
 * Scroll reveals · sticky-header state · count-ups · ambient video · magnetic CTAs.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(pointer: fine)').matches;
  if (!reduce) root.classList.add('has-motion');

  var revealObserver = null;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function observeReveals(els) {
    if (!els.length) return;

    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }

    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            revealObserver.unobserve(e.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    }

    els.forEach(function (el) {
      if (el.classList.contains('in') || el.dataset.revealBound === '1') return;
      el.dataset.revealBound = '1';
      revealObserver.observe(el);
    });
  }

  function initHeader() {
    var topbar, last = 0;
    function apply() {
      topbar = topbar || document.querySelector('.topbar');
      if (!topbar) return;
      var y = window.scrollY;
      topbar.classList.toggle('scrolled', y > 16);
      if (document.querySelector('.main-nav.open') || y <= 200) {
        topbar.classList.remove('nav-hidden');
      } else if (y > last + 3) {
        topbar.classList.add('nav-hidden');
      } else if (y < last - 3) {
        topbar.classList.remove('nav-hidden');
      }
      last = y;
    }
    apply();
    window.addEventListener('scroll', apply, { passive: true });
  }

  function initReveals() {
    document.querySelectorAll('.section-head, .cta-band').forEach(function (el) {
      if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal-auto', '');
    });

    document.querySelectorAll('[data-reveal-group]').forEach(function (group) {
      group.querySelectorAll('[data-reveal]').forEach(function (el, i) {
        if (!el.style.transitionDelay) {
          el.style.transitionDelay = Math.min(i * 0.08, 0.6) + 's';
        }
      });
    });

    observeReveals(document.querySelectorAll('[data-reveal], [data-reveal-auto]'));

    window.setTimeout(function () {
      document.querySelectorAll('[data-reveal], [data-reveal-auto]').forEach(function (el) {
        el.classList.add('in');
      });
    }, 2600);
  }

  function refresh() {
    document.querySelectorAll('[data-reveal-group]').forEach(function (group) {
      group.querySelectorAll('[data-reveal]').forEach(function (el, i) {
        if (!el.style.transitionDelay) {
          el.style.transitionDelay = Math.min(i * 0.08, 0.6) + 's';
        }
      });
    });
    observeReveals(document.querySelectorAll('[data-reveal]:not(.in), [data-reveal-auto]:not(.in)'));
  }

  function initCounts() {
    var els = document.querySelectorAll('[data-count]');
    if (!els.length) return;
    els.forEach(function (el) {
      if (el.dataset.countBound === '1') return;
      el.dataset.countBound = '1';
      var target = parseFloat(el.getAttribute('data-count')) || 0;
      var suffix = el.getAttribute('data-count-suffix') || '';
      if (reduce || !('IntersectionObserver' in window)) {
        el.textContent = target + suffix;
        return;
      }
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var start = null, dur = 1500;
          requestAnimationFrame(function loop(ts) {
            if (start === null) start = ts;
            var p = Math.min(1, (ts - start) / dur);
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(target * eased) + suffix;
            if (p < 1) requestAnimationFrame(loop);
          });
          io.unobserve(e.target);
        });
      }, { threshold: 0.6 });
      io.observe(el);
    });
  }

  function initAmbientVideo() {
    var vids = document.querySelectorAll('video[data-ambient]');
    if (!vids.length || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) { v.play().catch(function () {}); }
        else v.pause();
      });
    }, { threshold: 0.05 });
    vids.forEach(function (v) { io.observe(v); });
  }

  function initMagnetic() {
    if (!fine || reduce) return;
    document.querySelectorAll('[data-magnetic]').forEach(function (el) {
      if (el.dataset.magneticBound === '1') return;
      el.dataset.magneticBound = '1';
      var strength = parseFloat(el.getAttribute('data-magnetic')) || 0.3;
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var mx = e.clientX - (r.left + r.width / 2);
        var my = e.clientY - (r.top + r.height / 2);
        el.style.transform = 'translate(' + (mx * strength).toFixed(1) + 'px,' + (my * strength).toFixed(1) + 'px)';
      });
      el.addEventListener('pointerleave', function () { el.style.transform = ''; });
    });
  }

  function initHoverLift() {
    if (reduce) return;
    document.querySelectorAll('.decision-card, .testimonial-card, .gear-card').forEach(function (el) {
      el.classList.add('hover-lift');
    });
  }

  ready(function () {
    initHeader();
    initReveals();
    initCounts();
    initAmbientVideo();
    initMagnetic();
    initHoverLift();
  });

  window.BCMotion = { refresh };
})();
