/**
 * Noël 2026 — la fête déborde du hero : elle tient toute la page.
 *
 * La neige tombe sur tout le site ; une guirlande lumineuse pend sous le menu ; aux bords de
 * l'écran, deux boîtes à surprise laissent jaillir un gant de boxe sur son ressort ; le Père Noël,
 * en survêtement gris comme Rocky à l'entraînement, fait son footing en bas de l'écran et s'arrête
 * pour boxer dans le vide ; de temps en temps, son traîneau traverse le ciel.
 *
 * Tout ce qui bouge est confié à la carte graphique (transform / opacity, animations CSS ou Web
 * Animations) : aucune boucle JavaScript par image, aucune repeinture. Seul ce qui se voit bouger
 * tourne : un téléphone moyen fait défiler la page aussi vite qu'en temps normal.
 *
 * Au doigt, rien n'est cliquable : un tap destiné au site n'est jamais volé. À la souris, le Père
 * Noël pare les coups, et au troisième il rit et lance un cadeau ; les boîtes s'ouvrent au survol.
 * Allumé et éteint avec la scène du hero (événement « bc:noel »).
 */
(function () {
  'use strict';
  if (window.__bcNoelPage) return;
  window.__bcNoelPage = true;

  const doc = document;
  const root = doc.documentElement;
  const soft = root.classList.contains('bc-noel--soft');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const OFF_KEY = 'bc_noel_off';
  const OFF_VALUE = '2026';
  if (!mouse) root.classList.add('xmp-touch');

  const CFG = {
    runSpeed: mouse ? 84 : 70,
    runFirstMs: 2400,
    // Au téléphone, il passe un peu moins souvent : chaque course occupe tout le bas de l'écran.
    runGapMs: mouse ? [7000, 14000] : [11000, 19000],
    // Le test « devant un bouton ? » : trois fois par seconde suffit à 84 px/s.
    ghostCheckMs: 300,
    sleighFirstMs: [9000, 15000],
    sleighGapMs: [32000, 52000],
    popGapMs: [6000, 12000],
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

  // Dégradés partagés, déclarés une fois pour toute la couche (un SVG de taille nulle, mais rendu).
  const DEFS =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
    '<linearGradient id="xmpSweat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A3A9B6"/><stop offset="1" stop-color="#737A88"/></linearGradient>' +
    '<linearGradient id="xmpGlove" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF3B4E"/><stop offset="1" stop-color="#B80016"/></linearGradient>' +
    '<linearGradient id="xmpHat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF2238"/><stop offset="1" stop-color="#B00014"/></linearGradient>' +
    '<linearGradient id="xmpPaper" x1="0" x2="1"><stop offset="0" stop-color="#8E0014"/><stop offset=".45" stop-color="#E8001C"/><stop offset="1" stop-color="#9C0016"/></linearGradient>' +
    '<linearGradient id="xmpRibbon" x1="0" x2="1"><stop offset="0" stop-color="#A86A14"/><stop offset=".45" stop-color="#FFE2A0"/><stop offset="1" stop-color="#C98A24"/></linearGradient>' +
    '</defs></svg>';

  // Le Père Noël en survêtement d'entraînement : bonnet rouge et pompon, barbe blanche, ceinture
  // noire à boucle d'or, gants rouges du club. Pieds sur la ligne y = 146 ; regard vers +x. Chaque
  // membre est sa propre couche (cadre 120 × 150) : la course se joue en transform, sans repeindre.
  const part = (cls, paths, inner) =>
    `<div class="xmp-part ${cls}"><svg viewBox="0 0 120 150" aria-hidden="true" focusable="false">${paths}</svg>${inner || ''}</div>`;
  const GLOVE = (x, y) =>
    `<path d="M${x} ${y}c0-6 6-9 12-8 6 1 9 6 8 12-1 5-5 8-10 8h-5c-3 0-5-2-5-5z" fill="url(#xmpGlove)"/>` +
    `<path d="M${x - 1} ${y + 8}h8v5h-8z" fill="#F2F2F2"/>` +
    `<path d="M${x + 5} ${y - 3}c3-2 7-1 9 1" stroke="#FF8A95" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
  const SANTA_HTML =
    part('xmp-ground', '<ellipse cx="60" cy="146" rx="28" ry="4.5" fill="rgba(0,0,0,.3)"/>') +
    // Jambe arrière
    part('xmp-leg xmp-leg--b',
      '<path d="M47 92h12l-1 22-2 18h-9l-1-18z" fill="#676D7A"/>' +
      '<path d="M42 130h15c3 0 7 3 7 7v6H42z" fill="#1E1E24"/>') +
    // Bras arrière (derrière le buste)
    part('xmp-arm xmp-arm--b',
      '<path d="M47 48c-4 6-4 13 1 18l13-4c-3-4-3-8-1-12z" fill="#6F7584"/>' + GLOVE(58, 42)) +
    // Buste : sweat gris, ceinture du Père Noël ; la tête est une couche à l'intérieur.
    part('xmp-body',
      '<path d="M41 86h38l2 10H39z" fill="#7B8190"/>' +
      '<path d="M42 52c0-11 8-17 18-17 11 0 18 6 18 17l-1 34H43z" fill="url(#xmpSweat)"/>' +
      '<path d="M50 40c3 5 7 7 10 7s7-2 10-7" stroke="#6A7080" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      '<path d="M50 70h20" stroke="#6A7080" stroke-width="1.4" stroke-linecap="round"/>' +
      '<path d="M42 79h36v8H42z" fill="#1E1E24"/>' +
      '<rect x="55" y="78.5" width="10" height="9" rx="1.6" fill="none" stroke="#F2B24A" stroke-width="2"/>',
      part('xmp-head',
        '<path d="M57 32h10v6H57z" fill="#E9BFA0"/>' +
        '<circle cx="64" cy="22" r="10.5" fill="#F1C7A8"/>' +
        '<circle cx="70" cy="25" r="2.6" fill="#F2A08C" opacity=".75"/>' +
        '<path d="M52 23c1 12 7 19 13 19 7 0 12-7 13-19-4 3-8 4-13 4s-9-1-13-4z" fill="#F6F4EE"/>' +
        '<path d="M57 26c3-2.4 6-2.4 8.2-.2 2.2-2.2 5.6-2.2 8.3.2-2 3-6 3.2-8.3 1.4-2.3 1.8-6.2 1.6-8.2-1.4z" fill="#fff"/>' +
        '<circle cx="73.5" cy="24" r="2.2" fill="#E89A80"/>' +
        '<circle cx="69.5" cy="18.5" r="1.5" fill="#2A1B14"/>' +
        '<path d="M66.5 15.6l5-.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>' +
        '<path d="M51 14c3-10 13-14 22-11 7 2 11 8 11 13l-33 1z" fill="url(#xmpHat)"/>' +
        '<path d="M57 6c-6-2-12 0-14 7" stroke="#C4001A" stroke-width="6" fill="none" stroke-linecap="round"/>' +
        '<circle cx="43" cy="14" r="4.6" fill="#fff"/>' +
        '<path d="M49 13c9-3.4 26-3.4 35 .6v6c-9-3-26-3-35 .4z" fill="#F6F4EE"/>')) +
    // Jambe avant
    part('xmp-leg xmp-leg--f',
      '<path d="M62 92h12l-.4 22-1.6 18h-9l-1-18z" fill="#858B99"/>' +
      '<path d="M58 130h15c3 0 7 3 7 7v6H58z" fill="#24242B"/>') +
    // Bras avant
    part('xmp-arm xmp-arm--f',
      '<path d="M70 46c4 5 5 12 1 18l12-1c2-5 1-10-2-14z" fill="url(#xmpSweat)"/>' + GLOVE(78, 40));

  // Une boîte à surprise : le gant de boxe sort sur son ressort, le couvercle bascule.
  const BOX_BODY =
    '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<rect x="8" y="40" width="84" height="58" rx="4" fill="url(#xmpPaper)"/>' +
    '<rect x="44" y="40" width="12" height="58" fill="url(#xmpRibbon)"/>' +
    '<rect x="8" y="62" width="84" height="10" fill="url(#xmpRibbon)"/>' +
    '<rect x="8" y="40" width="84" height="5" fill="#000" opacity=".18"/>' +
    '</svg>';
  const BOX_LID =
    '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<rect x="4" y="30" width="92" height="13" rx="3" fill="url(#xmpPaper)"/>' +
    '<rect x="44" y="30" width="12" height="13" fill="url(#xmpRibbon)"/>' +
    '<path d="M50 31c-5-9-17-12-19-6-1 5 8 7 19 6zM50 31c5-9 17-12 19-6 1 5-8 7-19 6z" fill="url(#xmpRibbon)"/>' +
    '<circle cx="50" cy="31" r="3.4" fill="#FFE2A0"/>' +
    '</svg>';
  const BOX_JACK =
    '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<path d="M50 96l-9-5 18-6-18-6 18-6-18-6 18-6-18-6 9-5" fill="none" stroke="#C9CCD4" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M36 26c0-11 10-16 20-14 10 2 15 10 13 20-2 8-8 12-16 12h-8c-5 0-9-4-9-9z" fill="url(#xmpGlove)"/>' +
    '<path d="M35 34h14v9H35z" fill="#F2F2F2"/>' +
    '<path d="M46 16c5-3 12-2 15 2" stroke="#FF8A95" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  // Le traîneau : deux rennes, les rênes, le traîneau chargé ; silhouette nuit bordée d'or,
  // et une traînée de paillettes. Une seule image, déplacée d'un bloc.
  const SLEIGH_SVG =
    '<svg viewBox="0 0 220 70" aria-hidden="true" focusable="false">' +
    '<g fill="#FFE2A0">' +
    '<path d="M8 44l1.4 3.6 3.6 1.4-3.6 1.4L8 54l-1.4-3.6L3 49l3.6-1.4z" opacity=".55"/>' +
    '<path d="M24 36l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" opacity=".75"/>' +
    '<path d="M38 50l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" opacity=".6"/>' +
    '<circle cx="16" cy="40" r="1.2" opacity=".7"/><circle cx="31" cy="46" r="1" opacity=".8"/><circle cx="46" cy="42" r="1.3"/>' +
    '</g>' +
    // Silhouette nuit cernée d'or : lisible sur la vidéo sombre comme sur une section claire.
    '<g fill="#1A2140" stroke="#FFD27A" stroke-width="1.4" stroke-opacity=".95" stroke-linejoin="round">' +
    // Le traîneau, son patin recourbé, la hotte et le Père Noël assis.
    '<path d="M52 40h46c6 0 9-6 9-11v-4h6v6c0 10-6 17-15 17H60c-6 0-9-3-8-8z"/>' +
    '<path d="M50 52h56c6 0 9-4 10-8" fill="none" stroke-width="2.4" stroke="#F2B24A" stroke-opacity=".85"/>' +
    '<path d="M58 40c-2-8 2-14 10-14 7 0 10 6 9 14z"/>' +
    '<path d="M80 30c0-6 4-10 9-10 6 0 9 5 8 11l-1 9H81z"/>' +
    '<path d="M85 20c2-7 9-9 14-5l-6 4z"/>' +
    // Les rênes, puis les deux rennes et leurs bois.
    '<path d="M98 30l42-4M98 33l70-7" fill="none" stroke-width="1"/>' +
    '<path d="M140 26c2-5 9-6 14-4l10 1c4-6 9-7 11-5-2 3-4 6-8 8l2 6-4 1-2-4-12 1-3 8h-4l1-8-6 6h-4z"/>' +
    '<path d="M168 18c-1-6 2-10 2-10M170 12l4-4M168 14l-4-3" fill="none" stroke-width="1.6"/>' +
    '<path d="M176 24c2-5 9-6 14-4l10 1c4-6 9-7 11-5-2 3-4 6-8 8l2 6-4 1-2-4-12 1-3 8h-4l1-8-6 6h-4z"/>' +
    '<path d="M204 16c-1-6 2-10 2-10M206 10l4-4M204 12l-4-3" fill="none" stroke-width="1.6"/>' +
    '</g>' +
    '<circle cx="212" cy="24" r="2" fill="#FF3346"/>' +
    '</svg>';

  /* ---------- État ---------- */

  let layer = null;
  let garland = null;
  let timers = [];
  let alive = false;
  let runs = 0;
  let floorPx = 0;

  // Le bandeau FIGHT & Furious reste collé en bas de l'écran, par-dessus tout : le Père Noël court
  // et la boîte du bas se posent juste au-dessus. Une lecture par course, pas par image.
  function readFloor() {
    const bar = doc.getElementById('ff-promo');
    floorPx = bar && bar.getClientRects().length ? Math.round(bar.getBoundingClientRect().height) : 0;
    if (layer) layer.style.setProperty('--xmp-floor', floorPx + 'px');
    return floorPx;
  }
  const Z = { el: null, walker: null, flip: null, fig: null, say: null, x: -200, dir: 1, anim: null, seg: null, resume: null, hits: 0, busy: false, check: 0 };

  /* ---------- Démarrage / arrêt ---------- */

  function start() {
    if (alive) return;
    alive = true;
    timers = [];
    layer = el('div', 'xmp-layer', DEFS);
    layer.id = 'bcXmPage';
    layer.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(layer);
    readFloor();

    if (!reduce) buildSnow();
    buildBoxes();
    buildGarland();
    if (!reduce) {
      // Le Père Noël et le traîneau n'entrent en scène qu'après quelques secondes : on les
      // construit au prochain moment de repos, pas dans la même tâche que le reste.
      const later = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 }) : (fn) => setTimeout(fn, 300);
      // Éteint puis rallumé entre-temps : une ancienne construction ne doit pas doubler la scène.
      const run = ++runs;
      later(() => {
        if (!alive || run !== runs) return;
        buildSanta();
        later(() => {
          if (!alive || run !== runs) return;
          sleighLoop();
        });
      });
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    window.addEventListener('resize', onResize, { passive: true });
  }

  function stop(animated) {
    if (!alive) return;
    alive = false;
    timers.forEach(clearTimeout);
    timers = [];
    clearInterval(Z.check);
    Z.check = 0;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    const l = layer;
    const g = garland;
    layer = null;
    garland = null;
    if (Z.anim) Z.anim.cancel();
    Z.anim = null;
    Z.busy = false;
    const remove = () => { if (l) l.remove(); if (g) g.remove(); };
    if (animated && !reduce) {
      [l, g].forEach((n) => n && n.classList.add('is-leaving'));
      setTimeout(remove, 520);
    } else {
      remove();
    }
  }

  doc.addEventListener('bc:noel', (e) => {
    if (e.detail && e.detail.on) start();
    else stop(true);
  });

  let resizeT = 0;
  function onResize() {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (!alive) return;
      readFloor();
      placeBoxes();
      if (garland) layoutGarland();
      bandAt = -1e9;
    }, 160);
  }

  /* ---------- La neige ---------- */

  // Une tuile de flocons dessinée une fois (les flocons au bord sont doublés de l'autre côté : la
  // tuile se raccorde sans couture), répétée sur un calque qui descend d'une tuile en boucle.
  function snowTile(size, n, r0, r1, o0, o1) {
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><radialGradient id="f"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`;
    for (let i = 0; i < n; i++) {
      const r = rand(r0, r1);
      const x = rand(0, size);
      const y = rand(0, size);
      const o = rand(o0, o1).toFixed(2);
      for (const dx of [0, -size, size]) {
        for (const dy of [0, -size, size]) {
          const cx = x + dx;
          const cy = y + dy;
          if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue;
          s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(2)}" fill="url(#f)" opacity="${o}"/>`;
        }
      }
    }
    return `url("data:image/svg+xml,${encodeURIComponent(s + '</svg>')}")`;
  }

  function buildSnow() {
    // Au téléphone et sur une petite machine, un seul calque : la moitié du travail.
    const far = el('div', 'xmp-snow xmp-snow--far');
    far.style.backgroundImage = snowTile(260, mouse && !lowEnd ? 30 : 26, 0.8, mouse ? 1.8 : 2.1, 0.35, 0.8);
    layer.appendChild(far);
    if (mouse && !lowEnd) {
      const sway = el('div', 'xmp-sway');
      const near = el('div', 'xmp-snow xmp-snow--near');
      near.style.backgroundImage = snowTile(420, 9, 1.8, 3.1, 0.5, 0.9);
      sway.appendChild(near);
      layer.appendChild(sway);
    }
  }

  /* ---------- Les boîtes à surprise ---------- */

  const boxes = [];
  function buildBoxes() {
    boxes.length = 0;
    for (const side of ['left', 'right']) {
      const b = el(
        'div',
        `xmp-box xmp-box--${side}`,
        `<div class="xmp-box__jack">${BOX_JACK}</div><div class="xmp-box__body">${BOX_BODY}</div><div class="xmp-box__lid">${BOX_LID}</div>`
      );
      if (mouse) b.classList.add('is-hoverable');
      layer.appendChild(b);
      const box = { node: b, side, jack: b.querySelector('.xmp-box__jack'), lid: b.querySelector('.xmp-box__lid'), busy: false };
      boxes.push(box);
      if (mouse) {
        b.addEventListener('pointerenter', () => pop(box));
        b.addEventListener('click', () => pop(box));
      }
    }
    placeBoxes();
    if (!reduce) popLoop();
  }

  // Elles ne dépassent du bord que de la largeur de la marge : jamais sur un texte du site.
  function placeBoxes() {
    const W = innerWidth;
    const gutter = (W - Math.min(W - 40, CFG.contentMax)) / 2;
    const size = W < 600 ? 50 : W < 1100 ? 62 : 74;
    const visible = clamp(gutter - 6, 18, size * 0.86);
    for (const { node, side } of boxes) {
      node.style.setProperty('--size', size + 'px');
      node.style[side] = -(size - visible) + 'px';
      node.style[side === 'left' ? 'right' : 'left'] = 'auto';
      node.style.top = side === 'right' ? '58%' : 'auto';
      node.style.bottom = side === 'left' ? (W < 600 ? 78 : 98) + floorPx + 'px' : 'auto';
    }
  }

  // Le couvercle bascule, le gant jaillit sur son ressort, tremble, puis tout rentre.
  function pop(box) {
    if (box.busy || reduce || !alive) return;
    box.busy = true;
    const dir = box.side === 'left' ? 1 : -1;
    box.lid.animate(
      [
        { transform: 'none' },
        { transform: `translate(${-dir * 6}%, -14%) rotate(${-dir * 118}deg)`, offset: 0.16 },
        { transform: `translate(${-dir * 6}%, -14%) rotate(${-dir * 106}deg)`, offset: 0.24 },
        { transform: `translate(${-dir * 6}%, -14%) rotate(${-dir * 112}deg)`, offset: 0.78 },
        { transform: 'none' },
      ],
      { duration: 1700, easing: 'cubic-bezier(.3,1.4,.4,1)' }
    );
    const a = box.jack.animate(
      [
        { transform: 'translateY(56%) scaleY(.3)', opacity: 0 },
        { transform: `translateY(-26%) scaleY(1.08) rotate(${dir * 6}deg)`, opacity: 1, offset: 0.2 },
        { transform: `translateY(-16%) scaleY(.94) rotate(${-dir * 5}deg)`, opacity: 1, offset: 0.32 },
        { transform: `translateY(-21%) scaleY(1.02) rotate(${dir * 3}deg)`, opacity: 1, offset: 0.44 },
        { transform: 'translateY(-19%) scaleY(1) rotate(0deg)', opacity: 1, offset: 0.74 },
        { transform: 'translateY(56%) scaleY(.3)', opacity: 0 },
      ],
      { duration: 1700, easing: 'ease-in-out' }
    );
    a.onfinish = () => { box.busy = false; };
  }

  async function popLoop() {
    let k = Math.random() < 0.5 ? 0 : 1;
    while (alive) {
      await wait(rand(CFG.popGapMs[0], CFG.popGapMs[1]));
      if (!alive || doc.hidden) continue;
      const box = boxes[k++ % boxes.length];
      if (box) pop(box);
    }
  }

  /* ---------- La guirlande sous le menu ---------- */

  function buildGarland() {
    const topbar = doc.querySelector('#site-header .topbar') || doc.querySelector('.topbar');
    if (!topbar) return;
    garland = el('div', 'xmp-garland');
    garland.setAttribute('aria-hidden', 'true');
    topbar.appendChild(garland);
    layoutGarland();
  }

  // Le fil pend en festons entre ses crochets ; les ampoules s'y accrochent, en trois groupes qui
  // scintillent chacun à son rythme (trois animations pour toute la guirlande). Rien n'est mesuré :
  // le header fait toute la largeur de la fenêtre.
  const BULBS = ['#FFE9B0', '#FF3346', '#FFB347', '#8FD3FF'];
  function layoutGarland() {
    const W = innerWidth;
    const span = W < 600 ? 120 : 160;
    const sag = W < 600 ? 9 : 12;
    const n = Math.max(2, Math.round(W / span));
    const seg = W / n;
    const yAt = (x) => {
      const t = (x % seg) / seg;
      return 3 + sag * 4 * t * (1 - t);
    };
    let d = 'M0 3';
    for (let i = 0; i < n; i++) d += ` Q${(i + 0.5) * seg} ${3 + sag * 2} ${(i + 1) * seg} 3`;
    const groups = ['a', 'b', 'c'].map((g) => el('div', `xmp-bulbs xmp-bulbs--${g}`));
    const step = W < 600 ? 40 : 48;
    let k = 0;
    for (let x = step / 2; x < W; x += step) {
      const b = el('span', 'xmp-bulb');
      b.style.cssText = `left:${x.toFixed(1)}px;top:${yAt(x).toFixed(1)}px;--c:${BULBS[k % BULBS.length]}`;
      groups[k % 3].appendChild(b);
      k++;
    }
    garland.innerHTML = `<svg class="xmp-wire" width="${W}" height="${sag + 8}" viewBox="0 0 ${W} ${sag + 8}" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="#1b2030" stroke-width="1.6"/></svg>`;
    groups.forEach((g) => garland.appendChild(g));
  }

  /* ---------- Le Père Noël à l'entraînement ---------- */

  function buildSanta() {
    Z.el = el('div', 'xmp-santa');
    Z.el.hidden = true;
    Z.walker = el('div', 'xmp-santa__run');
    Z.flip = el('div', 'xmp-santa__flip');
    Z.fig = el('div', 'xmp-santa__fig', SANTA_HTML);
    Z.say = el('span', 'xmp-santa__say', 'Ho ho ho !');
    Z.flip.append(Z.fig);
    Z.walker.append(Z.flip, Z.say);
    Z.el.append(Z.walker);
    layer.appendChild(Z.el);
    if (mouse && !soft) {
      Z.fig.classList.add('is-hittable');
      Z.fig.addEventListener('pointerdown', punchSanta);
    }
    Z.x = -200;
    Z.walker.style.transform = `translateX(${Z.x}px)`;
    runLoop();
  }

  // Position du Père Noël calculée depuis sa propre animation, sans lire le DOM.
  function santaRect() {
    let x = Z.x;
    const a = Z.anim;
    if (a && a.effect && Z.seg) {
      const p = a.effect.getComputedTiming().progress;
      if (p != null) x = Z.seg.from + (Z.seg.to - Z.seg.from) * p;
    }
    const h = innerWidth < 600 ? 70 : 96;
    const bottom = innerHeight - floorPx;
    return { left: x, top: bottom - h, width: h * 0.8, height: h, right: x + h * 0.8, bottom };
  }

  // Devant un bouton ou un lien, il devient transparent : il ne vole jamais un clic, et l'appel
  // à l'action reste lisible. Les boutons de la bande où il court sont relevés par un
  // IntersectionObserver (à l'arrêt du défilement, puis toutes les 4 s au plus) : le navigateur
  // donne leurs positions sans qu'on force une mise en page ; chaque test ne compare que des nombres.
  const TARGETS = 'a, button, input, select, textarea, label, [role="button"]';
  let band = [];
  let bandAt = -1e9;
  let scrolling = false;
  let scrollT = 0;
  function readBand() {
    bandAt = performance.now();
    const zh = innerWidth < 600 ? 70 : 96;
    const bottom = innerHeight - floorPx;
    const top = bottom - zh;
    const io = new IntersectionObserver((entries) => {
      io.disconnect();
      const out = [];
      for (const e of entries) {
        const b = e.boundingClientRect;
        if (b.width > 0 && b.bottom > top && b.top < bottom) out.push(b.left, b.right);
      }
      band = out;
    });
    for (const n of doc.querySelectorAll(TARGETS)) if (!layer.contains(n)) io.observe(n);
  }

  function ghostCheck() {
    if (!Z.fig || !alive || !layer) return;
    const r = santaRect();
    let over = false;
    if (r.right > 0 && r.left < innerWidth) {
      // Pendant un défilement, la page glisse sous lui : il reste transparent jusqu'à l'arrêt.
      if (scrolling) over = true;
      else {
        if (performance.now() - bandAt > 4000) readBand();
        for (let i = 0; i < band.length && !over; i += 2) over = band[i + 1] > r.left && band[i] < r.right;
      }
    }
    Z.fig.classList.toggle('is-ghost', over);
  }

  function onScroll() {
    scrolling = true;
    clearTimeout(scrollT);
    scrollT = setTimeout(() => {
      scrolling = false;
      bandAt = -1e9;
      if (Z.el && !Z.el.hidden) requestAnimationFrame(ghostCheck);
    }, 180);
  }

  // Il n'existe que pendant ses courses : entre deux, il n'est ni dessiné ni testé.
  function showSanta(on) {
    Z.el.hidden = !on;
    clearInterval(Z.check);
    Z.check = on ? setInterval(() => requestAnimationFrame(ghostCheck), CFG.ghostCheckMs) : 0;
    if (on) {
      bandAt = -1e9;
      requestAnimationFrame(ghostCheck);
    }
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

  function runTo(target) {
    return new Promise((resolve) => {
      const go = () => {
        if (!alive) return resolve();
        const from = Z.x;
        Z.fig.classList.add('is-running');
        const anim = Z.walker.animate([{ transform: tx(from) }, { transform: tx(target) }], {
          duration: (Math.abs(target - from) / CFG.runSpeed) * 1000,
          easing: 'linear',
          fill: 'forwards',
        });
        Z.anim = anim;
        Z.seg = { from, to: target };
        anim.onfinish = () => {
          Z.x = target;
          Z.walker.style.transform = tx(target);
          anim.cancel();
          Z.anim = null;
          Z.seg = null;
          Z.resume = null;
          resolve();
        };
        Z.resume = go;
      };
      go();
    });
  }

  async function shadowBox() {
    Z.fig.classList.remove('is-running');
    Z.fig.classList.add('is-boxing');
    // Une fois sur trois, il se fait plaisir.
    if (Math.random() < 0.34) say(1500);
    await wait(1500);
    if (Z.fig) Z.fig.classList.remove('is-boxing');
  }

  function say(ms) {
    Z.say.classList.add('is-on');
    const id = setTimeout(() => Z.say && Z.say.classList.remove('is-on'), ms);
    timers.push(id);
  }

  async function runLoop() {
    let first = true;
    while (alive) {
      await wait(first ? CFG.runFirstMs : rand(CFG.runGapMs[0], CFG.runGapMs[1]));
      first = false;
      if (!alive) return;
      const W = innerWidth;
      const dir = Z.dir === 1 && Z.x > W / 2 ? -1 : 1;
      const from = dir > 0 ? -150 : W + 150;
      const to = dir > 0 ? W + 150 : -150;
      Z.x = from;
      Z.hits = 0;
      Z.walker.style.transform = tx(from);
      setDir(dir);
      readFloor();
      showSanta(true);
      // Il s'arrête une fois sur deux pour boxer dans le vide, comme sur les marches de Philadelphie.
      const stops = Math.random() < 0.55 ? [from + (to - from) * rand(0.32, 0.62)] : [];
      for (const s of stops) {
        await runTo(s);
        if (!alive) return;
        await whileBusy();
        await shadowBox();
        await whileBusy();
      }
      await runTo(to);
      await whileBusy();
      if (!alive) return;
      Z.fig.classList.remove('is-running', 'is-boxing', 'is-ghost');
      showSanta(false);
    }
  }

  async function whileBusy() {
    while (Z.busy && alive) await wait(120);
  }

  // À la souris : il pare les deux premiers coups, au troisième il éclate de rire et lance un
  // cadeau. On ne met pas le Père Noël K.O.
  async function punchSanta(e) {
    if (Z.busy || !alive) return;
    e.preventDefault();
    const fromLeft = e.clientX < Z.walker.getBoundingClientRect().left + Z.walker.offsetWidth / 2;
    const away = fromLeft ? 1 : -1;
    const running = !!Z.anim;
    if (Z.anim) {
      Z.x = currentX();
      Z.anim.cancel();
      Z.anim = null;
      Z.seg = null;
      Z.walker.style.transform = tx(Z.x);
    }
    Z.busy = true;
    Z.hits += 1;
    const fig = Z.fig;
    fig.classList.remove('is-running', 'is-boxing');
    if (Z.hits < 3) {
      fig.classList.add('is-block');
      const back = Z.walker.animate([{ transform: tx(Z.x) }, { transform: tx(Z.x + away * 14) }], { duration: 200, easing: 'cubic-bezier(.2,.9,.3,1)', fill: 'forwards' });
      await back.finished.catch(() => {});
      Z.x += away * 14;
      Z.walker.style.transform = tx(Z.x);
      back.cancel();
      await wait(300);
      fig.classList.remove('is-block');
    } else {
      Z.hits = 0;
      fig.classList.add('is-laugh');
      say(1600);
      throwGift(away);
      track('noel_santa_gift', { page: location.pathname });
      await wait(1600);
      fig.classList.remove('is-laugh');
    }
    Z.busy = false;
    if (running && Z.resume && alive) Z.resume();
  }

  // Le cadeau lancé décrit une parabole, rebondit au sol et éclate en confettis.
  function throwGift(away) {
    const r = santaRect();
    const g = el('div', 'xmp-gift', BOX_BODY + `<div class="xmp-gift__lid">${BOX_LID}</div>`);
    layer.appendChild(g);
    const x0 = r.left + r.width * 0.5;
    const y0 = r.top + r.height * 0.2;
    const dx = -away * rand(120, 200);
    const ground = innerHeight - floorPx - 22;
    const kf = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const x = x0 + dx * t;
      const y = y0 + (ground - y0) * t * t - 140 * Math.sin(Math.PI * t);
      kf.push({ transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${(-away * 360 * t).toFixed(0)}deg)` });
    }
    g.animate(kf, { duration: 900, easing: 'linear', fill: 'forwards' }).onfinish = () => {
      const end = kf[kf.length - 1].transform.replace(/rotate\([^)]*\)/, 'rotate(0deg)');
      g.animate([{ transform: end, opacity: 1 }, { transform: end + ' scale(1.3)', opacity: 0 }], { duration: 260, fill: 'forwards' }).onfinish = () => g.remove();
      confetti(x0 + dx, ground);
    };
  }

  function confetti(x, y) {
    const colors = ['#E8001C', '#FFB347', '#FFE9B0', '#8FD3FF', '#ffffff'];
    for (let i = 0; i < (lowEnd ? 8 : 14); i++) {
      const c = el('span', 'xmp-confetto');
      c.style.background = colors[i % colors.length];
      layer.appendChild(c);
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const v = rand(90, 220);
      const ex = x + Math.cos(a) * v;
      const ey = y + Math.sin(a) * v;
      c.animate(
        [
          { transform: `translate(${x}px,${y}px) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${ex.toFixed(1)}px,${ey.toFixed(1)}px) rotate(${rand(-300, 300).toFixed(0)}deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${ex.toFixed(1)}px,${(ey + rand(60, 120)).toFixed(1)}px) rotate(${rand(-500, 500).toFixed(0)}deg)`, opacity: 0 },
        ],
        { duration: rand(900, 1300), easing: 'cubic-bezier(.2,.7,.4,1)' }
      ).onfinish = () => c.remove();
    }
  }

  /* ---------- Le traîneau ---------- */

  // Une traversée calculée d'avance (arc léger, petit tangage), jouée par la carte graphique. Il
  // n'est montré qu'une fois posé à son point de départ, hors écran.
  async function sleighLoop() {
    const s = el('div', 'xmp-sleigh', SLEIGH_SVG);
    s.hidden = true;
    layer.appendChild(s);
    await wait(rand(CFG.sleighFirstMs[0], CFG.sleighFirstMs[1]));
    while (alive) {
      if (!doc.hidden) await fly(s);
      await wait(rand(CFG.sleighGapMs[0], CFG.sleighGapMs[1]));
    }
  }

  function fly(s) {
    const W = innerWidth;
    const w = W < 600 ? 170 : 260;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const x0 = dir > 0 ? -w - 20 : W + 20;
    const x1 = dir > 0 ? W + 20 : -w - 20;
    // En plein ciel, sous la guirlande : jamais emmêlé dans les lumières du menu.
    const y0 = innerHeight * rand(0.24, 0.34);
    const lift = rand(18, 40);
    const kf = [];
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = x0 + (x1 - x0) * t;
      const y = y0 - lift * Math.sin(Math.PI * t) + Math.sin(t * Math.PI * 6) * 4;
      kf.push({ transform: `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scaleX(${dir}) rotate(${(Math.cos(t * Math.PI * 6) * 2 - dir * Math.cos(Math.PI * t) * 4).toFixed(2)}deg)` });
    }
    s.style.width = w + 'px';
    s.style.transform = kf[0].transform;
    s.hidden = false;
    const a = s.animate(kf, { duration: ((W + w + 40) / rand(150, 210)) * 1000, easing: 'linear', fill: 'both' });
    return a.finished.catch(() => {}).then(() => {
      a.cancel();
      s.hidden = true;
    });
  }

  // ?noeldebug expose l'état pour les tests ; sans effet pour les visiteurs.
  if (/[?&]noeldebug\b/.test(location.search)) {
    window.__bcXmPage = {
      Z,
      boxes,
      pop: (i) => boxes[i] && pop(boxes[i]),
      sleigh: () => { const s = layer && layer.querySelector('.xmp-sleigh'); return s ? fly(s) : null; },
    };
  }

  if (store.get(OFF_KEY) !== OFF_VALUE) start();
})();
