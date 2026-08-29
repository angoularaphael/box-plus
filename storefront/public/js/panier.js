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
    { value: 'Toulouse St-Cyprien', label: 'Toulouse St-Cyprien' },
    { value: 'Barrière de Paris - Minimes', label: 'Barrière de Paris - Minimes' },
    { value: 'Ramonville', label: 'Ramonville' },
    { value: 'Portet-sur-Garonne', label: 'Portet-sur-Garonne' },
    { value: 'États-Unis', label: 'États-Unis' },
  ];

  let catalogProducts = [];

  async function loadCatalog() {
    try {
      const res = await fetch('/api/materiel');
      const data = await res.json();
      catalogProducts = data.products || [];
    } catch {
      catalogProducts = [];
    }
  }

  function gymsForCart(lines) {
    const lists = lines
      .map((l) => catalogProducts.find((p) => p.id === l.product_id))
      .filter(Boolean)
      .map((p) => p.pickup_gyms)
      .filter((g) => Array.isArray(g) && g.length);
    if (!lists.length) return GYMS.map((g) => g.value);
    return lists.reduce((acc, list) => acc.filter((g) => list.includes(g)));
  }

  function fillPickup(lines) {
    const gyms = gymsForCart(lines);
    const sameDay = lines.some((l) => {
      const p = catalogProducts.find((x) => x.id === l.product_id);
      return p && p.pickup_same_day;
    });
    if (!gyms.length) {
      pickupSelect.innerHTML =
        '<option value="">Impossible — articles incompatibles pour un même retrait</option>';
      pickupSelect.disabled = true;
      return;
    }
    if (gyms.length === 1) {
      const hint = sameDay ? ' (jour même)' : ' (sous 48h)';
      pickupSelect.innerHTML = `<option value="${gyms[0]}" selected>${gyms[0]}${hint}</option>`;
      pickupSelect.disabled = true;
      return;
    }
    pickupSelect.disabled = false;
    pickupSelect.innerHTML =
      '<option value="">Choisir une salle</option>' +
      gyms.map((g) => `<option value="${g}">${g}${sameDay ? '' : ' — sous 48h'}</option>`).join('');
  }

  function render() {
    const lines = window.BCCart.read();
    fillPickup(lines);
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
      pickup_gym: pickupSelect.disabled && pickupSelect.value
        ? pickupSelect.value
        : fd.get('pickup_gym'),
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
      if (data.payment_id) {
        try {
          sessionStorage.setItem('bc_materiel_payplug_id', data.payment_id);
        } catch {
          /* ignore */
        }
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
      btn.textContent = 'Payer';
    }
  });

  window.addEventListener('bccart:change', render);
  loadCatalog().then(render);
})();
