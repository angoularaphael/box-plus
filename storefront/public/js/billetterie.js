(function () {
  'use strict';

  var form = document.getElementById('bilForm');
  var grille = document.getElementById('bilProduits');
  var selectQte = document.getElementById('bilQuantite');
  var totalEl = document.getElementById('bilTotal');
  var erreurEl = document.getElementById('bilErreur');
  var bouton = document.getElementById('bilPayer');
  var params = new URLSearchParams(window.location.search);
  var produits = [];
  var CLE_SRC = 'bc_ff_src';

  function lireSrc() {
    var brut = String(params.get('src') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 12);
    if (brut) {
      try { localStorage.setItem(CLE_SRC, brut); } catch (e) { /* ignore */ }
      return brut;
    }
    try { return String(localStorage.getItem(CLE_SRC) || '').replace(/[^a-z0-9_-]/g, '').slice(0, 12); } catch (e) { return ''; }
  }

  if (params.get('annule') === '1') document.getElementById('bilAnnule').hidden = false;

  function euros(cents) {
    var v = cents / 100;
    return (v % 1 ? v.toFixed(2).replace('.', ',') : String(v)) + ' €';
  }

  function produitChoisi() {
    var r = form.querySelector('input[name="produit"]:checked');
    if (!r) return null;
    for (var i = 0; i < produits.length; i++) if (produits[i].id === r.value) return produits[i];
    return null;
  }

  function majTotal() {
    var p = produitChoisi();
    var q = Number(selectQte.value || 1);
    totalEl.textContent = p ? euros(p.prix_cents * q) : '-';
    bouton.disabled = !p;
  }

  function afficherErreur(msg) {
    erreurEl.textContent = msg || '';
    erreurEl.hidden = !msg;
  }

  function rendre(data) {
    produits = data.produits || [];
    var voulu = String(params.get('produit') || '').toLowerCase();
    grille.innerHTML = '';
    produits.forEach(function (p) {
      var label = document.createElement('label');
      label.className = 'bil-carte' + (p.id === 'weekend' ? ' bil-carte--pack' : '');
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'produit';
      input.value = p.id;
      if (p.id === voulu) input.checked = true;
      var corps = document.createElement('span');
      corps.className = 'bil-carte-corps';
      var nom = document.createElement('strong');
      nom.textContent = p.nom;
      var detail = document.createElement('span');
      detail.className = 'bil-carte-detail';
      detail.textContent = p.detail;
      var prix = document.createElement('span');
      prix.className = 'bil-carte-prix';
      prix.textContent = euros(p.prix_cents);
      corps.appendChild(nom);
      corps.appendChild(detail);
      label.appendChild(input);
      label.appendChild(corps);
      label.appendChild(prix);
      grille.appendChild(label);
    });
    for (var i = 1; i <= (data.quantite_max || 10); i++) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = String(i);
      selectQte.appendChild(o);
    }
    var m = data.methodes || {};
    form.querySelectorAll('input[name="methode"]').forEach(function (r) {
      if (m[r.value] === false) {
        r.disabled = true;
        r.closest('label').classList.add('bil-methode--off');
      }
    });
    var actif = form.querySelector('input[name="methode"]:not(:disabled)');
    if (actif && form.querySelector('input[name="methode"]:checked:disabled')) actif.checked = true;
    majTotal();
    if (voulu && produitChoisi()) {
      var prenom = form.querySelector('input[name="prenom"]');
      if (window.matchMedia('(min-width: 900px)').matches) prenom.focus({ preventScroll: true });
    }
  }

  form.addEventListener('change', majTotal);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    afficherErreur('');
    var fd = new FormData(form);
    var corps = {
      produit: fd.get('produit'),
      prenom: String(fd.get('prenom') || '').trim(),
      nom: String(fd.get('nom') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      quantite: Number(fd.get('quantite') || 1),
      methode: fd.get('methode'),
      src: lireSrc(),
    };
    if (!corps.produit) return afficherErreur('Choisissez un billet.');
    if (!corps.prenom || !corps.nom) return afficherErreur('Indiquez votre prénom et votre nom.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(corps.email)) return afficherErreur('Adresse e-mail invalide.');
    bouton.disabled = true;
    bouton.textContent = 'Redirection vers le paiement...';
    fetch('/api/billetterie/commande', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (data) {
        if (data && data.ok && data.url) {
          window.location.href = data.url;
          return;
        }
        afficherErreur((data && data.error) || 'Le paiement n\'a pas pu démarrer. Réessayez.');
        bouton.disabled = false;
        bouton.textContent = 'Payer et recevoir mon billet';
      })
      .catch(function () {
        afficherErreur('Connexion impossible. Vérifiez votre réseau et réessayez.');
        bouton.disabled = false;
        bouton.textContent = 'Payer et recevoir mon billet';
      });
  });

  fetch('/api/billetterie/produits')
    .then(function (r) { return r.json(); })
    .then(rendre)
    .catch(function () { afficherErreur('Billetterie momentanément indisponible. Réessayez dans un instant.'); });
})();
