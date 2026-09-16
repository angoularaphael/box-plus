(function () {
  const emptyEl = document.getElementById('cartEmpty');
  const contentEl = document.getElementById('cartContent');
  const linesEl = document.getElementById('cartLines');
  const totalEl = document.getElementById('cartTotal');
  const form = document.getElementById('checkoutForm');
  const errorEl = document.getElementById('checkoutError');
  const pickupSelect = document.getElementById('pickupGym');
  const scalapayOption = document.getElementById('scalapayOption');
  const scalapayRadio = document.getElementById('payMethodScalapay');
  const scalapayAddress = document.getElementById('scalapayAddress');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const CART_BACKUP_KEY = 'bc-cart-checkout-backup';

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
  let payConfig = {
    scalapay: false,
    scalapay_min_cents: 500,
    scalapay_max_cents: 200000,
  };

  function showError(message) {
    errorEl.textContent = message || 'Erreur de paiement';
    errorEl.hidden = false;
  }

  function selectCardFallback(message) {
    const card = form.querySelector('input[name="payment_method"][value="card"]');
    if (card) card.checked = true;
    syncPayMethodUi(window.BCCart.totalCents());
    if (message) showError(message);
  }

  function backupCart() {
    try {
      sessionStorage.setItem(CART_BACKUP_KEY, JSON.stringify(window.BCCart.read()));
    } catch {
      /* ignore */
    }
  }

  function restoreCartIfNeeded() {
    if (window.BCCart.read().length) return false;
    try {
      const raw = sessionStorage.getItem(CART_BACKUP_KEY);
      if (!raw) return false;
      const lines = JSON.parse(raw);
      if (!Array.isArray(lines) || !lines.length) return false;
      window.BCCart.write
        ? window.BCCart.write(lines)
        : localStorage.setItem('bc-cart', JSON.stringify(lines));
      return true;
    } catch {
      return false;
    }
  }

  function clearCartBackup() {
    try {
      sessionStorage.removeItem(CART_BACKUP_KEY);
    } catch {
      /* ignore */
    }
  }

  async function loadCatalog() {
    try {
      const res = await fetch('/api/materiel');
      const data = await res.json();
      catalogProducts = data.products || [];
    } catch {
      catalogProducts = [];
    }
  }

  async function loadPayConfig() {
    try {
      const res = await fetch('/api/payments/config');
      const data = await res.json();
      if (data && data.ok) {
        payConfig = {
          scalapay: data.scalapay === true,
          scalapay_min_cents: Number(data.scalapay_min_cents) || 500,
          scalapay_max_cents: Number(data.scalapay_max_cents) || 200000,
        };
      }
    } catch {
      /* keep defaults */
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
      const hint = sameDay ? ' (possibilité de retrait dès le jour même)' : ' (sous 48h)';
      pickupSelect.innerHTML = `<option value="${gyms[0]}" selected>${gyms[0]}${hint}</option>`;
      pickupSelect.disabled = true;
      return;
    }
    pickupSelect.disabled = false;
    pickupSelect.innerHTML =
      '<option value="">Choisir une salle</option>' +
      gyms.map((g) => `<option value="${g}">${g}${sameDay ? ' — possibilité de retrait dès le jour même' : ' — sous 48h'}</option>`).join('');
  }

  function selectedPayMethod() {
    return form.querySelector('input[name="payment_method"]:checked')?.value || 'card';
  }

  function scalapayEligible(totalCents) {
    return (
      payConfig.scalapay === true &&
      totalCents >= payConfig.scalapay_min_cents &&
      totalCents <= payConfig.scalapay_max_cents
    );
  }

  function syncPayMethodUi(totalCents) {
    const eligible = scalapayEligible(totalCents);
    if (scalapayOption) scalapayOption.hidden = !eligible;
    if (scalapayRadio) {
      scalapayRadio.disabled = !eligible;
      if (!eligible && scalapayRadio.checked) {
        const card = form.querySelector('input[name="payment_method"][value="card"]');
        if (card) card.checked = true;
      }
    }
    const useScalapay = eligible && selectedPayMethod() === 'scalapay';
    if (scalapayAddress) scalapayAddress.hidden = !useScalapay;
    const gender = document.getElementById('scalapayGender');
    const address1 = document.getElementById('scalapayAddress1');
    const postcode = document.getElementById('scalapayPostcode');
    const city = document.getElementById('scalapayCity');
    [gender, address1, postcode, city].forEach((el) => {
      if (!el) return;
      el.required = useScalapay;
    });
    if (checkoutBtn) {
      checkoutBtn.textContent = useScalapay ? 'Payer avec Scalapay' : 'Payer par carte';
    }
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
    const totalCents = window.BCCart.totalCents();
    totalEl.textContent = window.BCCart.formatCents(totalCents);
    syncPayMethodUi(totalCents);

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

  form.addEventListener('change', (e) => {
    if (e.target && e.target.name === 'payment_method') {
      syncPayMethodUi(window.BCCart.totalCents());
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const fd = new FormData(form);
    const payMethod = selectedPayMethod();
    const customer = {
      first_name: fd.get('first_name'),
      last_name: fd.get('last_name'),
      email: fd.get('email'),
      phone: fd.get('phone'),
      pickup_gym: pickupSelect.disabled && pickupSelect.value
        ? pickupSelect.value
        : fd.get('pickup_gym'),
    };
    if (payMethod === 'scalapay') {
      customer.gender = fd.get('gender') || '';
      customer.address = fd.get('address') || '';
      customer.postal_code = fd.get('postal_code') || '';
      customer.city = fd.get('city') || '';
    }
    const lines = window.BCCart.read().map((l) => ({
      product_id: l.product_id,
      variant_id: l.variant_id,
      qty: l.qty,
    }));

    const btn = document.getElementById('checkoutBtn');
    btn.disabled = true;
    btn.textContent = 'Redirection…';

    try {
      backupCart();
      const res = await fetch('/api/cart/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines,
          customer,
          payment_method: payMethod === 'scalapay' ? 'scalapay' : 'card',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const msg = (data.errors || [data.error]).filter(Boolean).join(', ');
        if (data.suggest_card || data.code === 'scalapay_create_failed' || data.code === 'scalapay_unavailable') {
          selectCardFallback(
            msg ||
              'Scalapay n’a pas pu démarrer. Choisissez « Carte bancaire » pour payer en une fois.'
          );
          btn.disabled = false;
          return;
        }
        throw new Error(msg || 'Erreur de paiement');
      }
      if (data.payment_id) {
        try {
          sessionStorage.setItem('bc_materiel_payplug_id', data.payment_id);
        } catch {
          /* ignore */
        }
      }
      if (data.mode === 'demo' || data.redirect) {
        clearCartBackup();
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
      showError(err.message || 'Erreur de paiement');
      btn.disabled = false;
      syncPayMethodUi(window.BCCart.totalCents());
    }
  });

  function handleReturnParams() {
    const params = new URLSearchParams(location.search);
    if (params.get('cancelled') === '1') {
      restoreCartIfNeeded();
      const reason = params.get('reason') || '';
      selectCardFallback(
        reason === 'scalapay'
          ? 'Paiement Scalapay annulé ou refusé. Vous pouvez payer par carte bancaire en une fois.'
          : 'Paiement annulé. Vous pouvez réessayer par carte bancaire.'
      );
      history.replaceState({}, '', '/panier');
    }
    if (params.get('pay') === 'card') {
      restoreCartIfNeeded();
      selectCardFallback('Réglez maintenant par carte bancaire en une fois.');
      history.replaceState({}, '', '/panier');
    }
  }

  window.addEventListener('bccart:change', render);
  Promise.all([loadCatalog(), loadPayConfig()]).then(() => {
    handleReturnParams();
    render();
  });
})();
