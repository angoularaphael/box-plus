/**
 * Intro fight-night — compte à rebours de round + cloche (Web Audio).
 * Remplace l'ancienne anim gants.
 */
(function () {
  'use strict';

  var stage = document.getElementById('fightIntro');
  var hub = document.getElementById('offerChoice');
  if (!stage || !hub) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var countEl = document.getElementById('fightCount');
  var skipBtn = document.getElementById('fightSkip');
  var audioCtx = null;
  var finished = false;
  var timers = [];

  function later(fn, ms) {
    var id = window.setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function clearTimers() {
    timers.forEach(function (id) { window.clearTimeout(id); });
    timers = [];
  }

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) {
      audioCtx = null;
    }
    return audioCtx;
  }

  /** Cloche de round — court ding métallique */
  function ringBell(intensity) {
    var ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});

    var t0 = ctx.currentTime;
    var gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.22 * intensity, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55 + intensity * 0.2);

    [880, 1320, 1760].forEach(function (freq, i) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.92, t0 + 0.4);
      g.gain.setValueAtTime(0.35 / (i + 1), t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      osc.connect(g);
      g.connect(gain);
      osc.start(t0);
      osc.stop(t0 + 0.6);
    });
  }

  function thud() {
    var ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    var t0 = ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t0);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.12);
    g.gain.setValueAtTime(0.28, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.15);
  }

  function setPhase(name) {
    stage.setAttribute('data-phase', name);
  }

  function showCount(n) {
    if (!countEl) return;
    countEl.textContent = String(n);
    countEl.classList.remove('fight-intro__count--hit');
    // force reflow for re-trigger
    void countEl.offsetWidth;
    countEl.classList.add('fight-intro__count--hit');
    stage.classList.add('fight-intro--shake');
    later(function () { stage.classList.remove('fight-intro--shake'); }, 180);
    thud();
    ringBell(0.55);
    if (navigator.vibrate) {
      try { navigator.vibrate(28); } catch (_) {}
    }
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearTimers();
    setPhase('out');
    stage.classList.add('fight-intro--out');
    hub.classList.add('offer-choice--in');
    document.body.classList.add('offer-intro-done');
    later(function () {
      if (stage.parentNode) stage.parentNode.removeChild(stage);
    }, 650);
  }

  function runSequence() {
    setPhase('ready');

    later(function () {
      setPhase('round');
      ringBell(0.35);
    }, 280);

    later(function () { setPhase('count'); showCount(3); }, 900);
    later(function () { showCount(2); }, 1550);
    later(function () { showCount(1); }, 2200);

    later(function () {
      setPhase('go');
      ringBell(1.1);
      if (navigator.vibrate) {
        try { navigator.vibrate([40, 30, 70]); } catch (_) {}
      }
    }, 2850);

    later(finish, 3800);
  }

  function unlockAudioOnce() {
    ensureAudio();
    document.removeEventListener('pointerdown', unlockAudioOnce);
    document.removeEventListener('keydown', unlockAudioOnce);
  }

  function run() {
    document.addEventListener('pointerdown', unlockAudioOnce, { once: true, passive: true });
    document.addEventListener('keydown', unlockAudioOnce, { once: true });

    if (skipBtn) {
      skipBtn.addEventListener('click', function () {
        unlockAudioOnce();
        finish();
      });
    }

    if (reduce) {
      finish();
      return;
    }

    runSequence();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
