/**
 * Boxing Center — motion engine (vanilla, dependency-free).
 * Scroll reveals · sticky-header state · count-ups · ambient video · magnetic CTAs.
 *
 * Discipline (from the design language):
 *  - No-JS = everything visible (hidden state gated behind `.has-motion`).
 *  - Respects prefers-reduced-motion (no transforms, instant reveal).
 *  - 60fps: opacity/transform only, rAF-throttled.
 *  - Desktop-only micro-interactions via (pointer: fine).
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(pointer: fine)').matches;
  if (!reduce) root.classList.add('has-motion');

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  /* ---- sticky header: shadow when scrolled, hide on scroll-down, reveal on scroll-up ---- */
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
        topbar.classList.add('nav-hidden');       // scrolling down → hide
      } else if (y < last - 3) {
        topbar.classList.remove('nav-hidden');     // scrolling up → reveal
      }
      last = y;
    }
    apply();
    window.addEventListener('scroll', apply, { passive: true });
  }

  /* ---- scroll reveals ---- */
  function initReveals() {
    // auto-enrol common static blocks so the whole page breathes
    document.querySelectorAll('.section-head, .cta-band').forEach(function (el) {
      if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal-auto', '');
    });

    var els = document.querySelectorAll('[data-reveal], [data-reveal-auto]');
    if (!els.length) return;

    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }

    // stagger children inside any [data-reveal-group]
    document.querySelectorAll('[data-reveal-group]').forEach(function (group) {
      group.querySelectorAll('[data-reveal]').forEach(function (el, i) {
        el.style.transitionDelay = Math.min(i * 0.08, 0.6) + 's';
      });
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(function (el) { io.observe(el); });

    // failsafe — never leave content hidden
    window.setTimeout(function () {
      els.forEach(function (el) { el.classList.add('in'); });
    }, 2600);
  }

  /* ---- count-up numbers ([data-count], optional [data-count-suffix]) ---- */
  function initCounts() {
    var els = document.querySelectorAll('[data-count]');
    if (!els.length) return;
    els.forEach(function (el) {
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

  /* ---- ambient <video data-ambient>: play only while visible (perf/battery) ---- */
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

  /* ---- magnetic CTAs (desktop, fine pointer, motion on) ---- */
  function initMagnetic() {
    if (!fine || reduce) return;
    document.querySelectorAll('[data-magnetic]').forEach(function (el) {
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

  ready(function () {
    initHeader();
    initReveals();
    initCounts();
    initAmbientVideo();
    initMagnetic();
  });
})();
