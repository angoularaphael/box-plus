/**
 * Homepage — featured gear strip (curated bestsellers from the real matériel catalog).
 * Surfaces the goods on the homepage (e-commerce merchandising) without touching backend.
 */
(async function () {
  var el = document.getElementById('featuredGear');
  if (!el) return;
  var L = function (p) { return (window.BCPaths && window.BCPaths.link(p)) || p; };
  var A = function (p) { return (window.BCPaths && window.BCPaths.asset(p)) || p.replace(/^\//, ''); };
  var esc = function (s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };

  try {
    var res = await fetch('/api/materiel?all=1');
    var data = await res.json();
    var products = (data.products || []).filter(function (p) { return p.image && p.stock > 0; });

    // curate one product per key category for a varied, representative strip
    var wantCats = ['gants', 'casque', 'short', 'protege-tibias', 'bandes', 'accessoires'];
    var picked = [], seen = {};
    wantCats.forEach(function (c) {
      var p = products.find(function (x) { return x.category === c && !seen[x.id]; });
      if (p) { picked.push(p); seen[p.id] = 1; }
    });
    for (var i = 0; i < products.length && picked.length < 4; i++) {
      if (!seen[products[i].id]) { picked.push(products[i]); seen[products[i].id] = 1; }
    }
    picked = picked.slice(0, 4);
    if (!picked.length) { el.closest('section').hidden = true; return; }

    el.innerHTML = picked.map(function (p) {
      var link = L('/materiel/produit') + '?id=' + encodeURIComponent(p.id);
      return '<article class="gear-card">' +
        '<a class="gear-card__media" href="' + link + '"><img src="' + A(p.image) + '" alt="' + esc(p.name) + '" loading="lazy"></a>' +
        '<div class="gear-card__body">' +
          '<span class="gear-card__cat">' + esc(p.category_label || p.category || '') + '</span>' +
          '<h4><a href="' + link + '">' + esc(p.name) + '</a></h4>' +
          '<div class="gear-card__price">' + esc(p.price_label || '') + '</div>' +
        '</div></article>';
    }).join('');
  } catch (e) {
    var sec = el.closest('section');
    if (sec) sec.hidden = true;
  }
})();
