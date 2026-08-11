/**
 * Boxing Center — motion engine (vanilla, dependency-free).
 * Scroll reveals · sticky-header · count-ups · ambient video · magnetic CTAs
 * · parallax · disciplines reel · scroll-scrub video.
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
    function scrollThreshold() {
      if (!document.body.classList.contains('home-cinema')) return 48;
      var hero = document.querySelector('.hero--cinema');
      if (!hero) return 80;
      // Passe en header clair seulement après ~55% du hero (évite flash blanc au load)
      return Math.max(120, Math.round(hero.offsetHeight * 0.55));
    }
    function apply() {
      topbar = topbar || document.querySelector('.topbar');
      if (!topbar) return;
      var y = window.scrollY || window.pageYOffset || 0;
      var scrolled = y > scrollThreshold();
      topbar.classList.toggle('scrolled', scrolled);
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
    window.addEventListener('pageshow', apply);
    window.addEventListener('resize', apply);
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
    initCounts();
    initMagnetic();
    initHoverLift();
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
          var start = null;
          var dur = 1500;
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
    if (!vids.length) return;
    vids.forEach(function (v) {
      if (reduce) {
        v.removeAttribute('autoplay');
        v.pause();
        return;
      }
      v.muted = true;
      v.playsInline = true;
      var tryPlay = function () {
        v.play().catch(function () {});
      };
      tryPlay();
      v.addEventListener('loadeddata', tryPlay, { once: true });
    });
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) {
          v.play().catch(function () {});
        } else {
          v.pause();
        }
      });
    }, { threshold: 0.05 });
    vids.forEach(function (v) {
      if (!reduce) io.observe(v);
    });
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
        el.style.transform =
          'translate(' + (mx * strength).toFixed(1) + 'px,' + (my * strength).toFixed(1) + 'px)';
      });
      el.addEventListener('pointerleave', function () {
        el.style.transform = '';
      });
    });
  }

  function initHoverLift() {
    if (reduce) return;
    document.querySelectorAll('.decision-card, .testimonial-card, .gear-card, .gym-card').forEach(function (el) {
      el.classList.add('hover-lift');
    });
  }

  function initParallax() {
    if (reduce) return;
    var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-parallax]'));
    if (!nodes.length) return;
    var ticking = false;

    function update() {
      ticking = false;
      var vh = window.innerHeight || 800;
      nodes.forEach(function (el) {
        // Never parallax a reveal node — fight between transforms.
        if (el.hasAttribute('data-reveal') || el.hasAttribute('data-reveal-auto')) return;
        var speed = parseFloat(el.getAttribute('data-parallax')) || 0.15;
        var rect = el.getBoundingClientRect();
        var mid = rect.top + rect.height / 2;
        var offset = (mid - vh / 2) * speed * -1;
        el.style.transform = 'translate3d(0,' + offset.toFixed(1) + 'px,0)';
      });
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  function initDiscReel() {
    var reel = document.querySelector('[data-disc-reel]');
    var track = document.querySelector('[data-disc-track]');
    if (!reel || !track) return;

    // Mobile: native horizontal scroll (CSS). Skip pin math.
    if (window.matchMedia('(max-width: 760px)').matches || reduce) return;

    var ticking = false;
    function update() {
      ticking = false;
      var rect = reel.getBoundingClientRect();
      var total = reel.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      var scrolled = Math.min(Math.max(-rect.top, 0), total);
      var progress = scrolled / total;
      var maxX = Math.max(0, track.scrollWidth - window.innerWidth + 40);
      track.style.transform = 'translate3d(' + (-maxX * progress).toFixed(1) + 'px,0,0)';
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  function initScrub() {
    var band = document.querySelector('[data-scrub]');
    var video = document.querySelector('[data-scrub-video]');
    if (!band || !video) return;

    if (reduce) {
      video.removeAttribute('autoplay');
      return;
    }

    var ready = false;
    var ticking = false;

    function seek() {
      ticking = false;
      if (!ready || !video.duration) return;
      var rect = band.getBoundingClientRect();
      var view = window.innerHeight || 800;
      var start = view * 0.85;
      var end = view * 0.15;
      var span = start - end;
      if (span <= 0) return;
      var p = (start - rect.top) / span;
      p = Math.min(1, Math.max(0, p));
      try {
        video.currentTime = video.duration * p;
      } catch (_) { /* ignore seek race */ }
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(seek);
      }
    }

    function arm() {
      ready = true;
      video.pause();
      seek();
    }

    if (video.readyState >= 1) arm();
    else video.addEventListener('loadedmetadata', arm, { once: true });

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
  }

  ready(function () {
    initHeader();
    initReveals();
    initCounts();
    initAmbientVideo();
    initMagnetic();
    initHoverLift();
    initParallax();
    initDiscReel();
    initScrub();
  });

  window.BCMotion = { refresh: refresh };
})();
