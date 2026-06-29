(function () {
  const emptyEl = document.getElementById('cartEmpty');
  const contentEl = document.getElementById('cartContent');
  const linesEl = document.getElementById('cartLines');
  const totalEl = document.getElementById('cartTotal');
  const form = document.getElementById('checkoutForm');
  const errorEl = document.getElementById('checkoutError');
  const pickupSelect = document.getElementById('pickupGym');

  function A(path) {
    return window.BCPaths?.asset(path) || path.replace(/^\//, '');
  }

  const GYMS = [
    'Toulouse St-Cyprien',
    'Barrière de Paris - Minimes',
    'Balma-Gramont',
    'Ramonville',
    'Portet-sur-Garonne',
  ];

  pickupSelect.innerHTML =
    '<option value="">Choisir une salle</option>' +
    GYMS.map((g) => `<option value="${g}">${g}</option>`).join('');

  function render() {
    const lines = window.BCCart.read();
    if (!lines.length) {
      emptyEl.hidden = false;
      contentEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    contentEl.hidden = false;
    totalEl.textContent = window.BCCart.formatCents(window.BCCart.totalCents());

    linesEl.innerHTML = lines
      .map(
        (l) => `
      <div class="cart-line card-panel">
        ${l.image ? `<img src="${A(l.image)}" alt="" class="cart-line-img" />` : '<div class="cart-line-img placeholder"></div>'}
        <div class="cart-line-info">
          <strong>${l.name}</strong>
          ${l.variant_label ? `<div class="cart-line-variant">${l.variant_label}</div>` : ''}
          <div class="materiel-price">${window.BCCart.formatCents(l.price_cents * l.qty)}</div>
        </div>
        <div class="cart-line-qty">
          <button type="button" data-action="minus" data-id="${l.product_id}" data-variant="${l.variant_id || ''}">−</button>
          <span>${l.qty}</span>
          <button type="button" data-action="plus" data-id="${l.product_id}" data-variant="${l.variant_id || ''}">+</button>
        </div>
        <button type="button" class="cart-remove" data-id="${l.product_id}" data-variant="${l.variant_id || ''}" aria-label="Retirer">×</button>
      </div>`
      )
      .join('');

    linesEl.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const variant = btn.dataset.variant || null;
        const line = lines.find(
          (l) => l.product_id === id && String(l.variant_id || '') === String(variant || '')
        );
        if (!line) return;
        const next = btn.dataset.action === 'plus' ? line.qty + 1 : line.qty - 1;
        window.BCCart.setQty(id, variant, next);
        render();
      });
    });

    linesEl.querySelectorAll('.cart-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.BCCart.remove(btn.dataset.id, btn.dataset.variant || null);
        render();
      });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const fd = new FormData(form);
    const customer = {
      first_name: fd.get('first_name'),
      last_name: fd.get('last_name'),
      email: fd.get('email'),
      phone: fd.get('phone'),
      pickup_gym: fd.get('pickup_gym'),
    };
    const lines = window.BCCart.read().map((l) => ({
      product_id: l.product_id,
      variant_id: l.variant_id,
      qty: l.qty,
    }));

    const btn = document.getElementById('checkoutBtn');
    btn.disabled = true;
    btn.textContent = 'Redirection…';

    try {
      const res = await fetch('/api/cart/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, customer }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error((data.errors || [data.error]).join(', '));
      }
      if (data.mode === 'demo' || data.redirect) {
        window.BCCart.clear();
        location.href = data.redirect || data.url;
        return;
      }
      if (data.url) {
        window.BCCart.clear();
        location.href = data.url;
        return;
      }
      throw new Error('Réponse checkout invalide');
    } catch (err) {
      errorEl.textContent = err.message || 'Erreur de paiement';
      errorEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Payer par carte';
    }
  });

  window.addEventListener('bccart:change', render);
  render();
})();
