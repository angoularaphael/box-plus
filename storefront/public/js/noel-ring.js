/**
 * Noël 2026 — « Boxing Day » : le cadeau qui s'ouvre à la boxe.
 *
 * En haut des pages vitrine, le sac de frappe est emballé comme un cadeau : papier rouge du club,
 * ruban or, nœud, étiquette. Il se balance doucement. Chaque coup arrache un peu de papier et fait
 * tomber la neige qui le couvrait ; au K.O., le nœud s'envole, le papier éclate, la lumière sort
 * du sac — et la carte « Ce Noël, offre-toi le ring » présente les deux formules du club, qui
 * s'emballent et se déballent tour à tour (prix lus dans l'API, jamais écrits en dur).
 * Au doigt : taper pour le jab, glisser de côté pour le crochet, vers le haut pour l'uppercut.
 *
 * Chargé par layout.js une fois la page affichée, jamais dans le tunnel de vente. Tout vit dans
 * le hero, rien ne recouvre un texte ou un bouton. Au repos, rien ne tourne en JavaScript : le
 * balancement est une animation de la carte graphique, la physique ne s'éveille qu'aux coups.
 */
(function () {
  'use strict';
  if (window.__bcNoelRing) return;
  window.__bcNoelRing = true;

  const doc = document;
  const root = doc.documentElement;
  const hero = doc.querySelector('.hero--cinema, .page-hero');
  if (!hero) return;

  const soft = root.classList.contains('bc-noel--soft');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const isCinema = hero.classList.contains('hero--cinema');
  // Avec la boutique gelée (noel-hiver.js) : le cadeau est pris dans la glace, et chaque coup
  // réchauffe toute la page. Le cadeau le dit, la page écoute.
  const frozen = root.classList.contains('bc-noel-hiver');
  root.classList.add('bc-noel-ring');

  const OFF_KEY = 'bc_noel_off';
  const OFF_VALUE = '2026';

  /* Réglages : chaque nombre a un nom. Les durées de « game feel » viennent des jeux de combat
     (arrêt sur image de 4 à 11 images à 60 i/s selon la force du coup). */
  const CFG = {
    bagPeriod: 1.75,
    bagDamping: 0.9,
    bounceStiffness: 210,
    bounceDamping: 9,
    maxHp: 20,
    // Un sac lourd se balance peu : l'énergie du pendule est plafonnée à ~24°, et toute la course
    // de ce balancement doit tenir hors des textes.
    maxSwing: 0.42,
    koDamping: 3.4,
    comboWindowMs: 430,
    hitStop: { jab: 60, direct: 85, crochet: 100, uppercut: 120, ko: 190 },
    shakePx: { jab: 3, direct: 4, crochet: 5, uppercut: 6, ko: 9 },
    traumaDecay: 1.8,
    flingSpeed: 1.35,
    flingCooldownMs: 150,
    // Au doigt : au-delà de 10 px c'est un geste, plus un tap ; un geste qui traverse le cadeau à
    // plus de 0,35 px/ms est un coup (crochet de côté, uppercut vers le haut).
    tapSlop: 10,
    swipeSpeed: 0.35,
    swipeCooldownMs: 140,
    hintDelayMs: 2600,
    // Au repos, le cadeau se balance de ±2° (animation de la carte graphique).
    idleSwayDeg: 2.2,
    idleSwayMs: 3400,
    // Carte de fin : chaque formule reste lisible ~4 s, puis elle s'emballe et se déballe sur
    // l'autre — 44,99 € ⇄ 400 €, tant que la carte est ouverte.
    offerShiftMs: 4000,
    offerDwellMs: 4600,
    wrapSwapMs: 640,
    wrapEndMs: 1320,
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
  const rand = (a, b) => a + Math.random() * (b - a);
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const now = () => performance.now();
  const el = (tag, cls, html) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  // Écrire un style seulement s'il change : rien ne touche le DOM quand rien ne bouge.
  const putT = (n, v) => { if (n._t !== v) { n._t = v; n.style.transform = v; } };
  const putO = (n, v) => { if (n._o !== v) { n._o = v; n.style.opacity = v; } };
  const tell = (name, detail) => doc.dispatchEvent(new CustomEvent(name, { detail }));
  // Au téléphone, un coup se sent dans la main (Android ; sans effet ailleurs).
  const BUZZ = { jab: 8, direct: 11, crochet: 14, uppercut: 18, ko: [24, 46, 38] };
  const buzz = (pattern) => {
    if (!coarse || reduce || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) { /* vibreur refusé */ }
  };

  /* ---------- Dessins ---------- */

  // Le sac en trois couches au même cadre 160 × 220 : le cuir et son emballage (une image fixe),
  // les déchirures (redessinées seulement quand le papier cède), le nœud (qui s'envole au K.O.).
  function giftHtml() {
    return (
      '<svg class="xm-gift" viewBox="0 0 160 220" aria-hidden="true" focusable="false">' +
      '<defs>' +
      '<linearGradient id="xmLeather" x1="0" x2="1"><stop offset="0" stop-color="#0f0809"/><stop offset=".45" stop-color="#2b1517"/><stop offset="1" stop-color="#120909"/></linearGradient>' +
      '<linearGradient id="xmPaper" x1="0" x2="1"><stop offset="0" stop-color="#6E0010"/><stop offset=".3" stop-color="#C4001A"/><stop offset=".5" stop-color="#E8001C"/><stop offset=".74" stop-color="#B00018"/><stop offset="1" stop-color="#62000E"/></linearGradient>' +
      '<linearGradient id="xmRibbon" x1="0" x2="1"><stop offset="0" stop-color="#A86A14"/><stop offset=".42" stop-color="#FFE2A0"/><stop offset=".62" stop-color="#F2B24A"/><stop offset="1" stop-color="#93590F"/></linearGradient>' +
      '<linearGradient id="xmIce" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E6F3FF" stop-opacity=".55"/><stop offset=".5" stop-color="#BFDDF8" stop-opacity=".3"/><stop offset="1" stop-color="#D8ECFF" stop-opacity=".5"/></linearGradient>' +
      '<linearGradient id="xmIcicle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3F9FF"/><stop offset="1" stop-color="#A9CBEE" stop-opacity=".75"/></linearGradient>' +
      '<radialGradient id="xmGlowHole" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#FFF1C4"/><stop offset=".38" stop-color="#FFB347"/><stop offset=".8" stop-color="#7A3A0C"/><stop offset="1" stop-color="#2A1206"/></radialGradient>' +
      '<pattern id="xmStars" width="24" height="24" patternUnits="userSpaceOnUse">' +
      '<path d="M12 4.5l1.3 4 4.2 1.3-4.2 1.3L12 15.2l-1.3-4.1L6.5 9.8l4.2-1.3z" fill="#FFD98A" opacity=".34"/>' +
      '<circle cx="3" cy="20" r="1.1" fill="#fff" opacity=".32"/></pattern>' +
      '</defs>' +
      // Les quatre chaînes d'un vrai sac de frappe, réunies sur l'émerillon.
      '<g fill="none" stroke="#2a2f3b" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="5 2.6">' +
      '<path d="M80 6L38 44"/><path d="M80 6L60 36"/><path d="M80 6L100 36"/><path d="M80 6L122 44"/>' +
      '</g>' +
      '<circle cx="80" cy="6" r="5" fill="none" stroke="#3a404d" stroke-width="3"/>' +
      // Le cuir, sous le papier : il apparaît quand le cadeau s'ouvre.
      '<g class="xm-leather">' +
      '<rect x="34" y="40" width="92" height="170" rx="21" fill="url(#xmLeather)"/>' +
      '<rect x="34" y="68" width="92" height="7" fill="#B8001A"/><rect x="34" y="178" width="92" height="7" fill="#B8001A"/>' +
      '<rect x="49" y="46" width="8" height="158" rx="4" fill="#fff" opacity=".07"/>' +
      '</g>' +
      // Le papier cadeau du club, le ruban or et l'étiquette (un gant rouge dessus).
      '<g class="xm-paper">' +
      '<rect x="32" y="38" width="96" height="174" rx="21" fill="url(#xmPaper)"/>' +
      '<rect x="32" y="38" width="96" height="174" rx="21" fill="url(#xmStars)"/>' +
      '<rect x="48" y="44" width="9" height="162" rx="4.5" fill="#fff" opacity=".12"/>' +
      '<rect x="72" y="38" width="16" height="174" fill="url(#xmRibbon)"/>' +
      '<path d="M32 117c30 9 66 9 96 0v15c-30 9-66 9-96 0z" fill="url(#xmRibbon)"/>' +
      '<path d="M88 127c7 2 12 7 14 12" stroke="#F2B24A" stroke-width="1.4" fill="none"/>' +
      '<g transform="rotate(-12 110 146)"><path d="M100 138h22l6 8-6 8h-22z" fill="#F4EEDC"/><circle cx="104" cy="146" r="1.7" fill="#A86A14"/>' +
      '<path d="M109 142c1.5-2.5 6-2.6 7.3.5 1 2.4-.8 5.5-4 5.5h-2c-1.2 0-2.1-.9-2.1-2z" fill="#E8001C"/></g>' +
      '</g>' +
      // La glace (boutique gelée) : du givre sur le papier, des stalactites dessous, la neige
      // posée dessus. Elle cède palier par palier sous les coups.
      '<g class="xm-ice">' +
      '<g class="xm-ice__sheen"><rect x="32" y="38" width="96" height="174" rx="21" fill="url(#xmIce)"/>' +
      '<g fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".85">' +
      '<path d="M36 198l15-13M43 203l8-18M35 187h16M47 178l4 11M40 191l9-1M45 197l6-5"/>' +
      '<path d="M124 58l-14 12M117 53l-8 16M125 69l-16-1M113 77l-3-9M119 64l-8 1"/>' +
      '<path d="M122 200l-13-10M125 190l-15-2M115 204l-6-14M118 196l-8-2"/>' +
      '<path d="M38 62l12 9M35 72l14-1M44 56l5 13"/></g>' +
      '<g fill="#fff"><path d="M56 96l1.2 3.4 3.4 1.2-3.4 1.2-1.2 3.4-1.2-3.4-3.4-1.2 3.4-1.2z"/><path d="M108 164l1 2.8 2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1z"/><path d="M102 92l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" opacity=".8"/></g></g>' +
      '<g class="xm-ice__icicles" fill="url(#xmIcicle)">' +
      '<path d="M43 207c2 6 3.2 13 4.2 21 1-8 2.8-15 5-21z"/><path d="M59 211c1.6 8 2.8 17 3.8 29 1-12 2.6-21 4.6-29z"/>' +
      '<path d="M81 212c1 5 2 11 2.8 18 .8-7 1.9-13 3.4-18z"/><path d="M97 211c1.4 7 2.5 15 3.5 25 1-10 2.3-18 4.3-25z"/>' +
      '<path d="M112 207c1 4 1.8 9 2.5 14 .6-5 1.5-10 2.7-14z"/></g>' +
      '<g class="xm-ice__cap">' +
      '<path d="M29 51c-2-9 6-15 16-13 5-6 15-8 23-4 5-4 12-5 18-2 7-4 17-2 22 3 10-1 18 5 17 14-1 5-6 7-12 6-6 4-14 2-19 0-6 3-14 3-20 0-7 4-15 3-21 0-8 3-19 2-24-4z" fill="#fff"/>' +
      '<path d="M30 53c6 5 16 5 23 2 6 3 14 4 21 0 6 3 14 3 20 0 5 2 13 4 19 0 5 1 10 0 12-4-1 5-6 8-12 7-6 4-14 2-19 0-6 3-14 3-20 0-7 4-15 3-21 0-8 3-19 2-23-5z" fill="#C5D8EC"/></g>' +
      '</g>' +
      '</svg>' +
      // Les déchirures : le papier cède par endroits et laisse voir le cuir et une lumière dorée.
      '<span class="xm-tears"><svg viewBox="0 0 160 220" aria-hidden="true" focusable="false">' +
      '<g class="xm-tear xm-tear--1"><path d="M42 58l9-4 3 7 8-5 2 9 6 1-4 8 5 6-9 3-2 8-7-6-8 3 1-8-6-5 6-5z" fill="url(#xmGlowHole)"/>' +
      '<path d="M44 60l7-3 2 6 7-4 2 8" fill="none" stroke="#FFB347" stroke-width="1" opacity=".75"/>' +
      '<path d="M61 70l10 4-6 9z" fill="#F2405A" opacity=".9"/></g>' +
      '<g class="xm-tear xm-tear--2"><path d="M98 150l8-6 4 6 9-2-1 9 7 5-8 5 1 9-9-2-5 7-4-8-8 1 3-8-6-6 8-3z" fill="url(#xmGlowHole)"/>' +
      '<path d="M100 151l7-5 3 5 8-2" fill="none" stroke="#FFB347" stroke-width="1" opacity=".75"/>' +
      '<path d="M96 168l-9 6 3-11z" fill="#F2405A" opacity=".9"/></g>' +
      '<g class="xm-tear xm-tear--3"><path d="M38 136l12-5 4 8 10-3-1 11 8 6-9 6 2 11-11-3-6 8-5-9-6 1z" fill="url(#xmGlowHole)"/>' +
      '<path d="M40 137l10-4 4 7 9-2" fill="none" stroke="#FFB347" stroke-width="1" opacity=".75"/>' +
      '<path d="M66 154l12 3-9 8z" fill="#F2405A" opacity=".9"/></g>' +
      '</svg></span>' +
      // Le nœud, sa propre couche : il s'envole au K.O. et revient pour la revanche.
      '<span class="xm-bow"><svg viewBox="0 0 160 220" aria-hidden="true" focusable="false">' +
      '<path d="M80 38c-6-16-30-22-34-10-3 9 14 14 34 10z" fill="url(#xmRibbon)"/>' +
      '<path d="M80 38c6-16 30-22 34-10 3 9-14 14-34 10z" fill="url(#xmRibbon)"/>' +
      '<path d="M76 40c-7 9-11 20-10 30l7-5 4 6c0-11 1-21 2-30z" fill="#C98A24"/>' +
      '<path d="M84 40c7 9 11 20 10 30l-7-5-4 6c0-11-1-21-2-30z" fill="#C98A24"/>' +
      '<ellipse cx="80" cy="38" rx="7" ry="6" fill="#FFE2A0"/><ellipse cx="80" cy="38" rx="7" ry="6" fill="none" stroke="#A86A14" stroke-width="1.2"/>' +
      '<path d="M58 27c4-2 9 0 12 4" fill="none" stroke="#fff" stroke-width="1.4" opacity=".55" stroke-linecap="round"/>' +
      '</svg></span>'
    );
  }

  // L'emballage qui passe sur la carte : deux pans de papier déchirés et un ruban.
  const WRAP_HTML =
    '<div class="xm-wrap" aria-hidden="true">' +
    '<span class="xm-wrap__half xm-wrap__half--l"></span><span class="xm-wrap__half xm-wrap__half--r"></span>' +
    '<span class="xm-wrap__ribbon"></span><span class="xm-wrap__knot"></span>' +
    '</div>';

  const ICONS = {
    snow:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2M4.2 10.6l3.2-.9-.7-3.3M19.8 13.4l-3.2.9.7 3.3M4.2 13.4l3.2.9-.7 3.3M19.8 10.6l-3.2-.9.7-3.3"/></svg>',
    gift:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="18" height="12" rx="2" fill="#E8001C"/><rect x="2" y="7" width="20" height="4" rx="1.4" fill="#C4001A"/><rect x="10.5" y="7" width="3" height="14" fill="#F2B24A"/><path d="M12 7C9.5 3 5.5 4 6.5 6.2 7.2 7.6 10 7.4 12 7zM12 7c2.5-4 6.5-3 5.5-.8C16.8 7.6 14 7.4 12 7z" fill="#F2B24A"/></svg>',
  };

  /* ---------- État ---------- */

  const S = {
    w: 0, h: 0, rect: null, topOffset: 0, startAt: 0,
    mode: 'none',
    running: false, looping: false, raf: 0, last: 0,
    pointer: { x: 0, y: 0, t: 0, vx: 0, vy: 0, lastFling: 0 },
    // Le geste en cours au doigt : départ, dernier point, vitesse lissée, coups déjà portés.
    touch: { id: null, x0: 0, y0: 0, x: 0, y: 0, t: 0, vx: 0, vy: 0, moved: false, onBag: false, inBag: false, hitAt: -1e9, hits: 0 },
    bag: {
      px: 0, py: 0, chain: 0, bw: 0, bh: 0, scale: 1,
      theta: 0, omega: 0, y: 0, vy: 0,
      squash: 0, squashV: 0, freezeUntil: 0, pending: null,
      hp: CFG.maxHp, round: 1, ko: false, koAt: 0, drop: 0,
      punches: 0, combo: 0, lastHit: -1e9, lastPointerHit: -1e9, flare: 0, hasBeenHit: false,
    },
    trauma: 0, shakeX: 0, shakeY: 0,
    hint: { shown: false, ok: true, coached: false },
    price: null,
  };

  /* ---------- Construction ---------- */

  let back, front, bagEl, swingEl, chainEl, bodyEl, hitEl, glowEl, bowEl, hud, hpFill, hpTrail, roundEl, hintEl, scrim, card, controls;
  let ro = null;
  let io = null;
  let idleAnim = null;

  function build() {
    // Le décor du fond : du givre aux coins et quelques lumières floues, une image fixe.
    back = el('div', 'xm-back', '<div class="xm-frost"></div><div class="xm-bokeh"></div>');
    back.setAttribute('aria-hidden', 'true');

    front = el('div', 'xm-front');
    bagEl = el('div', 'xm-bag');
    swingEl = el('div', 'xm-swing');
    chainEl = el('div', 'xm-chain');
    bodyEl = el('div', 'xm-body');
    glowEl = el('div', 'xm-glow');
    hitEl = el('button', 'xm-hit', giftHtml());
    hitEl.type = 'button';
    hitEl.setAttribute('aria-label', soft ? 'Frapper le cadeau (jeu de Noël)' : 'Ouvrir le cadeau à la boxe — jeu de Noël');
    bowEl = hitEl.querySelector('.xm-bow');
    bodyEl.append(glowEl, hitEl);
    swingEl.append(chainEl, bodyEl);
    bagEl.append(swingEl);

    hud = el(
      'div',
      'xm-hud',
      `<div class="xm-hp"><span>${frozen ? 'Glace' : 'Cadeau'}</span>` + '<span class="xm-hp__bar"><span class="xm-hp__trail"></span><span class="xm-hp__fill"></span></span><span class="xm-round">R1</span></div>'
    );
    hpFill = hud.querySelector('.xm-hp__fill');
    hpTrail = hud.querySelector('.xm-hp__trail');
    roundEl = hud.querySelector('.xm-round');

    // Au doigt, l'indice dit le geste : on tape, ou on glisse dessus.
    hintEl = el(
      'div',
      'xm-hint',
      frozen
        ? `<span class="xm-hint__lead">Tout est gelé ici…</span><strong>${coarse ? 'Tape' : 'Frappe'} le cadeau pour réchauffer.</strong>`
        : soft
          ? 'Un cadeau pendu comme un sac…<strong>Frappe-le !</strong>'
          : coarse
            ? 'Un cadeau t’attend…<strong>Tape-le, glisse dessus.</strong>'
            : 'Un cadeau t’attend…<strong>Ouvre-le à la boxe.</strong>'
    );
    hintEl.setAttribute('aria-hidden', 'true');

    card = el('div', 'xm-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Ton cadeau de Noël');
    scrim = el('div', 'xm-scrim');
    scrim.addEventListener('click', closeCard);

    controls = el('div', 'xm-controls');
    const offBtn = el('button', 'xm-ctl xm-ctl--off', ICONS.snow);
    offBtn.type = 'button';
    offBtn.setAttribute('aria-label', 'Couper les décorations de Noël');
    offBtn.title = 'Couper les décorations de Noël';
    offBtn.dataset.track = 'noel_off';
    controls.append(offBtn);
    offBtn.addEventListener('click', () => switchOff());

    front.append(bagEl, hud, hintEl, scrim, card, controls);

    // Insertion : le fond juste au-dessus du voile, le premier plan au-dessus du contenu.
    const veil = hero.querySelector(':scope > .hero__veil');
    if (veil) veil.after(back);
    else hero.prepend(back);
    hero.append(front);
    // Le défilement vertical reste au navigateur ; les gestes de côté reviennent au jeu.
    hero.classList.add('xm-gestures');

    // Un seul jeu d'écouteurs par scène : coupés d'un coup au démontage (interrupteur).
    S.ac = new AbortController();
    const on = { signal: S.ac.signal };
    const pas = { passive: true, signal: S.ac.signal };
    hitEl.addEventListener('pointerdown', onBagPointerDown, on);
    hitEl.addEventListener('click', onBagClick, on);
    hero.addEventListener('pointermove', onPointerMove, pas);
    hero.addEventListener('pointerdown', onPointerDown, pas);
    window.addEventListener('pointerup', onPointerUp, pas);
    window.addEventListener('pointercancel', onPointerCancel, pas);
    window.addEventListener('scroll', () => { S.rect = null; }, pas);
    doc.addEventListener('visibilitychange', syncRunning, on);
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card.classList.contains('is-on')) closeCard(); }, on);
    if (frozen) doc.addEventListener('bc:noel-heat', onHeat, on);

    // Invisible jusqu'à la première mise en place : pas un cadeau dans le coin.
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

  /* ---------- Mise en place : le cadeau ne doit jamais toucher un texte ou un bouton ---------- */

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
    const skip = (n) => !n || n.closest('.xm-front, .xm-back, .hero__stage, .page-hero__video-wrap');
    // Tout texte visible est un obstacle, quel que soit son conteneur. On mesure les lignes, pas
    // les blocs : un titre ne remplit pas sa largeur.
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
  // L'indice posé à côté du cadeau (petits écrans) : taille fixée en CSS, pour ne rien mesurer.
  const SIDE_HINT = { w: 150, h: 52 };

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
    // Toutes les mesures d'abord, toutes les écritures ensuite : une seule mise en page forcée.
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
    front.style.setProperty('--xm-top', S.topOffset + 12 + 'px');

    const b = S.bag;
    const sizeBag = (bw) => {
      b.bw = bw;
      b.scale = bw / 160;
      b.bh = 220 * b.scale;
    };
    const ideal = clamp(S.h * 0.24, 64, 230);
    // La place du bouton se calcule (36 px) : la mesurer forçait une mise en page de la page.
    const ctlW = 36;
    const ctlBox = (left) => ({ x: left ? 12 : S.w - 12 - ctlW, y: S.topOffset + 12, w: ctlW, h: 36 });
    const tryPlace = () => {
      const obstacles = text.concat([ctlBox(controls.classList.contains('xm-controls--left'))]);
      for (const fx of [0.8, 0.86, 0.74, 0.9, 0.68, 0.62, 0.56]) {
        for (const f of [1, 0.8, 0.62, 0.45]) {
          const chain = ideal * f;
          const px = S.w * fx;
          const top = S.topOffset;
          const box = swingBox(px, top, chain);
          const chainBox = { x: px - 6, y: top, w: 12, h: chain };
          // Toute la course doit rester dans l'écran : un cadeau coupé au bord, c'est raté.
          if (box.x < 4 || box.x + box.w > S.w - 4 || box.y + box.h > S.h - 16) continue;
          if (obstacles.some((o) => hits(box, o, 14) || hits(chainBox, o, 6))) continue;
          return { px, py: top, chain };
        }
      }
      return null;
    };
    // Le bouton est à droite ; s'il prend la seule place du sac, il passe à gauche. Sur un hero
    // court (téléphone), un cadeau plus petit trouve encore sa place.
    let placed = null;
    for (const bw of [clamp(S.w * 0.1, 86, 150), 72, 60]) {
      sizeBag(bw);
      controls.classList.remove('xm-controls--left');
      placed = tryPlace();
      if (!placed) {
        controls.classList.add('xm-controls--left');
        placed = tryPlace();
        if (!placed) controls.classList.remove('xm-controls--left');
      }
      if (placed) break;
    }

    S.mode = placed ? 'full' : 'none';
    bagEl.hidden = !placed;
    hud.hidden = !placed;
    hintEl.hidden = !placed;
    if (placed) {
      b.px = placed.px;
      b.py = placed.py;
      b.chain = placed.chain;
      chainEl.style.height = b.chain + 'px';
      bodyEl.style.cssText = `width:${b.bw}px;height:${b.bh}px;left:${-b.bw / 2}px;top:${b.chain - 6 * b.scale}px`;
      hitEl.style.width = b.bw + 'px';
      hitEl.style.height = b.bh + 'px';
      const g = b.bw * 2.2;
      glowEl.style.cssText = `width:${g}px;height:${g}px;left:${(b.bw - g) / 2}px;top:${(b.bh - g) / 2 + 20 * b.scale}px`;
    }
    renderHud();
    placeHud(text);
    render();
    // Le cadeau qui descend (arrivée, revanche) a besoin de la physique ; sinon il se balance seul.
    if (S.bag.drop > 0) kick();
    else if (!S.looping) startIdle();
  }

  function placeHud(measured) {
    if (S.mode !== 'full') return;
    const b = S.bag;
    const hw = 190;
    const x = clamp(b.px - hw / 2, 8, S.w - hw - 8);
    hud.style.transform = `translate(${x}px, ${b.py + b.chain - 30}px)`;
    hud.style.width = hw + 'px';
    // L'indice : sous le cadeau de préférence, sinon à côté, sinon au-dessus — et nulle part s'il
    // couvrirait un texte.
    const hw2 = S.hintSize.w;
    const hh = S.hintSize.h;
    const top = b.py + b.chain;
    let spot = null;
    let side = 0;
    S.hintBottom = null;
    if (frozen && S.w < 600) {
      // Petit écran : l'indice tient en une ligne, sur la chaîne, juste au-dessus de la barre de
      // glace (elle ne sort qu'au premier coup) et à gauche du bouton « couper ».
      const bottom = top - 38;
      spot = freeSpot(hw2, hh, [[clamp(b.px - hw2 / 2, 8, S.w - hw2 - 60), bottom - hh]], [], measured);
      if (spot) S.hintBottom = bottom;
      else {
        // Hero court (un iPhone dans Safari, barres comprises : 664 px) : la chaîne est trop courte
        // pour porter l'indice. Il passe sur deux lignes à côté du cadeau, une pointe tournée vers
        // lui — sous la guirlande, loin du bouton « couper » et de tout texte.
        const sw = SIDE_HINT.w;
        const sh = SIDE_HINT.h;
        const half = b.bw * 0.62 + 6;
        const idle = { x: b.px - half, y: top - 8, w: half * 2, h: b.bh + 20 };
        const ctl = { x: controls.classList.contains('xm-controls--left') ? 12 : S.w - 48, y: S.topOffset + 12, w: 36, h: 36 };
        const minY = S.topOffset + 32;
        // À hauteur du nœud de préférence ; sinon plus haut, le long de la chaîne (le logo du
        // hero est juste dessous sur les écrans courts) ; sinon plus bas.
        const ys = [top + b.bh * 0.34 - sh / 2, top - 4, top - 14, top - sh * 0.5, minY, top + 14, top + b.bh * 0.6 - sh / 2, top + b.bh - sh].map((y) => Math.max(y, minY));
        for (const s of b.px > S.w / 2 ? [-1, 1] : [1, -1]) {
          const x = s < 0 ? idle.x - 12 - sw : idle.x + idle.w + 12;
          spot = freeSpot(sw, sh, ys.map((y) => [x, y]), [idle, ctl], measured);
          if (spot) {
            side = s;
            break;
          }
        }
      }
    }
    // À côté du cadeau, la leçon des coups n'a pas la place : le cadeau se balancerait dessus.
    S.hint.side = !!side;
    hintEl.classList.toggle('is-side', !!side);
    hintEl.classList.toggle('is-side--right', side > 0);
    // Sur la chaîne, l'indice est tenu par son pied : la leçon des coups, plus haute, monte
    // d'elle-même sans qu'on ait à la mesurer.
    hintEl.style.top = S.hintBottom != null ? 'auto' : '';
    hintEl.style.bottom = S.hintBottom != null ? (S.h - S.hintBottom).toFixed(1) + 'px' : '';
    if (!spot && !side) {
      spot = freeSpot(hw2, hh, [
        [b.px - hw2 / 2, top + b.bh + 30],
        [b.px - b.bw * 0.62 - hw2 - 12, top + b.bh * 0.3],
        [b.px + b.bw * 0.62 + 12, top + b.bh * 0.3],
        [b.px - hw2 / 2, top - 30 - hh - 10],
      ], [bagBox()], measured);
    }
    S.hint.ok = !!spot;
    if (spot) hintEl.style.transform = S.hintBottom != null ? `translate(${spot.x}px, 0)` : `translate(${spot.x}px, ${spot.y}px)`;
    else hintEl.classList.remove('is-on');
  }

  /* ---------- Le balancement au repos : une animation de la carte graphique ---------- */

  function startIdle(dir) {
    if (idleAnim) idleAnim.cancel();
    idleAnim = null;
    if (reduce || S.mode !== 'full' || S.dead) return;
    const b = S.bag;
    const base = `translate(${b.px.toFixed(1)}px,${b.py.toFixed(1)}px)`;
    const a = CFG.idleSwayDeg;
    idleAnim = swingEl.animate(
      [{ transform: `${base} rotate(${-a}deg)` }, { transform: `${base} rotate(${a}deg)` }],
      { duration: CFG.idleSwayMs, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' }
    );
    // On part du milieu de la course (angle nul), dans le sens où le sac allait : aucun saut après
    // la physique. L'aller monte vers +2°, le retour (deuxième itération) redescend vers −2°.
    idleAnim.currentTime = dir < 0 ? CFG.idleSwayMs * 1.5 : CFG.idleSwayMs / 2;
    if (S.visible === false || doc.hidden) idleAnim.pause();
  }

  // Le visiteur frappe : la physique reprend la main à l'angle exact où le balancement était.
  function stopIdle() {
    if (!idleAnim) return;
    const m = new DOMMatrixReadOnly(getComputedStyle(swingEl).transform);
    S.bag.theta = Math.atan2(m.b, m.a);
    S.bag.omega = 0;
    idleAnim.cancel();
    idleAnim = null;
    swingEl._t = null;
  }

  /* ---------- Entrées ---------- */

  function local(e) {
    const r = S.rect || (S.rect = hero.getBoundingClientRect());
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // La direction du geste donne le coup : de côté un crochet, vers le haut un uppercut, vers le bas
  // un direct. Même règle au doigt et pour un revers de souris.
  function swipeType(vx, vy) {
    if (Math.abs(vx) >= Math.abs(vy) * 0.8) return 'crochet';
    return vy < 0 ? 'uppercut' : 'direct';
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
    if (e.pointerType !== 'mouse') {
      if (S.touch.id === e.pointerId) onTouchMove(p, t);
      return;
    }
    // Un revers de souris rapide à travers le cadeau compte comme un coup.
    if (S.mode === 'full') {
      const speed = Math.hypot(P.vx, P.vy);
      const c = bagCenter();
      if (speed > CFG.flingSpeed && t - P.lastFling > CFG.flingCooldownMs && Math.hypot(p.x - c.x, p.y - c.y) < S.bag.bw * 0.55) {
        P.lastFling = t;
        userHit(p.x, p.y, clamp(speed / 3, 0.5, 1.4), P.vx, swipeType(P.vx, P.vy), Math.atan2(P.vy, P.vx));
      }
    }
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse') return;
    const p = local(e);
    const onBag = !!(e.target && e.target.closest && e.target.closest('.xm-hit'));
    Object.assign(S.touch, { id: e.pointerId, x0: p.x, y0: p.y, x: p.x, y: p.y, t: now(), vx: 0, vy: 0, moved: false, onBag, inBag: onBag, hits: 0 });
  }

  // Le geste traverse-t-il le cadeau ? On teste le segment parcouru depuis le dernier point, pas
  // le seul point d'arrivée : un geste vif saute 40 px d'un événement à l'autre.
  function crossesBag(ax, ay, bx, by) {
    const c = bagCenter();
    const R = S.bag.bw * 0.62 + 10;
    const dx = bx - ax;
    const dy = by - ay;
    const k = clamp(((c.x - ax) * dx + (c.y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const qx = ax + dx * k - c.x;
    const qy = ay + dy * k - c.y;
    return qx * qx + qy * qy < R * R;
  }

  function onTouchMove(p, t) {
    const T = S.touch;
    const dt = Math.max(1, t - T.t);
    // Vitesse lissée : un seul événement est trop bruité pour donner la direction d'un coup.
    T.vx = T.vx * 0.35 + ((p.x - T.x) / dt) * 0.65;
    T.vy = T.vy * 0.35 + ((p.y - T.y) / dt) * 0.65;
    if (!T.moved && Math.hypot(p.x - T.x0, p.y - T.y0) > CFG.tapSlop) T.moved = true;
    const inside = S.mode === 'full' && crossesBag(T.x, T.y, p.x, p.y);
    const speed = Math.hypot(T.vx, T.vy);
    // Un coup par passage : il faut ressortir du cadeau pour le frapper à nouveau.
    const fresh = !T.inBag || T.hits === 0;
    if (inside && T.moved && fresh && speed > CFG.swipeSpeed && t - T.hitAt > CFG.swipeCooldownMs) {
      T.hitAt = t;
      T.hits += 1;
      const b = S.bag;
      const c = bagCenter();
      const x = c.x + clamp(p.x - c.x, -b.bw * 0.4, b.bw * 0.4);
      const y = c.y + clamp(p.y - c.y, -b.bh * 0.4, b.bh * 0.4);
      userHit(x, y, clamp(speed / 1.1, 0.6, 1.5), T.vx, swipeType(T.vx, T.vy), Math.atan2(T.vy, T.vx));
    }
    T.inBag = inside;
    T.x = p.x;
    T.y = p.y;
    T.t = t;
  }

  function onPointerUp(e) {
    const T = S.touch;
    if (!e || T.id !== e.pointerId) return;
    // Un tap sur le cadeau : le coup part au relâcher, pour qu'un geste ne commence pas par un
    // jab. Taper un côté donne un crochet, le bas un uppercut.
    if (T.onBag && !T.moved && !T.hits && S.mode === 'full') {
      S.bag.lastPointerHit = now();
      userHit(T.x0, T.y0, 1, 0);
    }
    T.id = null;
  }

  function onPointerCancel(e) {
    if (e && S.touch.id === e.pointerId) S.touch.id = null;
  }

  function onBagPointerDown(e) {
    // Au doigt, le coup part au relâcher ou au geste (voir onPointerUp / onTouchMove).
    if (e.pointerType !== 'mouse') return;
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

  function userHit(x, y, power, flingVx, forced, angle) {
    const b = S.bag;
    if (S.mode !== 'full' || b.drop > 0) return;
    // Carte fermée, cadeau ouvert : le frapper en remet un neuf.
    if (b.ko) {
      if (!card.classList.contains('is-on') && now() - b.koAt > 1600) rematch();
      return;
    }
    kick();
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
    const dmg = hit.dmg + (b.combo >= 3 ? 1 : 0);
    b.hp = Math.max(0, b.hp - dmg);
    b.punches += 1;
    const ko = b.hp === 0;
    b.freezeUntil = t + (ko ? CFG.hitStop.ko : CFG.hitStop[type]);
    b.pending = { domega: -side * hit.impulse * power * (ko ? 1.6 : 1), vy: hit.bounce * power };
    b.squash = ko ? 0.26 : 0.12 + 0.035 * hit.dmg;
    b.flare = 1;
    if (!reduce) S.trauma = Math.min(1, S.trauma + CFG.shakePx[ko ? 'ko' : type] / CFG.shakePx.ko);
    // La neige qui couvrait le cadeau tombe ; quand le papier cède, il en part des lambeaux.
    burst(x, y, -side, 5 + hit.dmg * 2, b.hp < CFG.maxHp * 0.7 ? 'mix' : 'snow');
    if (angle != null) swoosh(x, y, angle);

    // Un geste dit son nom (crochet, uppercut) : c'est comme ça qu'on apprend les coups.
    let label = hit.label;
    let big = false;
    if (b.combo >= 3) { label = 'Combo ×' + b.combo; big = true; }
    else if (b.combo === 2 && !forced) { label = 'Une-deux !'; big = true; }
    if (!ko) {
      // Au-dessus du cadeau, jamais sur lui ; un seul cri à la fois.
      const c = bagCenter();
      const sideX = c.x + (b.punches % 2 ? -1 : 1) * b.bw * 0.42;
      const cy = Math.min(c.y - b.bh * 0.62, b.py + b.chain - 62);
      callout(label, clamp(sideX, 60, S.w - 60), Math.max(cy, S.topOffset + 24), big ? 'xm-callout--big' : '', true);
    }

    if (!b.hasBeenHit) {
      b.hasBeenHit = true;
      hint(false);
      hud.classList.add('is-on');
      track('noel_first_hit', { page: location.pathname });
      // Après le premier coup, une ligne apprend les deux autres — une seule fois.
      if (!soft) setTimeout(coach, 1100);
    }
    S.bag.lastUserHit = t;
    renderHud();
    buzz(ko ? BUZZ.ko : BUZZ[type]);
    const hr = S.rect || (S.rect = hero.getBoundingClientRect());
    const bc = bagCenter();
    tell('bc:noel-hit', { ratio: 1 - b.hp / CFG.maxHp, ko, type, x: hr.left + bc.x, y: hr.top + bc.y });
    if (ko) knockout();
  }

  function knockout() {
    const b = S.bag;
    b.ko = true;
    b.koAt = now();
    const c = bagCenter();
    clearCallout();
    // La leçon des coups se retire : la place est aux cloches.
    hintEl.classList.remove('is-on');
    callout('K.O.', clamp(c.x, S.w * 0.18, S.w * 0.82), c.y - b.bh * 0.15, 'xm-callout--ko');
    // Cloche du ring, cloches de Noël.
    const bell = callout('Ding', clamp(b.px, 90, S.w - 90), b.py + b.chain - 52, 'xm-callout--bell');
    [0, 0.32, 0.64].forEach((d, i) => {
      setTimeout(() => { bell.textContent = ['Ding', 'Ding · Dong', 'Ding · Dong · Ding'][i]; }, d * 1000);
    });
    setTimeout(() => openGift(c), 160);
    setTimeout(showCard, 1400);
    track('noel_ko', { round: b.round, punches: b.punches, page: location.pathname });
    S.heat = 1;
    tell('bc:noel-ko', { round: b.round });
  }

  // Le cadeau s'ouvre : le nœud s'envole, le papier éclate en confettis, la lumière sort du sac.
  function openGift(c) {
    if (S.dead) return;
    bagEl.classList.add('is-open');
    kick();
    burst(c.x, c.y - S.bag.bh * 0.15, 1, soft ? 30 : 34, 'open');
    if (reduce) return;
    const dir = Math.random() < 0.5 ? -1 : 1;
    bowEl.animate(
      [
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${dir * 30}%,-34%) rotate(${dir * 40}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dir * 60}%,40%) rotate(${dir * 160}deg)`, opacity: 0 },
      ],
      { duration: 1100, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' }
    );
    const flash = el('span', 'xm-burst');
    bodyEl.append(flash);
    flash.animate([{ transform: 'scale(.2)', opacity: 0.95 }, { transform: 'scale(2.6)', opacity: 0 }], { duration: 760, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => flash.remove();
  }

  // La boutique regèle quand on cesse de frapper (noel-hiver.js l'annonce, deux fois par seconde) :
  // la glace du cadeau revient au même rythme, et sa barre remonte avec elle. Un cadeau déjà
  // ouvert ne se referme pas ; mais une fois le froid revenu, un cadeau neuf redescend tout seul.
  function onHeat(e) {
    if (S.dead || !e.detail || S.mode !== 'full') return;
    const b = S.bag;
    const v = clamp(e.detail.v, 0, 1);
    S.heat = v;
    if (b.ko) {
      regift();
      return;
    }
    const hp = Math.min(CFG.maxHp, CFG.maxHp * (1 - v));
    if (hp > b.hp + 0.005) {
      b.hp = hp;
      renderHud();
    }
  }

  // Cadeau ouvert, carte fermée, froid revenu : un cadeau neuf, gelé, redescend de lui-même.
  function regift() {
    const b = S.bag;
    if (S.dead || !frozen || !b.ko || b.drop > 0 || S.heat == null || S.heat >= 0.3) return;
    if (card.classList.contains('is-on') || now() - b.koAt < 4000) return;
    rematch(true);
  }

  // Un cadeau neuf : demandé (bouton, coup sur le sac ouvert) ou revenu de lui-même avec le froid
  // (quiet : ni annonce de round ni prise du focus).
  function rematch(auto) {
    const quiet = auto === true;
    const b = S.bag;
    stopPossession();
    card.classList.remove('is-on');
    scrim.classList.remove('is-on');
    front.classList.remove('has-overlay');
    bagEl.classList.remove('is-gone', 'is-open');
    b.round += 1;
    b.hp = CFG.maxHp;
    b.punches = 0;
    b.combo = 0;
    b.ko = false;
    b.drop = 1;
    b.theta = 0;
    b.omega = 0;
    bagEl.dataset.dmg = '0';
    // Un cadeau neuf descend du plafond, nœud compris.
    for (const a of bowEl.getAnimations()) a.cancel();
    renderHud();
    kick();
    tell('bc:noel-rematch', { round: b.round });
    if (quiet) return;
    setTimeout(() => {
      const c = bagCenter();
      callout('Round ' + b.round, c.x, c.y - b.bh * 0.2, 'xm-callout--big');
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
      S.price = euro(raw);
    } catch (e) {
      S.price = '';
    }
    return S.price;
  }

  function offerHtml(o, i) {
    // Chaque mot vient des données de la formule : rythme, durée réelle, public du club.
    const eyebrow = o.per === '/ 4 semaines' ? 'Toutes les 4 semaines' : i > 0 && o.year ? 'Ou toute l’année' : o.audience || (i > 0 ? 'Ou bien' : '');
    const href = `${link('/inscription')}?product=${encodeURIComponent(o.id)}`;
    return (
      `<div class="xm-offer${i === 0 ? ' is-on' : ''}" data-i="${i}"${i === 0 ? '' : ' aria-hidden="true"'}>` +
      `<p class="xm-offer__eyebrow">${esc(eyebrow)}</p>` +
      `<p class="xm-offer__name">${esc(o.name)}</p>` +
      `<p class="xm-offer__price"><span class="xm-offer__num" data-final="${esc(o.price)}">${esc(o.price)}</span>` +
      (o.per ? `<span class="xm-offer__per">${esc(o.per)}</span>` : '') + '</p>' +
      (o.note ? `<p class="xm-offer__note">${esc(o.note)}</p>` : '') +
      `<a class="btn xm-card__cta" href="${href}"${i === 0 ? '' : ' tabindex="-1"'} data-track="noel_ko_offer_${esc(o.id)}">Je choisis · ${esc(o.price)}</a>` +
      '</div>'
    );
  }

  async function showCard() {
    if (S.dead) return;
    const b = S.bag;
    const coups = b.punches > 1 ? `${b.punches} coups` : '1 coup';
    const offers = await loadOffers();
    if (offers.length === 2) {
      card.innerHTML =
        `<p class="xm-card__kicker">Ouvert en ${coups}</p>` +
        `<p class="xm-card__title">${soft ? 'Joyeux Noël, champion !' : 'Ce Noël, offre-toi le ring.'}</p>` +
        `<div class="xm-offers">${offers.map(offerHtml).join('')}${WRAP_HTML}</div>` +
        '<div class="xm-card__foot"><span class="xm-dots">' +
        offers.map((o, i) => `<button type="button" class="xm-dot" aria-pressed="${i === 0}" aria-label="Voir ${esc(o.name)} à ${esc(o.price)}"></button>`).join('') +
        '</span><button type="button" class="xm-card__again">Un autre cadeau</button></div>';
      stopPossession();
      const sh = { i: 0, busy: false, stopped: false, moved: false, timer: 0, round: b.round, shifts: 0 };
      S.shift = sh;
      // Seul un choix explicite (un point) arrête l'alternance : la carte apparaît souvent sous
      // la souris qui vient de frapper, et la survoler n'est pas un choix.
      card.querySelectorAll('.xm-dot').forEach((d, i) => d.addEventListener('click', () => {
        sh.stopped = true;
        clearTimeout(sh.timer);
        shiftTo(i);
      }));
      card.addEventListener('pointermove', () => { sh.moved = true; }, { passive: true, once: true });
    } else {
      const price = await priceLabel();
      const onEssai = /seance-essai/.test(location.pathname);
      card.innerHTML =
        `<p class="xm-card__kicker">Ouvert en ${coups}</p>` +
        '<p class="xm-card__title">Ce Noël, offre-toi le ring.</p>' +
        '<p class="xm-card__text">Séance d’essai sans engagement, débutants bienvenus, dans l’une des salles du club.</p>' +
        `<div class="xm-card__actions"><a class="btn xm-card__cta" href="${onEssai ? '#' : link('/seance-essai')}" data-track="noel_ko_cta">Réserver ma séance${price ? ' · ' + price : ''}</a>` +
        '<button type="button" class="xm-card__again">Un autre cadeau</button></div>';
      if (onEssai) {
        card.querySelector('.xm-card__cta').addEventListener('click', (e) => {
          e.preventDefault();
          const target = hero.nextElementSibling || doc.querySelector('main');
          if (target) target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        });
      }
    }
    card.insertAdjacentHTML('afterbegin', '<button type="button" class="xm-card__close" aria-label="Fermer">×</button>');
    card.querySelector('.xm-card__close').addEventListener('click', closeCard);
    card.querySelector('.xm-card__again').addEventListener('click', rematch);
    placeCard();
    card.classList.add('is-on');
    // Au clavier, le focus suit le combat jusqu'à l'offre.
    if (now() - (S.bag.lastKeyHit || -1e9) < 4000) card.querySelector('.xm-card__cta').focus({ preventScroll: true });
    if (S.shift && card.querySelector('.xm-offers')) cycle(S.shift, CFG.offerShiftMs);
  }

  // 44,99 € d'abord ; puis la carte s'emballe et se déballe sur 400 €, puis revient, tant qu'elle
  // est ouverte — chaque formule le temps d'être lue.
  function cycle(sh, ms) {
    clearTimeout(sh.timer);
    sh.timer = setTimeout(async () => {
      if (S.dead || S.shift !== sh || sh.stopped || !card.classList.contains('is-on') || S.bag.round !== sh.round) return;
      // Hors écran ou onglet caché : la suite attend que le visiteur revienne la voir.
      if (doc.hidden || S.visible === false) return cycle(sh, 1500);
      // Jamais sous un curseur qu'on vient d'amener sur « Je choisis » : on n'échange pas l'offre
      // qu'il allait cliquer. Une souris restée immobile depuis le dernier coup ne compte pas.
      const cta = card.querySelector('.xm-offer.is-on .xm-card__cta');
      if (sh.moved && cta && cta.matches(':hover')) return cycle(sh, 700);
      await shiftTo(1 - sh.i);
      if (S.shift === sh && !sh.stopped) cycle(sh, CFG.offerDwellMs);
    }, ms);
  }

  function stopPossession() {
    if (!S.shift) return;
    S.shift.stopped = true;
    clearTimeout(S.shift.timer);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Les chiffres défilent en étoiles et en flocons avant de se fixer sur le vrai prix.
  function decode(node, final) {
    const glyphs = '✦❄★✧✶0123456789';
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
    const wrap = card.querySelector('.xm-offers');
    const cur = wrap.querySelector('.xm-offer.is-on');
    const next = wrap.querySelector(`.xm-offer[data-i="${i}"]`);
    const hadFocus = cur.contains(doc.activeElement);
    const swap = () => {
      cur.classList.remove('is-on');
      cur.setAttribute('aria-hidden', 'true');
      cur.querySelector('.xm-card__cta').tabIndex = -1;
      next.classList.add('is-on');
      next.removeAttribute('aria-hidden');
      const cta = next.querySelector('.xm-card__cta');
      cta.removeAttribute('tabindex');
      const num = next.querySelector('.xm-offer__num');
      decode(num, num.dataset.final);
      if (hadFocus) cta.focus({ preventScroll: true });
    };
    if (reduce) {
      swap();
    } else {
      // Le papier se referme sur la formule, le ruban la noue… puis tout se déchire, et l'autre
      // formule est dessous. Au retour, en miroir.
      card.classList.toggle('is-back', i === 0);
      card.classList.add('is-wrapping');
      await sleep(CFG.wrapSwapMs);
      swap();
      await sleep(CFG.wrapEndMs - CFG.wrapSwapMs);
      card.classList.remove('is-wrapping');
    }
    card.querySelectorAll('.xm-dot').forEach((d, k) => d.setAttribute('aria-pressed', String(k === i)));
    sh.i = i;
    sh.busy = false;
    // Une mesure par carte suffit : l'alternance tourne en boucle.
    if (!sh.shifts++) track('noel_offer_shift', { to: i, page: location.pathname });
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
    // sans que le visiteur l'ait demandé : la carte se ferme d'un geste.
    const overlay = !spot;
    const x = overlay ? (S.w - cw) / 2 : spot.x;
    const y = overlay ? clamp((S.h - ch) / 2, S.topOffset + 8, S.h - ch - 8) : spot.y;
    card.classList.toggle('is-overlay', overlay);
    scrim.classList.toggle('is-on', overlay);
    // Sous le voile, le bouton des décorations chevaucherait la carte : il revient à sa fermeture.
    front.classList.toggle('has-overlay', overlay);
    card.style.transform = `translate(${x}px, ${y}px)`;
    // Le sac ouvert s'efface si la carte prend sa place (et sa barre de vie avec lui).
    const rest = { x: b.px - b.bw * 0.62, y: b.py + b.chain - 34, w: b.bw * 1.24, h: b.bh + 40 };
    bagEl.classList.toggle('is-gone', hits({ x, y, w: cw, h: ch }, rest, 0));
  }

  function closeCard() {
    stopPossession();
    card.classList.remove('is-on');
    scrim.classList.remove('is-on');
    front.classList.remove('has-overlay');
    bagEl.classList.remove('is-gone');
    hitEl.focus({ preventScroll: true });
    // Si la boutique a déjà regelé pendant que la carte était ouverte, le cadeau neuf arrive.
    setTimeout(regift, 1200);
  }

  /* ---------- Particules, trace des gestes, annonces ---------- */

  // Des éclats réutilisés (40 au plus) : neige qui tombe du cadeau, lambeaux de papier, ruban,
  // paillettes dorées. Ils ne vivent que pendant la boucle d'un coup.
  const POOL = [];
  function particle() {
    let p = POOL.find((q) => !q.alive);
    if (!p) {
      if (POOL.length >= 40) return null;
      p = { node: el('span', 'xm-particle'), alive: false };
      front.append(p.node);
      POOL.push(p);
    }
    return p;
  }

  const KINDS = {
    snow: { cls: 'xm-particle--snow', g: 260, v: [60, 180], up: [40, 120], life: [0.7, 1.2] },
    paper: { cls: 'xm-particle--paper', g: 520, v: [140, 360], up: [100, 260], life: [0.8, 1.3] },
    gold: { cls: 'xm-particle--gold', g: 520, v: [140, 360], up: [100, 260], life: [0.8, 1.3] },
    spark: { cls: 'xm-particle--spark', g: 140, v: [80, 260], up: [120, 280], life: [0.6, 1] },
  };

  function burst(x, y, dir, n, mix) {
    if (reduce) return;
    const count = lowEnd ? Math.ceil(n / 2) : n;
    for (let i = 0; i < count; i++) {
      const p = particle();
      if (!p) break;
      const kind = mix === 'snow' ? 'snow' : mix === 'open' ? ['paper', 'gold', 'spark', 'paper', 'snow'][i % 5] : ['snow', 'paper', 'snow', 'gold'][i % 4];
      const K = KINDS[kind];
      p.node.className = 'xm-particle ' + K.cls;
      // Les éclats partent du côté opposé au poing ; à l'ouverture, dans toutes les directions.
      const a = mix === 'open' ? rand(-Math.PI, 0) : (dir > 0 ? 0 : Math.PI) + rand(-0.9, 0.9);
      const v = rand(K.v[0], K.v[1]);
      Object.assign(p, {
        alive: true, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - rand(K.up[0], K.up[1]),
        rot: rand(0, 360), vr: rand(-540, 540), life: 0, max: rand(K.life[0], K.life[1]), g: K.g,
      });
    }
    kick();
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
      p.node.style.opacity = (1 - Math.pow(p.life / p.max, 2)).toFixed(2);
      p.node.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) rotate(${p.rot.toFixed(0)}deg)`;
    }
  }

  // Le geste laisse une trace : un arc doré dans le sens du coup, joué par la carte graphique.
  const SWOOSH_SVG =
    '<svg viewBox="0 0 120 60" aria-hidden="true" focusable="false"><defs><linearGradient id="xmSwoosh" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#FFB347" stop-opacity="0"/><stop offset=".6" stop-color="#FFE2A0" stop-opacity=".85"/><stop offset="1" stop-color="#FFFFFF"/>' +
    '</linearGradient></defs><path d="M6 50C26 14 82 6 114 26" fill="none" stroke="url(#xmSwoosh)" stroke-width="7" stroke-linecap="round"/></svg>';
  const swooshes = [];
  function swoosh(x, y, angle) {
    if (reduce) return;
    let s = swooshes.find((q) => !q.busy);
    if (!s) {
      if (swooshes.length >= 3) return;
      s = { node: el('div', 'xm-swoosh', SWOOSH_SVG), busy: false };
      front.append(s.node);
      swooshes.push(s);
    }
    s.busy = true;
    const k = (S.bag.bw / 110).toFixed(3);
    const base = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${((angle * 180) / Math.PI).toFixed(1)}deg)`;
    const a = s.node.animate(
      [
        { transform: `${base} translateX(-24px) scale(${k}) translate(-50%,-50%)`, opacity: 0 },
        { transform: `${base} translateX(0) scale(${k}) translate(-50%,-50%)`, opacity: 1, offset: 0.3 },
        { transform: `${base} translateX(22px) scale(${k}) translate(-50%,-50%)`, opacity: 0 },
      ],
      { duration: 300, easing: 'cubic-bezier(.2,.9,.3,1)' }
    );
    a.onfinish = () => { s.busy = false; };
  }

  let activeCallout = null;
  function clearCallout() {
    if (activeCallout) activeCallout.remove();
    activeCallout = null;
  }

  function callout(text, x, y, extra, replace) {
    if (replace) clearCallout();
    const n = el('div', 'xm-callout ' + (extra || ''));
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

  // Après le premier coup, l'indice apprend les deux autres coups, une seule fois, à la même place.
  function coach() {
    if (S.hint.coached || S.mode !== 'full' || S.bag.ko || photoHero || S.hint.ok === false || S.hint.side || S.dead) return;
    S.hint.coached = true;
    hintEl.innerHTML = coarse
      ? 'Glisse ← → : crochet.<strong>Glisse ↑ : uppercut.</strong>'
      : 'Frappe un côté : crochet.<strong>Le bas : uppercut.</strong>';
    hintEl.classList.add('is-on', 'is-coach');
    setTimeout(() => hintEl.classList.remove('is-on'), 4200);
  }

  /* ---------- Boucle : elle ne tourne qu'entre un coup et le retour au calme ---------- */

  function syncRunning() {
    const should = S.visible !== false && !doc.hidden && !S.dead;
    S.running = should;
    if (idleAnim) {
      if (should) idleAnim.play();
      else idleAnim.pause();
    }
    if (!should && S.looping) {
      S.looping = false;
      cancelAnimationFrame(S.raf);
    } else if (should && !S.looping && !settled()) kick();
  }

  // Un coup, une ouverture, un cadeau qui descend : la physique se réveille.
  function kick() {
    if (!S.running || S.looping || S.dead || !S.w) return;
    stopIdle();
    S.looping = true;
    S.last = now();
    S.raf = requestAnimationFrame(frame);
  }

  // Tout est-il revenu au calme ? Plus d'éclats en vol, plus de tremblement, et un balancement pas
  // plus grand que celui du repos (±2°) : on passe la main à l'animation au moment où le sac
  // repasse par la verticale, au lieu de laisser la physique s'éteindre pendant dix secondes.
  function settled() {
    const b = S.bag;
    if (S.trauma > 0.001 || b.drop > 0 || now() < b.freezeUntil || b.pending) return false;
    if (S.mode === 'full' && (Math.abs(b.theta) > 0.012 || Math.abs(b.omega) > 0.16 || Math.abs(b.y) > 0.3 || Math.abs(b.vy) > 1 || b.squash || b.flare > 0.01)) return false;
    return !POOL.some((p) => p.alive);
  }

  function frame(t) {
    if (!S.looping) return;
    const dt = Math.min(0.05, (t - S.last) / 1000);
    S.last = t;
    update(dt, t);
    render();
    if (settled()) {
      S.looping = false;
      const dir = S.bag.omega < 0 ? -1 : 1;
      S.bag.theta = 0;
      S.bag.omega = 0;
      render();
      startIdle(dir);
      return;
    }
    S.raf = requestAnimationFrame(frame);
  }

  function update(dt, t) {
    const b = S.bag;
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
          const wmax = Math.sqrt(2 * Math.max(0, emax - epot));
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
    }
    updateParticles(dt);
    // Tremblement « trauma² » : fort à l'impact, il s'éteint vite et sans à-coup.
    S.trauma = Math.max(0, S.trauma - CFG.traumaDecay * dt);
    const amp = CFG.shakePx.ko * S.trauma * S.trauma;
    S.shakeX = amp ? rand(-amp, amp) : 0;
    S.shakeY = amp ? rand(-amp, amp) * 0.6 : 0;
  }

  function render() {
    if (S.mode !== 'full') return;
    const b = S.bag;
    const dropY = -easeInOut(b.drop) * (b.chain + b.bh + S.topOffset + 40);
    putT(swingEl, `translate(${(b.px + S.shakeX).toFixed(1)}px,${(b.py + b.y + dropY + S.shakeY).toFixed(1)}px) rotate(${b.theta.toFixed(4)}rad)`);
    const sq = b.squash;
    putT(bodyEl, `scale(${(1 + sq).toFixed(3)},${(1 - sq * 0.75).toFixed(3)})`);
    putO(glowEl, (0.5 + b.flare * 0.5).toFixed(2));
  }

  /* ---------- Interrupteur : couper les décorations, ou les remettre ---------- */

  // La scène du hero et celle de toute la page s'allument et s'éteignent ensemble.
  const broadcast = (on) => doc.dispatchEvent(new CustomEvent('bc:noel', { detail: { on } }));

  function switchOff() {
    store.set(OFF_KEY, OFF_VALUE);
    track('noel_off', { page: location.pathname });
    broadcast(false);
    if (reduce) return teardown(true);
    for (const n of [front, back]) {
      n.style.transition = 'opacity .45s ease';
      n.style.opacity = '0';
    }
    setTimeout(() => teardown(true), 480);
  }

  function teardown(keepRelight) {
    S.dead = true;
    stopPossession();
    S.looping = false;
    cancelAnimationFrame(S.raf);
    if (idleAnim) idleAnim.cancel();
    idleAnim = null;
    if (S.ac) S.ac.abort();
    if (ro) ro.disconnect();
    if (io) io.disconnect();
    back.remove();
    front.remove();
    hero.classList.remove('xm-gestures');
    POOL.length = 0;
    swooshes.length = 0;
    if (keepRelight) relightButton();
  }

  function relightButton() {
    const wrap = el('div', 'xm-front');
    wrap.setAttribute('data-xm-relight', '');
    const ctl = el('div', 'xm-controls');
    const btn = el('button', 'xm-ctl', ICONS.gift);
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Remettre les décorations de Noël');
    btn.title = 'Remettre Noël';
    btn.dataset.track = 'noel_on';
    ctl.append(btn);
    wrap.append(ctl);
    const topbar = isCinema ? doc.querySelector('#site-header .topbar') : null;
    wrap.style.setProperty('--xm-top', (topbar ? Math.round(topbar.getBoundingClientRect().height) : 0) + 12 + 'px');
    hero.append(wrap);
    btn.addEventListener('click', () => {
      store.set(OFF_KEY, null);
      wrap.remove();
      start();
      broadcast(true);
    });
  }

  /* ---------- Départ ---------- */

  function start() {
    S.dead = false;
    S.startAt = now();
    S.offers = null;
    build();
    // Le cadeau descend du plafond sur sa chaîne, puis se balance.
    if (!reduce) S.bag.drop = 1;
    S.running = true;
    // L'indice : quelques secondes après l'arrivée, s'il n'a pas encore été frappé ; il se retire seul.
    setTimeout(() => {
      if (S.dead || S.bag.hasBeenHit || reduce) return;
      hint(true);
      setTimeout(() => { if (!S.bag.hasBeenHit) hint(false); }, 9000);
    }, CFG.hintDelayMs);
  }

  // ?noeldebug expose l'état pour les tests ; sans effet pour les visiteurs.
  if (/[?&]noeldebug\b/.test(location.search)) window.__bcXm = S;

  if (store.get(OFF_KEY) === OFF_VALUE) {
    relightButton();
    return;
  }
  start();
})();
