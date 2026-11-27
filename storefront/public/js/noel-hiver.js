/*
 * Noël 2026 — la boutique gelée. Chargé par layout.js (ensureNoel) avec le cadeau du hero
 * (noel-ring.js) et le Père Noël (noel-page.js), du 26 novembre au 4 janvier.
 *
 * L'hiver a gelé la boutique. La neige tient sur le vrai site — les mots des grands titres, les
 * boutons, les cartes, les bandeaux — et s'épaissit pendant qu'on lit ; le givre prend les bords de
 * la fenêtre (à l'ordinateur) ou le fond du hero, derrière les textes (au téléphone) ; la guirlande
 * du menu est prise dans la glace. C'est le cadeau du hero qui réchauffe tout : chaque coup porté
 * dessus fait reculer le givre, fondre la neige et rallume des ampoules ; au K.O., tout fond et des
 * braises montent. Sans rien faire, l'hiver revient. Autour : la souris fait fondre la neige, le
 * doigt essuie le givre du hero, un coup dans le vide fait tomber la neige voisine, un défilement
 * vif la souffle.
 *
 * Rien ne se pose sur un texte : ni jauge ni bulle. Le froid ne se lit que dans le décor.
 *
 * Vitesse (leçon d'Halloween) : rien ne tourne image par image au repos. La neige qui tombe = des
 * tuiles CSS. Les couches de neige = un petit canvas par élément, dans un calque en coordonnées du
 * document : il défile avec la page sans une ligne de JS ; on les redessine à l'accumulation (toutes
 * les 1,6 s, seulement celles qu'on voit) et sous la main. Le givre = un canvas redessiné aux
 * effacements. Les particules ne vivent qu'après un coup. Aucune mise en page forcée : les mesures
 * viennent des observateurs du navigateur.
 *
 * Et on ne paie pas pour ce qu'on ne voit pas (mesuré le 27/11/2026 sur un vrai défilement) : chaque
 * calque du compositeur et chaque élément en cours d'animation se recalcule à chaque image d'un
 * défilement, même invisible. Donc : les braises n'existent que du K.-O. au retour du froid ; la
 * guirlande gelée n'a aucune animation (même en pause) ; les couches de neige sont des canvas
 * « logiciels », peints dans un seul calque ; hors de l'écran, le givre du hero n'est plus rendu ;
 * et quand la page se met à défiler, vapeur, gouttes et fondus en cours s'arrêtent net.
 *
 * La fête : quand un dossier est complet ou un paiement confirmé, layout.js le signale
 * (html.bc-noel-party) et la page dégèle d'elle-même — voir « La fête » plus bas.
 */
