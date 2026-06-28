async function loadProducts() {
  const res = await fetch('/api/products');
  const data = await res.json();
  const products = data.products || data;
  const grid = document.getElementById('productsGrid');
  grid.innerHTML = '';

  if (data.synced_at) {
    const pill = document.getElementById('statusPill');
    pill.textContent = `Sync Deciplus · ${new Date(data.synced_at).toLocaleString('fr-FR')}`;
  }

  products.forEach((p) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    card.innerHTML = `
      ${p.category ? `<span class="product-tag">${p.category}</span>` : ''}
      ${p.badge ? `<span class="product-tag" style="color:var(--bc-red)">${p.badge}</span>` : ''}
      <h3>${p.tagline || p.name}</h3>
      <div class="product-deciplus">Deciplus : ${p.name}</div>
      <p>${p.description}</p>
      <div class="product-price">${p.price_label}</div>
      ${p.deciplus_total_note ? `<div class="product-note">${p.deciplus_total_note}</div>` : ''}
      ${p.installments_note ? `<div class="product-note">${p.installments_note}</div>` : ''}
      ${p.badge_fee_notice ? `<div class="notice-inline">${p.badge_fee_notice}</div>` : ''}
      <a class="btn" href="/checkout.html?product=${encodeURIComponent(p.id)}">
        ${p.price_cents === 0 ? 'Réserver' : 'Commander'}
      </a>
    `;
    grid.appendChild(card);
  });
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    const pill = document.getElementById('statusPill');
    if (cfg.stripe_enabled) {
      pill.textContent = 'Stripe + BOXPLUS';
    } else {
      pill.textContent = 'Mode démo (sans Stripe)';
      pill.classList.remove('live');
    }
  } catch {
    /* ignore */
  }
}

loadProducts();
loadConfig();
