const params = new URLSearchParams(location.search);
const order = params.get('order') || '';
const sessionId = params.get('session_id') || '';
const demo = params.get('demo');
const productId = params.get('product') || '';
const orderType = params.get('type') || '';

const PAYMENT_FAILED_MSG =
  'Le paiement n\'a pas pu être finalisé — vous n\'avez pas été débité. Vous pouvez réessayer.';

function showInvoiceButton(orderId) {
  const btn = document.getElementById('downloadInvoiceBtn');
  if (btn && orderId) {
    btn.href = `/api/facture/materiel/${encodeURIComponent(orderId)}`;
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

  if (page) page.classList.add('payment-failed');
  if (title) title.textContent = 'Paiement non confirmé';
  if (icon) icon.style.display = 'none';
  if (successText) {
    successText.textContent = message || PAYMENT_FAILED_MSG;
    successText.className = 'form-msg err';
  }
  if (nextList) nextList.style.display = 'none';
  if (actions) {
    actions.innerHTML = `
      <a href="${retryHref || '/'}" class="btn">Réessayer le paiement</a>
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
        if (orderId) showInvoiceButton(orderId);
      } else if (successText) {
        successText.textContent =
          "Paiement confirmé — votre abonnement est en cours d'enregistrement dans Deciplus.";
      }
      return;
    }

    showPaymentFailure(retryHref, PAYMENT_FAILED_MSG);
  } catch {
    showPaymentFailure(retryHref, PAYMENT_FAILED_MSG);
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
  } else if (order) {
    successText.textContent = `Commande ${order} confirmée — retrait en salle.`;
    showInvoiceButton(order);
  } else {
    successText.textContent = 'Commande matériel confirmée — retrait en salle.';
  }
} else if (demo) {
  successText.textContent = 'Commande enregistrée — traitement Deciplus automatique.';
} else if (sessionId) {
  const retry =
    order && productId
      ? `/checkout.html?product=${encodeURIComponent(productId)}`
      : '/abonnements';
  void confirmStripeSession(retry);
} else if (order) {
  successText.textContent = `Commande ${order} enregistrée.`;
}
