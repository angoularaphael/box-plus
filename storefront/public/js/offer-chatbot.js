/**
 * Mini chatbot FAQ — pages offres 29 / 259 / hub.
 */
(function () {
  'use strict';

  var FAQS = [
    {
      q: ['29', 'démarrer', 'demarrer', 'sans engagement', 'prélèvement', 'prelevement', '4 semaines'],
      a: 'L’offre à 29 € = 1ʳᵉ échéance CB (ou PayPal), puis prélèvement sans engagement toutes les 4 semaines. Accès aux 5 salles, cours illimités toutes disciplines.',
    },
    {
      q: ['259', 'année', '12 mois', '4x', '4×', 'comptant', 'imbattable'],
      a: 'L’offre à 259 € = 12 mois à tarifs imbattables. Moins cher en une seule fois. Sinon 4× sans frais : paiement immédiat de 64,75 €, puis 3 échéances de 64,75 €.',
    },
    {
      q: ['badge', 'accès', 'acces', 'carte'],
      a: 'Le badge d’accès (34,99 €) est prélevé sur IBAN environ 72 h après l’inscription pour les formules par prélèvement, selon les conditions du club.',
    },
    {
      q: ['salle', 'où', 'ou', 'toulouse', 'minimes', 'portet'],
      a: '5 salles : Minimes, Ramonville, États-Unis, Saint-Cyprien et Portet. Une carte, tout le réseau.',
    },
    {
      q: ['essai', 'essayer', 'gratuit'],
      a: 'Tu peux commencer par une séance d’essai gratuite, puis choisir 29 € / 4 semaines ou 259 € / 12 mois.',
    },
    {
      q: ['résilier', 'resilier', 'arrêter', 'arreter', 'engagement'],
      a: 'Sans engagement (29 €) : résiliation avec préavis avant la prochaine échéance (souvent 15 jours). L’année 259 € est un forfait 12 mois.',
    },
  ];

  function answer(text) {
    var t = String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    for (var i = 0; i < FAQS.length; i++) {
      var hit = FAQS[i].q.some(function (k) {
        return t.indexOf(
          String(k)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
        ) !== -1;
      });
      if (hit) return FAQS[i].a;
    }
    return 'Je peux t’aider sur 29 € / 4 semaines, 259 € / 12 mois, badge, salles ou essai. Pose ta question, ou écris à contact@boxingcenter.fr.';
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function boot() {
    if (document.getElementById('offerChat')) return;

    var root = el('div', 'offer-chat');
    root.id = 'offerChat';
    root.innerHTML =
      '<button type="button" class="offer-chat__fab" aria-expanded="false" aria-controls="offerChatPanel">?</button>' +
      '<div class="offer-chat__panel" id="offerChatPanel" hidden>' +
      '<div class="offer-chat__head"><strong>Coach Box+</strong><button type="button" class="offer-chat__x" aria-label="Fermer">×</button></div>' +
      '<div class="offer-chat__log" id="offerChatLog"></div>' +
      '<form class="offer-chat__form" id="offerChatForm">' +
      '<input type="text" id="offerChatInput" placeholder="Ex. badge, 4×, salles…" autocomplete="off" />' +
      '<button type="submit">OK</button>' +
      '</form></div>';
    document.body.appendChild(root);

    var fab = root.querySelector('.offer-chat__fab');
    var panel = root.querySelector('.offer-chat__panel');
    var log = root.querySelector('#offerChatLog');
    var form = root.querySelector('#offerChatForm');
    var input = root.querySelector('#offerChatInput');

    function push(who, text) {
      var row = el('div', 'offer-chat__msg offer-chat__msg--' + who);
      row.textContent = text;
      log.appendChild(row);
      log.scrollTop = log.scrollHeight;
    }

    function open() {
      panel.hidden = false;
      fab.setAttribute('aria-expanded', 'true');
      if (!log.childElementCount) {
        push('bot', 'Salut ! Questions sur 29 € / 4 semaines ou 259 € / 12 mois ?');
      }
      if (window.BCTrack) window.BCTrack.track('offer_chat_open', { path: location.pathname });
      input.focus();
    }

    function close() {
      panel.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
    }

    fab.addEventListener('click', function () {
      if (panel.hidden) open();
      else close();
    });
    root.querySelector('.offer-chat__x').addEventListener('click', close);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      push('user', q);
      input.value = '';
      var a = answer(q);
      push('bot', a);
      if (window.BCTrack) window.BCTrack.track('offer_chat_ask', { q: q.slice(0, 80) });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
