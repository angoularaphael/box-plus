/**
 * Snippet à coller dans le thème PrestaShop (checkout).
 * Envoie salle + IBAN au bridge BOXPLUS avant validation commande.
 *
 * Configurer dans le thème :
 *   window.BOXPLUS_BRIDGE_URL = 'https://votre-bridge.example.com';
 *   window.BOXPLUS_BRIDGE_SECRET = '...'; // même secret que BRIDGE_SECRET
 */
(function () {
  const BRIDGE = window.BOXPLUS_BRIDGE_URL || 'https://box-plus.vercel.app';
  const SECRET = window.BOXPLUS_BRIDGE_SECRET || '';

  if (!BRIDGE) return;

  const GYMS = [
    { value: 'st-cyprien', label: 'St-Cyprien' },
    { value: 'minimes', label: 'Minimes' },
    { value: 'ramonville', label: 'Ramonville' },
    { value: 'portet', label: 'Portet' },
    { value: 'etats-unis', label: 'États-Unis' },
    { value: 'balma', label: 'Balma' },
  ];

  function hmacSha256Hex(secret, body) {
    // Le thème peut appeler le bridge sans signature si SECRET vide (dev local).
    return null;
  }

  async function pushCheckout(payload) {
    const body = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    if (SECRET && window.crypto && window.crypto.subtle) {
      try {
        const enc = new TextEncoder();
        const key = await window.crypto.subtle.importKey(
          'raw',
          enc.encode(SECRET),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const sig = await window.crypto.subtle.sign('HMAC', key, enc.encode(body));
        headers['X-Boxplus-Signature'] = Array.from(new Uint8Array(sig))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      } catch (_) {
        /* signature optionnelle côté navigateur */
      }
    }

    const res = await fetch(`${BRIDGE.replace(/\/$/, '')}/bridge/prestashop/checkout`, {
      method: 'POST',
      headers,
      body,
      credentials: 'omit',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function getCartId() {
    if (window.prestashop && prestashop.cart && prestashop.cart.id) {
      return prestashop.cart.id;
    }
    const el = document.querySelector('[name="id_cart"]');
    return el ? el.value : null;
  }

  function injectFields(container) {
    if (!container || document.getElementById('boxplus-checkout-fields')) return;

    const wrap = document.createElement('div');
    wrap.id = 'boxplus-checkout-fields';
    wrap.innerHTML = `
      <div class="form-group">
        <label for="boxplus-gym">Salle *</label>
        <select id="boxplus-gym" required>
          <option value="">Choisir une salle</option>
          ${GYMS.map((g) => `<option value="${g.value}">${g.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="boxplus-iban">IBAN (prélèvement)</label>
        <input id="boxplus-iban" type="text" placeholder="FR76..." autocomplete="off" />
      </div>
      <div class="form-group">
        <label for="boxplus-birthdate">Date de naissance</label>
        <input id="boxplus-birthdate" type="date" />
      </div>
      <div class="form-group">
        <label for="boxplus-gender">Sexe</label>
        <select id="boxplus-gender">
          <option value="">—</option>
          <option value="M">Homme</option>
          <option value="F">Femme</option>
        </select>
      </div>
    `;
    container.prepend(wrap);
  }

  async function syncToBridge() {
    const cartId = getCartId();
    const gym = document.getElementById('boxplus-gym')?.value;
    if (!cartId || !gym) return;

    await pushCheckout({
      cart_id: cartId,
      gym,
      iban: document.getElementById('boxplus-iban')?.value || null,
      birthdate: document.getElementById('boxplus-birthdate')?.value || null,
      gender: document.getElementById('boxplus-gender')?.value || null,
    });
  }

  function init() {
    const checkout =
      document.querySelector('#checkout-personal-information-step') ||
      document.querySelector('.checkout-step') ||
      document.querySelector('#order');
    injectFields(checkout);

    document.addEventListener('change', (ev) => {
      if (ev.target.closest('#boxplus-checkout-fields')) {
        syncToBridge().catch(console.warn);
      }
    });

    const form = document.querySelector('#checkout-form') || document.querySelector('form[name="checkout"]');
    if (form) {
      form.addEventListener('submit', () => {
        syncToBridge().catch(console.warn);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
