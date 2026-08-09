/**
 * Motion légère sur les fiches offre 29 / 259.
 */
(function () {
  'use strict';

  var sheet = document.querySelector('.offer-sheet');
  if (!sheet) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    sheet.classList.add('offer-sheet--ready');
    return;
  }

  requestAnimationFrame(function () {
    sheet.classList.add('offer-sheet--ready');
  });

  var price = sheet.querySelector('.offer-sheet__price');
  if (price) {
    price.classList.add('offer-sheet__price--pop');
  }

  var stats = sheet.querySelectorAll('.offer-sheet__stats li');
  stats.forEach(function (el, i) {
    el.style.setProperty('--i', String(i));
    el.classList.add('offer-sheet__stat--in');
  });
})();
