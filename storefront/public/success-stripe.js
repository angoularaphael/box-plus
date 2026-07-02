const params = new URLSearchParams(location.search);
const order = params.get('order') || '';
const sessionId = params.get('session_id') || '';
const demo = params.get('demo');
const productId = params.get('product') || '';
const orderType = params.get('type') || '';

function showInvoiceButton(orderId) {
  const btn = document.getElementById('downloadInvoiceBtn');
  if (btn && orderId) {
    btn.href = `/api/facture/materiel/${encodeURIComponent(orderId)}`;
    btn.style.display = '';
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
    successText.textContent = 'Validation du paiement…';
    fetch('/api/checkout/confirm-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, order_id: order }),
    })
      .then((r) => r.json())
      .then((data) => {
        const orderId = order || data.order_id || '';
        successText.textContent = data.ok
          ? `Paiement confirmé — réf. ${orderId}. Retirez votre matériel en salle.`
          : 'Paiement reçu — contactez la salle si la confirmation tarde.';
        if (data.ok) showInvoiceButton(orderId);
      })
      .catch(() => {
        successText.textContent =
          'Paiement reçu — présentez votre email de confirmation en salle.';
      });
  } else {
    successText.textContent =
      order
        ? `Commande ${order} confirmée — retrait en salle.`
        : 'Commande matériel confirmée — retrait en salle.';
    if (order) showInvoiceButton(order);
  }
} else if (demo) {
  successText.textContent = 'Commande enregistrée — traitement Deciplus automatique.';
} else if (sessionId) {
  successText.textContent = 'Validation du paiement…';
  fetch('/api/checkout/confirm-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, order_id: order }),
  })
    .then((r) => r.json())
    .then((data) => {
      successText.textContent = data.ok
        ? "Paiement confirmé — votre abonnement est en cours d'enregistrement dans Deciplus."
        : 'Paiement reçu — contactez la salle si la confirmation tarde.';
    })
    .catch(() => {
      successText.textContent = 'Paiement reçu — votre commande sera traitée sous peu.';
    });
} else if (order) {
  successText.textContent = `Commande ${order} enregistrée.`;
}
