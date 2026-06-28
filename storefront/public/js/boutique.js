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
      <h3>${p.name}</h3>
      <div class="product-price">${p.price_label}</div>
      ${p.price_subtitle ? `<p class="product-price-sub">${p.price_subtitle}</p>` : ''}
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
    if (cfg.badge_fee_notice) {
      const banner = document.getElementById('badgeInfoBanner');
      const text = document.getElementById('badgeInfoText');
      if (banner && text) {
        text.textContent = cfg.badge_fee_notice;
        banner.hidden = false;
      }
    }
  } catch {
    /* ignore */
  }
}

loadProducts();
loadConfig();
