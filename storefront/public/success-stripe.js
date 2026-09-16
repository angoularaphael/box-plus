const params = new URLSearchParams(location.search);
const order = params.get('order') || '';
const sessionId = params.get('session_id') || '';
const demo = params.get('demo');
const productId = params.get('product') || '';
const orderType = params.get('type') || '';
const token = params.get('token') || '';

const PAYMENT_FAILED_MSG =
  'Le paiement n\'a pas pu être finalisé — vous n\'avez pas été débité. Vous pouvez réessayer.';

const MATERIEL_PENDING_MSG =
  'Paiement en cours de validation… quelques secondes encore.';

function showInvoiceButton(orderId, token) {
  const btn = document.getElementById('downloadInvoiceBtn');
  if (btn && orderId) {
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    btn.href = `/api/facture/materiel/${encodeURIComponent(orderId)}${q}`;
    btn.style.display = '';
  }
}

function showPaymentFailure(retryHref, message) {
  const page = document.querySelector('.success-page');
  const title = document.querySelector('.success-page h1');
  const icon = document.querySelector('.success-icon');
  const successText = document.getElementById('successText');
  const nextList = document.querySelector('.success-next');
  const actions = document.getElementById('successActions');

  if (page) {
    page.classList.add('payment-failed');
    page.classList.remove('success-page--celebrate');
  }
  if (title) title.textContent = 'Paiement non confirmé';
  if (icon) icon.style.display = 'none';
  const wrap = document.querySelector('.success-icon-wrap');
  if (wrap) wrap.style.display = 'none';
  if (successText) {
    successText.textContent = message || PAYMENT_FAILED_MSG;
    successText.className = 'form-msg err';
  }
  if (nextList) nextList.style.display = 'none';
  if (actions) {
    const panierCard = orderType === 'materiel' ? '/panier?pay=card' : retryHref || '/';
    actions.innerHTML = `
      <a href="${panierCard}" class="btn">${
        orderType === 'materiel' ? 'Payer par carte bancaire' : 'Réessayer le paiement'
      }</a>
      <a href="${retryHref || '/panier'}" class="btn secondary">Retour au panier</a>
      <a href="/" class="btn secondary">Retour à l'accueil</a>`;
  }
}

async function confirmStripeSession(retryHref) {
  const successText = document.getElementById('successText');
  if (successText) successText.textContent = 'Validation du paiement…';

  try {
    const res = await fetch('/api/checkout/confirm-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, order_id: order }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      const orderId = order || data.order_id || '';
      if (orderType === 'materiel') {
        if (successText) {
          successText.textContent = `Paiement confirmé — réf. ${orderId}. Retirez votre matériel en salle.`;
        }
        if (orderId) showInvoiceButton(orderId, token || data.access_token);
      } else if (successText) {
        successText.textContent =
          "Paiement confirmé — votre abonnement est en cours d'enregistrement.";
      }
      return;
    }

    showPaymentFailure(retryHref, PAYMENT_FAILED_MSG);
  } catch {
    showPaymentFailure(retryHref, PAYMENT_FAILED_MSG);
  }
}

async function confirmPayplugMaterielOnce() {
  const paymentId =
    params.get('payment_id') || sessionStorage.getItem('bc_materiel_payplug_id') || '';
  const res = await fetch('/api/checkout/confirm-payplug-materiel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_id: paymentId || undefined,
      order_id: order || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function confirmPayplugMateriel() {
  const successText = document.getElementById('successText');
  if (successText) successText.textContent = 'Validation du paiement…';

  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { res, data } = await confirmPayplugMaterielOnce();
      if (res.ok && data.ok) {
        const orderId = order || data.order_id || '';
        sessionStorage.removeItem('bc_materiel_payplug_id');
        try {
          sessionStorage.removeItem('bc-cart-checkout-backup');
        } catch {
          /* ignore */
        }
        if (successText) {
          successText.textContent = `Paiement confirmé — réf. ${orderId}. Retirez votre matériel en salle.`;
        }
        if (orderId) showInvoiceButton(orderId, token || data.access_token);
        return;
      }
      if (data.pending || data.error === 'payment_pending') {
        if (successText) {
          successText.textContent =
            attempt < maxAttempts
              ? MATERIEL_PENDING_MSG
              : 'Paiement en cours de validation — vous recevrez un email dès confirmation. Si besoin, payez par carte depuis le panier.';
        }
        if (order) showInvoiceButton(order, token);
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        const actions = document.getElementById('successActions');
        if (actions && !actions.querySelector('[data-fallback-card]')) {
          const a = document.createElement('a');
          a.href = '/panier?pay=card';
          a.className = 'btn secondary';
          a.dataset.fallbackCard = '1';
          a.textContent = 'Payer par carte à la place';
          actions.appendChild(a);
        }
        return;
      }
      showPaymentFailure(
        '/panier?pay=card',
        data.message ||
          'Scalapay / PayPlug n’a pas confirmé le paiement. Réessayez par carte bancaire — vous n’avez pas été débité.'
      );
      return;
    } catch {
      if (attempt >= maxAttempts) {
        showPaymentFailure('/panier?pay=card', PAYMENT_FAILED_MSG);
        return;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}

const successText = document.getElementById('successText');
if (!successText) {
  /* legacy page */
} else if (orderType === 'materiel') {
  if (demo) {
    successText.textContent =
      'Commande matériel enregistrée — présentez-vous en salle pour le retrait.';
  } else if (sessionId) {
    void confirmStripeSession('/panier');
  } else {
    void confirmPayplugMateriel();
  }
} else if (demo) {
  successText.textContent = 'Commande enregistrée — traitement automatique en cours.';
} else if (sessionId) {
  const retry =
    order && productId
      ? `/checkout.html?product=${encodeURIComponent(productId)}`
      : '/abonnements';
  void confirmStripeSession(retry);
} else if (order) {
  successText.textContent = `Commande ${order} enregistrée.`;
}
