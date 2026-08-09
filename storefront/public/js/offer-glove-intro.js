/**
 * Intro gants — inspirée de offre-d-été (sans Three.js / GSAP).
 * Coups de poing → étincelles → logo → révèle le choix 259 / 29.
 */
(function () {
  'use strict';

  var stage = document.getElementById('gloveIntro');
  var hub = document.getElementById('offerChoice');
  if (!stage || !hub) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var left = document.getElementById('gloveLeft');
  var right = document.getElementById('gloveRight');
  var logo = document.getElementById('gloveLogo');
  var canvas = document.getElementById('gloveSparks');
  var ctx = canvas ? canvas.getContext('2d') : null;
  var particles = [];
  var running = true;

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
    canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    if (ctx) ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  }

  function spawnSparks(n) {
    var cx = window.innerWidth / 2;
    var cy = window.innerHeight * 0.46;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = 2 + Math.random() * 9;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 2,
        life: 1,
        size: 1.5 + Math.random() * 3.5,
        color: Math.random() > 0.45 ? '#E8001C' : '#C8902F',
      });
    }
  }

  function tick() {
    if (!ctx || !running) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.28;
      p.vx *= 0.985;
      p.life -= 0.02;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(tick);
  }

  function finish() {
    stage.classList.add('glove-intro--out');
    hub.classList.add('offer-choice--in');
    document.body.classList.add('offer-intro-done');
    window.setTimeout(function () {
      running = false;
      if (stage.parentNode) stage.parentNode.removeChild(stage);
    }, 700);
  }

  function run() {
    resize();
    window.addEventListener('resize', resize, { passive: true });
    if (reduce) {
      finish();
      return;
    }
    requestAnimationFrame(tick);
    stage.classList.add('glove-intro--ready');
    window.setTimeout(function () {
      stage.classList.add('glove-intro--clash');
      spawnSparks(90);
      if (navigator.vibrate) try { navigator.vibrate(40); } catch (_) {}
    }, 700);
    window.setTimeout(function () {
      spawnSparks(50);
      if (logo) logo.classList.add('glove-intro__logo--in');
    }, 980);
    window.setTimeout(finish, 2100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
