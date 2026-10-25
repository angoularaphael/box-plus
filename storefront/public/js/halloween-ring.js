/**
 * Halloween 2026 — « La salle après la fermeture ».
 *
 * La nuit tombe sur le haut des pages vitrine. Le visiteur tient la lampe du ring (souris, doigt,
 * ou un balayage lent quand personne n'y touche). Une citrouille pend comme un sac de frappe et
 * bouge toute seule : sur le mur, là où la lampe éclaire, l'ombre d'un boxeur la frappe — et
 * personne n'est là. Il fuit la lumière. Au visiteur de frapper jusqu'au K.O. ; la cloche sonne
 * trois fois et la vraie séance d'essai apparaît (prix lu dans l'API, jamais écrit en dur).
 *
 * Chargé par layout.js pendant la fenêtre d'Halloween, jamais dans le tunnel de vente.
 * Tout vit dans le hero : rien ne recouvre un texte ou un bouton du site.
 */
(function () {
  'use strict';
  if (window.__bcHalloweenRing) return;
  window.__bcHalloweenRing = true;

  const doc = document;
  const root = doc.documentElement;
  const hero = doc.querySelector('.hero--cinema, .page-hero');
  if (!hero) return;

  const soft = root.classList.contains('bc-halloween--soft');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const isCinema = hero.classList.contains('hero--cinema');
  root.classList.add('bc-halloween-ring');
  if (lowEnd) root.classList.add('hw-lite');

  const OFF_KEY = 'bc_halloween_off';
  const OFF_VALUE = '2026';
  const SOUND_KEY = 'bc_halloween_sound';

  /* Réglages : chaque nombre a un nom. Les durées de « game feel » viennent des jeux de combat
     (arrêt sur image de 4 à 11 images à 60 i/s selon la force du coup). */
  const CFG = {
    nightAlpha: isCinema ? 0.56 : hero.classList.contains('page-hero--video') ? 0.5 : 0.42,
    lightRadius: [130, 250],
    lightFollow: 9,
    idleMs: 2600,
    projection: 1.32,
    bagPeriod: 1.75,
    bagDamping: 0.9,
    bounceStiffness: 210,
    bounceDamping: 9,
    maxHp: 20,
    // Un sac lourd se balance peu : on plafonne l'énergie du pendule à ~24°, et toute la course
    // de ce balancement doit tenir hors des textes.
    maxSwing: 0.42,
    koDamping: 3.4,
    comboWindowMs: 430,
    hitStop: { jab: 60, direct: 85, crochet: 100, uppercut: 120, ko: 190 },
    shakePx: { jab: 3, direct: 4, crochet: 5, uppercut: 6, ko: 9 },
    traumaDecay: 1.8,
    flingSpeed: 1.35,
    flingCooldownMs: 150,
    ghostCaughtMs: 1100,
    ghostReturnMs: 5200,
    ghostOpacity: 0.9,
    hintDelayMs: 3400,
    // Carte de fin : la première formule reste lisible 3,6 s avant que la carte soit possédée.
    offerShiftMs: 3600,
    curseSwapMs: 780,
    curseEndMs: 1320,
  };

  const HITS = {
    jab: { label: 'Jab', dmg: 1, impulse: 1.25, bounce: 0 },
    direct: { label: 'Direct', dmg: 2, impulse: 1.9, bounce: 0 },
    crochet: { label: 'Crochet', dmg: 2, impulse: 2.5, bounce: 0 },
    uppercut: { label: 'Uppercut', dmg: 3, impulse: 0.6, bounce: -340 },
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* stockage bloqué */ } },
  };
  const track = (name, props) => {
    try { if (window.BCTrack) window.BCTrack.track(name, props || {}); } catch (e) { /* suivi facultatif */ }
  };
  const link = (p) => (window.BCPaths && window.BCPaths.link ? window.BCPaths.link(p) : p);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const now = () => performance.now();
  const el = (tag, cls, html) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  /* ---------- Dessins ---------- */

  function pumpkinSvg() {
    const face = soft
      ? '<circle cx="60" cy="104" r="10"/><circle cx="100" cy="104" r="10"/>' +
        '<path d="M76 121h8l-4 7z"/>' +
        '<path d="M50 138c10 22 50 22 60 0-6 18-18 28-30 28s-24-10-30-28z"/>'
      : '<path d="M47 93l27 11-14 13z"/><path d="M113 93l-27 11 14 13z"/>' +
        '<path d="M75 121h10l-5 9z"/>' +
        '<path d="M42 139c16 9 60 9 76 0-6 22-22 33-38 33s-32-11-38-33z"/>';
    const guard = soft
      ? '<path d="M58 148c12 9 32 9 44 0-5 10-13 15-22 15s-17-5-22-15z"/>'
      : '<path d="M52 150c16 11 40 11 56 0-6 13-16 19-28 19s-22-6-28-19z"/>';
    return (
      '<svg class="hw-pumpkin" viewBox="0 0 160 202" aria-hidden="true" focusable="false">' +
      '<defs>' +
      '<radialGradient id="hwSkin" cx="36%" cy="32%" r="78%">' +
      '<stop offset="0" stop-color="#FFA54A"/><stop offset=".52" stop-color="#E7640F"/><stop offset="1" stop-color="#8F3405"/>' +
      '</radialGradient>' +
      '<radialGradient id="hwFire" cx="50%" cy="58%" r="62%">' +
      '<stop offset="0" stop-color="#FFF7CF"/><stop offset=".45" stop-color="#FFC233"/><stop offset="1" stop-color="#FF6A00"/>' +
      '</radialGradient>' +
      '<linearGradient id="hwGuard" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#FF3B4E"/><stop offset="1" stop-color="#B80016"/>' +
      '</linearGradient>' +
      '</defs>' +
      // Les quatre chaînes d'un vrai sac de frappe, réunies sur l'émerillon.
      '<g fill="none" stroke="#2a2f3b" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="5 2.6">' +
      '<path d="M80 6L36 54"/><path d="M80 6L60 44"/><path d="M80 6L100 44"/><path d="M80 6L124 54"/>' +
      '</g>' +
      '<circle cx="80" cy="6" r="5" fill="none" stroke="#3a404d" stroke-width="3"/>' +
      '<g fill="url(#hwSkin)">' +
      '<ellipse cx="42" cy="122" rx="34" ry="72"/><ellipse cx="118" cy="122" rx="34" ry="72"/>' +
      '<ellipse cx="62" cy="121" rx="36" ry="78"/><ellipse cx="98" cy="121" rx="36" ry="78"/>' +
      '<ellipse cx="80" cy="121" rx="38" ry="80"/>' +
      '</g>' +
      '<g fill="none" stroke="rgba(92,30,3,.38)" stroke-width="2">' +
      '<path d="M60 46c-14 40-14 110 0 150"/><path d="M100 46c14 40 14 110 0 150"/>' +
      '<path d="M80 41v160" stroke="rgba(92,30,3,.22)"/>' +
      '</g>' +
      '<g class="hw-lid">' +
      '<path d="M54 55c16-12 36-12 52 0" fill="none" stroke="#5c2404" stroke-width="2.2"/>' +
      '<path d="M73 52c-3-12 1-22 13-27-3 8-1 18 1 27z" fill="#4F5D24"/>' +
      '</g>' +
      '<g class="hw-face" fill="url(#hwFire)">' + face + '</g>' +
      // Le protège-dents rouge du club, dans le sourire.
      '<g class="hw-guard" fill="url(#hwGuard)">' + guard + '</g>' +
      '<g fill="none" stroke="#3f1702" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
      '<path class="hw-crack hw-crack--1" d="M36 76l11 13-7 10 13 12"/>' +
      '<path class="hw-crack hw-crack--2" d="M126 150l-13 8 5 12-11 11"/>' +
      '<path class="hw-crack hw-crack--3" d="M98 60l-7 16 9 8-5 15"/>' +
      '</g>' +
      '</svg>'
    );
  }

  // Même silhouette, sans couleur : c'est elle qui devient l'ombre sur le mur.
  const PUMPKIN_SHADOW =
    '<svg viewBox="0 0 160 202" width="100%" height="100%" aria-hidden="true" focusable="false">' +
    '<g fill="none" stroke="#04050a" stroke-width="3"><path d="M80 6L36 54"/><path d="M80 6L124 54"/></g>' +
    '<g fill="#04050a"><ellipse cx="42" cy="122" rx="34" ry="72"/><ellipse cx="118" cy="122" rx="34" ry="72"/>' +
    '<ellipse cx="80" cy="121" rx="40" ry="80"/><path d="M73 52c-3-12 1-22 13-27-3 8-1 18 1 27z"/></g></svg>';

  /* Le boxeur que personne ne voit : un squelette de traits épais, des gants ronds. En ombre floue,
     des formes simples se lisent mieux qu'un dessin détaillé. Pieds en (0,0), regard vers +x. */
  const GHOST_SVG =
    '<svg viewBox="-150 -300 300 312" aria-hidden="true" focusable="false">' +
    '<g fill="none" stroke="#04050a" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline class="g-leg-r" stroke-width="34" points="0,0 0,0 0,0"/>' +
    '<polyline class="g-leg-l" stroke-width="34" points="0,0 0,0 0,0"/>' +
    '<line class="g-arm-r1" stroke-width="25"/><line class="g-arm-r2" stroke-width="22"/>' +
    '</g>' +
    '<path class="g-torso" fill="#04050a" stroke="#04050a" stroke-width="14" stroke-linejoin="round"/>' +
    '<circle class="g-head" r="22" fill="#04050a"/>' +
    '<circle class="g-glove-r" r="18" fill="#04050a"/>' +
    '<g fill="none" stroke="#04050a" stroke-linecap="round">' +
    '<line class="g-arm-l1" stroke-width="25"/><line class="g-arm-l2" stroke-width="22"/>' +
    '</g>' +
    '<circle class="g-glove-l" r="19" fill="#04050a"/>' +
    '</svg>';

  // Liseré orangé dessiné dans la forme (lueur de la bougie) : pas de filtre recalculé en vol.
  const BAT_SVG =
    '<svg viewBox="-2 -2 68 32" aria-hidden="true" focusable="false"><path fill="#0d0a14" stroke="rgba(255,140,0,.55)" stroke-width="1.6" stroke-linejoin="round" d="M32 14C28 6 20 3 12 6c4 2 6 5 6 7-6 2-12 2-18 0 6 5 14 7 22 5-2 3-2 7-6 9 6-2 10-5 12-9 2 4 6 7 12 9-4-2-4-6-6-9 8 2 16 0 22-5-6 2-12 2-18 0 0-2 2-5 6-7-8-3-16 0-20 8z"/></svg>';

  const ICONS = {
    soundOff:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>',
    soundOn:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></svg>',
    lights:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0012 2z"/></svg>',
    pumpkin:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4F5D24" d="M11 4c0-1.6 1-2.6 2.6-3-.5 1.2-.4 2.2-.1 3z"/><ellipse cx="7.5" cy="14" rx="5.5" ry="8" fill="#E7640F"/><ellipse cx="16.5" cy="14" rx="5.5" ry="8" fill="#E7640F"/><ellipse cx="12" cy="14" rx="6" ry="9" fill="#F57A1F"/><path fill="#FFC233" d="M8 12l3 1-2 2zM16 12l-3 1 2 2zM8 17c2 1.5 6 1.5 8 0-1 2.5-3 3.5-4 3.5s-3-1-4-3.5z"/></svg>',
  };

  /* ---------- Son : tout est synthétisé, aucun fichier. Coupé par défaut. ---------- */

  const sound = {
    on: store.get(SOUND_KEY) === '1',
    ctx: null,
    noise: null,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        const len = Math.floor(this.ctx.sampleRate * 0.25);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    thud(power) {
      if (!this.on) return;
      const ac = this.ensure();
      if (!ac) return;
      const t = ac.currentTime;
      const out = ac.createGain();
      out.gain.value = 0.38 + 0.32 * power;
      out.connect(ac.destination);
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1300, t);
      lp.frequency.exponentialRampToValueAtTime(220, t + 0.14);
      const ng = ac.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      src.connect(lp).connect(ng).connect(out);
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120 - 20 * power, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      const og = ac.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(1, t + 0.006);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(og).connect(out);
      src.start(t);
      src.stop(t + 0.25);
      osc.start(t);
      osc.stop(t + 0.25);
    },
    bell(delay) {
      if (!this.on) return;
      const ac = this.ensure();
      if (!ac) return;
      const t = ac.currentTime + (delay || 0);
      const base = 1046;
      [[1, 0.5, 1.6], [2.0, 0.22, 1.1], [2.76, 0.16, 0.9], [5.4, 0.07, 0.45]].forEach(([mult, gain, decay]) => {
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.value = base * mult;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + decay + 0.05);
      });
    },
  };

  /* ---------- État ---------- */

  const S = {
    w: 0, h: 0, rect: null, topOffset: 0,
    mode: 'light',
    running: false, raf: 0, last: 0,
    nightMul: 1, fade: null,
    light: { x: 0, y: 0, tx: 0, ty: 0, r: 180, lastInput: -1e9, touching: false, sweepT: rand(0, 40) },
    pointer: { x: 0, y: 0, t: 0, vx: 0, vy: 0, lastFling: 0, inside: false },
    bag: {
      px: 0, py: 0, chain: 0, bw: 0, bh: 0, scale: 1,
      theta: 0.18, omega: 0, y: 0, vy: 0,
      squash: 0, squashV: 0, freezeUntil: 0, pending: null,
      hp: CFG.maxHp, round: 1, ko: false, koAt: 0, respawnAt: 0, drop: 0,
      punches: 0, combo: 0, lastHit: -1e9, lastPointerHit: -1e9, glow: 1, flare: 0, hasBeenHit: false,
    },
    ghost: {
      state: soft || reduce ? 'off' : 'training', alpha: 0, stateAlpha: 1, seen: 0, away: 0, turn: 1,
      x: 0, y: 0, H: 220, s: 1, seg: 0, segT: 0, pose: null, from: null, wait: 0, timeline: null,
    },
    trauma: 0, shakeX: 0, shakeY: 0,
    particles: [], bats: [],
    hint: { shown: false, at: 0 },
    price: null,
  };

  /* ---------- Construction ---------- */

  let back, front, canvas, ctx, fogA, fogB, shadowBag, shadowBagSwing, shadowChain, shadowGhost;
  let bagEl, swingEl, chainEl, bodyEl, hitEl, faceEl, glowEl, hud, hpFill, hpTrail, roundEl, hintEl, scrim, card, controls;
  let ghostParts = null;
  let ro = null;
  let io = null;

  function build() {
    back = el('div', 'hw-back');
    back.setAttribute('aria-hidden', 'true');
    fogA = el('div', 'hw-fog');
    fogB = el('div', 'hw-fog hw-fog--b');
    const shadows = el('div', 'hw-shadows');
    shadowBag = el('div', 'hw-shadow hw-shadow--bag');
    shadowBagSwing = el('div', 'hw-swing');
    shadowChain = el('div', '');
    shadowChain.style.cssText = 'position:absolute;left:-2px;top:0;width:4px;background:#04050a';
    const shadowPumpkin = el('div', 'hw-body', PUMPKIN_SHADOW);
    shadowBagSwing.append(shadowChain, shadowPumpkin);
    shadowBag.append(shadowBagSwing);
    shadowGhost = el('div', 'hw-shadow hw-shadow--ghost', GHOST_SVG);
    shadows.append(shadowBag, shadowGhost);
    canvas = el('canvas', 'hw-night');
    ctx = canvas.getContext('2d');
    back.append(fogA, fogB, shadows, canvas);
    if (lowEnd) fogB.remove();

    front = el('div', 'hw-front');
    bagEl = el('div', 'hw-bag');
    swingEl = el('div', 'hw-swing');
    chainEl = el('div', 'hw-chain');
    bodyEl = el('div', 'hw-body');
    glowEl = el('div', 'hw-glow');
    hitEl = el('button', 'hw-hit', pumpkinSvg());
    hitEl.type = 'button';
    hitEl.setAttribute('aria-label', soft ? 'Frapper la citrouille (jeu)' : "Frapper la citrouille — jeu d'Halloween");
    faceEl = hitEl.querySelector('.hw-face');
    bodyEl.append(glowEl, hitEl);
    swingEl.append(chainEl, bodyEl);
    bagEl.append(swingEl);

    hud = el(
      'div',
      'hw-hud',
      '<div class="hw-hp"><span>Citrouille</span><span class="hw-hp__bar"><span class="hw-hp__trail"></span><span class="hw-hp__fill"></span></span><span class="hw-round">R1</span></div>'
    );
    hpFill = hud.querySelector('.hw-hp__fill');
    hpTrail = hud.querySelector('.hw-hp__trail');
    roundEl = hud.querySelector('.hw-round');

    hintEl = el(
      'div',
      'hw-hint',
      soft ? 'Une citrouille pendue comme un sac…<strong>Frappe-la !</strong>' : 'Quelqu’un frappe ce sac…<strong>Frappe-le.</strong>'
    );
    hintEl.setAttribute('aria-hidden', 'true');

    card = el('div', 'hw-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Fin du round');
    scrim = el('div', 'hw-scrim');
    scrim.addEventListener('click', closeCard);

    controls = el('div', 'hw-controls');
    const soundBtn = el('button', 'hw-ctl hw-ctl--sound');
    soundBtn.type = 'button';
    const offBtn = el('button', 'hw-ctl hw-ctl--off', ICONS.lights);
    offBtn.type = 'button';
    offBtn.setAttribute('aria-label', "Rallumer la salle (couper les animations d'Halloween)");
    offBtn.title = 'Rallumer la salle';
    offBtn.dataset.track = 'halloween_off';
    controls.append(soundBtn, offBtn);
    renderSoundBtn(soundBtn);
    soundBtn.addEventListener('click', () => {
      sound.on = !sound.on;
      store.set(SOUND_KEY, sound.on ? '1' : null);
      if (sound.on) {
        sound.ensure();
        sound.thud(0.4);
      }
      renderSoundBtn(soundBtn);
      track('halloween_sound', { on: sound.on });
    });
    offBtn.addEventListener('click', () => switchOff());

    front.append(bagEl, hud, hintEl, scrim, card, controls);

    // Insertion : le fond juste au-dessus du voile, le premier plan au-dessus du contenu.
    const veil = hero.querySelector(':scope > .hero__veil');
    if (veil) veil.after(back);
    else hero.prepend(back);
    hero.append(front);

    // Un seul jeu d'écouteurs par scène : coupés d'un coup au démontage (interrupteur).
    S.ac = new AbortController();
    const on = { signal: S.ac.signal };
    const pas = { passive: true, signal: S.ac.signal };
    hitEl.addEventListener('pointerdown', onBagPointerDown, on);
    hitEl.addEventListener('click', onBagClick, on);
    hero.addEventListener('pointermove', onPointerMove, pas);
    hero.addEventListener('pointerdown', onPointerDown, pas);
    hero.addEventListener('pointerleave', () => { S.pointer.inside = false; }, pas);
    window.addEventListener('pointerup', onPointerUp, pas);
    window.addEventListener('pointercancel', onPointerUp, pas);
    window.addEventListener('scroll', updateRect, pas);
    doc.addEventListener('visibilitychange', syncRunning, on);
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card.classList.contains('is-on')) closeCard(); }, on);

    // Invisible jusqu'à la première mise en place : pas une image de citrouille dans le coin.
    back.style.visibility = 'hidden';
    front.style.visibility = 'hidden';
    ro = new ResizeObserver(() => {
      layout();
      back.style.visibility = '';
      front.style.visibility = '';
    });
    ro.observe(hero);
    io = new IntersectionObserver((entries) => {
      S.visible = entries[0].isIntersecting;
      syncRunning();
    });
    io.observe(hero);
  }

  function renderSoundBtn(btn) {
    btn.innerHTML = sound.on ? ICONS.soundOn : ICONS.soundOff;
    btn.setAttribute('aria-pressed', String(sound.on));
    btn.setAttribute('aria-label', sound.on ? 'Couper le son' : 'Activer le son du sac');
    btn.title = sound.on ? 'Couper le son' : 'Activer le son';
  }

  /* ---------- Mise en place : la citrouille ne doit jamais toucher un texte ou un bouton ---------- */

  function contentRects() {
    const hr = hero.getBoundingClientRect();
    const out = [];
    // Le contenu entre en glissant de 26 px vers le haut (motion.js) : un texte mesuré avant ou
    // pendant son entrée finira plus haut. On lui réserve cette course, sans attendre la fin.
    const lift = (n) => (n && n.closest('[data-reveal], [data-reveal-auto]') ? 26 : 0);
    const push = (r, n) => {
      if (!(r.width > 0 && r.height > 0)) return;
      const up = lift(n);
      out.push({ x: r.left - hr.left, y: r.top - hr.top - up, w: r.width, h: r.height + up });
    };
    // Les médias de fond (vidéo, image de repli) couvrent tout le hero : ce ne sont pas des obstacles.
    const skip = (n) => !n || n.closest('.hw-front, .hw-back, .hero__stage, .page-hero__video-wrap');
    // Tout texte visible est un obstacle, quel que soit son conteneur (un fil d'Ariane est souvent
    // un lien suivi de texte nu). On mesure les lignes, pas les blocs : un titre ne remplit pas sa largeur.
    const walker = doc.createTreeWalker(hero, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (t.nodeValue.trim() && !skip(t.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const range = doc.createRange();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) push(r, t.parentElement);
    }
    hero.querySelectorAll('a, button, img, .btn, input, select').forEach((n) => {
      if (!skip(n) && n.offsetWidth > 0) push(n.getBoundingClientRect(), n);
    });
    return out;
  }

  const hits = (a, b, m) => !(a.x + a.w + m < b.x || b.x + b.w + m < a.x || a.y + a.h + m < b.y || b.y + b.h + m < a.y);

  // Première position de la liste qui ne touche ni un texte, ni un bouton, ni le bord du hero.
  function freeSpot(w, h, candidates, extra, measured) {
    const obstacles = (measured || contentRects()).concat(extra || []);
    for (const [x, y] of candidates) {
      const box = { x, y, w, h };
      if (x < 8 || y < S.topOffset + 4 || x + w > S.w - 8 || y + h > S.h - 8) continue;
      if (obstacles.some((o) => hits(box, o, 10))) continue;
      return { x, y };
    }
    return null;
  }

  // Toute la course du balancement, pas seulement la position au repos.
  function swingBox(px, py, chain) {
    const b = S.bag;
    const reach = (chain + b.bh * 0.55) * Math.sin(CFG.maxSwing) + b.bw * 0.62;
    return { x: px - reach, y: py + chain - 34, w: reach * 2, h: b.bh + 40 };
  }

  function bagBox() {
    return swingBox(S.bag.px, S.bag.py, S.bag.chain);
  }

  function layout() {
    // Toutes les mesures d'abord, toutes les écritures ensuite : une seule mise en page forcée,
    // au lieu d'une par lecture intercalée (jusqu'à 230 ms sur l'accueil en cours de chargement).
    const r = hero.getBoundingClientRect();
    S.rect = r;
    // L'accueil a un header transparent posé sur la vidéo : la scène commence dessous.
    const topbar = isCinema ? doc.querySelector('#site-header .topbar') : null;
    const topH = topbar ? Math.round(topbar.getBoundingClientRect().height) : 0;
    const text = contentRects();
    if (!S.hintSize) S.hintSize = { w: hintEl.offsetWidth || 190, h: hintEl.offsetHeight || 64 };

    S.w = r.width;
    S.h = r.height;
    S.topOffset = topH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (lowEnd ? 0.35 : 0.5);
    const cw = Math.max(1, Math.round(S.w * dpr));
    const chh = Math.max(1, Math.round(S.h * dpr));
    if (canvas.width !== cw || canvas.height !== chh) {
      canvas.width = cw;
      canvas.height = chh;
    }
    S.dpr = dpr;
    S.light.r = clamp(Math.min(S.w, S.h) * 0.38, CFG.lightRadius[0], CFG.lightRadius[1]);
    front.style.setProperty('--hw-top', S.topOffset + 12 + 'px');

    const b = S.bag;
    const sizeBag = (bw) => {
      b.bw = bw;
      b.scale = bw / 160;
      b.bh = 202 * b.scale;
    };
    const ideal = clamp(S.h * 0.26, 70, 250);
    // La place des boutons se calcule (36 px chacun, 6 px d'écart) : la mesurer après chaque
    // changement de côté forçait une mise en page complète de la page.
    const ctlW = 36 * 2 + 6;
    const ctlBox = (left) => ({ x: left ? 12 : S.w - 12 - ctlW, y: S.topOffset + 12, w: ctlW, h: 36 });
    const tryPlace = () => {
      const obstacles = text.concat([ctlBox(controls.classList.contains('hw-controls--left'))]);
      for (const fx of [0.8, 0.86, 0.74, 0.9, 0.68, 0.62, 0.56]) {
        for (const f of [1, 0.8, 0.62, 0.45]) {
          const chain = ideal * f;
          const px = S.w * fx;
          const top = S.topOffset;
          const box = swingBox(px, top, chain);
          const chainBox = { x: px - 6, y: top, w: 12, h: chain };
          // Toute la course doit rester dans l'écran : une citrouille coupée au bord, c'est raté.
          if (box.x < 4 || box.x + box.w > S.w - 4 || box.y + box.h > S.h - 16) continue;
          if (obstacles.some((o) => hits(box, o, 14) || hits(chainBox, o, 6))) continue;
          return { px, py: top, chain };
        }
      }
      return null;
    };
    // Les boutons sont à droite ; s'ils prennent la seule place du sac, ils passent à gauche.
    // Sur un hero court (photo sur téléphone), une citrouille plus petite trouve encore sa place :
    // le même jeu partout, jamais une version amputée tant qu'un coin est libre.
    let placed = null;
    for (const bw of [clamp(S.w * 0.105, 92, 158), 76, 64]) {
      sizeBag(bw);
      controls.classList.remove('hw-controls--left');
      placed = tryPlace();
      if (!placed) {
        controls.classList.add('hw-controls--left');
        placed = tryPlace();
        if (!placed) controls.classList.remove('hw-controls--left');
      }
      if (placed) break;
    }

    S.mode = placed ? 'full' : 'light';
    // Sans sac, rien ne fait de bruit : pas de bouton de son inutile.
    controls.querySelector('.hw-ctl--sound').hidden = !placed;
    bagEl.hidden = !placed;
    hud.hidden = !placed;
    hintEl.hidden = !placed;
    shadowBag.hidden = !placed;
    if (placed) {
      b.px = placed.px;
      b.py = placed.py;
      b.chain = placed.chain;
      chainEl.style.height = b.chain + 'px';
      shadowChain.style.height = b.chain + 'px';
      for (const body of [bodyEl, shadowBag.querySelector('.hw-body')]) {
        body.style.width = b.bw + 'px';
        body.style.height = b.bh + 'px';
        body.style.left = -b.bw / 2 + 'px';
        body.style.top = b.chain - 6 * b.scale + 'px';
      }
      hitEl.style.width = b.bw + 'px';
      hitEl.style.height = b.bh + 'px';
      const g = b.bw * 2.1;
      glowEl.style.cssText = `width:${g}px;height:${g}px;left:${(b.bw - g) / 2}px;top:${(b.bh - g) / 2 + 22 * b.scale}px`;
    }

    // Le boxeur invisible : au sac en mode complet, seul contre son ombre sinon.
    const gh = S.ghost;
    if (placed) {
      // Assez grand pour être un homme à côté du sac, assez petit pour tenir dans la lampe.
      gh.H = clamp(Math.min(S.light.r * 1.05, b.bh * 1.75), 150, 300);
      gh.s = gh.H / 300;
      const shoulderY = b.py + b.chain + b.bh * 0.55;
      gh.y = shoulderY + 200 * gh.s;
      gh.x = b.px - b.bw * 0.46 - 122 * gh.s;
    } else {
      gh.H = clamp(S.h * 0.5, 140, 300);
      gh.s = gh.H / 300;
      gh.x = S.w * 0.76;
      gh.y = S.h * 0.88;
    }
    const svg = shadowGhost.querySelector('svg');
    svg.setAttribute('width', 300 * gh.s);
    svg.setAttribute('height', 312 * gh.s);
    svg.style.cssText = `position:absolute;left:${-150 * gh.s}px;top:${-300 * gh.s}px;overflow:visible`;

    if (!S.light.x) {
      S.light.x = S.light.tx = S.w * 0.3;
      S.light.y = S.light.ty = S.h * 0.45;
    }
    renderHud();
    placeHud(text);
    render(0);
  }

  // Au défilement, on oublie la position ; le prochain geste la relit (une lecture par défilement
  // forçait la mise en page à chaque image).
  function updateRect() {
    S.rect = null;
  }

  function placeHud(measured) {
    if (S.mode !== 'full') return;
    const b = S.bag;
    const hw = 190;
    let x = b.px - hw / 2;
    x = clamp(x, 8, S.w - hw - 8);
    hud.style.transform = `translate(${x}px, ${b.py + b.chain - 30}px)`;
    hud.style.width = hw + 'px';
    hud.firstElementChild.style.justifyContent = 'center';
    // L'indice : sous la citrouille de préférence (à gauche se tient le boxeur invisible),
    // sinon à côté, sinon au-dessus — et nulle part s'il couvrirait un texte.
    const hw2 = S.hintSize.w;
    const hh = S.hintSize.h;
    const top = b.py + b.chain;
    const spot = freeSpot(hw2, hh, [
      [b.px - hw2 / 2, top + b.bh + 30],
      [b.px + b.bw * 0.62 + 12, top + b.bh * 0.3],
      [b.px - b.bw * 0.62 - hw2 - 12, top + b.bh * 0.62],
      [b.px - hw2 / 2, top - 30 - hh - 10],
    ], [bagBox()], measured);
    S.hint.ok = !!spot;
    if (spot) hintEl.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
    // Les polices arrivent après coup et le titre grandit : un indice déjà affiché se retire.
    else hintEl.classList.remove('is-on');
  }

  /* ---------- Entrées ---------- */

  function local(e) {
    const r = S.rect || (S.rect = hero.getBoundingClientRect());
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerMove(e) {
    const p = local(e);
    const t = now();
    const P = S.pointer;
    const dt = Math.max(1, t - P.t);
    P.vx = (p.x - P.x) / dt;
    P.vy = (p.y - P.y) / dt;
    P.x = p.x;
    P.y = p.y;
    P.t = t;
    P.inside = true;
    if (e.pointerType === 'touch' && !S.light.touching) return;
    S.light.tx = p.x;
    S.light.ty = p.y;
    S.light.lastInput = t;
    // Un revers de souris rapide à travers la citrouille compte comme un coup.
    if (e.pointerType === 'mouse' && S.mode === 'full') {
      const speed = Math.hypot(P.vx, P.vy);
      const c = bagCenter();
      if (speed > CFG.flingSpeed && t - P.lastFling > CFG.flingCooldownMs && Math.hypot(p.x - c.x, p.y - c.y) < S.bag.bw * 0.55) {
        P.lastFling = t;
        userHit(p.x, p.y, clamp(speed / 3, 0.5, 1.4), P.vx);
      }
    }
  }

  function onPointerDown(e) {
    if (e.pointerType !== 'touch') return;
    const p = local(e);
    S.light.touching = true;
    S.light.tx = p.x;
    S.light.ty = p.y;
    S.light.lastInput = now();
  }

  function onPointerUp() {
    if (S.light.touching) S.light.lastInput = now();
    S.light.touching = false;
  }

  function onBagPointerDown(e) {
    const p = local(e);
    S.bag.lastPointerHit = now();
    userHit(p.x, p.y, 1, 0);
  }

  // Clavier (Entrée, Espace) : le vrai bouton reçoit un clic sans pointeur.
  const KEY_ORDER = ['jab', 'direct', 'crochet', 'uppercut'];
  let keyIdx = 0;
  function onBagClick(e) {
    if (now() - S.bag.lastPointerHit < 700) return;
    if (e.detail !== 0) return;
    const c = bagCenter();
    S.bag.lastKeyHit = now();
    userHit(c.x, c.y, 1, 0, KEY_ORDER[keyIdx++ % KEY_ORDER.length]);
  }

  /* ---------- Le sac ---------- */

  function bagCenter() {
    const b = S.bag;
    const d = b.chain + b.bh * 0.55 + b.y;
    return { x: b.px - d * Math.sin(b.theta), y: b.py + d * Math.cos(b.theta) };
  }

  function bagLocalImpact(x, y) {
    const c = bagCenter();
    const cos = Math.cos(-S.bag.theta);
    const sin = Math.sin(-S.bag.theta);
    const dx = x - c.x;
    const dy = y - c.y;
    return { rx: (dx * cos - dy * sin) / (S.bag.bw / 2), ry: (dx * sin + dy * cos) / (S.bag.bh / 2) };
  }

  function userHit(x, y, power, flingVx, forced) {
    const b = S.bag;
    if (S.mode !== 'full' || b.drop > 0) return;
    // Carte fermée, citrouille vaincue : la frapper relance un round.
    if (b.ko) {
      if (!card.classList.contains('is-on') && now() - b.koAt > 1600) rematch();
      return;
    }
    const t = now();
    const { rx, ry } = bagLocalImpact(x, y);
    b.combo = t - b.lastHit < CFG.comboWindowMs ? b.combo + 1 : 1;
    b.lastHit = t;
    let type = forced;
    if (!type) {
      if (ry > 0.42) type = 'uppercut';
      else if (Math.abs(rx) > 0.52) type = 'crochet';
      else type = b.combo % 2 === 0 ? 'direct' : 'jab';
    }
    const hit = HITS[type];
    // Côté gauche frappé : le poing vient de la gauche, le sac part à droite.
    const side = flingVx ? Math.sign(flingVx) : rx < -0.08 ? 1 : rx > 0.08 ? -1 : 1;
    let dmg = hit.dmg + (b.combo >= 3 ? 1 : 0);
    b.hp = Math.max(0, b.hp - dmg);
    b.punches += 1;
    const ko = b.hp === 0;
    const stop = ko ? CFG.hitStop.ko : CFG.hitStop[type];
    b.freezeUntil = t + stop;
    b.pending = { domega: -side * hit.impulse * power * (ko ? 1.6 : 1), vy: hit.bounce * power };
    b.squash = ko ? 0.26 : 0.12 + 0.035 * hit.dmg;
    b.flare = 1;
    if (!reduce) S.trauma = Math.min(1, S.trauma + CFG.shakePx[ko ? 'ko' : type] / CFG.shakePx.ko);
    sound.thud(ko ? 1.2 : 0.35 + 0.2 * hit.dmg);
    burst(x, y, -side, ko ? 26 : 6 + hit.dmg * 3);

    let label = hit.label;
    let big = false;
    if (b.combo === 2) { label = 'Une-deux !'; big = true; }
    else if (b.combo >= 3) { label = 'Combo ×' + b.combo; big = true; }
    if (!ko) {
      // Au-dessus de la citrouille, jamais sur son visage ; un seul cri à la fois.
      const c = bagCenter();
      const sideX = c.x + (b.punches % 2 ? -1 : 1) * b.bw * 0.42;
      // Au-dessus de la barre de vie aussi : le cri ne cache jamais l'état du combat.
      const cy = Math.min(c.y - b.bh * 0.62, b.py + b.chain - 62);
      callout(label, clamp(sideX, 60, S.w - 60), Math.max(cy, S.topOffset + 24), big ? 'hw-callout--big' : '', true);
    }

    if (!b.hasBeenHit) {
      b.hasBeenHit = true;
      hint(false);
      hud.classList.add('is-on');
      track('halloween_first_hit', { page: location.pathname });
    }
    if (S.ghost.state === 'training' || S.ghost.state === 'caught') ghostLeave();
    S.bag.lastUserHit = t;
    renderHud();
    if (ko) knockout();
  }

  function knockout() {
    const b = S.bag;
    b.ko = true;
    b.koAt = now();
    const c = bagCenter();
    clearCallout();
    callout('K.O.', clamp(c.x, S.w * 0.18, S.w * 0.82), c.y - b.bh * 0.15, 'hw-callout--ko');
    // Trois coups de cloche : fin du combat.
    const bell = callout('Ding', clamp(b.px, 90, S.w - 90), b.py + b.chain - 52, 'hw-callout--bell');
    [0, 0.32, 0.64].forEach((d, i) => {
      sound.bell(d);
      setTimeout(() => { bell.textContent = ['Ding', 'Ding · Ding', 'Ding · Ding · Ding'][i]; }, d * 1000);
    });
    setTimeout(() => {
      bagEl.classList.add('is-ko');
      releaseBats(c.x, c.y - b.bh * 0.4);
    }, 280);
    setTimeout(showCard, 1400);
    track('halloween_ko', { round: b.round, punches: b.punches, page: location.pathname });
  }

  function rematch() {
    const b = S.bag;
    card.classList.remove('is-on');
    scrim.classList.remove('is-on');
    front.classList.remove('has-overlay');
    bagEl.classList.remove('is-gone');
    b.round += 1;
    b.hp = CFG.maxHp;
    b.punches = 0;
    b.combo = 0;
    b.ko = false;
    b.drop = 1;
    b.theta = 0;
    b.omega = 0;
    bagEl.classList.remove('is-ko');
    bagEl.dataset.dmg = '0';
    const lid = hitEl.querySelector('.hw-lid');
    if (lid) {
      // Relance l'animation du couvercle pour le prochain K.O.
      lid.style.animation = 'none';
      void lid.getBoundingClientRect();
      lid.style.animation = '';
    }
    renderHud();
    setTimeout(() => {
      const c = bagCenter();
      callout('Round ' + b.round, c.x, c.y - b.bh * 0.2, 'hw-callout--big');
      hitEl.focus({ preventScroll: true });
    }, 520);
  }

  function renderHud() {
    const b = S.bag;
    const f = b.hp / CFG.maxHp;
    hpFill.style.transform = `scaleX(${f})`;
    hpTrail.style.transform = `scaleX(${f})`;
    roundEl.textContent = 'R' + b.round;
    const lost = 1 - f;
    bagEl.dataset.dmg = lost >= 0.75 ? '3' : lost >= 0.45 ? '2' : lost >= 0.2 ? '1' : '0';
  }

  /* ---------- Carte de fin de round : les vraies formules, avec leurs vrais prix ---------- */

  const euro = (label) => String(label || '').replace(/,00(\s*€)/, '$1').trim();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Les deux formules que le club met en avant sur l'accueil (featured_home, réglé dans l'admin) :
  // aujourd'hui 44,99 € puis 400 €. Sur la page enfants : Baby Boxe puis Boxe éducative.
  async function loadOffers() {
    if (S.offers) return S.offers;
    try {
      const url = soft ? '/api/products?tab=abonnements&subsection=enfants' : '/api/products?featured=3';
      const res = await fetch(link(url), { cache: 'no-store' });
      const data = await res.json();
      S.offers = (data.products || [])
        .filter((p) => p.active !== false && Number(p.price_cents) > 0)
        .slice(0, 2)
        .map((p) => ({
          id: p.id,
          name: p.display_name || p.name,
          price: euro(p.marketing_price_label || p.price_label),
          per: p.subsection === 'prelevement' ? '/ 4 semaines' : p.duration_label ? '· ' + p.duration_label : '',
          year: /12\s*mois/i.test(String(p.duration_label || p.name || '')),
          audience: p.audience || '',
          note: p.installments_note || '',
        }));
    } catch (e) {
      S.offers = [];
    }
    return S.offers;
  }

  async function priceLabel() {
    if (S.price !== null) return S.price;
    try {
      const res = await fetch(link('/api/products/seance-essai'), { cache: 'no-store' });
      const data = await res.json();
      const p = data && data.product;
      const raw = p && p.active !== false ? p.marketing_price_label || p.price_label || '' : '';
      S.price = String(raw).replace(/,00(\s*€)/, '$1').trim();
    } catch (e) {
      S.price = '';
    }
    return S.price;
  }

  // Le rideau de sang : une nappe droite en haut, des coulures de longueurs différentes en bas.
  const CURSE_HTML =
    '<div class="hw-curse" aria-hidden="true">' +
    '<svg class="hw-curse__glove" viewBox="-4 -4 128 88"><path d="M14 40c0-18 14-30 36-30h22c20 0 34 12 34 30s-14 30-34 30H52c-6 0-10-3-12-7l-6 3c-8 4-20-2-20-12v-1c0-8 6-12 12-13z" fill="#030308" stroke="#E8001C" stroke-width="2.6" stroke-linejoin="round"/>' +
    '<path d="M40 63c-4-6-4-14 0-20" stroke="#E8001C" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/></svg>' +
    // Le rideau de sang : coulures en bas quand il tombe, bord déchiré en haut quand il s'égoutte.
    '<svg class="hw-curse__drips" viewBox="0 0 300 340" preserveAspectRatio="none">' +
    '<defs><linearGradient id="hwCurse" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3D0006"/><stop offset=".6" stop-color="#8E0B19"/><stop offset="1" stop-color="#B8121F"/></linearGradient></defs>' +
    '<path fill="url(#hwCurse)" d="M0 40C10 28 22 50 34 40S52 12 66 24S86 56 100 42S118 8 134 20S152 52 168 38S188 10 204 26S224 58 240 44S262 14 276 28S294 50 300 36V286C294 304 292 328 284 336 276 328 278 302 268 292 260 284 252 310 244 318 236 310 240 288 228 282 216 276 214 322 204 332 194 322 198 292 186 286 174 280 170 302 162 310 154 302 158 278 146 276 134 274 134 318 124 328 114 318 118 288 106 284 94 280 92 302 84 308 76 302 80 282 68 280 56 278 58 322 48 332 38 322 44 292 32 286 20 280 18 300 10 306 2 300 6 286 0 284Z"/>' +
    '</svg>' +
    '</div>';

  function offerHtml(o, i) {
    // Chaque mot vient des données de la formule : rythme, durée réelle, public du club.
    const eyebrow = o.per === '/ 4 semaines' ? 'Toutes les 4 semaines' : i > 0 && o.year ? 'Ou toute l’année' : o.audience || (i > 0 ? 'Ou bien' : '');
    const href = `${link('/inscription')}?product=${encodeURIComponent(o.id)}`;
    return (
      `<div class="hw-offer${i === 0 ? ' is-on' : ''}" data-i="${i}"${i === 0 ? '' : ' aria-hidden="true"'}>` +
      `<p class="hw-offer__eyebrow">${esc(eyebrow)}</p>` +
      `<p class="hw-offer__name">${esc(o.name)}</p>` +
      `<p class="hw-offer__price"><span class="hw-offer__num" data-final="${esc(o.price)}">${esc(o.price)}</span>` +
      (o.per ? `<span class="hw-offer__per">${esc(o.per)}</span>` : '') + '</p>' +
      (o.note ? `<p class="hw-offer__note">${esc(o.note)}</p>` : '') +
      `<a class="btn hw-card__cta" href="${href}"${i === 0 ? '' : ' tabindex="-1"'} data-track="halloween_ko_offer_${esc(o.id)}">Je choisis · ${esc(o.price)}</a>` +
      '</div>'
    );
  }

  async function showCard() {
    const b = S.bag;
    const coups = b.punches > 1 ? `${b.punches} coups` : '1 coup';
    const offers = await loadOffers();
    if (offers.length === 2) {
      card.innerHTML =
        `<p class="hw-card__kicker">K.O. en ${coups}</p>` +
        `<p class="hw-card__title">${soft ? 'Bien frappé !' : 'Le vrai sac t’attend.'}</p>` +
        `<div class="hw-offers">${offers.map(offerHtml).join('')}${soft ? '' : CURSE_HTML}</div>` +
        '<div class="hw-card__foot"><span class="hw-dots">' +
        offers.map((o, i) => `<button type="button" class="hw-dot" aria-pressed="${i === 0}" aria-label="Voir ${esc(o.name)} à ${esc(o.price)}"></button>`).join('') +
        '</span><button type="button" class="hw-card__again">Revanche</button></div>';
      S.shift = { i: 0, busy: false, touched: false, moved: false };
      // Seul un choix explicite (un point) annule la possession : la carte apparaît souvent sous la
      // souris qui vient de frapper le sac, et la survoler n'est pas un choix.
      card.querySelectorAll('.hw-dot').forEach((d, i) => d.addEventListener('click', () => { S.shift.touched = true; shiftTo(i); }));
      card.addEventListener('pointermove', () => { S.shift.moved = true; }, { passive: true, once: true });
    } else if (soft) {
      card.innerHTML =
        `<p class="hw-card__kicker">K.O. en ${coups} !</p>` +
        '<p class="hw-card__title">Bien frappé !</p>' +
        '<p class="hw-card__text">Baby Boxe (3-6 ans) et Boxe éducative (7-16 ans), dans les salles du club.</p>' +
        `<div class="hw-card__actions"><a class="btn hw-card__cta" href="${link('/abonnements#enfants')}" data-track="halloween_ko_cta_enfants">Voir les cours enfants</a>` +
        '<button type="button" class="hw-card__again">Revanche</button></div>';
    } else {
      const price = await priceLabel();
      const onEssai = /seance-essai/.test(location.pathname);
      card.innerHTML =
        `<p class="hw-card__kicker">K.O. en ${coups}</p>` +
        '<p class="hw-card__title">Le vrai sac t’attend.</p>' +
        '<p class="hw-card__text">Séance d’essai sans engagement, débutants bienvenus, dans l’une des 5 salles.</p>' +
        `<div class="hw-card__actions"><a class="btn hw-card__cta" href="${onEssai ? '#' : link('/seance-essai')}" data-track="halloween_ko_cta">Réserver ma séance${price ? ' · ' + price : ''}</a>` +
        '<button type="button" class="hw-card__again">Revanche</button></div>';
      if (onEssai) {
        card.querySelector('.hw-card__cta').addEventListener('click', (e) => {
          e.preventDefault();
          const target = hero.nextElementSibling || doc.querySelector('main');
          if (target) target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        });
      }
    }
    card.insertAdjacentHTML('afterbegin', '<button type="button" class="hw-card__close" aria-label="Fermer">×</button>');
    card.querySelector('.hw-card__close').addEventListener('click', closeCard);
    card.querySelector('.hw-card__again').addEventListener('click', rematch);
    placeCard();
    card.classList.add('is-on');
    // Au clavier, le focus suit le combat jusqu'à l'offre.
    if (now() - (S.bag.lastKeyHit || -1e9) < 4000) card.querySelector('.hw-card__cta').focus({ preventScroll: true });
    // 44,99 € d'abord ; puis la carte est possédée et révèle l'année à 400 €.
    if (S.shift && card.querySelector('.hw-offers')) {
      const round = S.bag.round;
      const tryShift = () => {
        if (!card.classList.contains('is-on') || S.bag.round !== round || S.shift.touched) return;
        // Jamais sous un curseur qu'on vient d'amener sur « Je choisis » : on n'échange pas l'offre
        // qu'il allait cliquer. Une souris restée immobile depuis le dernier coup ne compte pas.
        const cta = card.querySelector('.hw-offer.is-on .hw-card__cta');
        if (S.shift.moved && cta && cta.matches(':hover')) return void setTimeout(tryShift, 700);
        shiftTo(1);
      };
      setTimeout(tryShift, CFG.offerShiftMs);
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Les chiffres passent par des signes occultes avant de se fixer sur le vrai prix.
  function decode(node, final) {
    const glyphs = '†✝Ø#§0123456789';
    const steps = reduce ? 1 : 11;
    let k = 0;
    const tick = () => {
      k += 1;
      const shown = Math.floor((k / steps) * final.length);
      node.textContent = [...final].map((c, i) => (i < shown || !/\d/.test(c) ? c : glyphs[Math.floor(Math.random() * glyphs.length)])).join('');
      if (k < steps) setTimeout(tick, 42);
      else node.textContent = final;
    };
    tick();
  }

  async function shiftTo(i) {
    const sh = S.shift;
    if (!sh || sh.busy || sh.i === i) return;
    sh.busy = true;
    const wrap = card.querySelector('.hw-offers');
    const cur = wrap.querySelector('.hw-offer.is-on');
    const next = wrap.querySelector(`.hw-offer[data-i="${i}"]`);
    const hadFocus = cur.contains(doc.activeElement);
    const swap = () => {
      cur.classList.remove('is-on', 'is-leaving');
      cur.setAttribute('aria-hidden', 'true');
      cur.querySelector('.hw-card__cta').tabIndex = -1;
      next.classList.add('is-on');
      next.removeAttribute('aria-hidden');
      const cta = next.querySelector('.hw-card__cta');
      cta.removeAttribute('tabindex');
      const num = next.querySelector('.hw-offer__num');
      decode(num, num.dataset.final);
      if (hadFocus) cta.focus({ preventScroll: true });
    };
    if (reduce || soft) {
      swap();
    } else {
      // La possession : la carte tremble, l'ombre du gant la traverse, l'offre se brouille,
      // le sang coule par-dessus puis s'égoutte — et l'autre formule apparaît dessous.
      card.classList.add('is-cursing');
      cur.classList.add('is-leaving');
      sound.thud(0.9);
      await sleep(CFG.curseSwapMs);
      swap();
      await sleep(CFG.curseEndMs - CFG.curseSwapMs);
      card.classList.remove('is-cursing');
    }
    card.querySelectorAll('.hw-dot').forEach((d, k) => d.setAttribute('aria-pressed', String(k === i)));
    sh.i = i;
    sh.busy = false;
    track('halloween_offer_shift', { to: i, page: location.pathname });
  }

  function placeCard() {
    const b = S.bag;
    const cw = Math.min(296, S.w - 24);
    card.style.width = cw + 'px';
    const ch = card.offsetHeight || 200;
    const top = b.py + b.chain;
    // À côté du sac d'abord ; sinon la première bande libre au-dessus des textes.
    const cands = [[b.px - b.bw - cw, top + b.bh * 0.1], [b.px + b.bw * 0.9, top + b.bh * 0.1]];
    for (let y = S.topOffset + 52; y + ch < S.h - 8; y += 12) {
      cands.push([clamp(b.px - cw / 2, 12, S.w - cw - 12), y], [(S.w - cw) / 2, y]);
    }
    const spot = freeSpot(cw, ch, cands);
    // Aucune place libre (petit écran) : écran de résultat, le temps de choisir. Rien n'est caché
    // sans que le visiteur l'ait demandé : c'est son K.O., et la carte se ferme d'un geste.
    const overlay = !spot;
    const x = overlay ? (S.w - cw) / 2 : spot.x;
    const y = overlay ? clamp((S.h - ch) / 2, S.topOffset + 8, S.h - ch - 8) : spot.y;
    card.classList.toggle('is-overlay', overlay);
    scrim.classList.toggle('is-on', overlay);
    // Sous le voile, le son et la lampe chevaucheraient la carte : ils reviennent à sa fermeture.
    front.classList.toggle('has-overlay', overlay);
    card.style.transform = `translate(${x}px, ${y}px)`;
    // La citrouille vaincue s'efface si la carte prend sa place (au repos : après le K.O. elle ne
    // se balance plus).
    const rest = { x: b.px - b.bw * 0.62, y: b.py + b.chain - 34, w: b.bw * 1.24, h: b.bh + 40 };
    bagEl.classList.toggle('is-gone', hits({ x, y, w: cw, h: ch }, rest, 0));
  }

  function closeCard() {
    card.classList.remove('is-on');
    scrim.classList.remove('is-on');
    front.classList.remove('has-overlay');
    bagEl.classList.remove('is-gone');
    hitEl.focus({ preventScroll: true });
  }

  /* ---------- L'adversaire invisible ---------- */

  const POSES = {
    guard: { la: 1.05, lb: -2.35, ra: 1.2, rb: -2.5, dx: 0, dy: 0 },
    jab: { la: -0.08, lb: 0.04, ra: 1.22, rb: -2.52, dx: 4, dy: 0 },
    cross: { la: 1.15, lb: -2.4, ra: -0.06, rb: 0.03, dx: 16, dy: 2 },
    hook: { la: -0.4, lb: 0.8, ra: 1.25, rb: -2.55, dx: 10, dy: 3 },
    bob: { la: 1.0, lb: -2.3, ra: 1.15, rb: -2.45, dx: -4, dy: 16 },
    rest: { la: 1.45, lb: -0.35, ra: 1.5, rb: -0.3, dx: 0, dy: 0 },
  };
  const COMBO = [
    { to: 'guard', d: 0.55 },
    { to: 'jab', d: 0.09, hit: 'jab' },
    { to: 'guard', d: 0.16 },
    { to: 'jab', d: 0.09, hit: 'jab' },
    { to: 'cross', d: 0.12, hit: 'direct' },
    { to: 'guard', d: 0.22 },
    { to: 'bob', d: 0.22 },
    { to: 'guard', d: 0.2 },
    { to: 'hook', d: 0.13, hit: 'crochet' },
    { to: 'guard', d: 0.3 },
    { to: 'guard', d: 0.9, idle: true },
  ];

  function bindGhost() {
    const q = (c) => shadowGhost.querySelector('.' + c);
    ghostParts = {
      legR: q('g-leg-r'), legL: q('g-leg-l'), torso: q('g-torso'), head: q('g-head'),
      r1: q('g-arm-r1'), r2: q('g-arm-r2'), gr: q('g-glove-r'),
      l1: q('g-arm-l1'), l2: q('g-arm-l2'), gl: q('g-glove-l'),
    };
    S.ghost.pose = { ...POSES.guard };
    S.ghost.from = { ...POSES.guard };
    S.ghost.timeline = COMBO;
  }

  function drawGhost(p, bounce) {
    const g = ghostParts;
    const dy = p.dy + bounce;
    const sx = p.dx;
    const set = (n, a) => { for (const k in a) n.setAttribute(k, a[k].toFixed ? a[k].toFixed(1) : a[k]); };
    const hipY = -122 + dy;
    g.legR.setAttribute('points', `-10,${hipY.toFixed(1)} ${(-24 - dy * 0.3).toFixed(1)},${(-62 + dy * 0.45).toFixed(1)} -38,0`);
    g.legL.setAttribute('points', `10,${hipY.toFixed(1)} ${(22 + dy * 0.3).toFixed(1)},${(-60 + dy * 0.45).toFixed(1)} 36,0`);
    const shL = { x: 16 + sx, y: -200 + dy };
    const shR = { x: -16 + sx * 0.6, y: -198 + dy };
    // Buste en V : épaules larges, taille serrée — une carrure de boxeur, pas un bonhomme bâton.
    g.torso.setAttribute(
      'd',
      `M-19 ${hipY.toFixed(1)} L19 ${hipY.toFixed(1)} L${(30 + sx).toFixed(1)} ${(-204 + dy).toFixed(1)} ` +
        `L${(6 + sx * 0.8).toFixed(1)} ${(-214 + dy).toFixed(1)} L${(-28 + sx * 0.6).toFixed(1)} ${(-199 + dy).toFixed(1)} Z`
    );
    set(g.head, { cx: 10 + sx * 0.9, cy: -229 + dy * 0.95 });
    const arm = (sh, a, b, l1, l2, glove) => {
      const ex = sh.x + 46 * Math.cos(a);
      const ey = sh.y + 46 * Math.sin(a);
      const hx = ex + 42 * Math.cos(a + b);
      const hy = ey + 42 * Math.sin(a + b);
      set(l1, { x1: sh.x, y1: sh.y, x2: ex, y2: ey });
      set(l2, { x1: ex, y1: ey, x2: hx, y2: hy });
      set(glove, { cx: hx, cy: hy });
    };
    arm(shR, p.ra, p.rb, g.r1, g.r2, g.gr);
    arm(shL, p.la, p.lb, g.l1, g.l2, g.gl);
  }

  function ghostLeave() {
    if (S.ghost.state === 'off' || S.ghost.state === 'gone' || S.ghost.state === 'leaving') return;
    S.ghost.state = 'leaving';
    S.ghost.leaveT = 0;
  }

  function updateGhost(dt, t) {
    const gh = S.ghost;
    if (gh.state === 'off') return;
    const L = S.light;
    const k = CFG.projection;
    const center = { x: gh.x, y: gh.y - gh.H * 0.55 };
    const sx = L.x + (center.x - L.x) * k;
    const sy = L.y + (center.y - L.y) * k;
    const prox = clamp(1 - Math.hypot(sx - L.x, sy - L.y) / (L.r * 1.15), 0, 1);

    if (gh.state === 'training') {
      advanceCombo(dt);
      // Le balayage automatique peut le montrer ; seule une lampe tenue par le visiteur le fait fuir.
      const userLight = L.touching || t - L.lastInput <= CFG.idleMs;
      if (prox > 0.55 && userLight) gh.seen += dt * 1000;
      else gh.seen = Math.max(0, gh.seen - dt * 600);
      if (gh.seen > CFG.ghostCaughtMs) {
        gh.state = 'caught';
        gh.caughtT = 0;
        gh.from = { ...gh.pose };
      }
    } else if (gh.state === 'caught') {
      // Il se fige, se tourne vers la lumière… puis disparaît.
      gh.caughtT += dt;
      const tt = clamp((gh.caughtT - 0.35) / 0.45, 0, 1);
      gh.turn = lerp(1, 0.58, easeInOut(tt));
      gh.pose = mixPose(gh.from, POSES.rest, easeInOut(tt));
      if (gh.caughtT > 0.95) { gh.state = 'leaving'; gh.leaveT = 0; }
    } else if (gh.state === 'leaving') {
      gh.leaveT += dt;
      gh.stateAlpha = clamp(1 - gh.leaveT / 0.8, 0, 1);
      if (gh.leaveT > 0.8) { gh.state = 'gone'; gh.away = 0; }
    } else if (gh.state === 'gone') {
      gh.away = prox < 0.15 && t - (S.bag.lastUserHit || -1e9) > 6000 && !S.bag.ko ? gh.away + dt * 1000 : 0;
      if (gh.away > CFG.ghostReturnMs) {
        gh.state = 'training';
        gh.stateAlpha = 1;
        gh.turn = 1;
        gh.seen = 0;
        gh.seg = 0;
        gh.segT = 0;
        gh.from = { ...POSES.guard };
        gh.pose = { ...POSES.guard };
      }
    }

    gh.alpha = Math.pow(prox, 1.3) * gh.stateAlpha * (gh.state === 'gone' ? 0 : CFG.ghostOpacity);
    const bounce = gh.state === 'training' ? Math.sin(t / 1000 * Math.PI * 2 * 1.7) * 3 : 0;
    // Hors de la lumière, l'ombre n'est ni dessinée ni peinte.
    const lit = gh.alpha > 0.01;
    shadowGhost.style.visibility = lit ? 'visible' : 'hidden';
    if (!lit) return;
    drawGhost(gh.pose, bounce);
    shadowGhost.style.opacity = gh.alpha.toFixed(3);
    // Projection d'une lampe ponctuelle sur le mur : S = L + (P − L)·k.
    shadowGhost.style.transform =
      `translate(${L.x.toFixed(1)}px,${L.y.toFixed(1)}px) scale(${k}) translate(${(-L.x).toFixed(1)}px,${(-L.y).toFixed(1)}px) ` +
      `translate(${gh.x.toFixed(1)}px,${gh.y.toFixed(1)}px) scale(${gh.turn.toFixed(3)},1)`;
  }

  function mixPose(a, b, t) {
    const o = {};
    for (const k in a) o[k] = lerp(a[k], b[k], t);
    return o;
  }

  function advanceCombo(dt) {
    const gh = S.ghost;
    const seg = gh.timeline[gh.seg];
    const b = S.bag;
    // Un vrai boxeur attend que le sac revienne vers lui avant de frapper.
    if (seg.hit && S.mode === 'full' && gh.segT === 0 && (Math.abs(b.theta) > 0.1 || b.ko || b.drop > 0) && gh.wait < 0.9) {
      gh.wait += dt;
      return;
    }
    gh.wait = 0;
    gh.segT += dt;
    const dur = seg.idle ? seg.d + (gh.idleExtra || 0) : seg.d;
    const tt = clamp(gh.segT / dur, 0, 1);
    gh.pose = mixPose(gh.from, POSES[seg.to], seg.hit ? easeOutCubic(tt) : easeInOut(tt));
    if (tt >= 1) {
      if (seg.hit && S.mode === 'full' && !b.ko && b.drop <= 0) ghostPunch(seg.hit);
      gh.from = { ...POSES[seg.to] };
      gh.seg = (gh.seg + 1) % gh.timeline.length;
      gh.segT = 0;
      if (gh.timeline[gh.seg].idle) gh.idleExtra = rand(0, 1.2);
    }
  }

  function ghostPunch(type) {
    const b = S.bag;
    const hit = HITS[type];
    b.freezeUntil = now() + CFG.hitStop[type] * 0.6;
    // Le fantôme frappe pour s'entraîner, pas pour démolir : le sac oscille d'une dizaine de degrés.
    b.pending = { domega: -hit.impulse * 0.42, vy: 0 };
    b.squash = 0.06 + 0.02 * hit.dmg;
    b.flare = 0.5;
    sound.thud(0.22 + 0.1 * hit.dmg);
  }

  /* ---------- Particules, chauves-souris, annonces ---------- */

  const POOL = [];
  function particle() {
    let p = POOL.find((q) => !q.alive);
    if (!p) {
      if (POOL.length >= 40) return null;
      p = { node: el('span', 'hw-particle'), alive: false };
      front.append(p.node);
      POOL.push(p);
    }
    return p;
  }

  function burst(x, y, dir, n) {
    if (reduce) return;
    const count = lowEnd ? Math.ceil(n / 2) : n;
    for (let i = 0; i < count; i++) {
      const p = particle();
      if (!p) break;
      const kind = soft ? 'candy' : i % 3 === 0 ? 'ember' : 'seed';
      p.node.className = 'hw-particle' + (kind === 'ember' ? ' hw-particle--ember' : kind === 'candy' ? ' hw-particle--candy' : '');
      if (kind === 'candy') p.node.style.background = ['#FF4D6D', '#FFC233', '#6BCB77', '#4D96FF', '#C77DFF'][i % 5];
      else p.node.style.background = '';
      // Les éclats partent du côté opposé au poing.
      const a = (dir > 0 ? 0 : Math.PI) + rand(-0.9, 0.9);
      const v = rand(140, 360);
      Object.assign(p, {
        alive: true, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - rand(80, 220),
        rot: rand(0, 360), vr: rand(-540, 540), life: 0, max: rand(0.55, 0.95), g: kind === 'ember' ? 380 : 980,
      });
    }
  }

  function updateParticles(dt) {
    for (const p of POOL) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        p.node.style.opacity = '0';
        continue;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const o = 1 - Math.pow(p.life / p.max, 2);
      p.node.style.opacity = o.toFixed(2);
      p.node.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) rotate(${p.rot.toFixed(0)}deg)`;
    }
  }

  function releaseBats(x, y) {
    if (reduce) return;
    const n = soft ? 0 : lowEnd ? 5 : 9;
    if (soft) burst(x, y, 1, 22);
    for (let i = 0; i < n; i++) spawnBat(x, y, rand(-1, 1) > 0 ? 1 : -1, true);
  }

  function spawnBat(x, y, dir, burstOut) {
    const node = el('div', 'hw-bat', BAT_SVG);
    const size = rand(34, 58);
    node.style.width = size + 'px';
    node.style.height = size / 2 + 'px';
    node.firstChild.style.animationDuration = rand(0.12, 0.19).toFixed(2) + 's';
    front.append(node);
    S.bats.push({
      node, x, y, dir,
      vx: dir * (burstOut ? rand(120, 320) : rand(70, 120)),
      vy: burstOut ? -rand(140, 320) : rand(-12, 12),
      life: 0, max: burstOut ? rand(1.8, 2.8) : (S.w + 120) / rand(70, 120) + 0.5,
      wob: rand(0, 6), size, burst: burstOut,
    });
  }

  // Les traversées de chauves-souris sont gérées pour toute la page (halloween-page.js) ;
  // ici ne vivent que celles qui s'échappent de la citrouille au K.O.
  function updateBats(dt) {
    for (let i = S.bats.length - 1; i >= 0; i--) {
      const b = S.bats[i];
      b.life += dt;
      if (b.burst) b.vy += 60 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt + Math.sin(b.life * 7 + b.wob) * (b.burst ? 0.9 : 0.6);
      const fade = b.burst ? clamp((b.max - b.life) / 0.5, 0, 1) : 1;
      b.node.style.opacity = fade.toFixed(2);
      b.node.style.transform = `translate(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px) scaleX(${b.dir})`;
      if (b.life > b.max || b.x < -120 || b.x > S.w + 120 || b.y < -80) {
        b.node.remove();
        S.bats.splice(i, 1);
      }
    }
  }

  let activeCallout = null;
  function clearCallout() {
    if (activeCallout) activeCallout.remove();
    activeCallout = null;
  }

  function callout(text, x, y, extra, replace) {
    if (replace) clearCallout();
    const n = el('div', 'hw-callout ' + (extra || ''));
    n.textContent = text;
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    front.append(n);
    if (replace) activeCallout = n;
    n.addEventListener('animationend', () => n.remove(), { once: true });
    setTimeout(() => n.remove(), 2600);
    return n;
  }

  // Sur une photo, le sujet (un boxeur, un enfant) est l'image qui vend : pas de bulle par-dessus.
  const photoHero = hero.classList.contains('page-hero--photo');
  function hint(on) {
    if (S.mode !== 'full' || photoHero) return;
    if (on) S.hint.shown = true;
    hintEl.classList.toggle('is-on', on && S.hint.ok !== false);
  }

  /* ---------- Boucle ---------- */

  function syncRunning() {
    const should = S.visible !== false && !doc.hidden && !S.dead;
    if (should && !S.running) {
      S.running = true;
      S.last = now();
      S.raf = requestAnimationFrame(frame);
    } else if (!should && S.running) {
      S.running = false;
      cancelAnimationFrame(S.raf);
    }
  }

  function frame(t) {
    if (!S.running) return;
    if (!S.w) {
      S.last = t;
      S.raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.05, (t - S.last) / 1000);
    S.last = t;
    update(dt, t);
    render(t);
    S.raf = requestAnimationFrame(frame);
  }

  function update(dt, t) {
    const L = S.light;
    const b = S.bag;
    // La lampe : suit le pointeur, ou balaie la salle quand personne n'y touche.
    if (reduce) {
      const c = S.mode === 'full' ? bagCenter() : { x: S.w * 0.7, y: S.h * 0.5 };
      L.tx = c.x - L.r * 0.35;
      L.ty = c.y;
    } else if (!L.touching && t - L.lastInput > CFG.idleMs) {
      L.sweepT += dt;
      const cx = S.mode === 'full' ? lerp(S.w * 0.5, b.px, 0.35) : S.w * 0.55;
      L.tx = cx + Math.sin(L.sweepT * (2 * Math.PI / 13)) * S.w * 0.32;
      L.ty = S.h * 0.48 + Math.sin(L.sweepT * (2 * Math.PI / 8.5)) * S.h * 0.22;
    }
    const f = reduce ? 1 : 1 - Math.exp(-CFG.lightFollow * dt);
    L.x += (L.tx - L.x) * f;
    L.y += (L.ty - L.y) * f;

    if (S.mode === 'full') {
      // Le sac : pendule amorti, arrêt sur image au moment de l'impact.
      if (b.drop > 0) b.drop = Math.max(0, b.drop - dt * 1.6);
      if (t >= b.freezeUntil) {
        const k = Math.pow((2 * Math.PI) / CFG.bagPeriod, 2);
        if (b.pending) {
          b.omega += b.pending.domega;
          b.vy += b.pending.vy;
          b.pending = null;
          const emax = k * (1 - Math.cos(CFG.maxSwing));
          const epot = k * (1 - Math.cos(b.theta));
          const room = Math.max(0, emax - epot);
          const wmax = Math.sqrt(2 * room);
          if (Math.abs(b.omega) > wmax) b.omega = Math.sign(b.omega) * wmax;
        }
        if (!reduce) {
          const steps = 4;
          const h = dt / steps;
          const damping = b.ko ? CFG.koDamping : CFG.bagDamping;
          for (let i = 0; i < steps; i++) {
            b.omega += (-k * Math.sin(b.theta) - damping * b.omega) * h;
            b.theta += b.omega * h;
            b.vy += (-CFG.bounceStiffness * b.y - CFG.bounceDamping * b.vy) * h;
            b.y += b.vy * h;
          }
        } else {
          b.omega = 0;
          b.theta = 0;
          b.y = 0;
        }
      }
      // Écrasement à l'impact, retour en ressort.
      b.squashV += (-260 * b.squash - 22 * b.squashV) * dt;
      if (t >= b.freezeUntil) b.squash += b.squashV * dt;
      if (Math.abs(b.squash) < 0.001 && Math.abs(b.squashV) < 0.01) { b.squash = 0; b.squashV = 0; }
      b.flare = Math.max(0, b.flare - dt * 2.6);
      if (!b.hasBeenHit && !S.hint.shown && t > CFG.hintDelayMs && !reduce) {
        hint(true);
        S.hint.at = t;
      }
      // L'indice ne s'installe pas : il disparaît seul s'il n'a pas servi.
      if (S.hint.shown && hintEl.classList.contains('is-on') && (b.hasBeenHit || t - S.hint.at > 9000)) hint(false);
    }

    updateGhost(dt, t);
    updateParticles(dt);
    updateBats(dt);

    // Tremblement « trauma² » : fort à l'impact, il s'éteint vite et sans à-coup.
    S.trauma = Math.max(0, S.trauma - CFG.traumaDecay * dt);
    const amp = CFG.shakePx.ko * S.trauma * S.trauma;
    S.shakeX = amp ? rand(-amp, amp) : 0;
    S.shakeY = amp ? rand(-amp, amp) * 0.6 : 0;

    if (S.fade) {
      const p = clamp((t - S.fade.start) / S.fade.dur, 0, 1);
      S.nightMul = S.fade.curve(p);
      if (p >= 1) {
        const done = S.fade.done;
        S.fade = null;
        if (done) done();
      }
    }
  }

  function render(t) {
    const b = S.bag;
    const L = S.light;
    const flicker = 0.88 + 0.12 * Math.sin((t || 0) / 90) * Math.sin((t || 0) / 37 + 1.3) + b.flare * 0.5;

    if (S.mode === 'full') {
      const dropY = -easeInOut(b.drop) * (b.chain + b.bh + S.topOffset + 40);
      const sw = `translate(${(b.px + S.shakeX).toFixed(1)}px,${(b.py + b.y + dropY + S.shakeY).toFixed(1)}px) rotate(${b.theta.toFixed(4)}rad)`;
      swingEl.style.transform = sw;
      const sq = b.squash;
      bodyEl.style.transform = `scale(${(1 + sq).toFixed(3)},${(1 - sq * 0.75).toFixed(3)})`;
      glowEl.style.opacity = b.ko ? '0.12' : clamp(flicker * 0.9, 0, 1).toFixed(2);
      // Repeindre le visage dessiné coûte : la bougie tremble à ~15 Hz, ce que l'œil prend pour une flamme.
      if (!b.ko && (t || 0) - (S.faceAt || 0) > 66) {
        S.faceAt = t || 0;
        faceEl.style.opacity = clamp(0.78 + flicker * 0.22, 0, 1).toFixed(2);
      }

      // L'ombre du sac, projetée par la lampe sur le mur.
      const k = CFG.projection;
      const c = bagCenter();
      const sx = L.x + (c.x - L.x) * k;
      const sy = L.y + (c.y - L.y) * k;
      const prox = clamp(1 - Math.hypot(sx - L.x, sy - L.y) / (L.r * 1.2), 0, 1);
      const bagLit = prox > 0.01;
      shadowBag.style.visibility = bagLit ? 'visible' : 'hidden';
      shadowBag.style.opacity = (Math.pow(prox, 1.2) * 0.62).toFixed(3);
      shadowBag.style.transform =
        `translate(${L.x.toFixed(1)}px,${L.y.toFixed(1)}px) scale(${k}) translate(${(-L.x).toFixed(1)}px,${(-L.y).toFixed(1)}px)`;
      shadowBagSwing.style.transform = `translate(${b.px.toFixed(1)}px,${(b.py + b.y + dropY).toFixed(1)}px) rotate(${b.theta.toFixed(4)}rad)`;
    }
    drawNight(flicker);
  }

  function drawNight(flicker) {
    const c = ctx;
    const W = S.w;
    const H = S.h;
    const L = S.light;
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, H);
    const a = CFG.nightAlpha * S.nightMul;
    if (a <= 0.003) return;
    c.fillStyle = `rgba(5,7,16,${a.toFixed(3)})`;
    c.fillRect(0, 0, W, H);
    const vg = c.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(3,4,10,0)');
    vg.addColorStop(1, `rgba(3,4,10,${(0.32 * S.nightMul).toFixed(3)})`);
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'destination-out';
    hole(L.x, L.y, L.r, 1);
    if (S.mode === 'full' && !S.bag.ko) {
      const bc = bagCenter();
      hole(bc.x, bc.y, S.bag.bw * 1.05 * clamp(flicker, 0.7, 1.4), 0.5);
    }
    c.globalCompositeOperation = 'source-over';
    const tint = c.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
    tint.addColorStop(0, `rgba(255,196,130,${(0.08 * S.nightMul).toFixed(3)})`);
    tint.addColorStop(1, 'rgba(255,196,130,0)');
    c.fillStyle = tint;
    c.fillRect(L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
  }

  function hole(x, y, r, strength) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.45, `rgba(0,0,0,${strength * 0.86})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* ---------- Interrupteur : rallumer la salle, ou y revenir ---------- */

  // Deux battements de néon en moins d'une seconde : sous la limite des 3 flashs/s (WCAG 2.3.1).
  const curves = {
    on: (p) => (p < 0.17 ? lerp(1, 0.25, p / 0.17) : p < 0.38 ? lerp(0.25, 0.78, (p - 0.17) / 0.21) : lerp(0.78, 0, easeInOut((p - 0.38) / 0.62))),
    off: (p) => (p < 0.25 ? lerp(0, 0.62, p / 0.25) : p < 0.45 ? lerp(0.62, 0.22, (p - 0.25) / 0.2) : lerp(0.22, 1, easeInOut((p - 0.45) / 0.55))),
  };

  // La scène du hero et celle de toute la page s'allument et s'éteignent ensemble.
  const broadcast = (on) => doc.dispatchEvent(new CustomEvent('bc:halloween', { detail: { on } }));

  function switchOff() {
    store.set(OFF_KEY, OFF_VALUE);
    track('halloween_off', { page: location.pathname });
    broadcast(false);
    const finish = () => teardown(true);
    if (reduce) return finish();
    S.fade = { start: now(), dur: 820, curve: curves.on, done: finish };
    front.style.transition = 'opacity .5s ease .3s';
    front.style.opacity = '0';
  }

  function teardown(keepRelight) {
    S.dead = true;
    syncRunning();
    if (S.ac) S.ac.abort();
    if (ro) ro.disconnect();
    if (io) io.disconnect();
    back.remove();
    front.remove();
    for (const b of S.bats) b.node.remove();
    S.bats = [];
    POOL.length = 0;
    if (keepRelight) relightButton();
  }

  function relightButton() {
    const wrap = el('div', 'hw-front');
    wrap.setAttribute('data-hw-relight', '');
    const ctl = el('div', 'hw-controls');
    const btn = el('button', 'hw-ctl', ICONS.pumpkin);
    btn.type = 'button';
    btn.setAttribute('aria-label', "Remettre les animations d'Halloween");
    btn.title = 'Remettre Halloween';
    btn.dataset.track = 'halloween_on';
    ctl.append(btn);
    wrap.append(ctl);
    const topbar = isCinema ? doc.querySelector('#site-header .topbar') : null;
    wrap.style.setProperty('--hw-top', (topbar ? Math.round(topbar.getBoundingClientRect().height) : 0) + 12 + 'px');
    hero.append(wrap);
    btn.addEventListener('click', () => {
      store.set(OFF_KEY, null);
      wrap.remove();
      start(true);
      broadcast(true);
    });
  }

  /* ---------- Départ ---------- */

  // Mesurer pendant que la page se construit force une mise en page complète (190 ms sur l'accueil) :
  // on attend la fin de l'image suivante, quand la mise en page vient d'être faite par le navigateur.
  const afterFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(() => !S.dead && fn()));

  function start(withTransition) {
    S.dead = false;
    build();
    if (S.ghost.state !== 'off') bindGhost();
    // Première mise en place : le ResizeObserver l'appelle juste après la mise en page du navigateur.
    if (withTransition && !reduce) {
      S.nightMul = 0;
      S.fade = { start: now(), dur: 760, curve: curves.off, done: null };
    }
    syncRunning();
    // Les polices du titre changent les lignes : on replace quand elles arrivent, et une fois la
    // page chargée. L'entrée glissée du contenu est déjà comptée dans les obstacles.
    if (doc.fonts && doc.fonts.ready) {
      doc.fonts.ready.then(() => {
        if (S.dead) return;
        S.hintSize = null;
        afterFrame(layout);
      });
    }
    if (doc.readyState !== 'complete') {
      window.addEventListener('load', () => !S.bag.hasBeenHit && afterFrame(layout), { once: true, signal: S.ac.signal });
    }
  }

  // ?hwdebug expose l'état pour les tests ; sans effet pour les visiteurs.
  if (/[?&]hwdebug\b/.test(location.search)) window.__bcHw = S;

  if (store.get(OFF_KEY) === OFF_VALUE) {
    relightButton();
    return;
  }
  start(false);
})();
