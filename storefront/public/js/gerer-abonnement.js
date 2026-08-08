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
    let delay = 700;
    while (Date.now() - startedAt < maxWaitMs) {
      await new Promise((r) => setTimeout(r, delay));
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
      delay = Math.min(1800, Math.round(delay * 1.25));
    }
    return { ok: false, status: 'timeout', mismatch_fields: [] };
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
          msgEl.textContent =
            data.error ||
            "Je suis désolé, mais nous n'avons pas pu trouver d'abonnement correspondant à ces informations.";
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
          msgEl.textContent = labels.length
            ? `Ces informations ne correspondent pas à votre fiche adhérent : ${labels.join(', ')}. Corrigez les champs en rouge puis renvoyez la demande.`
            : 'Nous n’avons pas trouvé de fiche adhérent correspondant à ces informations. Vérifiez téléphone, nom, prénom et date de naissance, puis renvoyez la demande.';
          msgEl.className = 'form-msg err';
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        if (s.ok && s.status === 'done') {
          msgEl.textContent =
            'Votre résiliation a bien été enregistrée. Elle sera effective sous 72 heures. Une confirmation vous sera envoyée par e-mail.';
          msgEl.className = 'form-msg';
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        if (s.ok && (s.status === 'error' || s.status === 'manual_review')) {
          msgEl.textContent =
            'La vérification automatique n’a pas pu aboutir. Votre demande est enregistrée ; un responsable va la contrôler.';
          msgEl.className = 'form-msg err';
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        msgEl.textContent =
          'Demande bien reçue. Notre équipe traite votre résiliation et vous enverra une confirmation par e-mail.';
        msgEl.className = 'form-msg';
        if (submitBtn) submitBtn.disabled = false;
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
        body: JSON.stringify(body),
      });
      verify = await vRes.json();
    } catch {
      verify = {};
    }
    if (!verify.ok || !verify.order_id) {
      changeMsg.textContent = verify.error || 'Vérification impossible';
      changeMsg.className = 'form-msg err';
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const status = await pollIdentityStatus(verify.order_id);
    if (status.ok && status.status === 'mismatch') {
      const fields = Array.isArray(status.mismatch_fields) ? status.mismatch_fields : [];
      markFormErrors(changeForm, fields);
      const labels = fields.map((f) => FIELD_LABELS[f]).filter(Boolean);
      changeMsg.textContent = labels.length
        ? `Ces informations ne correspondent pas à votre fiche adhérent : ${labels.join(', ')}. Corrigez les champs en rouge.`
        : 'Nous n’avons pas trouvé de fiche adhérent correspondant à ces informations.';
      changeMsg.className = 'form-msg err';
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    if (!(status.ok && status.status === 'verified')) {
      changeMsg.textContent =
        'La vérification n’a pas pu aboutir. Réessayez ou contactez votre salle.';
      changeMsg.className = 'form-msg err';
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    changeMsg.textContent = 'Identité confirmée — redirection vers le paiement…';
    changeMsg.className = 'form-msg';
    try {
      const res = await fetch('/api/membership/change/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, verify_order_id: verify.order_id }),
      });
      const data = await res.json();
      if (!data.ok) {
        changeMsg.textContent = data.error || 'Erreur';
        changeMsg.className = 'form-msg err';
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      changeMsg.textContent = 'Erreur de connexion au paiement';
      changeMsg.className = 'form-msg err';
      if (submitBtn) submitBtn.disabled = false;
    }
  };

  const params = new URLSearchParams(location.search);
  if (params.get('change') === '1' && params.get('session_id')) {
    fetch('/api/membership/change/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: params.get('session_id') }),
    })
      .then((r) => r.json())
      .then((data) => {
        changeMsg.hidden = false;
        changeMsg.className = data.ok ? 'form-msg' : 'form-msg err';
        changeMsg.textContent = data.ok
          ? 'Paiement reçu — votre changement d’abonnement est en cours de traitement.'
          : data.error || 'Confirmation impossible';
      })
      .catch(() => {});
  }

  loadOptions().catch(() => {});
})();
