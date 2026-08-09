/**
 * Tunnel offre — modal lead (tunnel_leads) puis redirect inscription.
 */
(function () {
  'use strict';

  var cfg = document.getElementById('offerFunnelConfig');
  if (!cfg) return;

  var productId = cfg.getAttribute('data-product') || '';
  var tunnel = cfg.getAttribute('data-tunnel') || '';
  var inscriptionUrl = cfg.getAttribute('data-inscription') || '/inscription?product=' + encodeURIComponent(productId);

  var modal = document.getElementById('offerLeadModal');
  var form = document.getElementById('offerLeadForm');
  var errEl = document.getElementById('offerLeadError');
  var skipBtn = document.getElementById('offerLeadSkip');

  function openModal(e) {
    if (e) e.preventDefault();
    if (!modal) {
      window.location.href = inscriptionUrl;
      return;
    }
    modal.hidden = false;
    var first = form && form.querySelector('input[name="prenom"]');
    if (first) first.focus();
  }

  function closeModal() {
    if (modal) modal.hidden = true;
  }

  document.querySelectorAll('[data-offer-cta]').forEach(function (btn) {
    btn.addEventListener('click', openModal);
  });

  if (skipBtn) {
    skipBtn.addEventListener('click', function () {
      window.location.href = inscriptionUrl;
    });
  }

  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
  }

  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (errEl) errEl.textContent = '';
      var fd = new FormData(form);
      var payload = {
        tunnel: tunnel,
        prenom: String(fd.get('prenom') || '').trim(),
        nom: String(fd.get('nom') || '').trim(),
        telephone: String(fd.get('telephone') || '').trim(),
        email: String(fd.get('email') || '').trim(),
        source: 'boutique-tunnel-' + tunnel,
        product_id: productId,
      };
      if (!payload.prenom || !payload.telephone) {
        if (errEl) errEl.textContent = 'Prénom et téléphone sont requis.';
        return;
      }
      var submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        var res = await fetch('/api/tunnel-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          throw new Error(data.error || 'Envoi impossible');
        }
        var q = new URLSearchParams();
        q.set('product', productId);
        if (payload.prenom) q.set('prenom', payload.prenom);
        if (payload.nom) q.set('nom', payload.nom);
        if (payload.telephone) q.set('phone', payload.telephone);
        if (payload.email) q.set('email', payload.email);
        window.location.href = '/inscription?' + q.toString();
      } catch (err) {
        if (errEl) errEl.textContent = err.message || 'Erreur réseau';
        if (submit) submit.disabled = false;
      }
    });
  }
})();
