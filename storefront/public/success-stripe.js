const BADGE_FEE_NOTICE =
  "En souscrivant un abonnement, votre badge d'accès (34,99 €) sera prélevé sur l'IBAN que vous indiquez dans un délai de 5 à 7 jours ouvrés après votre achat. Le montant payé aujourd'hui par carte bancaire correspond à votre 1ère échéance d'abonnement.";

function shouldShowBadgeFeeNotice(product) {
  if (!product?.requires_iban) return false;
  if (product.badge_fee_notice) return true;
  if (product.sale_type === 'abonnement') return true;
  return String(product.category || '').toLowerCase().includes('abonnement');
}

function showSuccessBadgeNotice(product) {
  if (!shouldShowBadgeFeeNotice(product)) return;
  const notice = document.getElementById('successBadgeNotice');
  const textEl = document.getElementById('successBadgeText');
  if (!notice || !textEl) return;
  notice.hidden = false;
  textEl.textContent = product.badge_fee_notice || BADGE_FEE_NOTICE;
}

async function maybeShowBadgeNoticeFromCatalog(productId) {
  if (!productId) return;
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    const products = data.products || data;
    const product = products.find((p) => p.id === productId);
    showSuccessBadgeNotice(product);
  } catch {
    /* ignore */
  }
}

const params = new URLSearchParams(location.search);
const order = params.get('order') || '';
const sessionId = params.get('session_id') || '';
const demo = params.get('demo');
const productId = params.get('product') || '';

document.getElementById('orderRef').textContent = order ? 'Réf. ' + order : '';

if (demo) {
  document.getElementById('successText').textContent =
    'Commande enregistrée — traitement Deciplus automatique.';
  maybeShowBadgeNoticeFromCatalog(productId);
} else if (sessionId) {
  document.getElementById('successText').textContent = 'Validation du paiement…';
  fetch('/api/checkout/confirm-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, order_id: order }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.ok) {
        document.getElementById('successText').textContent =
          'Paiement confirmé — votre abonnement est en cours d\'enregistrement dans Deciplus.';
      } else {
        document.getElementById('successText').textContent =
          'Paiement reçu — contactez la salle si la confirmation tarde.';
      }
      maybeShowBadgeNoticeFromCatalog(productId);
    })
    .catch(() => {
      document.getElementById('successText').textContent =
        'Paiement reçu — votre commande sera traitée sous peu.';
      maybeShowBadgeNoticeFromCatalog(productId);
    });
} else {
  maybeShowBadgeNoticeFromCatalog(productId);
}
