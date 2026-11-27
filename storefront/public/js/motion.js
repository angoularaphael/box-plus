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
    // Remonter, même de quelques pixels, rend le header ; descendre le replie. On mesure la
    // distance parcourue depuis le dernier changement de sens, pas l'écart entre deux événements :
    // un pavé tactile ou la fin d'un élan sur mobile envoient des pas de 1 à 2 px.
    var last = 0, dir = 0, turn = 0;
    var SHOW_AFTER = 6;
    var HIDE_AFTER = 14;
    // Cette fonction tourne à chaque événement de défilement. Elle ne recherche plus le header, le
    // menu et le hero dans la page à chaque fois, et ne remesure plus le hero : on les garde, et on
    // ne les relit que s'ils ont été remplacés (le header est rendu par layout.js) ou
    // redimensionnés. Les règles, elles, n'ont pas bougé.
    var topbar = null;
    var nav = null;
    var hero = null;
    var heroH = -1;
    var heroRO = null;
    function getTopbar() {
      if (!topbar || !topbar.isConnected) {
        topbar = document.querySelector('.topbar');
        nav = null;
      }
      return topbar;
    }
    function navOpen() {
      if (!nav || !nav.isConnected) nav = document.querySelector('.main-nav');
      return !!(nav && nav.classList.contains('open'));
    }
    function heroHeight() {
      if (!hero || !hero.isConnected) {
        hero = document.querySelector('.hero--cinema');
        heroH = -1;
        if (heroRO) heroRO.disconnect();
        if (hero && 'ResizeObserver' in window) {
          // Le navigateur prévient quand le hero change de hauteur : la mesure est déjà faite.
          if (!heroRO) heroRO = new ResizeObserver(function () { if (hero) heroH = hero.offsetHeight; });
          heroRO.observe(hero);
        }
      }
      if (!hero) return -1;
      if (heroH < 0 || !heroRO) heroH = hero.offsetHeight;
      return heroH;
    }
    function scrollThreshold() {
      if (!document.body.classList.contains('home-cinema')) return 48;
      var h = heroHeight();
      if (h < 0) return 80;
      // Passe en header clair seulement après ~55% du hero (évite flash blanc au load)
      return Math.max(120, Math.round(h * 0.55));
    }
    function apply() {
      var bar = getTopbar();
      if (!bar) return;
      var y = window.scrollY || window.pageYOffset || 0;
      var scrolled = y > scrollThreshold();
      bar.classList.toggle('scrolled', scrolled);
      var d = y - last;
      if (d !== 0) {
        var nd = d > 0 ? 1 : -1;
        if (nd !== dir) {
          dir = nd;
          turn = last;
        }
      }
      if (y <= 200 || navOpen()) {
        bar.classList.remove('nav-hidden');
      } else if (dir > 0 && y - turn > HIDE_AFTER) {
        bar.classList.add('nav-hidden');
      } else if (dir < 0 && turn - y > SHOW_AFTER) {
        bar.classList.remove('nav-hidden');
      }
      last = y;
    }
    function remeasure() {
      // La fenêtre a changé : la hauteur du hero se relit tout de suite, comme avant.
      heroH = -1;
      apply();
    }
    apply();
    window.addEventListener('scroll', apply, { passive: true });
    window.addEventListener('pageshow', remeasure);
    window.addEventListener('resize', remeasure);
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
    var vids = document.querySelectorAll(
      'video[data-ambient], .hero__video, .page-hero__video, .offer-sheet__bg video, .offer-editorial__hero-img, .scrub-band__video'
    );
    if (!vids.length) return;
    vids.forEach(function (v) {
      if (v.id === 'webcamPreview' || v.hasAttribute('data-scrub-video')) return;
      v.classList.add('bg-video');
      if (reduce) {
        v.removeAttribute('autoplay');
        v.pause();
        v.classList.add('is-playing');
        return;
      }
      v.muted = true;
      v.playsInline = true;
      var reveal = function () {
        v.classList.add('is-playing');
      };
      if (!v.paused && v.readyState >= 2) reveal();
      v.addEventListener('playing', reveal);
      var tryPlay = function () {
        var p = v.play();
        if (p && typeof p.then === 'function') p.then(reveal).catch(function () {});
      };
      var preload = String(v.getAttribute('preload') || 'metadata').toLowerCase();
      if (preload !== 'none') {
        tryPlay();
        v.addEventListener('loadeddata', tryPlay, { once: true });
        v.addEventListener('canplay', tryPlay, { once: true });
      }
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
      if (!reduce && v.id !== 'webcamPreview' && !v.hasAttribute('data-scrub-video')) io.observe(v);
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
    // Le calcul n'a pas changé : à chaque image du défilement on mesure et on calcule comme avant.
    // Ce qui change : tant que le bloc est à plus de 600 px de l'écran, on ne le déplace plus (on
    // ne le voit pas, et chaque déplacement fait retravailler toute la page) ; on retient où il en
    // serait, et il reprend cette place exacte dès qu'il approche. Et un déplacement identique au
    // précédent n'est pas réécrit.
    var FAR = 600;
    // off : le décalage que le calcul vient de donner ; drawn : celui qui est réellement appliqué.
    var items = nodes.map(function (el) { return { el: el, off: 0, drawn: 0, text: null }; });

    function update() {
      ticking = false;
      var vh = window.innerHeight || 800;
      // D'abord toutes les mesures, ensuite tous les déplacements : jamais l'un entre deux autres.
      var todo = [];
      items.forEach(function (it) {
        var el = it.el;
        // Never parallax a reveal node — fight between transforms.
        if (el.hasAttribute('data-reveal') || el.hasAttribute('data-reveal-auto')) return;
        var speed = parseFloat(el.getAttribute('data-parallax')) || 0.15;
        var rect = el.getBoundingClientRect();
        var real = rect.top + rect.height / 2;
        // Là où serait le bloc s'il avait été déplacé à chaque image : le calcul repart de là.
        var mid = it.drawn === it.off ? real : real - it.drawn + it.off;
        var offset = (mid - vh / 2) * speed * -1;
        // Loin : ni le bloc tel qu'il est posé, ni le bloc tel qu'on le poserait, n'approche à
        // moins de 600 px de l'écran.
        var reach = vh / 2 + FAR + rect.height / 2;
        var far = Math.abs(real - vh / 2) > reach && Math.abs(mid - it.off + offset - vh / 2) > reach;
        todo.push([it, offset, far]);
      });
      todo.forEach(function (t) {
        var it = t[0];
        var text = t[1].toFixed(1);
        it.off = parseFloat(text);
        // Loin de l'écran (et déjà posé une première fois), ou déjà à cette place : rien à écrire.
        if ((t[2] && it.text !== null) || text === it.text) return;
        it.el.style.transform = 'translate3d(0,' + text + 'px,0)';
        it.text = text;
        it.drawn = it.off;
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
    var shown = null;
    function update() {
      ticking = false;
      var rect = reel.getBoundingClientRect();
      var total = reel.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      var scrolled = Math.min(Math.max(-rect.top, 0), total);
      var progress = scrolled / total;
      var maxX = Math.max(0, track.scrollWidth - window.innerWidth + 40);
      // Avant et après le ruban, la position ne change plus : on ne la réécrit pas à chaque image.
      var v = 'translate3d(' + (-maxX * progress).toFixed(1) + 'px,0,0)';
      if (v === shown) return;
      shown = v;
      track.style.transform = v;
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
    var sought = -1;

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
      // Hors du bandeau, l'image voulue ne change pas (la première ou la dernière) : on ne
      // redemande pas à la vidéo de s'y rendre à chaque image du défilement.
      var t = video.duration * p;
      if (t === sought) return;
      try {
        video.currentTime = t;
        sought = t;
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
