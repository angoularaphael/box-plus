(function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const lead = document.getElementById('payLead');
  const amountEl = document.getElementById('payAmount');
  const choices = document.getElementById('payChoices');
  const status = document.getElementById('payStatus');
  const situation = document.getElementById('paySituation');
  const productEl = document.getElementById('payProduct');
  const step3 = document.getElementById('payStep3');
  // Un lien = une échéance : une fois réglée, on ne repropose pas le paiement (évite de payer deux fois).
  const paidKey = `bc_regul_paid_${token.slice(-24)}`;

  function wasPaid() {
    try {
      return localStorage.getItem(paidKey) === '1';
    } catch {
      return false;
    }
  }

  function rememberPaid() {
    try {
      localStorage.setItem(paidKey, '1');
    } catch {
      /* navigation privée */
    }
  }

  function showPaid() {
    if (lead) {
      lead.textContent =
        'Merci, votre paiement est bien reçu. Le club encaisse l’échéance dans les minutes qui suivent : la banque ne repassera pas le prélèvement.';
    }
    if (situation) situation.hidden = true;
    if (choices) choices.innerHTML = '';
  }

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
      rememberPaid();
      showPaid();
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

  // Sans lien : le membre demande son lien (envoye a l'e-mail de sa fiche par le club).
  function showRequestForm() {
    const form = document.getElementById('regulRequestForm');
    if (lead) {
      lead.textContent =
        'Un prélèvement n’est pas passé ? Vous pouvez régler votre échéance par carte. Remplissez ce formulaire : nous vous envoyons votre lien de paiement personnel par e-mail.';
    }
    if (!form) return;
    form.hidden = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = {
        last_name: fd.get('last_name'),
        first_name: fd.get('first_name'),
        birthdate: fd.get('birthdate'),
        email: fd.get('email'),
        website: fd.get('website'),
      };
      if (!body.last_name || !body.first_name || !body.birthdate) {
        setStatus('Merci d’indiquer votre nom, prénom et date de naissance.', true);
        return;
      }
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      setStatus('Envoi de votre demande…');
      try {
        const res = await fetch('/api/echeancier/request-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          setStatus(data.error || 'Demande impossible pour le moment.', true);
          if (btn) btn.disabled = false;
          return;
        }
        form.hidden = true;
        if (lead) lead.textContent = data.message;
        setStatus('');
      } catch {
        setStatus('Demande impossible pour le moment. Réessayez ou contactez l’accueil de votre salle.', true);
        if (btn) btn.disabled = false;
      }
    });
  }

  async function init() {
    if (!token) {
      showRequestForm();
      return;
    }
    const done = await confirmReturn().catch(() => false);
    if (done) return;
    if (wasPaid()) {
      showPaid();
      return;
    }

    const res = await fetch(`/api/echeancier/pay-info?t=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (lead) {
        lead.textContent =
          'Ce lien n’est plus valable : soit la banque a déjà représenté le prélèvement, soit le délai pour régler en ligne est passé. Pour savoir où vous en êtes, contactez l’accueil de votre salle.';
      }
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
    const du = data.failed_due ? ` du ${data.failed_due}` : '';
    if (lead) {
      lead.textContent =
        data.kind === 'resilie'
          ? `${who} votre prélèvement${du} n’est pas passé et votre contrat a été résilié. Ce paiement solde l’échéance restée impayée.`
          : data.kind === 'demande'
            ? `${who} votre prélèvement${du} n’est pas passé. Ce paiement par carte régularise l’échéance restée impayée.`
            : `${who} votre prélèvement${du} n’est pas passé.${data.new_due ? ` La banque le représentera le ${data.new_due}.` : ''} Si vous réglez maintenant par carte, elle ne repassera pas et votre abonnement continue normalement.`;
    }
    if (amountEl) amountEl.textContent = data.amount_label;
    if (productEl) productEl.textContent = data.product ? `Échéance de votre abonnement : ${data.product}` : '';
    if (step3) {
      step3.textContent =
        data.kind === 'resilie'
          ? 'Vous recevez la confirmation. Pour reprendre un abonnement, passez par la boutique ou l’accueil.'
          : data.kind === 'demande'
            ? 'Votre situation est régularisée, sans nouvelle présentation à la banque.'
            : 'Votre abonnement continue, sans nouvelle présentation à la banque.';
    }
    if (situation) situation.hidden = false;
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
