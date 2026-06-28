let currentProduct = null;
let stripeMode = false;
let catalogLoading = true;

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

function setPayButtons({ stripe = false, demo = false, free = false } = {}) {
  document.getElementById('payStripeBtn').hidden = !stripe;
  document.getElementById('payDemoBtn').hidden = !demo;
  document.getElementById('payFreeBtn').hidden = !free;
}

async function init() {
  const productId = qs('product');
  if (!productId) {
    location.href = '/';
    return;
  }

  if (qs('cancelled')) showMsg('Paiement non finalisé — vous pouvez réessayer.', false);

  setPayButtons();

  try {
    const [catalogRes, config] = await Promise.all([
      fetch('/api/products'),
      fetch('/api/config').then((r) => r.json()),
    ]);
    const catalogData = await catalogRes.json();
    const products = catalogData.products || catalogData;

    currentProduct = products.find((p) => p.id === productId);
    if (!currentProduct) {
      showMsg(`Offre « ${productId} » introuvable — retournez à l'accueil et choisissez une offre à jour.`, false);
      document.getElementById('productTitle').textContent = 'Offre introuvable';
      return;
    }

    stripeMode = Boolean(config.stripe_enabled);
    const demoAllowed =
      !stripeMode || String(config.demo_checkout_enabled) === 'true';

    document.getElementById('modePill').textContent = stripeMode ? 'Stripe actif' : 'Mode démo';
    document.getElementById('productId').value = currentProduct.id;
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
      ibanInput.value = '';
    } else {
      ibanBlock.hidden = false;
      ibanInput.setAttribute('required', 'required');
    }

    if (currentProduct.deciplus_total_note) {
      const note = document.createElement('div');
      note.className = 'info-box';
      note.textContent =
        currentProduct.deciplus_total_note + ' — Stripe encaisse : ' + currentProduct.price_label;
      document.querySelector('.summary-panel').appendChild(note);
    }

    renderBadgeFeeNotice(currentProduct);

    if (!currentProduct.requires_payment) {
      setPayButtons({ free: true });
    } else if (stripeMode) {
      setPayButtons({ stripe: true, demo: demoAllowed });
    } else {
      setPayButtons({ demo: true });
    }
  } catch (err) {
    showMsg('Impossible de charger l\'offre — rechargez la page.', false);
  } finally {
    catalogLoading = false;
  }
}

async function submitCheckout(endpoint) {
  if (catalogLoading || !currentProduct) {
    showMsg('Chargement en cours… patientez une seconde.', false);
    return;
  }

  const form = document.getElementById('checkoutForm');
  if (!form.reportValidity()) return;

  const body = formData(form);
  body.product_id = currentProduct.id;
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
  if (!currentProduct) {
    showMsg('Offre non chargée — rechargez la page.', false);
    return;
  }

  const submitterId = e.submitter?.id || '';

  if (!currentProduct.requires_payment || submitterId === 'payFreeBtn') {
    submitCheckout('/api/checkout/create-session');
    return;
  }
  if (submitterId === 'payDemoBtn') {
    submitCheckout('/api/checkout/demo');
    return;
  }
  if (stripeMode) {
    submitCheckout('/api/checkout/create-session');
    return;
  }
  submitCheckout('/api/checkout/demo');
});

document.getElementById('payDemoBtn').addEventListener('click', () => {
  submitCheckout('/api/checkout/demo');
});

init();
