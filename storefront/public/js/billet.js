(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var id = params.get('id') || '';
  var t = params.get('t') || '';
  var etat = document.getElementById('billetEtat');
  var liste = document.getElementById('billetListe');
  var actions = document.getElementById('billetActions');
  var essais = 0;

  document.getElementById('billetImprimer').addEventListener('click', function () { window.print(); });

  function message(titre, texte) {
    etat.innerHTML = '';
    var h = document.createElement('h1');
    h.textContent = titre;
    var p = document.createElement('p');
    p.textContent = texte;
    etat.appendChild(h);
    etat.appendChild(p);
    etat.hidden = false;
  }

  function euros(cents) {
    var v = cents / 100;
    return (v % 1 ? v.toFixed(2).replace('.', ',') : String(v)) + ' €';
  }

  function ligne(dl, terme, valeur) {
    var dt = document.createElement('dt');
    dt.textContent = terme;
    var dd = document.createElement('dd');
    dd.textContent = valeur;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function afficher(c) {
    etat.hidden = true;
    liste.innerHTML = '';
    var surligne = params.get('c');
    c.billets.forEach(function (b) {
      var art = document.createElement('article');
      art.className = 'bil-billet' + (surligne && surligne === b.code ? ' bil-billet--scan' : '');
      var tete = document.createElement('div');
      tete.className = 'bil-billet-tete';
      tete.innerHTML = '<span>Boxing Center x Moteka</span>';
      var titre = document.createElement('strong');
      titre.textContent = c.evenement.nom;
      tete.appendChild(titre);
      var corps = document.createElement('div');
      corps.className = 'bil-billet-corps';
      var dl = document.createElement('dl');
      ligne(dl, 'Billet', c.produit_nom);
      ligne(dl, 'Accès', c.jours.join(' · '));
      ligne(dl, 'Nom', c.client.prenom + ' ' + c.client.nom);
      ligne(dl, 'E-mail', c.client.email);
      ligne(dl, 'Code', b.code);
      ligne(dl, 'Billet', b.numero + ' / ' + c.quantite);
      ligne(dl, 'Lieu', c.evenement.lieu);
      var qr = document.createElement('img');
      qr.className = 'bil-billet-qr';
      qr.width = 220;
      qr.height = 220;
      qr.alt = 'QR code du billet ' + b.code;
      qr.src = '/api/billetterie/qr/' + encodeURIComponent(c.order_id) + '/' + b.numero + '.png?t=' + encodeURIComponent(t);
      var cote = document.createElement('div');
      cote.className = 'bil-billet-cote';
      cote.innerHTML =
        '<div class="bil-billet-logos">' +
        '<img src="/img/billetterie/boxing-center.png" alt="Boxing Center" width="105" height="49">' +
        '<span aria-hidden="true">x</span>' +
        '<img src="/img/billetterie/moteka-blanc.svg" alt="Moteka" width="110" height="13">' +
        '</div>';
      cote.appendChild(qr);
      corps.appendChild(dl);
      corps.appendChild(cote);
      var pied = document.createElement('p');
      pied.className = 'bil-billet-pied';
      pied.textContent = 'Billet payé (' + euros(c.total_cents) + ' au total). Présentez ce QR code à l\'entrée.';
      art.appendChild(tete);
      art.appendChild(corps);
      art.appendChild(pied);
      liste.appendChild(art);
    });
    liste.hidden = false;
    actions.hidden = false;
  }

  function confirmer() {
    essais += 1;
    fetch('/api/billetterie/confirmer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, t: t }),
    })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (res) {
        var d = res.data || {};
        if (d.ok && d.commande && d.commande.paid) return afficher(d.commande);
        if (res.status === 403) return message('Billet introuvable', 'Ce lien n\'est pas valide. Utilisez le lien reçu par e-mail.');
        if (d.pending && essais < 10) {
          message('Paiement en cours de validation...', 'Cela peut prendre quelques secondes, ne fermez pas la page.');
          return setTimeout(confirmer, 3000);
        }
        message('Paiement non confirmé', 'Nous n\'avons pas reçu la confirmation du paiement. Si vous avez été débité, votre billet vous sera envoyé par e-mail dès sa validation. Sinon, vous pouvez réessayer depuis la billetterie.');
        actions.hidden = false;
      })
      .catch(function () {
        if (essais < 5) return setTimeout(confirmer, 3000);
        message('Connexion impossible', 'Rechargez la page dans un instant.');
      });
  }

  if (!id || !t) {
    message('Billet introuvable', 'Ce lien n\'est pas complet. Utilisez le lien reçu par e-mail.');
  } else {
    confirmer();
  }
})();