(function () {
  'use strict';
  if (window.__bcNoelHiver) return;
  window.__bcNoelHiver = true;

  const doc = document;
  const root = doc.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mouse = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  // Les couches de neige au téléphone : 1,5 suffit (la neige est douce), et c'est deux fois moins à peindre.
  const CAP_DPR = mouse ? DPR : Math.min(DPR, 1.5);
  const OFF_KEY = 'bc_noel_off';
  const OFF_VALUE = '2026';
  const HEAT_KEY = 'bc_noel_heat';
  const FROST_KEY = 'bc_noel_frost';
  const debug = /[?&]noeldebug\b/.test(location.search);
  if (!mouse) root.classList.add('xh-touch');

  const CFG = {
    punchR: mouse ? 230 : 170,
    meltR: mouse ? 62 : 54,
    meltRate: 0.6,
    // Sans coup sur le cadeau pendant 8 s, la boutique refroidit (tout regèle en un peu moins de 3 min).
    decayAfterMs: 8000,
    decayPerS: 0.006,
    holdMs: 45000,
    accumMs: 1600,
    // Un défilement plus vif que 2,4 px/ms souffle la neige des éléments à l'écran.
    flickSpeed: 2.4,
    budget: mouse ? { word: 16, band: 3, btn: 9, card: 20 } : { word: 6, band: 2, btn: 4, card: 6 },
  };

  /* ---------- Outils ---------- */

  const now = () => performance.now();
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const el = (tag, cls, html) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  };
  const sess = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* stockage bloqué */ } },
  };

  /* ---------- État ---------- */

  // Une seule valeur, de 0 (tout est gelé) à 1 (tout a fondu).
  const H = { v: 0, climaxed: false, peakAt: -1e9, lastAct: -1e9, decayT: 0, stage: -1 };
  // Les paliers du décor : stalactites de la guirlande, neige qui tombe, braises.
  const STAGES = [0, 0.2, 0.45, 0.75, 1];
  let alive = false;
  let fx = null; // calque fixe : givre des bords, neige qui tombe, braises, particules, ondes
  let capsLayer = null; // calque en coordonnées du document : couches de neige, gouttes, vapeur
  let snowEl = null;
  let emberEl = null;
  let warmEl = null;
  let handEl = null;
  let garland = null;
  let ac = null;
  let timers = [];
  let intervals = [];
  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  };
  const every = (fn, ms) => {
    const id = setInterval(fn, ms);
    intervals.push(id);
    return id;
  };

  /* ---------- Le froid et le chaud ---------- */

  // La chaleur suit le visiteur de page en page (le temps de la visite) et retombe pendant son absence.
  function loadHeat() {
    try {
      const s = JSON.parse(sess.get(HEAT_KEY) || 'null');
      if (!s) return;
      const idleS = Math.max(0, (Date.now() - s.t) / 1000 - CFG.decayAfterMs / 1000);
      H.v = clamp(s.v - idleS * CFG.decayPerS, 0, 1);
      H.climaxed = !!s.c && H.v > 0.4;
    } catch (e) {
      /* rien de sauvé */
    }
  }
  let saveT = 0;
  function saveHeat() {
    clearTimeout(saveT);
    saveT = 0;
    sess.set(HEAT_KEY, JSON.stringify({ v: +H.v.toFixed(4), t: Date.now(), c: H.climaxed ? 1 : 0 }));
  }
  function saveSoon() {
    if (!saveT) saveT = setTimeout(saveHeat, 700);
  }

  // Le cadeau réchauffe : la boutique prend au moins la chaleur qu'il a gagnée.
  function warmTo(v) {
    if (!alive) return;
    H.lastAct = now();
    const nv = clamp(v, 0, 1);
    if (nv > H.v) {
      H.v = nv;
      render();
    }
    if (!H.decayT) H.decayT = every(decayTick, 500);
    saveSoon();
  }
  // Un cadeau neuf arrive, gelé : le froid retombe (le décor, lui, revient en fondu).
  function coolDown() {
    if (!alive) return;
    H.v = 0;
    H.climaxed = false;
    if (fx) fx.classList.remove('is-hot');
    if (garland) garland.classList.remove('is-hot');
    hideEmbers();
    render();
    saveSoon();
  }

  function decayTick() {
    // Une page de confirmation reste chaude tant qu'on y est : la fête ne regèle pas.
    if (doc.hidden || !alive || H.party) return;
    const t = now();
    if (H.climaxed && t - H.peakAt < CFG.holdMs) return;
    if (t - H.lastAct < CFG.decayAfterMs) return;
    H.v = Math.max(0, H.v - CFG.decayPerS * 0.5);
    if (H.climaxed && H.v < 0.4) H.climaxed = false;
    render();
    saveSoon();
    // Le froid revient : le cadeau du hero l'apprend, sa glace se reforme au même rythme.
    doc.dispatchEvent(new CustomEvent('bc:noel-heat', { detail: { v: H.v } }));
    if (H.v <= 0) {
      clearInterval(H.decayT);
      H.decayT = 0;
    }
  }

  // Tout le décor se règle sur cette valeur, en opacité et en classes : rien à repeindre.
  function render() {
    if (!alive) return;
    const v = H.v;
    let s = 0;
    for (let i = 0; i < STAGES.length; i++) if (v >= STAGES[i]) s = i;
    if (s !== H.stage) {
      H.stage = s;
      if (garland) garland.dataset.stage = String(s);
      if (fx) fx.dataset.stage = String(s);
    }
    if (F.cv) F.cv.style.opacity = Math.pow(1 - v, 0.85).toFixed(3);
    if (warmEl) {
      warmEl.style.opacity = (Math.pow(v, 1.6) * 0.9).toFixed(3);
      warmEl.classList.toggle('is-on', v > 0.004);
    }
    if (snowEl) snowEl.style.opacity = (1 - sstep(0.5, 0.95, v)).toFixed(3);
    lightBulbs(v);
  }

  /* ---------- Le givre sur la vitre ---------- */

  // mode : 'fixed' (les bords de la fenêtre) ou 'hero' (le fond du hero, derrière les textes).
  // W × H : la taille du givre en pixels CSS ; w × h : celle du canvas.
  const F = { cv: null, ctx: null, full: null, fctx: null, haze: null, mask: null, mctx: null, w: 0, h: 0, W: 0, H: 0, s: 1, ms: 0.125, band: 0, vw: 0, regrowT: 0, idle: 0, raf: 0, masked: false, mode: 'fixed', host: null, box: null, ro: null, io: null, rect: null };

  // Où vit le givre. À l'ordinateur, sur grand écran : aux bords de la fenêtre, dans les marges
  // (jamais plus large que la marge du contenu). Au téléphone et sur petit écran, les textes vont
  // d'un bord à l'autre : le givre vit dans le hero, DERRIÈRE les textes, et le doigt l'essuie.
  // Sans hero : pas de givre sur cette page.
  function frostPlan() {
    const vw = innerWidth;
    if (mouse && vw >= 1000) {
      const gutter = (vw - Math.min(vw - 40, 1180)) / 2;
      return { mode: 'fixed', band: clamp(gutter - 6, 16, 124) };
    }
    const hero = doc.querySelector('.hero--cinema, .page-hero');
    return hero ? { mode: 'hero', host: hero, band: vw < 600 ? 58 : 84 } : null;
  }

  function buildFrost(intro) {
    const plan = frostPlan();
    if (!plan) return;
    F.mode = plan.mode;
    F.band = plan.band;
    F.host = plan.host || null;
    if (F.mode === 'fixed') {
      paintFrost(innerWidth, Math.max(innerHeight, root.clientHeight), intro && !reduce);
      return;
    }
    // Le calque du givre du hero : au-dessus de la vidéo et de son voile, sous le contenu.
    F.box = el('div', 'xh-heroice');
    F.box.setAttribute('aria-hidden', 'true');
    const veil = F.host.querySelector(':scope > .hero__veil');
    if (veil) veil.after(F.box);
    else F.host.prepend(F.box);
    // Sa taille arrive par un ResizeObserver : aucune mise en page forcée.
    F.ro = new ResizeObserver((ents) => {
      if (!alive) return;
      const e = ents[0];
      const bb = e.borderBoxSize && e.borderBoxSize[0];
      const w = bb ? bb.inlineSize : e.contentRect.width;
      const h = bb ? bb.blockSize : e.contentRect.height;
      if (w < 40 || h < 40) return;
      if (!F.cv || Math.abs(w - F.W) > 1 || Math.abs(h - F.H) > 60) paintFrost(w, h, false);
    });
    F.ro.observe(F.host);
    // Hero sorti de l'écran : son givre n'est plus rendu (le canvas garde son dessin). Deux calques
    // plein écran de moins pendant tout le reste de la page. « visibility » et pas « display » :
    // au retour, le fondu d'apparition du givre ne rejoue pas.
    F.io = new IntersectionObserver((ents) => {
      if (alive && F.box) F.box.style.visibility = ents[ents.length - 1].isIntersecting ? '' : 'hidden';
    }, { rootMargin: '200px 0px' });
    F.io.observe(F.host);
    const pas = { passive: true, signal: ac.signal };
    F.host.addEventListener('pointerdown', onHeroPointer, pas);
    F.host.addEventListener('pointermove', onHeroPointer, pas);
  }

  function paintFrost(cssW, cssH, intro) {
    if (F.raf) cancelAnimationFrame(F.raf);
    F.raf = 0;
    if (F.cv) F.cv.remove();
    F.W = cssW;
    F.H = cssH;
    F.vw = cssW;
    F.rect = null;
    F.cv = el('canvas', F.mode === 'hero' ? 'xh-frost xh-frost--hero' : 'xh-frost');
    if (F.mode === 'hero') F.box.appendChild(F.cv);
    else fx.insertBefore(F.cv, fx.firstChild);
    F.cv.style.opacity = Math.pow(1 - H.v, 0.85).toFixed(3);
    F.ctx = F.cv.getContext('2d');
    F.full = doc.createElement('canvas');
    F.fctx = F.full.getContext('2d');
    F.haze = doc.createElement('canvas');
    F.mask = doc.createElement('canvas');
    F.mctx = F.mask.getContext('2d');
    F.masked = false;
    // Pleine résolution (en pixels CSS) : des cristaux fins comme des cheveux, pas des traits flous.
    F.s = F.mode === 'hero' ? (lowEnd ? 0.6 : 0.75) : lowEnd ? 0.75 : 1;
    F.w = Math.ceil(cssW * F.s);
    F.h = Math.ceil(cssH * F.s);
    for (const c of [F.cv, F.full, F.haze]) {
      c.width = F.w;
      c.height = F.h;
    }
    F.mask.width = Math.ceil(cssW * F.ms);
    F.mask.height = Math.ceil(cssH * F.ms);
    paintHaze(F.haze.getContext('2d'));
    const segs = genFrost();
    const cv = F.cv;
    if (intro) {
      cv.classList.add('is-ready');
      growFrost(segs);
    } else {
      // Par tranches, de l'extérieur vers l'intérieur (chaque tranche garde son éclat), chacune
      // dans un moment de repos du navigateur ; le givre apparaît en fondu une fois dessiné.
      const n = segs.length;
      let k = 0;
      const slice = () => {
        if (!alive || F.cv !== cv) return;
        const t0 = performance.now();
        while (k < 8 && performance.now() - t0 < 8) {
          strokeSegs(F.fctx, segs, Math.floor((n * k) / 8), Math.floor((n * (k + 1)) / 8));
          k++;
        }
        if (k < 8) {
          if (window.requestIdleCallback) window.requestIdleCallback(slice, { timeout: 300 });
          else setTimeout(slice, 20);
          return;
        }
        mergeHaze();
        compose();
        cv.classList.add('is-ready');
      };
      slice();
    }
  }

  // La buée glacée des bords, plus dense dans les coins, et son grain.
  function paintHaze(c) {
    const W = F.w;
    const Hh = F.h;
    const b = F.band * F.s * 1.3;
    const col = (a) => `rgba(214,232,252,${a})`;
    // Dans le hero, le givre passe derrière des textes blancs : la buée y est plus légère, surtout
    // sur les côtés, pour ne rien enlever à leur contraste.
    const hero = F.mode === 'hero';
    const edge = (k, x0, y0, x1, y1, rx, ry, rw, rh) => {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, col(0.5 * k));
      g.addColorStop(0.5, col(0.14 * k));
      g.addColorStop(1, col(0));
      c.fillStyle = g;
      c.fillRect(rx, ry, rw, rh);
    };
    edge(hero ? 0.8 : 1, 0, 0, 0, b, 0, 0, W, b);
    edge(hero ? 0.7 : 1, 0, Hh, 0, Hh - b, 0, Hh - b, W, b);
    edge(hero ? 0.4 : 1, 0, 0, b, 0, 0, 0, b, Hh);
    edge(hero ? 0.4 : 1, W, 0, W - b, 0, W - b, 0, b, Hh);
    for (const [x, y] of [[0, 0], [W, 0], [0, Hh], [W, Hh]]) {
      const r = b * 2.6;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, col(hero ? 0.3 : 0.5));
      g.addColorStop(1, col(0));
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.fillStyle = '#fff';
    const n = Math.round((W + Hh) * (F.vw < 600 ? 0.9 : 1.3));
    for (let i = 0; i < n; i++) {
      const e = (Math.random() * 4) | 0;
      const dd = Math.pow(Math.random(), 2.3) * b;
      const x = e === 2 ? dd : e === 3 ? W - dd : Math.random() * W;
      const y = e === 0 ? dd : e === 1 ? Hh - dd : Math.random() * Hh;
      const r = rand(0.3, 0.85);
      c.globalAlpha = rand(0.2, 0.75);
      c.fillRect(x, y, r, r);
    }
    c.globalAlpha = 1;
  }

  // Des cristaux qui partent des bords : un tronc qui ondule un peu, des branches à 60° (la glace
  // pousse en hexagones), plus longs dans les coins.
  function genFrost() {
    const W = F.w;
    const Hh = F.h;
    const band = F.band * F.s;
    const segs = [];
    const step = (F.vw < 600 ? 26 : 19) * F.s;
    const seeds = [];
    for (let x = rand(0, step); x < W; x += step * rand(0.6, 1.4)) {
      seeds.push([x, 0, Math.PI / 2]);
      seeds.push([x, Hh, -Math.PI / 2]);
    }
    for (let y = rand(0, step); y < Hh; y += step * rand(0.6, 1.4)) {
      seeds.push([0, y, 0]);
      seeds.push([W, y, Math.PI]);
    }
    for (const [x, y, a] of seeds) {
      const ex = Math.min(x, W - x);
      const ey = Math.min(y, Hh - y);
      const corner = 1 - clamp(Math.max(ex, ey) / (band * 3), 0, 1);
      const len = band * rand(0.22, 0.72) * (1 + corner * 0.6);
      branch(segs, x, y, a + rand(-0.6, 0.6), len, 0, 0, rand(-0.035, 0.035));
    }
    // Des fleurs de givre : six bras à 60°, chacun avec ses barbes, posées dans la bande.
    const nf = Math.round(((F.vw + F.h / F.s) * 2) / (F.vw < 600 ? 260 : 150));
    for (let i = 0; i < nf; i++) {
      const e = (Math.random() * 4) | 0;
      const dd = rand(0.2, 0.85) * band;
      const x = e === 2 ? dd : e === 3 ? W - dd : rand(0, W);
      const y = e === 0 ? dd : e === 1 ? Hh - dd : rand(0, Hh);
      const R = rand(5, 12) * F.s;
      const rot = rand(0, Math.PI / 3);
      for (let k = 0; k < 6; k++) branch(segs, x, y, rot + (k * Math.PI) / 3, R, 1, dd * 0.9, 0);
    }
    segs.sort((p, q) => p.o - q.o);
    return segs;
  }
  // Une plume de givre : un tronc qui s'incurve à peine, des barbes à 60° qui alternent d'un côté à
  // l'autre, et des barbules sur les barbes.
  function branch(segs, x, y, a, len, depth, o0, curl) {
    const st = (depth === 0 ? 3 : depth === 1 ? 2.2 : 1.6) * F.s;
    const w0 = depth === 0 ? 0.95 : depth === 1 ? 0.7 : 0.5;
    const a0 = depth === 0 ? 0.8 : depth === 1 ? 0.62 : 0.44;
    const pb = depth === 0 ? 0.55 : depth === 1 ? 0.3 : 0;
    let d = 0;
    let px = x;
    let py = y;
    let ang = a;
    let side = Math.random() < 0.5 ? 1 : -1;
    while (d < len) {
      ang += curl + rand(-0.06, 0.06);
      const nx = px + Math.cos(ang) * st;
      const ny = py + Math.sin(ang) * st;
      const t = d / len;
      segs.push({ x1: px, y1: py, x2: nx, y2: ny, w: w0 * (1 - t * 0.5), a: a0 * (1 - t * 0.55), o: o0 + d, k: depth });
      if (pb && t > 0.05 && t < 0.9 && Math.random() < pb) {
        side = Math.random() < 0.8 ? -side : side;
        const bl = Math.min((len - d) * (depth === 0 ? rand(0.2, 0.42) : rand(0.3, 0.55)), F.band * F.s * 0.32);
        if (bl > st * 1.5) branch(segs, nx, ny, ang + side * (Math.PI / 3) * rand(0.85, 1.1), bl, depth + 1, o0 + d, curl * 0.5);
      }
      px = nx;
      py = ny;
      d += st;
    }
  }
  // Un tracé par profondeur : d'abord une ombre bleue décalée (elle fait lire le givre sur les
  // sections claires), puis le blanc.
  function strokeSegs(c, segs, a, b) {
    if (b <= a) return;
    c.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const p = new Path2D();
      let n = 0;
      let ws = 0;
      let as = 0;
      for (let j = a; j < b; j++) {
        const s = segs[j];
        if (s.k !== k) continue;
        p.moveTo(s.x1, s.y1);
        p.lineTo(s.x2, s.y2);
        ws += s.w;
        as += s.a;
        n++;
      }
      if (!n) continue;
      const w = ws / n;
      const al = as / n;
      c.save();
      c.translate(0.45, 0.5);
      c.strokeStyle = `rgba(58,98,150,${(al * 0.4).toFixed(3)})`;
      c.lineWidth = w + 0.55;
      c.stroke(p);
      c.restore();
      c.strokeStyle = `rgba(247,251,255,${al.toFixed(3)})`;
      c.lineWidth = w;
      c.stroke(p);
    }
  }
  // Le givre se forme sous les yeux du visiteur, des bords vers le centre (la première page de la visite).
  function growFrost(segs) {
    const oMax = segs.length ? segs[segs.length - 1].o : 1;
    let i = 0;
    let t0 = 0;
    const step = (t) => {
      F.raf = 0;
      if (!alive || !F.fctx) return;
      if (!t0) t0 = t;
      const k = clamp((t - t0) / 1800, 0, 1);
      const cut = (1 - Math.pow(1 - k, 2.4)) * oMax;
      const j0 = i;
      while (i < segs.length && segs[i].o <= cut) i++;
      strokeSegs(F.fctx, segs, j0, i);
      if (k < 1) {
        compose(k);
        F.raf = requestAnimationFrame(step);
      } else {
        mergeHaze();
        compose();
      }
    };
    F.raf = requestAnimationFrame(step);
  }
  function mergeHaze() {
    if (!F.haze) return;
    F.fctx.globalCompositeOperation = 'destination-over';
    F.fctx.drawImage(F.haze, 0, 0);
    F.fctx.globalCompositeOperation = 'source-over';
    F.haze = null;
  }
  function compose(hazeAlpha) {
    const c = F.ctx;
    if (!c) return;
    c.globalCompositeOperation = 'copy';
    if (F.haze) {
      c.globalAlpha = hazeAlpha == null ? 1 : hazeAlpha;
      c.drawImage(F.haze, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
    c.drawImage(F.full, 0, 0);
    if (F.masked) {
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(F.mask, 0, 0, F.w, F.h);
    }
    c.globalCompositeOperation = 'source-over';
  }
  // Dans le repère du givre (la fenêtre, ou le hero).
  function nearEdge(x, y, pad) {
    const b = F.band * (pad || 1.3);
    return x < b || y < b || x > F.W - b || y > F.H - b;
  }
  // Un point de l'écran, dans ce repère ; rien s'il tombe hors du givre.
  function frostPoint(cx, cy) {
    if (!F.cv) return null;
    if (F.mode === 'fixed') return { x: cx, y: cy };
    const r = F.rect || (F.rect = F.host.getBoundingClientRect());
    const x = cx - r.left;
    const y = cy - r.top;
    return x >= 0 && y >= 0 && x <= r.width && y <= r.height ? { x, y } : null;
  }
  // La main efface le givre (un masque en basse résolution) ; il repousse doucement.
  function wipe(cx, cy, r, a) {
    if (!F.mctx) return;
    const m = F.mctx;
    const x = cx * F.ms;
    const y = cy * F.ms;
    const rr = Math.max(2, r * F.ms);
    const g = m.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(0.55, `rgba(0,0,0,${(a * 0.7).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    m.fillStyle = g;
    m.beginPath();
    m.arc(x, y, rr, 0, Math.PI * 2);
    m.fill();
    F.masked = true;
    F.idle = 0;
    if (!F.regrowT) F.regrowT = every(regrow, 320);
  }
  function regrow() {
    // Pas pendant un défilement : chaque repousse redessine le givre.
    if (doc.hidden || !F.mctx || scrolling()) return;
    F.idle++;
    if (F.idle < 6) return;
    const m = F.mctx;
    if (F.idle > 75) {
      m.clearRect(0, 0, F.mask.width, F.mask.height);
      F.masked = false;
      compose();
      clearInterval(F.regrowT);
      F.regrowT = 0;
      return;
    }
    m.globalCompositeOperation = 'destination-out';
    m.fillStyle = 'rgba(0,0,0,0.06)';
    m.fillRect(0, 0, F.mask.width, F.mask.height);
    m.globalCompositeOperation = 'source-over';
    compose();
  }
  function dropFrost(keepNodes) {
    if (F.raf) cancelAnimationFrame(F.raf);
    clearInterval(F.regrowT);
    F.raf = 0;
    F.regrowT = 0;
    if (F.ro) F.ro.disconnect();
    F.ro = null;
    if (F.io) F.io.disconnect();
    F.io = null;
    if (!keepNodes) {
      if (F.cv) F.cv.remove();
      if (F.box) F.box.remove();
    }
    F.cv = F.ctx = F.full = F.fctx = F.haze = F.mask = F.mctx = F.box = F.host = F.rect = null;
  }

  /* ---------- La neige qui tient sur le site ---------- */

  const C = { list: [], byNode: new Map(), io: null, ro: null, tick: 0, ox: 0, oy: 0 };
  const INTERACTIVE = 'a, button, input, select, textarea, label, summary, video, iframe, [role="button"], [role="link"], [contenteditable="true"], [contenteditable=""]';
  const NO_SNOW = 'header, nav, .topbar, #ff-promo, [role="dialog"], dialog, .modal, .drawer, form, #chloeFab, .chat-fab, .xm-front, .xm-back, #bcXmPage';
  const rng = doc.createRange();
  const insets = new WeakMap();
  let mctx = null;

  // Le tri des cibles ne lit que des styles : aucune mise en page forcée. La taille et la place se
  // vérifient à l'apparition, avec les mesures que l'IntersectionObserver vient de faire.
  function eligible(n) {
    if (!n || !n.isConnected || n.closest(NO_SNOW)) return false;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    // Ni dans un ruban qui défile de côté, ni dans un bloc fixe : la neige ne suivrait pas.
    for (let p = n.parentElement, i = 0; p && p !== doc.body && i < 8; p = p.parentElement, i++) {
      const pc = getComputedStyle(p);
      if (pc.overflowX === 'auto' || pc.overflowX === 'scroll') return false;
      if (pc.position === 'fixed' || pc.position === 'sticky') return false;
    }
    return true;
  }
  function fits(c, r) {
    if (!r) return false;
    const word = c.kind === 'word';
    return r.width >= (word ? 12 : 56) && r.height >= (word ? 8 : 20) && r.left >= -2 && r.right <= root.clientWidth + 2;
  }
  function upper(h) {
    if (getComputedStyle(h).textTransform === 'uppercase') return true;
    const t = (h.textContent || '').replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (t.length < 3) return false;
    return t.replace(/[^A-ZÀ-Þ]/g, '').length / t.length > 0.8;
  }
  function wordsOf(h) {
    const out = [];
    const tw = doc.createTreeWalker(h, NodeFilter.SHOW_TEXT);
    for (let t = tw.nextNode(); t; t = tw.nextNode()) {
      const re = /\S+/g;
      let m;
      while ((m = re.exec(t.nodeValue))) {
        if (/[A-Za-zÀ-ÿ0-9]/.test(m[0])) out.push({ text: t, start: m.index, end: m.index + m[0].length });
      }
    }
    return out;
  }
  // Le haut des capitales dans la boîte du texte : la neige se pose sur les lettres, pas au-dessus.
  function capInset(h) {
    if (insets.has(h)) return insets.get(h);
    let v = 0;
    try {
      const cs = getComputedStyle(h);
      mctx = mctx || doc.createElement('canvas').getContext('2d');
      mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = mctx.measureText('HBEXTM');
      v = m.fontBoundingBoxAscent ? m.fontBoundingBoxAscent - m.actualBoundingBoxAscent : parseFloat(cs.fontSize) * 0.2;
    } catch (e) {
      v = 0;
    }
    insets.set(h, v);
    return v;
  }
  function rectOf(c) {
    if (!c.node.isConnected) return null;
    if (c.kind !== 'word') return c.node.getBoundingClientRect();
    try {
      rng.setStart(c.text, c.start);
      rng.setEnd(c.text, c.end);
      return rng.getBoundingClientRect();
    } catch (e) {
      return null;
    }
  }

  function collectTargets() {
    const out = [];
    const B = CFG.budget;
    const ok = eligible;
    let nw = 0;
    for (const h of doc.querySelectorAll('h1, h2')) {
      if (nw >= B.word || !ok(h) || !upper(h)) continue;
      for (const w of wordsOf(h)) {
        if (nw >= B.word) break;
        out.push({ node: h, kind: 'word', text: w.text, start: w.start, end: w.end });
        nw++;
      }
    }
    let nb = 0;
    for (const n of doc.querySelectorAll('.statstrip, .cta-band, .site-footer')) {
      if (nb < B.band && ok(n)) { out.push({ node: n, kind: 'band' }); nb++; }
    }
    let nt = 0;
    for (const n of doc.querySelectorAll('.btn, .ff-btn')) {
      if (nt < B.btn && ok(n)) { out.push({ node: n, kind: 'btn' }); nt++; }
    }
    let nc = 0;
    for (const n of doc.querySelectorAll('.qtile, .offer-card, .gear-card, .testimonial-card, .gym-card, .product-card, .shop-card, .card')) {
      if (nc < B.card && ok(n)) { out.push({ node: n, kind: 'card' }); nc++; }
    }
    return out;
  }

  // Garde les couches des éléments toujours là, ajoute les nouveaux, retire les disparus.
  function syncCaps() {
    if (!alive) return;
    const targets = collectTargets();
    const keep = new Set();
    const old = new Map();
    for (const c of C.list) old.set(c.kind === 'word' ? c.text.__xhKey + ':' + c.start : c.node, c);
    const next = [];
    for (const t of targets) {
      if (t.kind === 'word' && !t.text.__xhKey) t.text.__xhKey = Math.random().toString(36).slice(2);
      const k = t.kind === 'word' ? t.text.__xhKey + ':' + t.start : t.node;
      let c = old.get(k);
      if (!c) c = makeCap(t);
      keep.add(c);
      next.push(c);
    }
    for (const c of C.list) if (!keep.has(c)) dropCap(c);
    C.list = next;
    C.byNode.clear();
    for (const c of next) {
      if (!C.byNode.has(c.node)) {
        C.byNode.set(c.node, []);
        C.io.observe(c.node);
      }
      C.byNode.get(c.node).push(c);
    }
    measureAll();
  }

  // Le canvas n'est créé qu'à la première apparition : une page longue ne paie que ce qu'on voit.
  function makeCap(t) {
    return {
      node: t.node,
      kind: t.kind,
      text: t.text || null,
      start: t.start || 0,
      end: t.end || 0,
      cv: null,
      ctx: null,
      rad: 0,
      amp: rand(0.78, 1.08), // pas deux couches de la même épaisseur
      x: 0, base: 0, w: 0, n: 0, step: 3, maxH: 0, ow: 0, droop: 0, left: 0, cw: 0, ch: 0,
      h: null, tg: null, sp: null,
      vis: false, on: false, pending: false, melt: 0, shaped: false, fadeUntil: 0,
    };
  }
  function dropCap(c) {
    if (c.cv) c.cv.remove();
    c.on = false;
  }
  function ensureCanvas(c) {
    if (c.cv) return;
    c.cv = el('canvas', 'xh-cap');
    capsLayer.appendChild(c.cv);
    // Un canvas « logiciel » : le navigateur le peint dans le calque des couches de neige au lieu
    // d'en faire un calque du compositeur à lui seul. Dix-huit petits calques en moins : chaque
    // calque se paie à chaque image d'un défilement, même hors de l'écran.
    c.ctx = c.cv.getContext('2d', { willReadFrequently: true });
    c.rad = c.kind === 'word' ? 0 : parseFloat(getComputedStyle(c.node).borderTopLeftRadius) || 0;
  }
  function layerOrigin() {
    const lr = capsLayer.getBoundingClientRect();
    C.ox = lr.left + scrollX;
    C.oy = lr.top + scrollY;
    C.oSet = true;
  }

  function measureAll() {
    if (!alive || !capsLayer || !C.list.some((c) => c.cv)) return;
    layerOrigin();
    const rects = C.list.map((c) => (c.cv && (c.on || c.vis) ? rectOf(c) : null));
    C.list.forEach((c, i) => {
      if (rects[i] && rects[i].width > 1 && shape(c, rects[i])) draw(c);
    });
  }

  function shape(c, r) {
    ensureCanvas(c);
    const sx = scrollX;
    const sy = scrollY;
    let x = r.left + sx;
    let w = r.width;
    let top = r.top + sy;
    let maxH;
    let ow;
    let droop;
    if (c.kind === 'word') {
      top += capInset(c.node);
      x -= 1;
      w += 2;
      const fs = parseFloat(getComputedStyle(c.node).fontSize) || 40;
      maxH = clamp(fs * 0.22, 6, 18);
      ow = 1.6;
      droop = 2;
    } else if (c.kind === 'btn') {
      maxH = clamp(r.height * 0.26, 8, 14);
      ow = 2.8;
      droop = 3 + Math.min(c.rad, 12) * 0.25;
    } else if (c.kind === 'band') {
      maxH = mouse ? 22 : 15;
      ow = 0;
      droop = 0;
    } else {
      maxH = clamp(w * 0.06, 11, mouse ? 26 : 18);
      ow = 3.6;
      droop = 4 + Math.min(c.rad, 18) * 0.25;
    }
    maxH *= c.amp || 1;
    const PAD = 4;
    const vwDoc = root.clientWidth;
    const left = Math.max(0, x - ow - PAD);
    const right = Math.min(vwDoc, x + w + ow + PAD);
    const step = c.kind === 'word' ? 2.5 : mouse ? 3 : 4;
    const n = Math.max(3, Math.ceil(w / step) + 1);
    const resized = n !== c.n || Math.abs(w - c.w) > 0.5;
    const redraw = resized || !c.shaped || Math.abs(maxH - c.maxH) > 0.05;
    c.x = x;
    c.base = top;
    c.w = w;
    c.step = (w / (n - 1));
    c.maxH = maxH;
    c.ow = ow;
    c.droop = droop;
    c.left = left;
    c.cw = Math.max(4, right - left);
    c.ch = Math.ceil(maxH + droop + PAD * 2 + 2);
    if (resized) {
      const fill = c.h ? meanFill(c) : clamp((rand(0.5, 0.68)) * (1 - H.v * 0.9), 0, 1);
      c.n = n;
      profile(c, fill);
    }
    const W = Math.ceil(c.cw * CAP_DPR);
    const Hh = Math.ceil(c.ch * CAP_DPR);
    if (c.cv.width !== W) c.cv.width = W;
    if (c.cv.height !== Hh) c.cv.height = Hh;
    c.cv.style.width = c.cw + 'px';
    c.cv.style.height = c.ch + 'px';
    c.cv.style.transform = `translate(${(left - C.ox).toFixed(1)}px,${(top - (maxH + PAD + 2) - C.oy).toFixed(1)}px)`;
    c.shaped = true;
    // Seule la forme se redessine ; un simple déplacement ne touche qu'au transform.
    return redraw;
  }
  function meanFill(c) {
    let s = 0;
    let n = 0;
    for (let i = 0; i < c.n; i++) {
      if (c.tg[i] > 0.1) {
        s += c.h[i] / c.tg[i];
        n++;
      }
    }
    return n ? s / n : 0.5;
  }
  // Le profil voulu : arrondi aux bouts, deux ondulations lentes et quelques bosses (là où le vent
  // a poussé la neige), ramené à la hauteur de la couche ; puis l'état actuel.
  function profile(c, fill) {
    const n = c.n;
    c.h = new Float32Array(n);
    c.tg = new Float32Array(n);
    const f1 = rand(1.1, 2.4);
    const f2 = rand(4.5, 8.5);
    const p1 = rand(0, 6.283);
    const p2 = rand(0, 6.283);
    const taper = c.kind === 'band' ? 0.015 : c.kind === 'word' ? 0.2 : clamp((c.rad || 0) / Math.max(40, c.w) + 0.08, 0.08, 0.3);
    const K = c.kind === 'word' ? 1 + (Math.random() < 0.55 ? 1 : 0) : c.kind === 'band' ? Math.max(3, Math.round(c.w / 85)) : 2 + Math.floor(Math.random() * 3);
    const bw = c.kind === 'band' ? 14 / Math.max(200, c.w) : 1;
    const bumps = [];
    for (let k = 0; k < K; k++) {
      const a = rand(0.14, 0.42) * (Math.random() < 0.22 ? -0.55 : 1);
      bumps.push([rand(0.1, 0.9), c.kind === 'band' ? rand(1, 2.6) * bw : rand(0.05, 0.13), a]);
    }
    let top = 0;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const e = 0.24 + 0.76 * sstep(0, taper, t) * sstep(0, taper, 1 - t);
      let b = 1 + 0.1 * Math.sin(t * 6.283 * f1 + p1) + 0.05 * Math.sin(t * 6.283 * f2 + p2);
      for (const [bc, bwid, ba] of bumps) {
        const d = (t - bc) / bwid;
        b += ba * Math.exp(-d * d);
      }
      c.tg[i] = e * Math.max(0.25, b);
      if (c.tg[i] > top) top = c.tg[i];
    }
    for (let i = 0; i < n; i++) {
      c.tg[i] = (c.tg[i] / (top || 1)) * c.maxH;
      c.h[i] = c.tg[i] * fill * rand(0.92, 1.05);
    }
    c.sp = [];
    const ns = Math.round(clamp(c.w / 45, 1, 14));
    for (let i = 0; i < ns; i++) c.sp.push({ u: Math.random(), d: rand(0.18, 0.55), s: rand(0.5, 1.1), g: Math.random() < 0.25 });
    // Le grain : de la neige, pas du plâtre.
    c.gr = [];
    const ng = Math.round(clamp(c.w / 5, 4, 160));
    for (let i = 0; i < ng; i++) c.gr.push({ u: Math.random(), d: rand(0.25, 0.95) });
  }

  // Une couche de neige : la surface passe par le haut de chaque colonne, déborde un peu des bords
  // et retombe en lèvre ; dessous, une ombre de contact sur l'élément.
  function draw(c) {
    if (!c.shaped) return;
    const ctx = c.ctx;
    ctx.setTransform(CAP_DPR, 0, 0, CAP_DPR, 0, 0);
    ctx.clearRect(0, 0, c.cw, c.ch);
    const h = c.h;
    const n = c.n;
    let hmax = 0;
    for (let i = 0; i < n; i++) if (h[i] > hmax) hmax = h[i];
    if (hmax < 0.4) return;
    const word = c.kind === 'word';
    const base = c.maxH + 6; // le haut de l'élément, dans le canvas
    const x0 = c.x - c.left; // le bord gauche de l'élément, dans le canvas
    const xr = x0 + c.w;
    const k0 = clamp(h[0] / (c.maxH * 0.45), 0, 1);
    const k1 = clamp(h[n - 1] / (c.maxH * 0.45), 0, 1);
    const lipL = c.ow * k0;
    const lipR = c.ow * k1;
    const dL = c.droop * k0;
    const dR = c.droop * k1;
    // La neige mord un peu sur l'élément : jamais de jour entre la couche et ce qu'elle couvre.
    const sink = word ? 1.8 : 0.9;

    // Ombre de contact sur l'élément — pas sur des lettres blanches, où elle ferait un trait noir.
    if (!word) {
      const g = ctx.createLinearGradient(0, base, 0, base + 5);
      g.addColorStop(0, 'rgba(8,16,40,0.22)');
      g.addColorStop(1, 'rgba(8,16,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, base, c.w, 5);
    }

    // Le dessus (et ses deux lèvres), puis le corps fermé par le dessous.
    const top = new Path2D();
    top.moveTo(x0 - lipL, base + dL);
    top.bezierCurveTo(x0 - lipL - 1.1, base + dL - (dL + h[0]) * 0.6, x0 - lipL * 0.3, base - h[0], x0 + c.step * 0.5, base - (h[0] + h[1]) / 2);
    for (let i = 1; i < n; i++) {
      const xa = x0 + (i - 1) * c.step;
      const xb = x0 + i * c.step;
      top.quadraticCurveTo(xa, base - h[i - 1], (xa + xb) / 2, base - (h[i - 1] + h[i]) / 2);
    }
    top.bezierCurveTo(xr + lipR * 0.3, base - h[n - 1], xr + lipR + 1.1, base + dR - (dR + h[n - 1]) * 0.6, xr + lipR, base + dR);
    const body = new Path2D(top);
    body.quadraticCurveTo(xr + lipR * 0.15, base + dR * 0.3 + sink * 0.5, xr - 2, base + sink);
    body.lineTo(x0 + 2, base + sink);
    body.quadraticCurveTo(x0 - lipL * 0.15, base + dL * 0.3 + sink * 0.5, x0 - lipL, base + dL);
    body.closePath();

    // Le volume : blanc dessus, bleu de neige à l'ombre dessous. Devant un fond clair, la neige
    // blanche disparaît : son ombre bleue est plus marquée, un halo et un liseré la détachent.
    const light = c.light !== false;
    const g = ctx.createLinearGradient(0, base - hmax, 0, base + Math.max(dL, dR, sink));
    g.addColorStop(0, '#FFFFFF');
    if (light) {
      g.addColorStop(0.32, '#F3F7FC');
      g.addColorStop(0.68, '#D3E0EF');
      g.addColorStop(1, '#A9BEDA');
    } else {
      g.addColorStop(0.42, '#FAFCFF');
      g.addColorStop(0.74, '#E1EAF5');
      g.addColorStop(1, '#C2D2E6');
    }
    // L'ombre : la même forme, un peu plus bas et plus sombre, dessous (pas de flou : un flou de
    // canvas coûte cher à chaque redessin).
    ctx.save();
    ctx.translate(0, word ? 0.9 : 1.3);
    ctx.fillStyle = light ? 'rgba(20,34,70,0.26)' : 'rgba(0,0,0,0.22)';
    ctx.fill(body);
    ctx.restore();
    ctx.fillStyle = g;
    ctx.fill(body);
    if (light) {
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = 'rgba(96,126,172,0.55)';
      ctx.stroke(top);
    }
    // Une lumière juste sous le bord : le dessus des bosses accroche le jour.
    ctx.save();
    ctx.clip(body);
    ctx.translate(0, 1.7);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke(top);
    ctx.restore();

    ctx.fillStyle = 'rgba(132,160,200,0.42)';
    for (const s of c.gr) {
      const i = Math.min(n - 1, Math.round(s.u * (n - 1)));
      if (h[i] < 2.2) continue;
      ctx.fillRect(x0 + i * c.step, base - h[i] * (1 - s.d), 0.7, 0.7);
    }
    // Paillettes : la neige accroche la lumière.
    for (const s of c.sp) {
      const i = Math.min(n - 1, Math.round(s.u * (n - 1)));
      if (h[i] < 3) continue;
      const x = x0 + i * c.step;
      const y = base - h[i] * (1 - s.d);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(x - s.s / 2, y - s.s / 2, s.s, s.s);
      if (s.g) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(x - 2, y - 0.25, 4, 0.5);
        ctx.fillRect(x - 0.25, y - 2, 0.5, 4);
      }
    }
  }

  // Ce qu'il y a derrière la neige : clair (la page, une carte blanche) ou sombre (le hero et sa
  // vidéo, un bandeau marine). On remonte les fonds des parents — des styles, pas de mise en page.
  // Un bandeau pleine largeur a, derrière sa neige, la section du dessus.
  function opaqueLight(n) {
    for (let p = n; p && p.nodeType === 1; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(cs.backgroundColor);
      if (m && (m[4] === undefined || +m[4] > 0.5)) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 > 0.6;
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return false;
    }
    return true;
  }
  function bgLightOf(c) {
    if (c.kind === 'band') return opaqueLight(c.node.previousElementSibling || c.node.parentElement);
    return opaqueLight(c.kind === 'word' ? c.node : c.node.parentElement);
  }

  // L'angle de talus : une colonne ne dépasse pas trop ses voisines, la neige s'affaisse.
  function relax(c) {
    const h = c.h;
    const lim = c.kind === 'word' ? 1.3 : 1.8;
    for (let i = 0; i < c.n - 1; i++) {
      const d = h[i] - h[i + 1];
      if (d > lim) {
        const m = (d - lim) * 0.35;
        h[i] -= m;
        h[i + 1] += m;
      } else if (d < -lim) {
        const m = (-d - lim) * 0.35;
        h[i + 1] -= m;
        h[i] += m;
      }
    }
  }

  // Les couches qui entrent à l'écran apparaissent par lots : toutes les lectures d'abord, puis
  // toutes les écritures (une seule mise en page, pas une par couche).
  const revealQ = new Set();
  let revealT = 0;
  function reveal(c) {
    if (c.on || c.dead || revealQ.has(c)) return;
    revealQ.add(c);
    if (!revealT) revealT = later(flushReveal, 520);
  }
  // Pendant un défilement, la neige attend : le fil principal reste au défilement.
  let lastScrollAt = -1e9;
  const scrolling = () => now() - lastScrollAt < 180;
  // Et ce qui bougeait encore s'arrête net quand la page repart : une bouffée de vapeur ou une
  // couche en fondu, lancées à l'arrêt précédent, coûtaient un recalcul par image pendant tout le
  // geste suivant (c'était le plus gros poste du décor pendant un défilement). La page bouge :
  // personne ne voit la fin d'une bouffée.
  const live = new Set();
  const play = (node, frames, opts) => {
    const a = node.animate(frames, opts);
    live.add(a);
    a.onfinish = a.oncancel = () => live.delete(a);
    return a;
  };
  let moving = false;
  function moveStart() {
    moving = true;
    for (const a of [...live]) a.cancel();
    live.clear();
    // Les couches en train d'apparaître sont là d'un coup (plus de fondu pendant que ça défile).
    // On ne touche que celles-là : une classe sur tout le calque ferait recalculer toutes les autres.
    const t = now();
    for (const c of C.list) {
      if (c.fadeUntil > t && c.cv) c.cv.style.transition = 'none';
      c.fadeUntil = 0;
    }
  }
  function settle() {
    moving = false;
  }
  function flushReveal() {
    revealT = 0;
    if (!alive) return revealQ.clear();
    if (scrolling()) {
      revealT = later(flushReveal, 240);
      return;
    }
    settle();
    const all = [...revealQ].filter((c) => c.vis && !c.on && !c.dead);
    revealQ.clear();
    if (!all.length) return;
    // Par lots de six au plus : le reste attend le prochain moment de repos (jamais de longue tâche).
    const list = all.slice(0, 6);
    if (all.length > 6) {
      all.slice(6).forEach((c) => revealQ.add(c));
      const go = () => { if (alive) flushReveal(); };
      if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 300 });
      else setTimeout(go, 30);
    }
    if (!C.oSet) layerOrigin();
    const rects = list.map(rectOf);
    const lights = list.map((c) => (c.light == null ? bgLightOf(c) : c.light));
    const shown = [];
    list.forEach((c, i) => {
      const r = rects[i];
      if (!r || r.width < 2 || r.height < 2) return;
      // Trop petit, ou qui dépasse de l'écran sur le côté : cet élément n'aura pas de neige.
      if (!fits(c, r)) {
        c.dead = true;
        return;
      }
      c.light = lights[i];
      shape(c, r);
      draw(c);
      c.on = true;
      c.fadeUntil = now() + 950;
      c.cv.classList.add('is-on');
      shown.push(c);
    });
    // Les cartes du site arrivent en glissant : on reprend la mesure une fois posées.
    later(() => {
      if (!alive) return;
      const again = shown.filter((c) => c.on);
      const rs = again.map(rectOf);
      again.forEach((c, i) => {
        if (rs[i] && rs[i].width > 1 && shape(c, rs[i])) draw(c);
      });
    }, 1100);
  }

  // Il neige encore : les couches visibles s'épaississent. Plus il fait chaud, moins ça tient ;
  // au-delà de la moitié du thermomètre, ça fond tout seul.
  function accumTick() {
    if (doc.hidden || !alive || scrolling()) return;
    const v = H.v;
    const fall = clamp(1 - v * 2, 0, 1);
    const melt = v > 0.5 ? (v - 0.5) * 1.1 : 0;
    for (const c of C.list) {
      if (!c.on || !c.vis) continue;
      let changed = false;
      for (let i = 0; i < c.n; i++) {
        const tg = c.tg[i];
        let h = c.h[i];
        if (fall > 0 && h < tg) {
          h += (tg - h) * 0.03 * fall + (Math.random() < 0.12 * fall ? 0.35 : 0);
          if (h > tg) h = tg;
        }
        if (melt > 0 && h > 0) h = Math.max(0, h - melt * 0.7);
        if (h !== c.h[i]) {
          const d = Math.abs(h - c.h[i]);
          c.h[i] = h;
          changed = true;
          if (d > 0) c.drift = (c.drift || 0) + d / c.n;
        }
      }
      // On ne redessine que ce qui se voit : une fois la couche presque pleine, plus rien ne tourne.
      if (changed && (c.drift || 0) >= 0.45) {
        c.drift = 0;
        relax(c);
        draw(c);
      }
    }
  }

  // Un défilement vif souffle la neige des éléments à l'écran : au téléphone, c'est le geste de tous
  // les instants. On ne lit que la position de défilement ; le souffle part quand la page s'arrête.
  const wind = { y: 0, t: 0, peak: 0, timer: 0 };
  function onScroll() {
    const t = now();
    const y = scrollY;
    const dt = t - wind.t;
    if (dt > 0 && dt < 120) {
      const sp = Math.abs(y - wind.y) / dt;
      if (sp > wind.peak) wind.peak = sp;
    }
    wind.y = y;
    wind.t = t;
    lastScrollAt = t;
    F.rect = null;
    if (!moving) moveStart();
    if (!wind.timer) wind.timer = later(gust, 260);
  }
  function gust() {
    wind.timer = 0;
    if (!alive) return;
    if (scrolling()) {
      wind.timer = later(gust, 200);
      return;
    }
    settle();
    const sp = wind.peak;
    wind.peak = 0;
    if (sp < CFG.flickSpeed || reduce) return;
    const k = clamp((sp - CFG.flickSpeed) / 5 + 0.18, 0.18, 0.55);
    const sx = scrollX;
    const sy = scrollY;
    for (const c of C.list) {
      if (!c.on || !c.vis) continue;
      let sum = 0;
      for (let i = 0; i < c.n; i++) {
        const loss = c.h[i] * k * rand(0.5, 1);
        c.h[i] -= loss;
        sum += loss;
      }
      if (sum < 1.5) continue;
      draw(c);
      // Au doigt : deux bouffées animées par la carte graphique. À la souris : de la poudreuse.
      if (!mouse) {
        steam(c.x + c.w * rand(0.2, 0.45), c.base - 4);
        if (c.w > 120) steam(c.x + c.w * rand(0.55, 0.8), c.base - 4);
        continue;
      }
      const n = Math.min(6, 2 + Math.round(sum / 14));
      for (let j = 0; j < n; j++) spawn(c.x + Math.random() * c.w - sx, c.base - 3 - sy, rand(-90, 90), rand(-150, -30), rand(0.9, 1.7), 'powder');
    }
  }

  /* ---------- La main chaude ---------- */

  function meltAt(px, py, R, rate, dt) {
    let total = 0;
    for (const c of C.list) {
      if (!c.on || !c.vis) continue;
      if (py < c.base - c.maxH - R || py > c.base + R || px < c.x - R || px > c.x + c.w + R) continue;
      let got = 0;
      let gi = -1;
      let gmax = 0;
      const i0 = Math.max(0, Math.floor((px - R - c.x) / c.step));
      const i1 = Math.min(c.n - 1, Math.ceil((px + R - c.x) / c.step));
      for (let i = i0; i <= i1; i++) {
        const hh = c.h[i];
        if (hh <= 0.05) continue;
        const d = Math.hypot(px - (c.x + i * c.step), py - (c.base - hh * 0.5));
        if (d >= R) continue;
        const k = 1 - d / R;
        const dh = Math.min(hh, rate * k * k * dt);
        c.h[i] = hh - dh;
        got += dh;
        if (dh > gmax) {
          gmax = dh;
          gi = i;
        }
      }
      if (got > 0) {
        c.dirty = true;
        c.melt += got;
        total += got;
        if (c.melt > 9 && gi >= 0) {
          c.melt = 0;
          drip(c, gi);
        }
      }
    }
    return total;
  }
  function flushDirty() {
    for (const c of C.list) {
      if (c.dirty) {
        c.dirty = false;
        draw(c);
      }
    }
  }

  // À la souris : la neige fond sous le curseur, le givre des bords s'efface sur son passage.
  const ptr = { cx: -1, cy: -1, raf: 0, last: 0, steamAt: 0, handT: 0 };
  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    ptr.cx = e.clientX;
    ptr.cy = e.clientY;
    if (!ptr.raf) ptr.raf = requestAnimationFrame(moveStep);
  }
  function moveStep(t) {
    ptr.raf = 0;
    if (!alive) return;
    const dt = clamp((t - (ptr.last || t - 16.7)) / 16.7, 0.5, 3);
    ptr.last = t;
    const cx = ptr.cx;
    const cy = ptr.cy;
    let warm = false;
    if (F.cv && F.mode === 'fixed' && H.v < 0.97 && nearEdge(cx, cy)) {
      wipe(cx, cy, CFG.meltR * 1.15, 0.45);
      compose();
      warm = true;
    }
    const got = meltAt(cx + scrollX, cy + scrollY, CFG.meltR, CFG.meltRate * (1 + H.v * 1.5), dt);
    if (got > 0) {
      flushDirty();
      warm = true;
      if (t - ptr.steamAt > 150) {
        ptr.steamAt = t;
        steam(cx + scrollX, cy + scrollY - 6);
      }
    }
    if (warm && handEl) {
      handEl.style.transform = `translate3d(${cx - 90}px,${cy - 90}px,0)`;
      handEl.classList.add('is-on');
      clearTimeout(ptr.handT);
      ptr.handT = setTimeout(() => handEl && handEl.classList.remove('is-on'), 220);
    }
  }

  // Au doigt (et sur petit écran) : le givre du hero s'essuie comme une vitre, d'un geste de côté.
  // Le défilement vertical reste au navigateur, et ne redessine rien.
  const swipe = { x: 0, y: 0, x0: 0, y0: 0, raf: 0 };
  function onHeroPointer(e) {
    if (!F.cv || H.v > 0.97) return;
    if (e.type === 'pointerdown') {
      F.rect = null;
      swipe.x0 = e.clientX;
      swipe.y0 = e.clientY;
      // Un doigt qui se pose va le plus souvent faire défiler : il n'essuie rien. Le geste de
      // côté, lui, essuie (et le tap frappe).
      if (e.pointerType !== 'mouse') return;
    } else if (e.pointerType !== 'mouse') {
      const dx = Math.abs(e.clientX - swipe.x0);
      if (dx < 10 || dx < Math.abs(e.clientY - swipe.y0)) return;
    }
    swipe.x = e.clientX;
    swipe.y = e.clientY;
    if (!swipe.raf) swipe.raf = requestAnimationFrame(heroWipe);
  }
  function heroWipe() {
    swipe.raf = 0;
    if (!alive) return;
    const p = frostPoint(swipe.x, swipe.y);
    if (!p || !nearEdge(p.x, p.y, 1.5)) return;
    wipe(p.x, p.y, 46, 0.6);
    compose();
  }

  /* ---------- Les coups dans le vide ---------- */

  let combo = 0;
  let lastPunch = -1e9;
  // Au doigt, un coup = un tap : posé, relevé sur place, vite. Un défilement annule le pointeur
  // (pointercancel) : il ne frappe jamais. iOS n'envoie pas de « click » sur un bloc ordinaire.
  const tap = { id: -1, x: 0, y: 0, t: 0 };
  function onDown(e) {
    const type = e.pointerType || 'mouse';
    if (type === 'touch') {
      tap.id = e.pointerId;
      tap.x = e.clientX;
      tap.y = e.clientY;
      tap.t = now();
      return;
    }
    if (e.button !== 0 || e.clientX >= root.clientWidth) return;
    hitAt(e.target, e.clientX, e.clientY);
  }
  function onUp(e) {
    if (e.pointerType !== 'touch' || e.pointerId !== tap.id) return;
    tap.id = -1;
    if (now() - tap.t > 450 || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 12) return;
    hitAt(e.target, e.clientX, e.clientY);
  }
  function onCancel(e) {
    if (e.pointerId === tap.id) tap.id = -1;
  }
  // Ni le cadeau, ni sa carte, ni le Père Noël (ils ont leur propre jeu), ni un panneau fixe du
  // site (Chloé, menu, bannière, fenêtre) : là, on ne frappe pas.
  function inFixed(t) {
    for (let p = t, i = 0; p && p !== doc.body && i < 14; p = p.parentElement, i++) {
      if (p.nodeType === 1 && getComputedStyle(p).position === 'fixed') return true;
    }
    return false;
  }
  function hitAt(t, cx, cy) {
    if (!alive || !t || !t.closest) return;
    if (t.closest('.xm-hit, .xm-card, .xm-scrim, .xm-controls, .xmp-santa, .xmp-box') || inFixed(t)) return;
    const own = t.closest(INTERACTIVE);
    if (own) return knockOwn(own, cx, cy);
    punch(cx, cy);
  }
  // Un clic sur un bouton enneigé : la neige saute du bouton (le clic, lui, fait ce qu'il doit).
  function knockOwn(node, cx, cy) {
    const caps = C.byNode.get(node);
    if (!caps) return;
    for (const c of caps) if (c.on) knockCap(c, cx + scrollX, cy + scrollY, 160, 0.7);
  }

  // Un coup dans le vide : l'onde fait tomber la neige des éléments voisins, fend le givre s'il est
  // là, secoue les stalactites. (La chaleur, elle, vient du cadeau.)
  function punch(cx, cy) {
    if (!alive) return;
    const t = now();
    combo = t - lastPunch < 650 ? Math.min(combo + 1, 5) : 1;
    lastPunch = t;
    shock(cx, cy, combo);
    knock(cx + scrollX, cy + scrollY, CFG.punchR * (1 + (combo - 1) * 0.08));
    const p = H.v < 0.97 ? frostPoint(cx, cy) : null;
    if (p && nearEdge(p.x, p.y, 1.7)) {
      wipe(p.x, p.y, mouse ? 130 : 84, 0.95);
      compose();
      for (let i = 0; i < 7; i++) spawn(cx, cy, rand(-260, 260), rand(-260, 60), rand(1.6, 3.4), 'shard');
    }
    shakeIcicles(cx, cy);
  }

  // Les couches autour du point d'impact perdent leur neige, qui tombe en paquets.
  function knock(px, py, R) {
    for (const c of C.list) {
      if (!c.on || !c.vis) continue;
      const dx = px < c.x ? c.x - px : px > c.x + c.w ? px - (c.x + c.w) : 0;
      const dy = Math.abs(py - (c.base - c.maxH * 0.5));
      if (Math.hypot(dx, dy) > R) continue;
      knockCap(c, px, py, R, 0.88);
    }
  }
  function knockCap(c, px, py, R, power) {
    let sum = 0;
    let best = [];
    for (let i = 0; i < c.n; i++) {
      const hh = c.h[i];
      if (hh <= 0.1) continue;
      const colx = c.x + i * c.step;
      const d = Math.hypot(px - colx, py - (c.base - hh * 0.5));
      const k = clamp(1.2 - d / R, 0, 1);
      if (!k) continue;
      const loss = hh * k * power;
      c.h[i] = hh - loss;
      sum += loss;
      best.push([loss, i]);
    }
    if (sum <= 0.3) return;
    draw(c);
    if (!reduce) {
      c.cv.animate([{ transform: c.cv.style.transform }, { transform: c.cv.style.transform + ' translateY(-3px)' }, { transform: c.cv.style.transform }], { duration: 220, easing: 'ease-out' });
      best.sort((a, b) => b[0] - a[0]);
      best = best.slice(0, 40);
      const chunks = Math.min(7, Math.round(sum / (c.kind === 'word' ? 5 : 8)) + 1);
      const sx = scrollX;
      const sy = scrollY;
      for (let j = 0; j < chunks; j++) {
        const [, i] = best[Math.floor(Math.random() * Math.min(best.length, 12 + j * 3))] || best[0];
        const colx = c.x + i * c.step;
        const dir = Math.sign(colx - px) || (Math.random() < 0.5 ? -1 : 1);
        spawn(colx - sx, c.base - 3 - sy, dir * rand(40, 190), rand(-240, -60), rand(2.2, c.kind === 'word' ? 3.6 : 5), 'chunk');
      }
      for (let j = 0; j < chunks * 3; j++) {
        const [, i] = best[Math.floor(Math.random() * best.length)];
        spawn(c.x + i * c.step - sx, c.base - 2 - sy, rand(-120, 120), rand(-200, -40), rand(0.8, 1.6), 'powder');
      }
    }
  }

  /* ---------- Particules (seulement après un coup) ---------- */

  const P = { cv: null, ctx: null, list: [], raf: 0, last: 0, dpr: mouse ? Math.min(DPR, 1.5) : 1, w: 0, h: 0 };
  function spawn(x, y, vx, vy, r, kind, extra) {
    if (!alive || reduce || P.list.length > (mouse && !lowEnd ? 140 : 70)) return;
    if (!P.cv) {
      P.cv = el('canvas', 'xh-parts');
      fx.appendChild(P.cv);
      P.ctx = P.cv.getContext('2d');
    }
    if (P.w !== innerWidth || P.h !== innerHeight) {
      P.w = innerWidth;
      P.h = innerHeight;
      P.cv.width = Math.ceil(P.w * P.dpr);
      P.cv.height = Math.ceil(P.h * P.dpr);
    }
    const part = { x, y, vx, vy, r, kind, life: 0, max: kind === 'powder' ? rand(0.5, 0.9) : rand(0.85, 1.3), rot: rand(0, 6.28), vr: rand(-7, 7) };
    if (extra) Object.assign(part, extra);
    P.list.push(part);
    if (!P.raf) {
      P.last = 0;
      P.raf = requestAnimationFrame(simParts);
    }
  }
  function simParts(t) {
    P.raf = 0;
    if (!alive || !P.ctx) return;
    const dt = P.last ? Math.min(0.033, (t - P.last) / 1000) : 0.016;
    P.last = t;
    const c = P.ctx;
    c.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
    c.clearRect(0, 0, P.w, P.h);
    for (let i = P.list.length - 1; i >= 0; i--) {
      const p = P.list[i];
      p.life += dt;
      // Un papier de fête s'arrête à son plancher (le haut du premier texte sous lui).
      if (p.life >= p.max || p.y > P.h + 20 || (p.floor != null && p.y > p.floor)) {
        P.list.splice(i, 1);
        continue;
      }
      const g = p.kind === 'powder' ? 380 : p.kind === 'ember' ? -120 : p.kind === 'paper' ? 620 : 1500;
      p.vy += g * dt;
      const drag = p.kind === 'powder' ? 0.93 : p.kind === 'paper' ? 0.965 : 0.995;
      p.vx *= drag;
      if (p.kind === 'powder') p.vy *= 0.97;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const q = p.life / p.max;
      const a = q > 0.55 ? 1 - (q - 0.55) / 0.45 : 1;
      if (p.kind === 'chunk') drawChunk(c, p, a);
      else if (p.kind === 'shard') drawShard(c, p, a);
      else if (p.kind === 'paper') {
        // Un bout de papier cadeau qui tournoie : on le voit de face, puis par la tranche.
        if (p.ceil == null || p.y > p.ceil) {
          c.save();
          c.translate(p.x, p.y);
          c.rotate(p.rot);
          // Il s'efface en approchant de son plancher : jamais coupé net au-dessus du titre.
          c.globalAlpha = a * (p.floor != null ? clamp((p.floor - p.y) / 24, 0, 1) : 1);
          c.fillStyle = p.color;
          const w = p.r * 1.7;
          const h = p.r * Math.max(0.25, Math.abs(Math.cos(p.rot * 1.7)));
          c.fillRect(-w / 2, -h / 2, w, h);
          c.restore();
        }
      } else {
        c.globalAlpha = a * 0.85;
        c.fillStyle = '#fff';
        c.fillRect(p.x, p.y, p.r, p.r);
        c.globalAlpha = 1;
      }
    }
    if (P.list.length) P.raf = requestAnimationFrame(simParts);
    else c.clearRect(0, 0, P.w, P.h);
  }
  // Un paquet de neige : trois boules serrées, ombrées de bleu dessous.
  function drawChunk(c, p, a) {
    const r = p.r;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.rot);
    c.globalAlpha = a;
    const blob = (ox, oy) => {
      c.beginPath();
      c.arc(ox, oy, r, 0, 6.283);
      c.arc(ox - r * 0.75, oy + r * 0.25, r * 0.72, 0, 6.283);
      c.arc(ox + r * 0.65, oy + r * 0.35, r * 0.6, 0, 6.283);
      c.fill();
    };
    c.fillStyle = '#B9CCE2';
    blob(0.5, 0.9);
    c.fillStyle = '#FFFFFF';
    blob(0, 0);
    c.restore();
  }
  function drawShard(c, p, a) {
    const r = p.r;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.rot);
    c.globalAlpha = a * 0.9;
    c.fillStyle = 'rgba(230,242,255,0.95)';
    c.strokeStyle = 'rgba(90,130,180,0.5)';
    c.lineWidth = 0.6;
    c.beginPath();
    c.moveTo(-r, -r * 0.4);
    c.lineTo(r * 1.2, 0);
    c.lineTo(-r * 0.2, r * 0.8);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  /* ---------- Ondes de choc, onde de chaleur, gouttes, vapeur ---------- */

  const pool = (cls, parent, n) => {
    const list = [];
    let k = 0;
    return () => {
      // Après un arrêt puis une reprise, les anciens nœuds sont partis avec leur calque.
      if (list.length && !list[0].isConnected) list.length = 0;
      if (list.length < n) {
        const node = el('span', cls);
        parent().appendChild(node);
        list.push(node);
        return node;
      }
      return list[k++ % n];
    };
  };
  const ringOf = pool('xh-ring', () => fx, 4);
  const flashOf = pool('xh-flash', () => fx, 3);
  const waveOf = pool('xh-wave', () => fx, 3);
  const dripOf = pool('xh-drip', () => capsLayer, 10);
  const steamOf = pool('xh-steam', () => capsLayer, 8);

  function shock(cx, cy, k) {
    if (reduce) return;
    const r = ringOf();
    const s = 1.5 + (k - 1) * 0.25;
    r.animate(
      [
        { transform: `translate3d(${cx}px,${cy}px,0) scale(.12)`, opacity: 0.95 },
        { transform: `translate3d(${cx}px,${cy}px,0) scale(${s})`, opacity: 0 },
      ],
      { duration: 460 + k * 30, easing: 'cubic-bezier(.15,.7,.3,1)' }
    );
    const f = flashOf();
    f.animate(
      [
        { transform: `translate3d(${cx}px,${cy}px,0) scale(.35)`, opacity: 0.9 },
        { transform: `translate3d(${cx}px,${cy}px,0) scale(1.15)`, opacity: 0 },
      ],
      { duration: 300, easing: 'ease-out' }
    );
  }
  // La chaleur d'un coup porté au cadeau : un anneau tiède part de lui et traverse tout l'écran —
  // c'est lui qui dit, sans un mot, que le cadeau réchauffe la boutique.
  function heatWave(cx, cy, power) {
    if (reduce || !fx) return;
    const w = waveOf();
    const reach = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
    const s = (reach / 100) * (0.6 + power * 0.5);
    w.animate(
      [
        { transform: `translate3d(${cx}px,${cy}px,0) scale(.25)`, opacity: 0.5 + power * 0.4 },
        { transform: `translate3d(${cx}px,${cy}px,0) scale(${s.toFixed(2)})`, opacity: 0 },
      ],
      { duration: 640 + power * 420, easing: 'cubic-bezier(.2,.7,.3,1)' }
    );
  }
  // Une goutte se détache du bord de la neige et coule.
  function drip(c, i) {
    // Ni goutte ni vapeur neuves tant que la page défile.
    if (reduce || moving) return;
    const d = dripOf();
    const x = c.x + i * c.step - C.ox;
    const y = c.base - C.oy;
    d.style.left = x.toFixed(1) + 'px';
    d.style.top = y.toFixed(1) + 'px';
    const fall = c.kind === 'word' ? rand(14, 26) : rand(18, 40);
    play(
      d,
      [
        { transform: 'translateY(-2px) scale(.4,.6)', opacity: 0 },
        { transform: 'translateY(0) scale(1,1)', opacity: 0.95, offset: 0.25 },
        { transform: `translateY(${fall * 0.35}px) scale(.9,1.25)`, opacity: 0.9, offset: 0.55 },
        { transform: `translateY(${fall}px) scale(.7,1.5)`, opacity: 0 },
      ],
      { duration: rand(800, 1150), easing: 'cubic-bezier(.5,0,.8,.6)' }
    );
  }
  function steam(px, py) {
    if (reduce || moving) return;
    const s = steamOf();
    s.style.left = (px - C.ox).toFixed(1) + 'px';
    s.style.top = (py - C.oy).toFixed(1) + 'px';
    const dx = rand(-10, 10);
    play(
      s,
      [
        { transform: 'translate(0,0) scale(.5)', opacity: 0 },
        { transform: `translate(${dx * 0.3}px,-10px) scale(.9)`, opacity: 0.7, offset: 0.25 },
        { transform: `translate(${dx}px,-38px) scale(1.7)`, opacity: 0 },
      ],
      { duration: rand(900, 1300), easing: 'ease-out' }
    );
  }

  /* ---------- La guirlande prise dans la glace : elle se rallume avec la chaleur ---------- */

  const BULBS = ['#FFE9B0', '#FF3346', '#FFB347', '#8FD3FF'];
  // Une stalactite : la glace claire, un reflet blanc à gauche, le bleu de l'épaisseur à droite.
  const ICICLE = '<svg viewBox="0 0 10 40" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M0.5 0H9.5C8.4 7 7.1 18 5.6 37.6Q5 40.6 4.4 37.6C2.9 18 1.6 7 0.5 0Z" fill="url(#xhIce)"/><path d="M2.6 1.5C3.3 9 4.1 19 4.8 30" stroke="rgba(255,255,255,.95)" stroke-width="1" fill="none"/><path d="M8 1.5C7.2 8 6.4 16 5.7 26" stroke="rgba(110,150,205,.5)" stroke-width=".8" fill="none"/></svg>';
  let bulbs = [];
  let glows = [];
  let litOrder = [];
  let litN = -1;
  let icicles = [];

  function buildGarland() {
    const topbar = doc.querySelector('#site-header .topbar') || doc.querySelector('.topbar');
    if (!topbar) return;
    garland = el('div', 'xh-garland');
    garland.setAttribute('aria-hidden', 'true');
    topbar.appendChild(garland);
    layoutGarland();
  }
  function layoutGarland() {
    if (!garland) return;
    // La largeur de la page, pas celle de la fenêtre : à l'ordinateur, innerWidth compte la barre
    // de défilement (15 px sous Windows). Une guirlande plus large que la page ajoutait une barre
    // de défilement horizontale à tout le site.
    const W = Math.min(innerWidth, root.clientWidth || innerWidth);
    const span = W < 600 ? 120 : 160;
    const sag = W < 600 ? 9 : 12;
    const n = Math.max(2, Math.round(W / span));
    const seg = W / n;
    const yAt = (x) => {
      const t = (x % seg) / seg;
      return 3 + sag * 4 * t * (1 - t);
    };
    let d = 'M0 3';
    for (let i = 0; i < n; i++) d += ` Q${((i + 0.5) * seg).toFixed(1)} ${3 + sag * 2} ${((i + 1) * seg).toFixed(1)} 3`;
    garland.innerHTML =
      `<svg class="xh-wire" width="${W}" height="${sag + 8}" viewBox="0 0 ${W} ${sag + 8}" aria-hidden="true" focusable="false">` +
      '<defs><linearGradient id="xhIce" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3F9FF" stop-opacity=".97"/><stop offset=".6" stop-color="#CFE3F7" stop-opacity=".85"/><stop offset="1" stop-color="#A9CBEE" stop-opacity=".6"/></linearGradient></defs>' +
      // Le fil, et la neige posée dessus en petits paquets.
      `<path d="${d}" fill="none" stroke="#1b2030" stroke-width="1.6"/><g fill="#F6F9FD" stroke="rgba(110,140,185,.4)" stroke-width=".5">${lumps(yAt, W)}</g></svg>`;
    const ice = el('div', 'xh-ice');
    const glass = el('div', 'xh-bulbs');
    const groups = ['a', 'b', 'c'].map((g) => el('div', `xh-glows xh-glows--${g}`));
    bulbs = [];
    glows = [];
    icicles = [];
    const step = W < 600 ? 40 : 48;
    let k = 0;
    for (let x = step / 2; x < W; x += step) {
      const pos = `left:${x.toFixed(1)}px;top:${yAt(x).toFixed(1)}px;--c:${BULBS[k % BULBS.length]}`;
      const b = el('span', 'xh-bulb');
      b.style.cssText = pos;
      glass.appendChild(b);
      bulbs.push(b);
      const g = el('span', 'xh-glow');
      g.style.cssText = pos;
      groups[k % 3].appendChild(g);
      glows.push(g);
      // Entre deux ampoules, une stalactite — parfois deux ou trois, de plus en plus courtes.
      const ix = x + step / 2 + rand(-5, 5);
      if (ix < W - 10) {
        const main = rand(10, W < 600 ? 20 : 32);
        const count = Math.random() < 0.5 ? 1 : Math.random() < 0.6 ? 2 : 3;
        for (let j = 0; j < count; j++) {
          const px = ix + (j === 0 ? 0 : (j === 1 ? -1 : 1) * rand(3.6, 5));
          const len = j === 0 ? main : main * rand(0.3, 0.62);
          const wd = j === 0 ? 6 : 4.2;
          const ic = el('span', 'xh-icicle', ICICLE);
          ic.style.cssText = `left:${px.toFixed(1)}px;top:${(yAt(px) - 1.6).toFixed(1)}px;height:${len.toFixed(1)}px;width:${wd}px;margin-left:${(-wd / 2).toFixed(1)}px`;
          if (j === 0 && k % 3 === 1) {
            const dr = el('span', 'xh-icedrip');
            dr.style.animationDelay = `${rand(0, 3).toFixed(2)}s`;
            dr.style.animationDuration = `${rand(2.4, 3.8).toFixed(2)}s`;
            ic.appendChild(dr);
          }
          ice.appendChild(ic);
          icicles.push({ node: ic, x: px, y: yAt(px), len, broken: false });
        }
      }
      k++;
    }
    garland.append(ice, glass, ...groups);
    litOrder = bulbs.map((_, i) => i).sort(() => Math.random() - 0.5);
    litN = -1;
    garland.dataset.stage = String(Math.max(0, H.stage));
    lightBulbs(H.v);
  }
  // Des paquets de neige de toutes les tailles, posés sur le fil (plus serrés au creux des festons).
  function lumps(yAt, W) {
    let s = '';
    for (let x = rand(2, 9); x < W - 7; x += rand(6, 17)) {
      const rx = rand(2, 5.4);
      const ry = rand(1.3, 2.5);
      s += `<ellipse cx="${x.toFixed(1)}" cy="${(yAt(x) - 1.3 - ry * 0.4).toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}"/>`;
    }
    return s;
  }
  // Une ampoule de plus s'allume à chaque degré gagné, dans le désordre, comme une guirlande qui dégèle.
  function lightBulbs(v) {
    if (!bulbs.length) return;
    const n = v >= 0.999 ? bulbs.length : Math.floor(v * bulbs.length * 0.97);
    if (n === litN) return;
    litN = n;
    for (let j = 0; j < litOrder.length; j++) {
      const i = litOrder[j];
      const on = j < n;
      bulbs[i].classList.toggle('is-lit', on);
      glows[i].classList.toggle('is-lit', on);
    }
  }
  function shakeIcicles(cx, cy) {
    if (!garland || reduce || !icicles.length) return;
    const gr = garland.getBoundingClientRect();
    if (!gr.height && !gr.width) return;
    const top = gr.top;
    if (cy > top + 170) return;
    for (const ic of icicles) {
      if (ic.broken) continue;
      const ix = gr.left + ic.x;
      const iy = top + ic.y + ic.len * 0.5;
      const d = Math.hypot(cx - ix, cy - iy);
      if (d < 30) {
        ic.broken = true;
        ic.node.animate(
          [
            { transform: 'translateY(0) rotate(0)', opacity: 1 },
            { transform: `translateY(${170 + rand(0, 60)}px) rotate(${rand(-28, 28)}deg)`, opacity: 0 },
          ],
          { duration: 720, easing: 'cubic-bezier(.55,0,.9,.5)', fill: 'forwards' }
        ).onfinish = (ev) => {
          ic.node.classList.add('is-broken');
          if (ev && ev.target) ev.target.cancel();
          later(() => {
            ic.broken = false;
            ic.node.classList.remove('is-broken');
          }, 9000);
        };
        for (let i = 0; i < 5; i++) spawn(ix, top + ic.y + ic.len, rand(-120, 120), rand(-160, -20), rand(1.4, 2.8), 'shard');
      } else if (d < 150) {
        const a = (1 - d / 150) * 9 * (cx < ix ? 1 : -1);
        ic.node.animate(
          [{ transform: 'rotate(0)' }, { transform: `rotate(${a}deg)` }, { transform: `rotate(${-a * 0.5}deg)` }, { transform: 'rotate(0)' }],
          { duration: 520, easing: 'ease-out' }
        );
      }
    }
  }

  /* ---------- Neige qui tombe, braises, chaleur des bords ---------- */

  function snowTile(size, n, r0, r1, o0, o1, warm) {
    // Flocon : un point blanc qui s'estompe. Braise : un cœur presque blanc, de l'or, puis un halo rouge.
    const stops = warm
      ? '<stop offset="0" stop-color="#FFF6D6"/><stop offset=".28" stop-color="#FFC35A"/><stop offset=".6" stop-color="#FF5A1F" stop-opacity=".7"/><stop offset="1" stop-color="#E8001C" stop-opacity="0"/>'
      : '<stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>';
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><radialGradient id="f">${stops}</radialGradient></defs>`;
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
  function buildSky() {
    warmEl = el('div', 'xh-warm');
    fx.appendChild(warmEl);
    if (reduce) return;
    snowEl = el('div', 'xh-snowfall');
    const far = el('div', 'xh-snow xh-snow--far');
    far.style.backgroundImage = snowTile(260, mouse && !lowEnd ? 30 : 24, 0.8, mouse ? 1.8 : 2.1, 0.35, 0.8);
    snowEl.appendChild(far);
    if (mouse && !lowEnd) {
      const sway = el('div', 'xh-sway');
      const near = el('div', 'xh-snow xh-snow--near');
      near.style.backgroundImage = snowTile(420, 9, 1.8, 3.1, 0.5, 0.9);
      sway.appendChild(near);
      snowEl.appendChild(sway);
    }
    fx.appendChild(snowEl);
    // La main chaude suit la souris : au doigt, elle n'existe pas.
    if (mouse) {
      handEl = el('div', 'xh-hand');
      fx.appendChild(handEl);
    }
  }
  // Les braises montent du bas de l'écran, comme d'un feu, et s'éteignent en route (un masque fixe
  // sur un calque qui, lui, défile). Elles n'existent que du K.-O. au retour du froid : un calque
  // plein écran masqué, même invisible, se paie à chaque image.
  let emberWrap = null;
  let emberT = 0;
  function showEmbers() {
    if (reduce || !fx) return;
    clearTimeout(emberT);
    if (!emberWrap) {
      emberWrap = el('div', 'xh-emberwrap');
      emberEl = el('div', 'xh-embers');
      emberEl.style.backgroundImage = snowTile(300, mouse ? 16 : 11, 1.8, 3.8, 0.65, 1, true);
      emberWrap.appendChild(emberEl);
      fx.insertBefore(emberWrap, snowEl ? snowEl.nextSibling : null);
    }
    emberWrap.classList.remove('is-out');
  }
  function hideEmbers() {
    const w = emberWrap;
    if (!w || w.classList.contains('is-out')) return;
    w.classList.add('is-out');
    emberT = later(() => {
      if (!w.classList.contains('is-out')) return;
      w.remove();
      if (emberWrap === w) emberWrap = emberEl = null;
    }, 1500);
  }

  /* ---------- Le cadeau réchauffe la boutique ---------- */

  // noel-ring.js annonce chaque coup porté au cadeau du hero (bc:noel-hit : la part de glace qui a
  // cédé, le point d'impact à l'écran), son ouverture (bc:noel-ko) et l'arrivée d'un cadeau neuf
  // (bc:noel-rematch). La boutique suit : pas de jauge, c'est le décor qui répond.
  function onBagHit(e) {
    const d = e.detail;
    if (!alive || !d) return;
    const gain = Math.max(0, d.ratio - H.v);
    heatWave(d.x, d.y, clamp(0.25 + gain * 5, 0.25, 1));
    // Le coup secoue aussi la neige posée près du cadeau.
    knock(d.x + scrollX, d.y + scrollY, CFG.punchR * 1.3);
    if (!d.ko) warmTo(d.ratio);
  }
  function onBagKo() {
    if (!alive) return;
    H.v = 1;
    H.lastAct = now();
    render();
    climax();
  }
  function onBagRematch() {
    coolDown();
  }

  // Le cadeau s'ouvre : tout fond, la guirlande s'emballe, les braises montent.
  function climax() {
    if (H.climaxed) return;
    H.climaxed = true;
    H.peakAt = now();
    saveHeat();
    if (!H.decayT) H.decayT = every(decayTick, 500);
    if (fx) fx.classList.add('is-hot');
    if (garland) garland.classList.add('is-hot');
    showEmbers();
    later(() => {
      if (fx) fx.classList.remove('is-hot');
      if (garland) garland.classList.remove('is-hot');
      hideEmbers();
    }, 9000);
    meltAll();
  }
  // Toute la neige visible fond en 1,4 s, en fumant.
  function meltAll() {
    const caps = C.list.filter((c) => c.on && c.vis);
    if (reduce) {
      for (const c of caps) {
        c.h.fill(0);
        draw(c);
      }
      return;
    }
    let t0 = 0;
    let puffs = 0;
    const step = (t) => {
      if (!alive) return;
      if (!t0) t0 = t;
      const k = clamp((t - t0) / 1400, 0, 1);
      for (const c of caps) {
        for (let i = 0; i < c.n; i++) c.h[i] *= 0.9;
        if (k >= 1) c.h.fill(0);
        draw(c);
      }
      if (puffs < 14 && Math.random() < 0.5 && caps.length) {
        const c = caps[Math.floor(Math.random() * caps.length)];
        steam(c.x + Math.random() * c.w, c.base - 4);
        puffs++;
      }
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- La fête : un dossier complet, un paiement confirmé ---------- */

  // layout.js pose html.bc-noel-party (et envoie « bc:noel-party ») quand la page affiche une
  // confirmation : l'étape « Confirmé » de l'inscription, la page de confirmation d'une commande.
  // Dans la langue du décor : un cadeau tombe de la guirlande sur la coche verte et s'ouvre (son
  // nœud d'or reste dessus) ; sa chaleur dégèle toute la page — trois ondes partent de la coche, la
  // guirlande se rallume ampoule par ampoule, la neige des boutons fond en fumant, les braises
  // montent, et des éclats de papier rouge, vert et or tombent quelques secondes. La page reste
  // chaude tant qu'on y est. Rien de plus gros qu'un flocon ne passe sur un texte : les papiers du
  // cadeau restent entre le haut de la carte et le titre.
  const PRIZE_BODY =
    '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><defs>' +
    '<linearGradient id="xhPzR" x1="0" x2="1"><stop offset="0" stop-color="#8E0014"/><stop offset=".45" stop-color="#E8001C"/><stop offset="1" stop-color="#9C0016"/></linearGradient>' +
    '<linearGradient id="xhPzG" x1="0" x2="1"><stop offset="0" stop-color="#A86A14"/><stop offset=".45" stop-color="#FFE2A0"/><stop offset="1" stop-color="#C98A24"/></linearGradient></defs>' +
    '<rect x="8" y="25" width="48" height="35" rx="3" fill="url(#xhPzR)"/><rect x="27" y="25" width="10" height="35" fill="url(#xhPzG)"/>' +
    '<rect x="8" y="38" width="48" height="7" fill="url(#xhPzG)"/><rect x="8" y="25" width="48" height="4" fill="#000" opacity=".18"/></svg>';
  const PRIZE_LID =
    '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
    '<rect x="5" y="15" width="54" height="11" rx="3" fill="url(#xhPzR)"/><rect x="27" y="15" width="10" height="11" fill="url(#xhPzG)"/>' +
    '<path d="M32 16c-4-8-14-10-15.500-5-1 4.500 6.500 6.500 15.500 5zM32 16c4-8 14-10 15.500-5 1 4.500-6.500 6.500-15.500 5z" fill="url(#xhPzG)"/>' +
    '<circle cx="32" cy="16" r="3" fill="#FFE2A0"/></svg>';
  // Le nœud d'or qui reste sur la coche : deux coques, deux pans, le nœud.
  const BOW =
    '<svg viewBox="0 0 46 30" aria-hidden="true" focusable="false"><defs>' +
    '<linearGradient id="xhBowG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE9A6"/><stop offset=".5" stop-color="#F2B24A"/><stop offset="1" stop-color="#B9781A"/></linearGradient></defs>' +
    '<path d="M20 15.500L13 28.500l5-1.600 2.400 3L24 17z" fill="#D9982E" stroke="#8A5A12" stroke-width=".8" stroke-linejoin="round"/>' +
    '<path d="M26 15.500L33 28.500l-5-1.600-2.400 3L22 17z" fill="#E7A93A" stroke="#8A5A12" stroke-width=".8" stroke-linejoin="round"/>' +
    '<path d="M23 15C17 4 5 1 2.500 6.500.500 12 8 19 23 15z" fill="url(#xhBowG)" stroke="#8A5A12" stroke-width=".9"/>' +
    '<path d="M23 15C29 4 41 1 43.500 6.500 45.500 12 38 19 23 15z" fill="url(#xhBowG)" stroke="#8A5A12" stroke-width=".9"/>' +
    '<path d="M7.500 8.500c3-.800 6.500.400 9 2.600M38.500 8.500c-3-.800-6.500.400-9 2.600" stroke="#FFF6D8" stroke-width="1.300" fill="none" stroke-linecap="round" opacity=".85"/>' +
    '<rect x="19.400" y="10.400" width="7.200" height="8.200" rx="2.400" fill="url(#xhBowG)" stroke="#8A5A12" stroke-width=".9"/></svg>';

  let partied = false;
  let fleckEl = null;
  function party() {
    if (partied || !alive || !fx) return;
    partied = true;
    H.party = true;
    const wrap = doc.querySelector('.success-page--celebrate .success-icon-wrap');
    const wr = wrap ? wrap.getBoundingClientRect() : null;
    const seen = !!wr && wr.width > 0 && wr.top > 70 && wr.bottom < innerHeight - 20;
    // Mouvement réduit : la page est chaude d'emblée, la guirlande allumée, le nœud posé. Rien ne bouge.
    if (reduce) {
      H.v = 1;
      H.climaxed = true;
      H.peakAt = now();
      render();
      if (wrap) tieBow(wrap, true);
      return;
    }
    // La coche n'est pas à l'écran (page déjà défilée) : pas de cadeau, la chaleur part du milieu.
    if (!seen || !capsLayer) {
      if (wrap) tieBow(wrap, false);
      thaw(innerWidth / 2, innerHeight * 0.42, wrap);
      return;
    }
    if (!C.oSet) layerOrigin();
    const g = el('div', 'xh-prize', `<div class="xh-prize__body">${PRIZE_BODY}</div><div class="xh-prize__lid">${PRIZE_LID}</div>`);
    g.style.left = (wr.left + wr.width / 2 + scrollX - C.ox).toFixed(1) + 'px';
    g.style.top = (wr.top + wr.height / 2 + scrollY - C.oy).toFixed(1) + 'px';
    capsLayer.appendChild(g);
    // Il tombe de la guirlande, s'écrase un peu sur la coche, tremble d'impatience…
    const fall = Math.min(230, Math.max(120, wr.top - 40));
    g.animate(
      [
        { transform: `translateY(${-fall}px) rotate(-12deg)`, opacity: 0, offset: 0 },
        { transform: `translateY(${-fall + 26}px) rotate(-10deg)`, opacity: 1, offset: 0.1, easing: 'cubic-bezier(.55,0,1,.5)' },
        { transform: 'translateY(0) rotate(0deg)', opacity: 1, offset: 0.5 },
        { transform: 'translateY(5px) scale(1.15,.8)', offset: 0.57 },
        { transform: 'translateY(-11px) scale(.94,1.07)', offset: 0.68 },
        { transform: 'translateY(0) scale(1)', offset: 0.78 },
        { transform: 'translateY(0) rotate(-6deg)', offset: 0.84 },
        { transform: 'translateY(0) rotate(6deg)', offset: 0.9 },
        { transform: 'translateY(0) rotate(-3deg)', offset: 0.95 },
        { transform: 'translateY(0) rotate(0deg)', opacity: 1, offset: 1 },
      ],
      { duration: 1200, easing: 'linear', fill: 'forwards' }
    ).onfinish = () => {
      if (!alive) return g.remove();
      // … et s'ouvre : le couvercle saute, le papier vole, le nœud reste sur la coche.
      const r = wrap.isConnected ? wrap.getBoundingClientRect() : wr;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      g.querySelector('.xh-prize__lid').animate(
        [
          { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
          { transform: 'translate(-30px,-92px) rotate(-70deg)', opacity: 1, offset: 0.6 },
          { transform: 'translate(-46px,-72px) rotate(-120deg)', opacity: 0 },
        ],
        { duration: 640, easing: 'cubic-bezier(.2,.8,.4,1)', fill: 'forwards' }
      );
      g.querySelector('.xh-prize__body').animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.55)', opacity: 0 }], { duration: 300, easing: 'ease-out', fill: 'forwards' });
      later(() => g.remove(), 720);
      papers(cx, cy, r);
      tieBow(wrap, false);
      try {
        if (!mouse && navigator.vibrate) navigator.vibrate([16, 50, 16, 50, 34]);
      } catch (e) {
        /* pas de vibreur */
      }
      thaw(cx, cy, wrap);
    };
  }
  // Le papier du cadeau : il jaillit vers le haut et sur les côtés, retombe, et s'efface avant le
  // titre. Son élan est réglé pour ne jamais monter jusqu'aux étapes du dossier ni au menu.
  function papers(cx, cy, r) {
    const cols = ['#E8001C', '#F2B24A', '#16A34A', '#FFD27A', '#C8001A', '#F2B24A'];
    // Le plancher : juste sous la coche, et toujours au-dessus du titre.
    const title = doc.querySelector('.success-page--celebrate h1');
    const floor = Math.min(r.bottom + 12, title ? title.getBoundingClientRect().top - 6 : 1e9);
    const header = doc.querySelector('#site-header');
    const stepper = doc.getElementById('stepper');
    let ceil = header ? header.getBoundingClientRect().bottom + 34 : 40;
    if (stepper) {
      const sr = stepper.getBoundingClientRect();
      if (sr.bottom < r.top && sr.bottom > ceil) ceil = sr.bottom + 6;
    }
    const rise = Math.max(30, cy - ceil - 8);
    const vmax = Math.min(400, Math.sqrt(2 * 620 * rise));
    const n = mouse && !lowEnd ? 30 : 20;
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const v = rand(0.5, 1) * vmax;
      // Sur les côtés, ils partent plus vite : la place est là.
      spawn(cx + rand(-12, 12), cy - 10, Math.cos(a) * v * 1.5, Math.sin(a) * v, rand(3, 5.2), 'paper', { color: cols[i % cols.length], floor, ceil, max: rand(1, 1.6), vr: rand(-9, 9) });
    }
  }
  function tieBow(wrap, still) {
    if (!wrap || wrap.querySelector('.xh-bow')) return;
    const b = el('span', still ? 'xh-bow is-still' : 'xh-bow', BOW);
    b.setAttribute('aria-hidden', 'true');
    wrap.appendChild(b);
  }
  // La chaleur du cadeau : trois ondes, la boutique dégèle en trois temps, puis tout s'embrase.
  function thaw(cx, cy, wrap) {
    heatWave(cx, cy, 1);
    warmTo(0.4);
    later(() => {
      heatWave(cx, cy, 0.75);
      warmTo(0.72);
    }, 380);
    later(() => {
      if (!alive) return;
      heatWave(cx, cy, 1);
      H.v = 1;
      H.lastAct = now();
      H.climaxed = false;
      render();
      climax();
      flecks(wrap);
    }, 780);
  }
  // Des éclats de papier — rouge, vert, or — tombent neuf secondes dans les marges de la page, de
  // part et d'autre du contenu : jamais sur un texte. Il faut de vraies marges (un ordinateur, une
  // tablette couchée) ; au téléphone il n'y en a pas, la fête s'en passe. Une tuile répétée animée
  // par la carte graphique, comme la neige, derrière un masque qui cache la colonne du contenu.
  function fleckTile(size, n) {
    const cols = ['#E8001C', '#F2B24A', '#16A34A', '#FFD27A', '#C8001A'];
    let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`;
    for (let i = 0; i < n; i++) {
      const x = rand(10, size - 10).toFixed(1);
      const y = rand(10, size - 10).toFixed(1);
      const c = cols[i % cols.length];
      const o = rand(0.7, 1).toFixed(2);
      if (i % 3 === 0) s += `<circle cx="${x}" cy="${y}" r="${rand(1.6, 2.6).toFixed(1)}" fill="${c}" opacity="${o}"/>`;
      else s += `<rect x="${x}" y="${y}" width="${rand(4.5, 7).toFixed(1)}" height="${rand(2.2, 3.2).toFixed(1)}" rx=".7" fill="${c}" opacity="${o}" transform="rotate(${rand(0, 180).toFixed(0)} ${x} ${y})"/>`;
    }
    return `url("data:image/svg+xml,${encodeURIComponent(s + '</svg>')}")`;
  }
  function flecks(wrap) {
    if (reduce || !capsLayer || fleckEl || !wrap) return;
    const box = wrap.closest('.form-panel, .success-page');
    if (!box) return;
    const br = box.getBoundingClientRect();
    const L = br.left - 14;
    const R = br.right + 14;
    if (L < 110 || root.clientWidth - R < 110) return;
    // Le cadre vit dans la page (il défile avec elle) : du haut du contenu au pied de page, pour
    // que rien ne tombe non plus sur les textes du pied de page.
    const main = wrap.closest('main') || box;
    const top = main.getBoundingClientRect().top + scrollY;
    const footer = doc.getElementById('site-footer');
    const bottom = footer ? footer.getBoundingClientRect().top + scrollY : top + main.getBoundingClientRect().height;
    if (bottom - top < 160) return;
    if (!C.oSet) layerOrigin();
    const w = el('div', 'xh-fleckwrap');
    w.style.left = (-C.ox).toFixed(1) + 'px';
    w.style.top = (top - C.oy).toFixed(1) + 'px';
    w.style.width = root.clientWidth + 'px';
    w.style.height = Math.round(bottom - top) + 'px';
    const m = `linear-gradient(to right, #000 0, #000 ${(L - 26).toFixed(0)}px, transparent ${L.toFixed(0)}px, transparent ${R.toFixed(0)}px, #000 ${(R + 26).toFixed(0)}px, #000 100%)`;
    w.style.webkitMaskImage = m;
    w.style.maskImage = m;
    // Deux tuiles de tailles et de vitesses différentes, l'une sur l'autre : l'œil ne retrouve
    // jamais le même motif.
    const a = el('div', 'xh-flecks xh-flecks--a');
    a.style.backgroundImage = fleckTile(310, 13);
    const b = el('div', 'xh-flecks xh-flecks--b');
    b.style.backgroundImage = fleckTile(430, 16);
    w.append(a, b);
    fleckEl = w;
    capsLayer.appendChild(w);
    later(() => w.classList.add('is-out'), 9000);
    later(() => {
      w.remove();
      if (fleckEl === w) fleckEl = null;
    }, 10600);
  }

  /* ---------- Départ / arrêt ---------- */

  let resizeT = 0;
  let roT = 0;
  let lastW = 0;
  let runs = 0;
  // Seule la largeur compte : au téléphone, la barre d'adresse qui se replie change la hauteur
  // sans rien déplacer dans la page.
  function onResize() {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      F.rect = null;
      if (!alive || Math.abs(innerWidth - lastW) < 2) return;
      lastW = innerWidth;
      dropFrost();
      buildFrost(false);
      render();
      layoutGarland();
      syncCaps();
    }, 180);
  }

  function start(first) {
    if (alive) return;
    alive = true;
    timers = [];
    intervals = [];
    ac = new AbortController();
    const sig = { signal: ac.signal };
    const pas = { passive: true, signal: ac.signal };
    const cap = { passive: true, capture: true, signal: ac.signal };
    // Une page avec le cadeau commence comme lui : gelée, glace entière (la barre du cadeau et le
    // décor disent toujours la même chose). Sans cadeau, la chaleur de la visite se prolonge.
    // Une page de confirmation aussi : la fête part d'une page gelée, pour qu'on la voie dégeler.
    if (root.classList.contains('bc-noel-ring') || root.classList.contains('bc-noel-party')) {
      H.v = 0;
      H.climaxed = false;
    } else {
      loadHeat();
    }
    H.stage = -1;
    lastW = innerWidth;
    fx = el('div', 'xh-fx');
    fx.id = 'bcXhFx';
    fx.setAttribute('aria-hidden', 'true');
    capsLayer = el('div', 'xh-caps');
    capsLayer.id = 'bcXhCaps';
    capsLayer.setAttribute('aria-hidden', 'true');
    doc.body.append(capsLayer, fx);
    // La guirlande d'abord (légère) ; le ciel, le givre puis la neige posée arrivent chacun dans
    // sa propre tâche, au repos du navigateur : jamais une longue tâche.
    buildGarland();
    const run = ++runs;
    const idle = (fn) => new Promise((res) => {
      const go = () => {
        if (alive && run === runs) fn();
        res();
      };
      if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 500 });
      else setTimeout(go, 30);
    });
    (async () => {
      await idle(() => {
        buildSky();
        render();
      });
      await idle(() => {
        buildFrost(first && !sess.get(FROST_KEY));
        sess.set(FROST_KEY, '1');
        render();
      });
      await idle(observeCaps);
    })();

    if (mouse) window.addEventListener('pointermove', onMove, pas);
    doc.addEventListener('pointerdown', onDown, cap);
    doc.addEventListener('pointerup', onUp, cap);
    doc.addEventListener('pointercancel', onCancel, cap);
    window.addEventListener('resize', onResize, pas);
    window.addEventListener('scroll', onScroll, pas);
    window.addEventListener('pagehide', saveHeat, sig);
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) saveHeat(); }, sig);
    doc.addEventListener('bc:noel-hit', onBagHit, sig);
    doc.addEventListener('bc:noel-ko', onBagKo, sig);
    doc.addEventListener('bc:noel-rematch', onBagRematch, sig);

    if (!reduce) C.tick = every(accumTick, CFG.accumMs);
    if (H.v > 0) H.decayT = every(decayTick, 500);
    render();
    // Une confirmation est déjà affichée : on laisse la page gelée s'installer, puis la fête.
    if (root.classList.contains('bc-noel-party')) later(party, 1700);
  }

  function observeCaps() {
    C.io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        const caps = C.byNode.get(e.target);
        if (!caps) continue;
        for (const c of caps) {
          c.vis = e.isIntersecting;
          if (c.vis && !c.on && !c.dead) reveal(c);
        }
      }
    }, { rootMargin: '160px 0px' });
    // La page change de hauteur (images, polices, contenu chargé après) : on remesure, au calme.
    C.ro = new ResizeObserver(() => {
      clearTimeout(roT);
      roT = setTimeout(() => alive && syncCaps(), 260);
    });
    C.ro.observe(doc.body);
    syncCaps();
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => alive && measureAll());
  }

  function stop(animated) {
    if (!alive) return;
    alive = false;
    saveHeat();
    timers.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    timers = [];
    intervals = [];
    H.decayT = 0;
    wind.timer = 0;
    if (ac) ac.abort();
    ac = null;
    if (C.io) C.io.disconnect();
    if (C.ro) C.ro.disconnect();
    C.io = C.ro = null;
    revealQ.clear();
    revealT = 0;
    if (ptr.raf) cancelAnimationFrame(ptr.raf);
    ptr.raf = 0;
    if (swipe.raf) cancelAnimationFrame(swipe.raf);
    swipe.raf = 0;
    if (P.raf) cancelAnimationFrame(P.raf);
    P.raf = 0;
    P.list.length = 0;
    P.cv = P.ctx = null;
    P.w = P.h = 0;
    live.clear();
    moving = false;
    partied = false;
    H.party = false;
    fleckEl = null;
    doc.querySelectorAll('.xh-bow').forEach((n) => n.remove());
    const nodes = [fx, capsLayer, garland, F.box];
    dropFrost(true);
    C.list = [];
    C.byNode.clear();
    C.oSet = false;
    fx = capsLayer = garland = null;
    snowEl = emberEl = emberWrap = warmEl = handEl = null;
    bulbs = [];
    glows = [];
    icicles = [];
    const remove = () => nodes.forEach((n) => n && n.remove());
    if (animated && !reduce) {
      nodes.forEach((n) => n && n.classList.add('is-leaving'));
      setTimeout(remove, 520);
    } else {
      remove();
    }
  }

  // L'interrupteur est celui du cadeau (noel-ring.js) : il coupe et remet tout le décor d'un geste.
  doc.addEventListener('bc:noel', (e) => {
    if (!e.detail) return;
    if (e.detail.on) start(false);
    else stop(true);
  });
  // Le paiement vient d'être confirmé alors que le décor était déjà là : la fête, tout de suite.
  doc.addEventListener('bc:noel-party', () => {
    if (alive && !partied) later(party, 500);
  });

  // ?noeldebug expose l'état pour les tests ; sans effet pour les visiteurs.
  if (debug) {
    window.__bcXh = {
      H, C, F, P, CFG,
      punch,
      heat(v) {
        if (v >= 1) onBagKo();
        else warmTo(v);
      },
      cool: coolDown,
      gust,
      party,
      sync: syncCaps,
      stop,
      start,
    };
  }

  if (store.get(OFF_KEY) === OFF_VALUE) return;
  start(true);
})();
