(function () {
  const gymSelect = document.getElementById('c_gym');
  const currentSelect = document.getElementById('c_current');
  const targetSelect = document.getElementById('c_target');
  const gymList = document.getElementById('gymList');
  const changeMsg = document.getElementById('changeMsg');
  const changeForm = document.getElementById('changeForm');
  const chatWidget = document.getElementById('chatWidget');
  const chatFab = document.getElementById('chatFab');

  const GYMS = [
    { id: 'minimes', label: 'Minimes', address: '12 rue de Fenouillet, 31200 Toulouse' },
    { id: 'ramonville', label: 'Ramonville', address: '33 rue des Ormes, 31530 Ramonville' },
    { id: 'portet', label: 'Portet', address: 'Portet-sur-Garonne' },
    { id: 'etats-unis', label: 'États-Unis', address: '388 avenue des États-Unis, 31200 Toulouse' },
    { id: 'st-cyprien', label: 'St-Cyprien', address: '11 Rue Sainte-Lucie, 31300 Toulouse' },
  ];

  const FIELD_LABELS = {
    last_name: 'Nom',
    first_name: 'Prénom',
    phone: 'Téléphone',
    birthdate: 'Date de naissance',
  };

  const changeRateHint = document.getElementById('changeRateHint');

  function cleanChangeReturnUrl() {
    try {
      const url = new URL(window.location.href);
      ['change', 'paypal_return', 'payplug_return', 'payment_id', 'paypal_order_id', 'token', 'PayerID', 'session_id'].forEach(
        (k) => url.searchParams.delete(k)
      );
      if (url.hash === '#changer') url.hash = '';
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    } catch {
      /* ignore */
    }
  }

  function rateLimitLine(data, { onlyOnFail = true } = {}) {
    if (!data) return '';
    if (data.code === 'rate_limited' || data.locked) {
      return data.message || data.error || 'Trop de tentatives. Réessayez plus tard.';
    }
    // Quota restant : uniquement après un échec (mismatch / erreur), pas après succès
    if (onlyOnFail && data.ok === true && !data.failed) return '';
    const remaining =
      typeof data.rate_limit_remaining === 'number'
        ? data.rate_limit_remaining
        : typeof data.remaining === 'number'
          ? data.remaining
          : null;
    if (remaining == null) return '';
    const max = data.max_attempts || 5;
    return `Tentatives restantes : ${remaining} sur ${max}.`;
  }

  function setChangeRateHint(data, { failed = false } = {}) {
    if (!changeRateHint) return;
    const locked = Boolean(data?.locked || data?.code === 'rate_limited');
    if (!failed && !locked) {
      changeRateHint.hidden = true;
      changeRateHint.textContent = '';
      return;
    }
    const show = rateLimitLine({ ...data, failed: true }, { onlyOnFail: false });
    if (!show) {
      changeRateHint.hidden = true;
      changeRateHint.textContent = '';
      return;
    }
    changeRateHint.hidden = false;
    changeRateHint.textContent = show;
    changeRateHint.className = 'form-hint form-hint--warn';
  }

  async function refreshChangeRateHint(body, { failed = false } = {}) {
    if (!body?.first_name || !body?.last_name || !body?.birthdate) return;
    if (!body.email && !body.phone) return;
    try {
      const res = await fetch('/api/membership/rate-limit-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, scope: 'change' }),
      });
      const data = await res.json();
      if (data.locked || data.code === 'rate_limited') {
        setChangeRateHint(data, { failed: true });
      } else if (failed) {
        setChangeRateHint(data, { failed: true });
      } else {
        setChangeRateHint(null);
      }
    } catch {
      /* ignore */
    }
  }

  function bindChangeRateWatchers() {
    // Pas d’affichage proactif du quota : seulement après échec / lock
  }

  gymList.innerHTML = GYMS.map(
    (g) =>
      `<li class="manage-gym-item"><strong>${g.label}</strong><span>${g.address}</span></li>`
  ).join('');

  gymSelect.innerHTML = GYMS.map((g) => `<option value="${g.id}">${g.label}</option>`).join('');

  function clearFormErrors(form) {
    form?.querySelectorAll('.field-error').forEach((el) => el.classList.remove('field-error'));
  }

  function markFormErrors(form, fields) {
    (fields || []).forEach((name) => {
      const input = form?.querySelector(`[name="${name}"]`);
      if (input) input.classList.add('field-error');
    });
  }

  async function pollIdentityStatus(orderId, { maxWaitMs = 90000 } = {}) {
    const startedAt = Date.now();
    let delay = 250;
    while (Date.now() - startedAt < maxWaitMs) {
      try {
        const r = await fetch(`/api/membership/cancel-status?order=${encodeURIComponent(orderId)}`);
        const s = await r.json();
        if (s.ok && (s.status === 'mismatch' || s.status === 'verified' || s.status === 'done')) {
          return s;
        }
        if (s.ok && (s.status === 'error' || s.status === 'manual_review')) {
          return s;
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(1000, Math.round(delay * 1.2));
    }
    return { ok: false, status: 'timeout', mismatch_fields: [] };
  }

  function showConfirmBox({
    title = 'Félicitations !',
    lead = '',
    cta = 'Continuer',
    id = 'manageConfirmBox',
  } = {}) {
    if (document.getElementById(id)) return;
    const root = document.createElement('div');
    root.id = id;
    root.className = 'change-congrats';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', `${id}Title`);
    root.innerHTML = `
      <div class="change-congrats__panel">
        <button type="button" class="change-congrats__close" data-congrats-close aria-label="Fermer">×</button>
        <div class="change-congrats__burst" aria-hidden="true"></div>
        <p class="change-congrats__kicker">Boxing Center</p>
        <h2 class="change-congrats__title" id="${id}Title">${title}</h2>
        <p class="change-congrats__lead">${lead}</p>
        <button type="button" class="btn change-congrats__cta" data-congrats-close>${cta}</button>
      </div>`;
    document.body.appendChild(root);
    document.body.classList.add('change-congrats-lock');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => root.classList.add('is-open'));
    });
    const close = () => {
      root.classList.remove('is-open');
      document.body.classList.remove('change-congrats-lock');
      setTimeout(() => root.remove(), 320);
    };
    root.querySelectorAll('[data-congrats-close]').forEach((el) => {
      el.addEventListener('click', close);
    });
    root.addEventListener('click', (e) => {
      if (e.target === root) close();
    });
    document.addEventListener(
      'keydown',
      function onKey(e) {
        if (e.key === 'Escape') {
          close();
          document.removeEventListener('keydown', onKey);
        }
      },
      { passive: true }
    );
  }

  function showChangeCongrats() {
    showConfirmBox({
      id: 'changeCongrats',
      title: 'Félicitations !',
      lead: 'Votre bascule en abonnement comptant est enregistrée. Elle sera active dans quelques minutes — un e-mail de confirmation suivra.',
      cta: 'Continuer',
    });
  }

  function showCancelCongrats() {
    showConfirmBox({
      id: 'cancelCongrats',
      title: 'Demande enregistrée',
      lead: 'Votre résiliation est prise en charge. Elle sera effective sous 72 heures — une confirmation vous sera envoyée par e-mail.',
      cta: 'Compris',
    });
  }

  function openChat() {
    chatWidget.hidden = false;
    chatFab.hidden = true;
    const root = document.getElementById('counselorRoot');
    if (!root.dataset.ready) {
      root.dataset.ready = '1';
      window.BCCounselor.render(root, async (formData, msgEl) => {
        const form = root.querySelector('#cancelForm');
        const submitBtn = form?.querySelector('button[type="submit"]');

        const clearErrors = () => clearFormErrors(form);
        const markErrors = (fields) => markFormErrors(form, fields);
        const setWaiting = (text) => {
          msgEl.hidden = false;
          msgEl.className = 'form-msg';
          msgEl.innerHTML = `<span class="cancel-spinner" aria-hidden="true"></span> ${text}`;
        };

        clearErrors();
        if (submitBtn) submitBtn.disabled = true;
        setWaiting('Envoi de la demande…');

        let data = {};
        try {
          const res = await fetch('/api/membership/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
          });
          data = await res.json();
        } catch {
          data = {};
        }
        if (!data.ok) {
          if (submitBtn) submitBtn.disabled = false;
          const limitLine = rateLimitLine({ ...data, failed: true }, { onlyOnFail: false });
          msgEl.textContent = [data.error, limitLine].filter(Boolean).join(' ')
            || "Je suis désolé, mais nous n'avons pas pu trouver d'abonnement correspondant à ces informations.";
          msgEl.className = 'form-msg err';
          return;
        }

        setWaiting('Vérification de vos informations sur votre fiche adhérent… Merci de patienter.');
        const s = await pollIdentityStatus(data.order_id);
        if (s.ok && s.status === 'mismatch') {
          clearErrors();
          const fields = Array.isArray(s.mismatch_fields) ? s.mismatch_fields : [];
          markErrors(fields);
          const labels = fields.map((f) => FIELD_LABELS[f]).filter(Boolean);
          const left = rateLimitLine(
            { ...data, failed: true, rate_limit_remaining: data.rate_limit_remaining },
            { onlyOnFail: false }
          );
          msgEl.textContent = [
            labels.length
              ? `Ces informations ne correspondent pas à votre fiche adhérent : ${labels.join(', ')}. Corrigez les champs en rouge puis renvoyez la demande.`
              : 'Nous n’avons pas trouvé de fiche adhérent correspondant à ces informations. Vérifiez téléphone, nom, prénom et date de naissance, puis renvoyez la demande.',
            left,
          ]
            .filter(Boolean)
            .join(' ');
          msgEl.className = 'form-msg err';
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        // Dès que l’identité est OK (verified) — pas besoin d’attendre la fin Deciplus
        if (s.ok && (s.status === 'verified' || s.status === 'done')) {
          msgEl.innerHTML =
            '<strong>Votre résiliation sera traitée.</strong><br/>Les informations correspondent : la demande est prise en charge. Elle sera effective sous 72 heures ; une confirmation vous sera envoyée par e-mail.';
          msgEl.className = 'form-msg';
          if (submitBtn) submitBtn.disabled = false;
          showCancelCongrats();
          return;
        }
        if (s.ok && (s.status === 'error' || s.status === 'manual_review')) {
          msgEl.textContent =
            'La vérification automatique n’a pas pu aboutir. Votre demande est enregistrée ; un responsable va la contrôler.';
          msgEl.className = 'form-msg err';
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        msgEl.innerHTML =
          '<strong>Votre résiliation sera traitée.</strong><br/>Demande bien reçue. Notre équipe la finalise et vous enverra une confirmation par e-mail.';
        msgEl.className = 'form-msg';
        if (submitBtn) submitBtn.disabled = false;
        showCancelCongrats();
      });
    }
  }

  function closeChat() {
    chatWidget.hidden = true;
    chatFab.hidden = false;
  }

  document.getElementById('openCounselor').onclick = openChat;
  chatFab.onclick = openChat;
  document.getElementById('closeCounselor').onclick = closeChat;

  async function loadOptions() {
    const res = await fetch('/api/membership/options');
    const data = await res.json();
    if (!data.ok) return;
    currentSelect.innerHTML = (data.current_plans || [])
      .filter((p) => !/promo/i.test(String(p.id || '')) && !/promo/i.test(String(p.label || '')))
      .map((p) => `<option value="${p.id}">${p.label}</option>`)
      .join('');
    targetSelect.innerHTML = (data.comptant_targets || [])
      .map(
        (p) =>
          `<option value="${p.id}">${p.name}${p.price_label ? ` — ${p.price_label}` : ''}</option>`
      )
      .join('');
  }

  const changePayPanel = document.getElementById('changePayPanel');
  const changePayLead = document.getElementById('changePayLead');
  const changePayBtn = document.getElementById('changePayBtn');
  const changePayBack = document.getElementById('changePayBack');
  let changeCheckoutBody = null;
  let changeProductSummary = null;

  function showChangePayStep({ body, product, verifyOrderId }) {
    changeCheckoutBody = {
      ...body,
      verify_order_id: verifyOrderId,
    };
    changeProductSummary = product || null;
    const label =
      product?.price_label ||
      (product?.price_cents != null ? `${(Number(product.price_cents) / 100).toFixed(2).replace('.', ',')} €` : '');
    const name = product?.name || targetSelect?.selectedOptions?.[0]?.textContent || 'abonnement comptant';
    changePayLead.textContent = label
      ? `Identité confirmée. Montant à régler : ${label} (${name}). Choisissez PayPlug (carte) ou PayPal.`
      : `Identité confirmée. Choisissez PayPlug (carte) ou PayPal pour finaliser le passage en comptant.`;
    changeForm.hidden = true;
    changePayPanel.hidden = false;
    changeMsg.hidden = false;
    changeMsg.className = 'form-msg';
    changeMsg.textContent = 'Identité confirmée — choisissez votre mode de paiement ci-dessous.';
    changePayPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function backToChangeForm() {
    changePayPanel.hidden = true;
    changeForm.hidden = false;
    changeCheckoutBody = null;
    changeProductSummary = null;
    changeMsg.hidden = true;
    const submitBtn = changeForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = false;
  }

  async function startChangePayment(paymentMethod) {
    if (!changeCheckoutBody) {
      changeMsg.hidden = false;
      changeMsg.className = 'form-msg err';
      changeMsg.textContent = 'Recommencez la vérification de vos informations.';
      return;
    }
    changePayBtn.disabled = true;
    changeMsg.hidden = false;
    changeMsg.className = 'form-msg';
    changeMsg.innerHTML =
      '<span class="cancel-spinner" aria-hidden="true"></span> Ouverture du paiement…';
    try {
      const res = await fetch('/api/membership/change/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...changeCheckoutBody,
          payment_method: paymentMethod,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        changeMsg.textContent =
          data.error === 'paypal_not_configured'
            ? 'PayPal temporairement indisponible. Choisissez la carte.'
            : data.error === 'payplug_not_configured'
              ? 'Paiement carte temporairement indisponible. Essayez PayPal.'
              : data.error || 'Erreur';
        changeMsg.className = 'form-msg err';
        changePayBtn.disabled = false;
        return;
      }
      if (data.payment_id) {
        sessionStorage.setItem('bc_change_payplug_id', data.payment_id);
        sessionStorage.removeItem('bc_change_paypal_id');
      }
      if (data.paypal_order_id) {
        sessionStorage.setItem('bc_change_paypal_id', data.paypal_order_id);
        sessionStorage.removeItem('bc_change_payplug_id');
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      changeMsg.textContent = 'URL de paiement manquante';
      changeMsg.className = 'form-msg err';
      changePayBtn.disabled = false;
    } catch {
      changeMsg.textContent = 'Erreur de connexion au paiement';
      changeMsg.className = 'form-msg err';
      changePayBtn.disabled = false;
    }
  }

  changeForm.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target).entries());
    const submitBtn = changeForm.querySelector('button[type="submit"]');
    clearFormErrors(changeForm);
    if (submitBtn) submitBtn.disabled = true;
    changeMsg.hidden = false;
    changeMsg.className = 'form-msg';
    changeMsg.innerHTML =
      '<span class="cancel-spinner" aria-hidden="true"></span> Vérification de votre fiche adhérent…';

    let verify = {};
    try {
      const vRes = await fetch('/api/membership/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, verify_mode: 'change' }),
      });
      verify = await vRes.json();
    } catch {
      verify = {};
    }
    if (!verify.ok || !verify.order_id) {
      const limitLine = rateLimitLine({ ...verify, failed: true }, { onlyOnFail: false });
      changeMsg.textContent =
        [verify.error, limitLine].filter(Boolean).join(' ') || 'Vérification impossible';
      changeMsg.className = 'form-msg err';
      setChangeRateHint(verify, { failed: true });
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const status = await pollIdentityStatus(verify.order_id);
    if (status.ok && status.status === 'mismatch') {
      const fields = Array.isArray(status.mismatch_fields) ? status.mismatch_fields : [];
      markFormErrors(changeForm, fields);
      const labels = fields.map((f) => FIELD_LABELS[f]).filter(Boolean);
      const left = rateLimitLine(
        { ...verify, failed: true },
        { onlyOnFail: false }
      );
      changeMsg.textContent = [
        labels.length
          ? `Ces informations ne correspondent pas à votre fiche adhérent : ${labels.join(', ')}. Corrigez les champs en rouge.`
          : 'Nous n’avons pas trouvé de fiche adhérent correspondant à ces informations.',
        left,
      ]
        .filter(Boolean)
        .join(' ');
      changeMsg.className = 'form-msg err';
      setChangeRateHint(verify, { failed: true });
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    if (!(status.ok && status.status === 'verified')) {
      changeMsg.textContent = [
        'La vérification n’a pas pu aboutir. Réessayez ou contactez votre salle.',
        rateLimitLine({ ...verify, failed: true }, { onlyOnFail: false }),
      ]
        .filter(Boolean)
        .join(' ');
      changeMsg.className = 'form-msg err';
      setChangeRateHint(verify, { failed: true });
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const selectedOpt = targetSelect?.selectedOptions?.[0];
    const productHint = {
      id: body.target_product_id,
      name: selectedOpt?.textContent || body.target_product_id,
      price_label: String(selectedOpt?.textContent || '').split('—')[1]?.trim() || '',
    };
    showChangePayStep({
      body,
      product: productHint,
      verifyOrderId: verify.order_id,
    });
    setChangeRateHint(null);
    if (submitBtn) submitBtn.disabled = false;
  };

  changePayBtn?.addEventListener('click', () => {
    const method =
      document.querySelector('input[name="change_pay_method"]:checked')?.value || 'payplug';
    void startChangePayment(method);
  });
  changePayBack?.addEventListener('click', backToChangeForm);

  const params = new URLSearchParams(location.search);
  async function confirmChangePayment() {
    if (params.get('change') !== '1') return;
    const fromPaypal = params.get('paypal_return') === '1';
    const fromPayplug = params.get('payplug_return') === '1';
    const paypalOrderId = fromPaypal
      ? params.get('paypal_order_id') ||
        params.get('token') ||
        sessionStorage.getItem('bc_change_paypal_id') ||
        ''
      : params.get('paypal_order_id') || sessionStorage.getItem('bc_change_paypal_id') || '';
    const paymentId = fromPaypal
      ? ''
      : params.get('payment_id') || sessionStorage.getItem('bc_change_payplug_id') || '';
    const sessionId = fromPaypal || fromPayplug ? '' : params.get('session_id') || '';
    if (!paymentId && !sessionId && !paypalOrderId) {
      // Ancienne URL ?change=1 sans paiement → nettoyer sans popup
      if (!fromPaypal && !fromPayplug) cleanChangeReturnUrl();
      return;
    }
    if (fromPaypal && !paypalOrderId) {
      changeMsg.hidden = false;
      changeMsg.className = 'form-msg err';
      changeMsg.textContent =
        'Retour PayPal incomplet (identifiant manquant). Réessayez le paiement PayPal.';
      return;
    }

    const confirmKey = `bc_change_done_${paymentId || paypalOrderId || sessionId}`;
    if (sessionStorage.getItem(confirmKey) === '1') {
      // Déjà confirmé : pas de popup à chaque refresh
      cleanChangeReturnUrl();
      changeMsg.hidden = false;
      changeMsg.className = 'form-msg';
      changeMsg.textContent =
        'Votre abonnement comptant a déjà été enregistré. Un e-mail de confirmation suivra.';
      return;
    }

    changeMsg.hidden = false;
    changeMsg.textContent = 'Confirmation du paiement…';
    changeMsg.className = 'form-msg';
    try {
      const payload =
        fromPaypal || (!paymentId && paypalOrderId)
          ? { paypal_order_id: paypalOrderId }
          : paymentId
            ? { payment_id: paymentId }
            : { session_id: sessionId };
      const res = await fetch('/api/membership/change/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      changeMsg.className = data.ok ? 'form-msg' : 'form-msg err';
      changeMsg.textContent = data.ok
        ? 'Votre abonnement comptant a bien été enregistré. Il prendra effet dans quelques minutes. Un e-mail de confirmation vous sera envoyé dès que c’est actif.'
        : data.error || 'Confirmation impossible';
      sessionStorage.removeItem('bc_change_payplug_id');
      sessionStorage.removeItem('bc_change_paypal_id');
      document.getElementById('changer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (data.ok) {
        sessionStorage.setItem(confirmKey, '1');
        showChangeCongrats();
        cleanChangeReturnUrl();
      }
    } catch {
      changeMsg.className = 'form-msg err';
      changeMsg.textContent = 'Confirmation impossible';
      document.getElementById('changer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  if (params.get('change') === '1' || params.get('change') === 'cancelled' || location.hash === '#changer') {
    document.getElementById('changer')?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
  if (params.get('change') === 'cancelled') {
    changeMsg.hidden = false;
    changeMsg.className = 'form-msg err';
    changeMsg.textContent = 'Paiement annulé — vous n’avez pas été débité. Vous pouvez réessayer.';
    cleanChangeReturnUrl();
  }

  bindChangeRateWatchers();
  confirmChangePayment().catch(() => {});

  loadOptions().catch(() => {});
})();
