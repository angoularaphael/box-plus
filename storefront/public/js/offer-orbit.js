/**
 * Hub offres — timeline intro → appear → orbit → choose.
 */
(function () {
  'use strict';

  var hub = document.querySelector('[data-offer-hub]');
  if (!hub) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var phases = reduce ? ['choose'] : ['intro', 'appear', 'orbit', 'choose'];
  var delays = reduce ? [0] : [400, 900, 4200, 0];
  var i = 0;

  function setPhase(name) {
    hub.setAttribute('data-phase', name);
  }

  function next() {
    if (i >= phases.length) return;
    setPhase(phases[i]);
    var wait = delays[i] || 0;
    i += 1;
    if (i < phases.length) {
      window.setTimeout(next, wait);
    }
  }

  setPhase(phases[0]);
  if (!reduce) {
    window.setTimeout(next, delays[0]);
  } else {
    setPhase('choose');
  }

  // Position arms for appear/orbit initial angles
  var arm259 = hub.querySelector('.orbit-arm--259');
  var arm29 = hub.querySelector('.orbit-arm--29');
  if (arm259) arm259.style.setProperty('--start', '20deg');
  if (arm29) arm29.style.setProperty('--start', '200deg');
})();
