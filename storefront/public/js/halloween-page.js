/**
 * Halloween 2026 — la nuit déborde du hero : elle tient toute la page.
 *
 * Repris du premier décor d'angoularaphael et redessinés : le zombie boxeur qui traverse le bas
 * de l'écran (cycle de marche, garde, il s'arrête pour boxer dans le vide), les citrouilles qui
 * guettent depuis les bords, les chauves-souris qui traversent vraiment l'écran, le sang qui
 * suinte du header et laisse tomber une goutte de temps en temps.
 *
 * Au doigt, rien n'est cliquable : un tap destiné au site n'est jamais volé. À la souris, le
 * zombie se frappe (trois coups, K.O., il se relève) et les citrouilles se penchent.
 * Allumé et éteint avec la scène du hero (événement « bc:halloween »).
 */
(function () {
  'use strict';
  if (window.__bcHalloweenPage) return;
  window.__bcHalloweenPage = true;

  const doc = document;
  const root = doc.documentElement;
  const soft = root.classList.contains('bc-halloween--soft');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const OFF_KEY = 'bc_halloween_off';
  const OFF_VALUE = '2026';

  const CFG = {
    zombieSpeed: mouse ? 64 : 48,
    zombieFirstMs: 2600,
    zombieGapMs: [5000, 11000],
    zombieHp: 3,
    batGapMs: [9000, 17000],
    dripGapMs: [2600, 6200],
    contentMax: 1180,
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  };
  const track = (name, props) => {
    try { if (window.BCTrack) window.BCTrack.track(name, props || {}); } catch (e) { /* suivi facultatif */ }
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const el = (tag, cls, html) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const wait = (ms) => new Promise((res) => { const id = setTimeout(res, ms); timers.push(id); });

  /* ---------- Dessins ---------- */

  // Le zombie boxeur : gants rouges et protège-dents du club, comme la citrouille du hero.
  // Pieds sur la ligne y = 146 ; regard vers +x.
  const ZOMBIE_SVG =
    '<svg class="zb" viewBox="0 0 120 150" aria-hidden="true" focusable="false">' +
    '<defs>' +
    '<linearGradient id="zbSkin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9DB088"/><stop offset="1" stop-color="#6D7F5B"/></linearGradient>' +
    '<linearGradient id="zbGlove" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF3B4E"/><stop offset="1" stop-color="#B80016"/></linearGradient>' +
    '</defs>' +
    '<ellipse class="zb-shadow" cx="60" cy="146" rx="30" ry="4.5" fill="rgba(0,0,0,.32)"/>' +
    // Jambe arrière
    '<g class="zb-leg zb-leg--b">' +
    '<path d="M47 94h11l-1.6 23-1.4 18h-8.6l-.6-18z" fill="#617150"/>' +
    '<path d="M42 133h15c3 0 6 3 6 7v4H42z" fill="#231e1b"/>' +
    '<path d="M47 136h8M47 139h8" stroke="#55494a" stroke-width="1"/>' +
    '</g>' +
    // Bras arrière (derrière le buste)
    '<g class="zb-arm zb-arm--b">' +
    '<path d="M47 46c-4 6-4 13 1 18l13-4c-3-4-3-8-1-12z" fill="#6D7F5B"/>' +
    '<g class="zb-glove"><path d="M58 42c0-6 6-9 12-8 6 1 9 6 8 12-1 5-5 8-10 8h-5c-3 0-5-2-5-5z" fill="url(#zbGlove)"/>' +
    '<path d="M57 50h8v5h-8z" fill="#F2F2F2"/></g>' +
    '</g>' +
    // Buste, short, tête
    '<g class="zb-body">' +
    '<path d="M41 85h38l3 19H64l-4-8-4 8H40z" fill="#1D2343"/>' +
    '<path d="M42 87v15M78 87v15" stroke="#E8001C" stroke-width="2.4"/>' +
    '<path d="M41 85h38v3H41z" fill="#EDEDED"/>' +
    '<path d="M44 52c-1-11 7-18 17-18 11 0 19 7 18 18l-1 34-5-3-4 4-4-4-4 4-4-4-4 4-4-3-4 3z" fill="#A3A9AF"/>' +
    '<path d="M52 60c5 3 11 3 16 0M54 70c4 2 9 2 12 0" stroke="#7E848A" stroke-width="1.4" fill="none"/>' +
    '<circle cx="66" cy="64" r="4" fill="#6B6F60" opacity=".45"/>' +
    '<g class="zb-head">' +
    '<path d="M58 34h10v6H58z" fill="#6D7F5B"/>' +
    '<path d="M50 18c0-10 8-15 16-15 10 0 16 7 16 16 0 9-5 16-15 16-9 0-17-6-17-17z" fill="url(#zbSkin)"/>' +
    '<path d="M53 8c3-5 9-6 13-5-3 1-4 3-4 5 3-2 7-2 9 0" stroke="#2A2824" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
    '<path d="M56 12l2 3M60 11l1 3M64 11l0 3" stroke="#3B2D26" stroke-width="1.2" stroke-linecap="round"/>' +
    '<path d="M55 11h12" stroke="#3B2D26" stroke-width="1"/>' +
    '<circle cx="73.5" cy="17" r="5.4" fill="#F4F1E6"/><circle class="zb-pupil" cx="75.4" cy="18" r="1.8" fill="#170F0A"/>' +
    '<path d="M60 14l5 5M65 14l-5 5" stroke="#2A1B14" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M77 22l2 1.5" stroke="#55654A" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M64 26c3 4 11 4 15 0-1 4-4 7-8 7s-6-3-7-7z" fill="#2A140E"/>' +
    '<path d="M66 28c3 2.4 8 2.4 11 0-1 2.6-3 4-5.5 4s-4.5-1.4-5.5-4z" fill="#E8001C"/>' +
    '<path d="M70 26.5h2v2h-2z" fill="#F4F1E6"/>' +
    '</g>' +
    '</g>' +
    // Jambe avant
    '<g class="zb-leg zb-leg--f">' +
    '<path d="M62 94h11l-.4 23-1.6 18h-8.6l-.6-18z" fill="url(#zbSkin)"/>' +
    '<path d="M58 133h15c3 0 6 3 6 7v4H58z" fill="#2B2420"/>' +
    '<path d="M63 136h8M63 139h8" stroke="#5E5250" stroke-width="1"/>' +
    '</g>' +
    // Bras avant
    '<g class="zb-arm zb-arm--f">' +
    '<path d="M70 46c4 5 5 12 1 18l12-1c2-5 1-10-2-14z" fill="url(#zbSkin)"/>' +
    '<g class="zb-glove"><path d="M78 40c0-6 6-9 12-8 6 1 9 6 8 12-1 5-5 8-10 8h-5c-3 0-5-2-5-5z" fill="url(#zbGlove)"/>' +
    '<path d="M83 37c3-2 7-1 9 1" stroke="#FF8A95" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<path d="M77 48h8v5h-8z" fill="#F2F2F2"/></g>' +
    '</g>' +
    '</svg>';

  function pumpkinSvg() {
    return (
      '<svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">' +
      '<defs><radialGradient id="hwpSkin" cx="36%" cy="32%" r="78%"><stop offset="0" stop-color="#FFA54A"/><stop offset=".52" stop-color="#E7640F"/><stop offset="1" stop-color="#8F3405"/></radialGradient>' +
      '<radialGradient id="hwpFire" cx="50%" cy="58%" r="62%"><stop offset="0" stop-color="#FFF7CF"/><stop offset=".45" stop-color="#FFC233"/><stop offset="1" stop-color="#FF6A00"/></radialGradient></defs>' +
      '<g fill="url(#hwpSkin)"><ellipse cx="44" cy="92" rx="36" ry="58"/><ellipse cx="116" cy="92" rx="36" ry="58"/><ellipse cx="64" cy="90" rx="38" ry="64"/><ellipse cx="96" cy="90" rx="38" ry="64"/><ellipse cx="80" cy="90" rx="40" ry="66"/></g>' +
      '<path d="M73 30c-3-12 1-22 13-27-3 8-1 18 1 27z" fill="#4F5D24"/>' +
      '<g class="hwp-face" fill="url(#hwpFire)">' +
      (soft
        ? '<circle cx="60" cy="80" r="10"/><circle cx="100" cy="80" r="10"/><path d="M50 112c10 22 50 22 60 0-6 18-18 28-30 28s-24-10-30-28z"/>'
        : '<path d="M46 70l27 11-14 13z"/><path d="M114 70l-27 11 14 13z"/><path d="M42 110c16 9 60 9 76 0-6 22-22 33-38 33s-32-11-38-33z"/>') +
      '</g>' +
      '<path d="M54 122c16 11 36 11 52 0-6 13-16 19-26 19s-20-6-26-19z" fill="#E8001C"/>' +
      '</svg>'
    );
  }

  // Le liseré orangé (la lueur des citrouilles) est dessiné dans la forme : aucun filtre à
  // recalculer à chaque battement d'aile.
  const BAT_SVG =
    '<svg viewBox="-2 -2 68 32" aria-hidden="true" focusable="false"><path fill="#0d0a14" stroke="rgba(255,140,0,.55)" stroke-width="1.6" stroke-linejoin="round" d="M32 14C28 6 20 3 12 6c4 2 6 5 6 7-6 2-12 2-18 0 6 5 14 7 22 5-2 3-2 7-6 9 6-2 10-5 12-9 2 4 6 7 12 9-4-2-4-6-6-9 8 2 16 0 22-5-6 2-12 2-18 0 0-2 2-5 6-7-8-3-16 0-20 8z"/></svg>';

  const DRIP_SVG =
    '<svg viewBox="0 0 24 64" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<path d="M0 0H24C24 9 19 15 18 27 17.4 38 19.5 47 18 53 16.6 59 14.4 63 12 63 9.6 63 7.4 59 6 53 4.5 47 6.6 38 6 27 5 15 0 9 0 0Z" fill="url(#hwpBlood)"/>' +
    '<path d="M8.6 30C8.1 40 8.8 47 9.7 52" stroke="rgba(255,255,255,.38)" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  /* ---------- État ---------- */

  let layer = null;
  let blood = null;
  let timers = [];
  let alive = false;
  const Z = { el: null, walker: null, flip: null, fig: null, x: -200, dir: 1, anim: null, resume: null, hp: CFG.zombieHp, busy: false };
  const bats = [];
  let batRaf = 0;
  const pointer = { x: -1e4, y: -1e4 };

  /* ---------- Démarrage / arrêt ---------- */

  function start() {
    if (alive) return;
    alive = true;
    timers = [];
    layer = el('div', 'hwp-layer');
    layer.id = 'bcHwPage';
    layer.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(layer);
    // Le premier décor (s'il a été chargé par erreur avec celui-ci) ne doit pas doubler les personnages.
    const legacy = doc.getElementById('bcHalloween');
    if (legacy) legacy.remove();

    buildPumpkins();
    if (!soft) {
      buildBlood();
      if (!reduce) {
        buildZombie();
        // Le vol est préparé d'avance (hors écran, cachées) : le premier passage ne coûte rien.
        batPool.length = 0;
        for (let i = 0; i < (lowEnd ? 2 : 4); i++) {
          const n = batNode();
          n.hidden = true;
          n.dataset.busy = '0';
        }
        scheduleBats(true);
        window.addEventListener('pointermove', onPointer, { passive: true });
      }
    }
    window.addEventListener('resize', onResize, { passive: true });
  }

  function stop(animated) {
    if (!alive) return;
    alive = false;
    timers.forEach(clearTimeout);
    timers = [];
    cancelAnimationFrame(batRaf);
    bats.length = 0;
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('resize', onResize);
    const l = layer;
    const b = blood;
    layer = null;
    blood = null;
    if (Z.anim) Z.anim.cancel();
    Z.anim = null;
    const remove = () => { if (l) l.remove(); if (b) b.remove(); };
    if (animated && !reduce) {
      [l, b].forEach((n) => n && n.classList.add('is-leaving'));
      setTimeout(remove, 520);
    } else {
      remove();
    }
  }

  doc.addEventListener('bc:halloween', (e) => {
    if (e.detail && e.detail.on) start();
    else stop(true);
  });

  let resizeT = 0;
  function onResize() {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (!alive) return;
      placePumpkins();
      if (blood) layoutBlood();
    }, 160);
  }

  function onPointer(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }

  /* ---------- Les citrouilles qui guettent ---------- */

  const pumpkins = [];
  function buildPumpkins() {
    pumpkins.length = 0;
    for (const side of ['left', 'right']) {
      const p = el('div', `hwp-pumpkin hwp-pumpkin--${side}`, '<div class="hwp-pumpkin__glow"></div>' + pumpkinSvg());
      if (mouse) p.classList.add('is-hoverable');
      p.style.animationDelay = rand(-6, 0).toFixed(2) + 's';
      layer.appendChild(p);
      pumpkins.push({ node: p, side });
      if (mouse) {
        p.addEventListener('click', () => {
          p.classList.remove('is-giggle');
          void p.offsetWidth;
          p.classList.add('is-giggle');
        });
      }
    }
    placePumpkins();
  }

  // Elles ne dépassent du bord que de la largeur de la marge : jamais sur un texte du site.
  function placePumpkins() {
    const W = innerWidth;
    const gutter = (W - Math.min(W - 40, CFG.contentMax)) / 2;
    const size = W < 600 ? 46 : W < 1100 ? 58 : 70;
    const visible = clamp(gutter - 6, 16, size * 0.86);
    for (const { node, side } of pumpkins) {
      node.style.setProperty('--size', size + 'px');
      node.style.setProperty('--hide', size - visible + 'px');
      node.style.setProperty('--peek', Math.min(size * 0.5, size - visible) + 'px');
      node.style[side] = -(size - visible) + 'px';
      node.style[side === 'left' ? 'right' : 'left'] = 'auto';
      // À droite, plus bas que le sac-citrouille du hero : pas trois citrouilles au même endroit.
      node.style.top = side === 'right' ? '64%' : 'auto';
      node.style.bottom = side === 'left' ? (W < 600 ? '78px' : '98px') : 'auto';
    }
  }

  /* ---------- Le sang qui suinte du header ---------- */

  function buildBlood() {
    const topbar = doc.querySelector('#site-header .topbar') || doc.querySelector('.topbar');
    if (!topbar) return;
    blood = el('div', 'hwp-blood');
    blood.setAttribute('aria-hidden', 'true');
    blood.innerHTML =
      '<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="hwpBlood" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#5A0009"/><stop offset=".55" stop-color="#9E0F1C"/><stop offset="1" stop-color="#C21426"/></linearGradient></defs></svg>' +
      '<div class="hwp-blood__band"></div><div class="hwp-blood__drips"></div>';
    topbar.appendChild(blood);
    layoutBlood();
    if (!reduce) scheduleDrop();
  }

  // Des coulures toutes différentes, pas un motif qui se répète tous les 180 px.
  // Placées en pourcentage du header, qui fait toute la largeur : rien à mesurer (lire une largeur
  // ici forçait une mise en page complète de l'accueil pendant son chargement).
  function layoutBlood() {
    const drips = blood.querySelector('.hwp-blood__drips');
    drips.innerHTML = '';
    const n = Math.round(clamp(innerWidth / 95, 5, 18));
    for (let i = 0; i < n; i++) {
      const d = el('span', 'hwp-drip', DRIP_SVG);
      const x = ((i + rand(0.15, 0.85)) / n) * 100;
      const w = rand(9, 20);
      const h = rand(14, i % 4 === 0 ? 48 : 30);
      d.dataset.x = x.toFixed(2);
      d.dataset.h = h.toFixed(1);
      d.style.cssText = `left:calc(${x.toFixed(2)}% - ${(w / 2).toFixed(1)}px);width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;animation-delay:${rand(-8, 0).toFixed(2)}s;animation-duration:${rand(5, 9).toFixed(2)}s`;
      drips.appendChild(d);
    }
  }

  async function scheduleDrop() {
    while (alive && blood) {
      await wait(rand(CFG.dripGapMs[0], CFG.dripGapMs[1]));
      if (!alive || !blood) return;
      const topbar = blood.parentElement;
      if (!topbar || topbar.classList.contains('nav-hidden')) continue;
      const drips = blood.querySelectorAll('.hwp-drip');
      if (!drips.length) continue;
      const d = drips[Math.floor(Math.random() * drips.length)];
      const drop = el('span', 'hwp-drop');
      drop.style.left = `calc(${d.dataset.x}% - 3px)`;
      drop.style.top = parseFloat(d.dataset.h) - 4 + 'px';
      blood.appendChild(drop);
      const fall = rand(70, 150);
      const a = drop.animate(
        [
          { transform: 'translateY(0) scale(.6, .8)', opacity: 0 },
          { transform: 'translateY(2px) scale(1, 1)', opacity: 1, offset: 0.18 },
          { transform: `translateY(${fall}px) scale(.8, 1.25)`, opacity: 0 },
        ],
        { duration: 900 + fall * 4, easing: 'cubic-bezier(.55,0,1,.45)' }
      );
      a.onfinish = () => drop.remove();
    }
  }

  /* ---------- Le zombie boxeur ---------- */

  function buildZombie() {
    Z.el = el('div', 'hwp-zombie');
    Z.walker = el('div', 'hwp-zombie__walk');
    Z.flip = el('div', 'hwp-zombie__flip');
    Z.fig = el('div', 'hwp-zombie__fig is-walking', ZOMBIE_SVG);
    const ko = el('span', 'hwp-zombie__ko', 'K.O.');
    const stars = el('span', 'hwp-zombie__stars', '<i></i><i></i><i></i>');
    Z.flip.append(Z.fig);
    Z.walker.append(Z.flip, ko, stars);
    Z.el.append(Z.walker);
    layer.appendChild(Z.el);
    if (mouse) {
      Z.fig.classList.add('is-hittable');
      Z.fig.addEventListener('pointerdown', punchZombie);
    }
    Z.x = -200;
    Z.walker.style.transform = `translateX(${Z.x}px)`;
    zombieLoop();
    // Au début d'une image, la mise en page est déjà à jour : le test ne force rien.
    const id = setInterval(() => requestAnimationFrame(ghostCheck), 220);
    timers.push(id);
  }

  // Position du zombie calculée depuis sa propre animation, sans lire le DOM.
  function zombieRect() {
    let x = Z.x;
    const a = Z.anim;
    if (a && a.effect) {
      const t = a.effect.getComputedTiming();
      const kf = a.effect.getKeyframes();
      const from = parseFloat(String(kf[0].transform).replace('translateX(', ''));
      const to = parseFloat(String(kf[kf.length - 1].transform).replace('translateX(', ''));
      if (Number.isFinite(from) && Number.isFinite(to) && t.progress != null) x = from + (to - from) * t.progress;
    }
    const h = innerWidth < 600 ? 70 : 96;
    return { left: x, top: innerHeight - h, width: h * 0.8, height: h, right: x + h * 0.8 };
  }

  // Devant un bouton ou un lien, il devient un fantôme qu'on traverse : il ne vole jamais un clic,
  // et l'appel à l'action reste lisible.
  function ghostCheck() {
    if (!Z.fig || !alive || !layer) return;
    const r = zombieRect();
    if (r.right < 0 || r.left > innerWidth) return;
    // Une grille 3 × 3 sur tout le corps : un bord de bouton suffit à le rendre transparent.
    let over = false;
    outer: for (const fx of [0.15, 0.5, 0.85]) {
      for (const fy of [0.12, 0.5, 0.88]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) continue;
        const under = doc.elementsFromPoint(x, y).find((n) => !layer.contains(n));
        if (under && under.closest('a, button, input, select, textarea, label, [role="button"]')) {
          over = true;
          break outer;
        }
      }
    }
    Z.fig.classList.toggle('is-ghost', over);
  }

  const tx = (x) => `translateX(${x.toFixed(1)}px)`;

  function setDir(dir) {
    Z.dir = dir;
    Z.flip.style.transform = `scaleX(${dir})`;
  }

  function currentX() {
    const m = new DOMMatrixReadOnly(getComputedStyle(Z.walker).transform);
    return m.m41;
  }

  function walkTo(target) {
    return new Promise((resolve) => {
      const go = () => {
        if (!alive) return resolve();
        const from = Z.x;
        const dist = Math.abs(target - from);
        Z.fig.classList.add('is-walking');
        const anim = Z.walker.animate([{ transform: tx(from) }, { transform: tx(target) }], {
          duration: (dist / CFG.zombieSpeed) * 1000,
          easing: 'linear',
          fill: 'forwards',
        });
        Z.anim = anim;
        anim.onfinish = () => {
          Z.x = target;
          Z.walker.style.transform = tx(target);
          anim.cancel();
          Z.anim = null;
          Z.resume = null;
          resolve();
        };
        Z.resume = go;
      };
      go();
    });
  }

  async function shadowBox() {
    Z.fig.classList.remove('is-walking');
    Z.fig.classList.add('is-boxing');
    await wait(1500);
    if (Z.fig) Z.fig.classList.remove('is-boxing');
  }

  async function zombieLoop() {
    let first = true;
    while (alive) {
      await wait(first ? CFG.zombieFirstMs : rand(CFG.zombieGapMs[0], CFG.zombieGapMs[1]));
      first = false;
      if (!alive) return;
      const W = innerWidth;
      const dir = Z.dir === 1 && Z.x > W / 2 ? -1 : 1;
      const from = dir > 0 ? -150 : W + 150;
      const to = dir > 0 ? W + 150 : -150;
      Z.x = from;
      Z.hp = CFG.zombieHp;
      Z.walker.style.transform = tx(from);
      setDir(dir);
      // Il s'arrête une fois sur deux pour boxer dans le vide — du shadow boxing, littéralement.
      const stops = Math.random() < 0.6 ? [from + (to - from) * rand(0.32, 0.62)] : [];
      for (const s of stops) {
        await walkTo(s);
        if (!alive) return;
        await whileBusy();
        await shadowBox();
        // Frappé pendant qu'il boxait : il finit de se relever avant de repartir.
        await whileBusy();
      }
      await walkTo(to);
      await whileBusy();
    }
  }

  async function whileBusy() {
    while (Z.busy && alive) await wait(120);
  }

  // À la souris : deux coups le font reculer, le troisième le met K.O. ; il se relève.
  async function punchZombie(e) {
    if (Z.busy || !alive) return;
    e.preventDefault();
    const fromLeft = e.clientX < Z.walker.getBoundingClientRect().left + Z.walker.offsetWidth / 2;
    const away = fromLeft ? 1 : -1;
    const walking = !!Z.anim;
    if (Z.anim) {
      Z.x = currentX();
      Z.anim.cancel();
      Z.anim = null;
      Z.walker.style.transform = tx(Z.x);
    }
    Z.busy = true;
    Z.hp -= 1;
    const fig = Z.fig;
    fig.classList.remove('is-walking', 'is-boxing');
    fig.style.setProperty('--away', String(away * Z.dir));
    if (Z.hp > 0) {
      fig.classList.add('is-hit');
      const back = Z.walker.animate([{ transform: tx(Z.x) }, { transform: tx(Z.x + away * 22) }], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' });
      await back.finished.catch(() => {});
      Z.x += away * 22;
      Z.walker.style.transform = tx(Z.x);
      back.cancel();
      await wait(260);
      fig.classList.remove('is-hit');
    } else {
      fig.classList.add('is-ko');
      Z.walker.classList.add('is-ko');
      track('halloween_zombie_ko', { page: location.pathname });
      await wait(1700);
      fig.classList.remove('is-ko');
      fig.classList.add('is-rising');
      Z.walker.classList.remove('is-ko');
      await wait(560);
      fig.classList.remove('is-rising');
      Z.hp = CFG.zombieHp;
    }
    Z.busy = false;
    if (walking && Z.resume && alive) Z.resume();
  }

  /* ---------- Les chauves-souris ---------- */

  async function scheduleBats(firstRun) {
    if (firstRun) await wait(rand(3500, 6500));
    while (alive) {
      const n = lowEnd ? 1 : Math.floor(rand(1, 4));
      const fromLeft = Math.random() < 0.5;
      const y = innerHeight * rand(0.14, 0.46);
      for (let i = 0; i < n; i++) spawnBat(fromLeft, y + rand(-40, 40), i * rand(180, 420));
      await wait(rand(CFG.batGapMs[0], CFG.batGapMs[1]));
    }
  }

  // Les chauves-souris sont créées une fois, au départ, puis réutilisées : rien n'est inséré
  // dans la page pendant qu'elles volent.
  const batPool = [];
  function batNode() {
    let n = batPool.find((q) => !q.isConnected || q.dataset.busy !== '1');
    if (!n) {
      if (batPool.length >= 6) return null;
      n = el('div', 'hwp-bat', BAT_SVG);
      n.firstChild.style.animationDuration = rand(0.12, 0.2).toFixed(2) + 's';
      batPool.push(n);
    }
    if (!n.isConnected) layer.appendChild(n);
    n.dataset.busy = '1';
    n.hidden = false;
    return n;
  }

  function spawnBat(fromLeft, y, delay) {
    const id = setTimeout(() => {
      if (!alive || !layer) return;
      const node = batNode();
      if (!node) return;
      const size = rand(30, 52);
      node.style.width = size + 'px';
      node.style.height = size / 2 + 'px';
      const dir = fromLeft ? 1 : -1;
      bats.push({ node, x: fromLeft ? -60 : innerWidth + 60, y, vx: dir * rand(150, 240), vy: rand(-10, 10), dir, t: rand(0, 6) });
      if (!batRaf) {
        last = performance.now();
        batRaf = requestAnimationFrame(flyBats);
      }
    }, delay);
    timers.push(id);
  }

  let last = 0;
  function flyBats(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    for (let i = bats.length - 1; i >= 0; i--) {
      const b = bats[i];
      b.t += dt;
      // La souris les effraie : elles s'écartent de la flèche.
      const dx = b.x - pointer.x;
      const dy = b.y - pointer.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 130 * 130) {
        const d = Math.sqrt(d2) || 1;
        b.vy += (dy / d) * 900 * dt;
        b.vx += (dx / d) * 300 * dt * Math.sign(b.vx) * Math.sign(dx || 1);
      }
      b.vy *= 0.96;
      b.x += b.vx * dt;
      b.y += b.vy * dt + Math.sin(b.t * 6.5) * 0.9;
      b.node.style.transform = `translate(${b.x.toFixed(1)}px,${b.y.toFixed(1)}px) scaleX(${b.dir})`;
      if (b.x < -120 || b.x > innerWidth + 120 || b.y < -80 || b.y > innerHeight + 80) {
        b.node.hidden = true;
        b.node.dataset.busy = '0';
        bats.splice(i, 1);
      }
    }
    batRaf = bats.length && alive ? requestAnimationFrame(flyBats) : 0;
  }

  // ?hwdebug expose l'état pour les tests ; sans effet pour les visiteurs.
  if (/[?&]hwdebug\b/.test(location.search)) window.__bcHwPage = { Z, bats };

  if (store.get(OFF_KEY) !== OFF_VALUE) start();
})();
