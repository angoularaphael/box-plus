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
  // Avec la boutique gelée (noel-hiver.js), la neige et la guirlande sont les siennes.
  const frozen = root.classList.contains('bc-noel-hiver');
  const OFF_KEY = 'bc_noel_off';
  const OFF_VALUE = '2026';
  if (!mouse) root.classList.add('xmp-touch');

  const CFG = {
    // Au téléphone il marche (42 px/s) : sur un petit écran, un footing le faisait filer avant
    // qu'on ait pu le toucher.
    runSpeed: mouse ? 84 : 42,
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
    '<linearGradient id="xmpCoat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9E0014"/><stop offset=".38" stop-color="#E0001C"/><stop offset=".72" stop-color="#F2283A"/><stop offset="1" stop-color="#B80018"/></linearGradient>' +
    '<linearGradient id="xmpCoatB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A80016"/><stop offset="1" stop-color="#7C000F"/></linearGradient>' +
    '<linearGradient id="xmpFur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DAD9D2"/></linearGradient>' +
    '<linearGradient id="xmpGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE9A6"/><stop offset=".5" stop-color="#F2B24A"/><stop offset="1" stop-color="#B9781A"/></linearGradient>' +
    '<linearGradient id="xmpSack" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B98A4E"/><stop offset="1" stop-color="#6E4A22"/></linearGradient>' +
    '<radialGradient id="xmpSkin" cx="62%" cy="40%" r="70%"><stop offset="0" stop-color="#FBD9BF"/><stop offset="1" stop-color="#E7B090"/></radialGradient>' +
    '<linearGradient id="xmpPaper" x1="0" x2="1"><stop offset="0" stop-color="#8E0014"/><stop offset=".45" stop-color="#E8001C"/><stop offset="1" stop-color="#9C0016"/></linearGradient>' +
    '<linearGradient id="xmpRibbon" x1="0" x2="1"><stop offset="0" stop-color="#A86A14"/><stop offset=".45" stop-color="#FFE2A0"/><stop offset="1" stop-color="#C98A24"/></linearGradient>' +
    '</defs></svg>';

  // Le Père Noël : manteau rouge bordé de fourrure, ceinture noire à boucle d'or, bottes, barbe en
  // boucles, la hotte sur le dos — et des gants d'or (les Golden Gloves). Pieds sur la ligne
  // y = 146 ; regard vers +x. Chaque membre est sa propre couche (cadre 120 × 150) : la marche se
  // joue en transform, sans repeindre.
  const part = (cls, paths, inner) =>
    `<div class="xmp-part ${cls}"><svg viewBox="0 0 120 150" aria-hidden="true" focusable="false">${paths}</svg>${inner || ''}</div>`;
  // Un gant d'or, sa manchette de fourrure dessous, un reflet dessus.
  const GLOVE = (x, y) =>
    `<path d="M${x} ${y}c0-6.4 6-9.6 12.4-8.4 6 1.1 9.2 6.2 8.2 12.2-.9 5.2-5 8.4-10.2 8.4h-5.2c-3 0-5.2-2.2-5.2-5.2z" fill="url(#xmpGold)" stroke="#8A5A12" stroke-width=".8"/>` +
    `<path d="M${x - 1.6} ${y + 7.6}h9.6c1.2 0 2 .9 2 2.2v2.4c0 1.2-.8 2.1-2 2.1h-9.6c-1.2 0-2-.9-2-2.1V${y + 9.8}c0-1.3.8-2.2 2-2.2z" fill="url(#xmpFur)"/>` +
    `<path d="M${x + 5} ${y - 3.2}c3.2-2.2 7.4-1.2 9.6 1.2" stroke="#FFF6D8" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
  // Une botte noire à revers de fourrure ; (x, y) = le haut de la tige, côté talon.
  const BOOT = (x, y, dark) =>
    `<path d="M${x} ${y}h12.6c.6 4.6 4.6 5.6 8 8.2 1.9 1.5 2 5.8-.4 5.8H${x}z" fill="${dark ? '#121217' : '#1D1D24'}"/>` +
    `<path d="M${x} ${y + 12.4}h20.6" stroke="#3A3A44" stroke-width="1.3"/>` +
    `<path d="M${x - 1.6} ${y - 5.4}h15.8c1.4 0 2.4 1.2 2.4 2.9s-1 2.9-2.4 2.9H${x - 1.6}c-1.4 0-2.4-1.2-2.4-2.9s1-2.9 2.4-2.9z" fill="${dark ? '#DEDCD4' : 'url(#xmpFur)'}"/>`;
  const SANTA_HTML =
    part('xmp-ground', '<ellipse cx="60" cy="146" rx="30" ry="4.6" fill="rgba(0,0,0,.3)"/>') +
    // Jambe arrière
    part('xmp-leg xmp-leg--b',
      '<path d="M46.4 90h13l-1.2 22-1.4 14.6h-9.6l-.9-14.6z" fill="url(#xmpCoatB)"/>' + BOOT(45.6, 130.6, true)) +
    // Bras arrière (derrière le buste)
    part('xmp-arm xmp-arm--b',
      '<path d="M46.6 47.4c-4.4 6.2-4.2 13.6 1.2 18.8l13.6-4.2c-3.2-4.2-3.4-8.6-1.2-12.6z" fill="url(#xmpCoatB)"/>' + GLOVE(58, 42)) +
    // Buste : la hotte derrière, le manteau et son ventre, la fourrure, la ceinture ; la tête est
    // une couche à l'intérieur.
    part('xmp-body',
      // La hotte, deux paquets qui dépassent.
      '<path d="M22 58c-5.6 9.4-5 24 3 31.6 8 5.6 18.6 3.6 22.6-2.6l1.6-33.6c-8.6-5.4-21-4.4-27.200 4.6z" fill="url(#xmpSack)"/>' +
      '<path d="M26 62c-3 8-2.6 17 1.6 23" stroke="#5A3A18" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".6"/>' +
      '<path d="M33 46.500l9-4.200 3.800 8.200-9 4.200z" fill="#E8001C"/><path d="M36.400 44.900l3.800 8.200" stroke="#FFE2A0" stroke-width="1.6"/>' +
      '<path d="M25.500 50.500l7.400-1.400 1.400 7.400-7.400 1.400z" fill="#F2B24A"/><path d="M29.200 49.800l1.400 7.400" stroke="#fff" stroke-width="1.3"/>' +
      '<path d="M40 52c3-2.600 6.600-3.400 10-2.600" stroke="#5A3A18" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
      // Le manteau : le ventre part vers l'avant.
      '<path d="M41.500 54c0-11.800 8.200-19 19.200-19 11.400 0 19.600 7 20 18.600 3.600 6.400 5 14.400 3.800 22.400-.8 5.200-2.400 9.600-4.200 13H40.300c-1.500-6.400-1.700-13-.5-19.400z" fill="url(#xmpCoat)"/>' +
      '<path d="M78 60c3.400 6.800 4 14.800 1.400 23" stroke="#8C0011" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".55"/>' +
      '<path d="M47 44c-2.400 6-3.200 13-2.600 21" stroke="#FF6A76" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".5"/>' +
      // La patte de fourrure du devant, puis l'ourlet.
      '<path d="M66.500 41c1.400 14.600 1.600 31.800.2 47.400h7.200c1.400-15.600 1.200-32.800-.2-47.400z" fill="url(#xmpFur)"/>' +
      '<path d="M38.200 85.400h44c2.200 0 3.600 2.200 3.600 5s-1.400 5-3.600 5h-44c-2.200 0-3.600-2.200-3.600-5s1.400-5 3.600-5z" fill="url(#xmpFur)"/>' +
      '<path d="M40 92.600c3 1.600 6 1.600 9 0s6-1.600 9 0 6 1.600 9 0 6-1.600 9 0 5 1.400 7 .2" stroke="#C9C7BE" stroke-width="1" fill="none" stroke-linecap="round"/>' +
      // La ceinture et sa boucle d'or.
      '<path d="M40.400 69.600c14.200 3.200 29 3.200 43.800-.2l.4 8.600c-14.800 3.400-29.800 3.400-44.600.2z" fill="#17171C"/>' +
      '<path d="M41 71.400c14 2.800 28.600 2.800 43 0" stroke="#3C3C46" stroke-width="1" fill="none"/>' +
      '<rect x="64.600" y="68.600" width="12.400" height="11.200" rx="2" fill="none" stroke="url(#xmpGold)" stroke-width="2.600"/><path d="M70.800 71v6.400" stroke="#F2B24A" stroke-width="1.600" stroke-linecap="round"/>' +
      // Le col de fourrure.
      '<path d="M47.400 40.600c2.200-3.600 7.600-5.400 13.200-5.400 5.800 0 11.400 1.800 13.600 5.400 1 1.800-.2 4-2.400 4.200-7.400.8-15 .8-22.200 0-2.200-.2-3.200-2.400-2.200-4.200z" fill="url(#xmpFur)"/>',
      part('xmp-head',
        // Les cheveux blancs sur la nuque, le visage, l'oreille.
        '<path d="M52.600 16c-2.600 5.400-2.400 12.600.6 17.400l6-2.200V15z" fill="#ECEAE3"/>' +
        '<circle cx="64" cy="22" r="10.600" fill="url(#xmpSkin)"/>' +
        '<path d="M56.200 20.600c-2.200-.4-3.200 1.800-2.400 3.800.6 1.600 2.200 2.200 3.400 1.600z" fill="#E7B090"/>' +
        '<circle cx="69.600" cy="25.600" r="3" fill="#F2907C" opacity=".55"/>' +
        // La barbe : une masse, des boucles au bord, des mèches.
        '<path d="M52 22.600c-.8 9.600 2 18.800 7.400 23.600 3.600 3.200 8.800 3.200 12.400 0 5.200-4.600 8-12.800 7.400-21.600-3.400 2.400-7.800 3.400-13.400 3.400s-10.200-2-13.800-5.400z" fill="url(#xmpFur)"/>' +
        '<g fill="#FFFFFF"><circle cx="56.400" cy="41" r="3.400"/><circle cx="61.200" cy="45.600" r="3.800"/><circle cx="67" cy="46.800" r="3.800"/><circle cx="72.600" cy="44.200" r="3.600"/><circle cx="76.400" cy="39" r="3.200"/><circle cx="53.600" cy="34.600" r="3"/></g>' +
        '<path d="M57 36c1.600 3 4 5 7 5.600M66 38c1 2.600 3 4 5.600 4.200M60.600 31.600c1.400 1.600 3.200 2.400 5.200 2.400" stroke="#CFCDC4" stroke-width="1" fill="none" stroke-linecap="round"/>' +
        // La moustache, le nez, l'œil rieur et le sourcil blanc.
        '<path d="M56.600 26.800c3-3.200 6.800-3.200 9.400-.6 2.600-2.600 6.800-2.600 9.800.6-2.400 3.400-7 3.600-9.800 1.600-2.800 2-7.400 1.800-9.400-1.600z" fill="#FFFFFF"/>' +
        '<path d="M66 26.200v2.200" stroke="#D5D3CA" stroke-width=".9" stroke-linecap="round"/>' +
        '<circle cx="73.400" cy="23.600" r="2.700" fill="#E88A74"/><circle cx="72.600" cy="22.800" r=".9" fill="#F7B7A4"/>' +
        '<path d="M67.600 19.400c1.200-1.400 3-1.400 4.200 0" stroke="#2A1B14" stroke-width="1.500" fill="none" stroke-linecap="round"/>' +
        '<path d="M66 15.800c1.800-1.600 4.400-1.800 6.400-.6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>' +
        // Le bonnet : la pointe retombe derrière, le pompon, le revers de fourrure.
        '<path d="M51 14.500c2.200-11 13.400-15.400 23-11.800 7.400 2.800 10.800 8.600 10.800 13.400l-33.800 1z" fill="url(#xmpHat)"/>' +
        '<path d="M58 6.400c-6.400-2.600-13 .2-15.400 7" stroke="#C4001A" stroke-width="6.600" fill="none" stroke-linecap="round"/>' +
        '<path d="M60 4.600c3-1.400 6.400-1.600 9.600-.8" stroke="#FF7582" stroke-width="1.300" fill="none" stroke-linecap="round" opacity=".7"/>' +
        '<circle cx="42.400" cy="14.600" r="5" fill="url(#xmpFur)"/><circle cx="41" cy="13.200" r="1.600" fill="#fff"/>' +
        '<path d="M48.400 13.200c9.800-3.800 27.200-3.800 36.800.4 1.600.8 2.400 2.600 2 4.400-.4 1.800-2 2.800-3.800 2.200-9.400-3-24.600-3-34 .2-1.800.6-3.400-.6-3.600-2.400-.2-2 .8-4 2.600-4.800z" fill="url(#xmpFur)"/>')) +
    // Jambe avant
    part('xmp-leg xmp-leg--f',
      '<path d="M61.400 90h13l-.6 22-1.600 14.600h-9.600l-1-14.600z" fill="url(#xmpCoat)"/>' + BOOT(60.600, 130.600, false)) +
    // Bras avant
    part('xmp-arm xmp-arm--f',
      '<path d="M70 45.400c4.400 5.400 5.400 12.600 1.200 18.800l12.400-1c2.200-5.200 1-10.600-2.200-14.800z" fill="url(#xmpCoat)"/>' + GLOVE(78, 40));

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

    if (!reduce && !frozen) buildSnow();
    buildBoxes();
    if (!frozen) buildGarland();
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
    Z.fig.classList.add('is-hittable');
    let lastType = 'mouse';
    Z.fig.addEventListener('pointerdown', (e) => {
      lastType = e.pointerType || 'mouse';
      if (lastType === 'mouse') punchSanta(e);
    });
    Z.fig.addEventListener('click', (e) => {
      if (lastType !== 'mouse') punchSanta(e);
    });
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
    // Sa bulle s'efface avec lui : jamais posée sur un bouton. Près d'un bord, elle serait coupée :
    // elle se retire.
    Z.walker.classList.toggle('is-ghost', over);
    if (r.left < 74 || r.right > innerWidth - 74) Z.say.classList.remove('is-on');
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

  function say(ms, text) {
    Z.say.textContent = text || 'Ho ho ho !';
    Z.say.classList.toggle('is-long', !!text && text.length > 12);
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
      // Il entre et sort juste hors du cadre (moins loin au téléphone : à son pas, 150 px de
      // coulisse feraient attendre pour rien).
      const off = W < 600 ? 80 : 150;
      const from = dir > 0 ? -off : W + off;
      const to = dir > 0 ? W + off : -off;
      Z.x = from;
      Z.walker.style.transform = tx(from);
      setDir(dir);
      readFloor();
      showSanta(true);
      // En chemin, il s'arrête pour narguer (au milieu de l'écran au téléphone, deux fois à
      // l'ordinateur) et, une fois sur deux, pour boxer dans le vide.
      const span = to - from;
      const stops = (W < 600 ? [rand(0.44, 0.56)] : [rand(0.27, 0.36), rand(0.64, 0.73)]).map((m) => ({ at: from + span * m, taunt: true }));
      if (Math.random() < 0.5) stops.push({ at: from + span * rand(0.46, 0.54), taunt: false });
      stops.sort((a, b) => (a.at - b.at) * dir);
      for (const s of stops) {
        await runTo(s.at);
        if (!alive) return;
        await whileBusy();
        if (s.taunt) await tauntStop();
        else await shadowBox();
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

  // Il nargue en marchant : « Tu ne peux pas me toucher ! » — de quoi donner envie d'essayer.
  const TAUNTS = ['Tu ne peux pas me toucher !', 'Coup de chance !', 'Pas trois fois !', 'D’accord, t’es rapide !'];
  // Il s'arrête pour narguer — bien en vue, facile à toucher du doigt — puis repart. Sa bulle ne
  // sort que là où elle ne couvre aucun texte ni bouton : le navigateur donne la place des textes
  // (IntersectionObserver, sans mise en page forcée) ; s'il y en a un, il passe sans rien dire.
  const TEXTS = 'p, h1, h2, h3, h4, h5, li, blockquote, figcaption, label, dt, dd, th, td, a, button, .btn';
  const TAUNT_MS = 2800;
  function bubbleClear() {
    return new Promise((resolve) => {
      const r = santaRect();
      const cx = r.left + r.width / 2;
      // La bulle à l'arrêt, puis le chemin qu'elle ferait s'il la disait en marchant.
      const x0 = cx - 98;
      const x1 = cx + 98;
      const w0 = Math.min(x0, x0 + Z.dir * 150);
      const w1 = Math.max(x1, x1 + Z.dir * 150);
      const y0 = r.top - 44;
      const y1 = r.top - 2;
      if (x0 < 4 || x1 > innerWidth - 4) return resolve(2);
      const io = new IntersectionObserver((entries) => {
        io.disconnect();
        let level = 0;
        for (const e of entries) {
          const b = e.boundingClientRect;
          if (!(b.width > 0 && b.height > 0 && b.bottom > y0 && b.top < y1)) continue;
          // Un bouton ou un lien sur le chemin (Chloé, un appel à l'action) : il se tait.
          if (b.right > w0 && b.left < w1 && e.target.matches('a, button, .btn, input, select')) return resolve(2);
          if (b.right > x0 && b.left < x1) level = 1;
        }
        resolve(level);
      });
      let n = 0;
      for (const node of doc.querySelectorAll(TEXTS)) {
        if (layer.contains(node) || node.closest('.xm-front, #site-header')) continue;
        io.observe(node);
        n++;
      }
      if (!n) {
        io.disconnect();
        resolve(0);
      }
    });
  }
  async function tauntStop() {
    if (!alive || Z.busy || !Z.fig) return;
    const text = TAUNTS[Math.min(Z.hits, TAUNTS.length - 1)];
    // 0 : place nette, il s'arrête et nargue. 1 : un texte juste là, il ne s'arrête pas dessus
    // et le lance en passant. 2 : un bouton, un lien ou le bord de l'écran, il se tait.
    const level = await bubbleClear();
    if (!alive || Z.busy || !Z.fig || level === 2) return;
    if (level === 1) {
      say(1900, text);
      return;
    }
    Z.fig.classList.remove('is-running');
    Z.fig.classList.add('is-taunt');
    say(TAUNT_MS, text);
    await wait(TAUNT_MS);
    if (Z.fig) Z.fig.classList.remove('is-taunt');
  }

  // Touché — à la souris ou au doigt —, il éclate de rire et lâche un cadeau de sa hotte. On ne
  // met pas le Père Noël K.O.
  async function punchSanta(e) {
    if (Z.busy || !alive) return;
    if (e.cancelable) e.preventDefault();
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
    fig.classList.add('is-laugh');
    say(1600);
    throwGift(away);
    track('noel_santa_gift', { page: location.pathname, hits: Z.hits });
    await wait(1600);
    if (Z.fig) Z.fig.classList.remove('is-laugh');
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
