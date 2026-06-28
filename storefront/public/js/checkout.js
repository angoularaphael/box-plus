let currentProduct = null;
let stripeMode = false;

const BADGE_FEE_NOTICE =
  "En souscrivant un abonnement, votre badge d'accès (34,99 €) sera prélevé sur l'IBAN que vous indiquez dans un délai de 3 à 7 jours ouvrés, avant le début des prélèvements de votre abonnement. Le montant payé aujourd'hui par carte bancaire correspond à votre 1ère échéance d'abonnement.";

function isAbonnementProduct(product) {
  if (!product) return false;
  if (product.sale_type === 'abonnement') return true;
  if (String(product.category || '').toLowerCase().includes('abonnement')) return true;
  if (/badge|decipass|essai|séance|seance/i.test(String(product.name || ''))) return false;
  return false;
}

function renderBadgeFeeNotice(product) {
  if (!isAbonnementProduct(product)) return;
  const text = product.badge_fee_notice || BADGE_FEE_NOTICE;
  for (const id of ['badgeFeeNotice', 'summaryBadgeNotice']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.hidden = false;
    el.className = id === 'summaryBadgeNotice' ? 'notice-important' : 'notice-important full';
    el.innerHTML = `<strong>Information badge</strong><p>${text}</p>`;
  }
}

function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

function formData(form) {
  const fd = new FormData(form);
  const body = {};
  fd.forEach((v, k) => { body[k] = v; });
  return body;
}

function showMsg(text, ok) {
  const el = document.getElementById('formMsg');
  el.textContent = text;
  el.className = 'form-msg ' + (ok ? 'ok' : 'err');
}

async function init() {
  const productId = qs('product');
  if (!productId) {
    location.href = '/';
    return;
  }

  if (qs('cancelled')) showMsg('Paiement non finalisé — vous pouvez réessayer.', false);

  const catalogRes = await fetch('/api/products');
  const catalogData = await catalogRes.json();
  const products = catalogData.products || catalogData;
  const config = await fetch('/api/config').then((r) => r.json());

  currentProduct = products.find((p) => p.id === productId);
  if (!currentProduct) {
    showMsg('Produit introuvable', false);
    return;
  }

  stripeMode = config.stripe_enabled;
  document.getElementById('modePill').textContent = stripeMode ? 'Stripe actif' : 'Mode démo';
  document.getElementById('productId').value = productId;
  document.getElementById('productTitle').textContent = currentProduct.tagline || currentProduct.name;
  document.getElementById('productSub').textContent = currentProduct.description;
  document.getElementById('sumName').textContent = currentProduct.name;
  document.getElementById('sumDesc').textContent = currentProduct.description;
  document.getElementById('sumPrice').textContent = currentProduct.price_label;

  const ibanBlock = document.getElementById('ibanBlock');
  const ibanInput = document.getElementById('iban');
  if (!currentProduct.requires_iban) {
    ibanBlock.hidden = true;
    ibanInput.removeAttribute('required');
  } else {
    ibanBlock.hidden = false;
    ibanInput.setAttribute('required', 'required');
  }

  if (currentProduct.deciplus_total_note) {
    const note = document.createElement('div');
    note.className = 'info-box';
    note.textContent = currentProduct.deciplus_total_note + ' — Stripe encaisse : ' + currentProduct.price_label;
    document.querySelector('.summary-panel').appendChild(note);
  }

  renderBadgeFeeNotice(currentProduct);

  const payStripe = document.getElementById('payStripeBtn');
  const payDemo = document.getElementById('payDemoBtn');
  const payFree = document.getElementById('payFreeBtn');

  if (!currentProduct.requires_payment) {
    payFree.hidden = false;
  } else if (stripeMode) {
    payStripe.hidden = false;
  } else {
    payDemo.hidden = false;
  }
}

async function submitCheckout(endpoint) {
  const form = document.getElementById('checkoutForm');
  if (!form.reportValidity()) return;

  const body = formData(form);
  showMsg('Traitement…', true);

  const buttons = form.querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      const err = data.errors?.join(', ') || data.error || 'Erreur';
      throw new Error(err);
    }

    if (data.url) {
      location.href = data.url;
      return;
    }
    if (data.redirect) {
      location.href = data.redirect;
      return;
    }
    showMsg('Commande enregistrée.', true);
  } catch (err) {
    showMsg(err.message, false);
    buttons.forEach((b) => { b.disabled = false; });
  }
}

document.getElementById('checkoutForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentProduct) return;
  if (!currentProduct.requires_payment) {
    submitCheckout('/api/checkout/create-session');
    return;
  }
  if (stripeMode) {
    submitCheckout('/api/checkout/create-session');
  }
});

document.getElementById('payDemoBtn').addEventListener('click', () => {
  submitCheckout('/api/checkout/demo');
});

init();
