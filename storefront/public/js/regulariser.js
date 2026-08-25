(function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const lead = document.getElementById('payLead');
  const amountEl = document.getElementById('payAmount');
  const choices = document.getElementById('payChoices');
  const status = document.getElementById('payStatus');

  function setStatus(msg, err) {
    if (!status) return;
    status.textContent = msg || '';
    status.style.color = err ? '#b42318' : '';
  }

  async function checkout(method) {
    setStatus('Redirection vers le paiement sécurisé…');
    const res = await fetch('/api/echeancier/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, method }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.url) {
      setStatus(data.error || 'Paiement indisponible pour le moment.', true);
      return;
    }
    if (data.hosted_checkout_id) {
      sessionStorage.setItem('bc_ech_cawl_id', data.hosted_checkout_id);
    }
    location.href = data.url;
  }

  async function confirmReturn() {
    const paypalOrderId = params.get('paypal_order_id') || (params.get('paypal_return') === '1' ? params.get('token') : '') || '';
    const paymentId = params.get('payment_id') || '';
    const hostedCheckoutId =
      params.get('hostedCheckoutId') ||
      params.get('hosted_checkout_id') ||
      sessionStorage.getItem('bc_ech_cawl_id') ||
      '';
    if (
      params.get('paypal_return') !== '1' &&
      params.get('payplug_return') !== '1' &&
      params.get('cawl_return') !== '1'
    ) {
      return false;
    }

    setStatus('Vérification du paiement…');
    const body = { token };
    if (params.get('cawl_return') === '1') {
      body.hosted_checkout_id = hostedCheckoutId;
    }
    if (params.get('paypal_return') === '1') {
      body.paypal_order_id = paypalOrderId;
    }
    if (params.get('payplug_return') === '1' && paymentId) body.payment_id = paymentId;

    const res = await fetch('/api/echeancier/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.paid) {
      if (lead) lead.textContent = 'Merci. Votre règlement a bien été reçu. Votre échéance va être encaissée au club.';
      if (choices) choices.innerHTML = '';
      setStatus('Paiement confirmé.');
      return true;
    }
    if (res.status === 402) {
      setStatus('Paiement en cours de validation. Vous pouvez patienter quelques instants puis actualiser.', true);
      return true;
    }
    return false;
  }

  function button(label, method) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn block';
    b.textContent = label;
    b.style.marginTop = '10px';
    b.addEventListener('click', () => checkout(method));
    return b;
  }

  async function init() {
    if (!token) {
      if (lead) lead.textContent = 'Lien de paiement invalide ou expiré. Merci de contacter votre salle.';
      return;
    }
    const done = await confirmReturn().catch(() => false);
    if (done && lead && /Merci/.test(lead.textContent)) return;

    const res = await fetch(`/api/echeancier/pay-info?t=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (lead) lead.textContent = 'Ce lien n’est plus valable. Merci de vous rapprocher de l’accueil de votre salle.';
      return;
    }
    if (data.portet_paused) {
      if (lead) {
        lead.textContent = data.portet_paused_message ||
          'Les paiements en ligne pour la salle de Portet sont momentanément indisponibles. Contactez le club ou passez à l’accueil.';
      }
      setStatus('', false);
      return;
    }
    const who = data.prenom ? `Bonjour ${data.prenom},` : 'Bonjour,';
    if (lead) {
      lead.textContent = `${who} merci de régler l’échéance ci-dessous afin de conserver votre accès aux salles Boxing Center.`;
    }
    if (amountEl) {
      amountEl.textContent = data.offer_label && data.offer_label !== data.amount_label
        ? `${data.amount_label} — formule ${data.offer_label}`
        : data.amount_label;
    }
    if (!choices) return;
    choices.innerHTML = '';
    if (data.portet_via_cawl || (data.portet && data.show_cawl)) {
      choices.appendChild(button('Régler par carte bancaire', 'cawl'));
    } else if (data.portet || data.portet_via_paypal) {
      if (data.show_paypal) {
        choices.appendChild(button('Régler avec PayPal (ou carte via PayPal)', 'paypal'));
      }
    } else {
      if (data.show_payplug) choices.appendChild(button('Régler par carte bancaire', 'payplug'));
      if (data.show_paypal) choices.appendChild(button('Régler avec PayPal', 'paypal'));
    }
    if (!choices.childElementCount) {
      setStatus('Aucun moyen de paiement n’est disponible pour le moment.', true);
    }
  }

  init().catch((err) => setStatus(err.message || 'Erreur', true));
})();
