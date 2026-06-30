(function () {
  const params = new URLSearchParams(window.location.search);
  const STORAGE_KEY = 'bc_inscription_progress';
  const STORAGE_TTL_MS = 48 * 60 * 60 * 1000;

  const state = {
    productId: params.get('product'),
    orderId: params.get('order'),
    token: params.get('token'),
    sessionId: params.get('session_id'),
    step: Number(params.get('step') || 1),
    product: null,
    order: null,
    config: null,
    shortDraft: null,
  };

  const stepContent = document.getElementById('stepContent');
  const formMsg = document.getElementById('formMsg');

  function setMsg(text, type) {
    formMsg.textContent = text || '';
    formMsg.className = 'form-msg' + (type ? ` ${type}` : '');
  }

  function saveProgress() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          productId: state.productId,
          orderId: state.orderId,
          token: state.token,
          sessionId: state.sessionId,
          step: state.step,
          shortDraft: state.shortDraft,
          savedAt: Date.now(),
        })
      );
    } catch {
      /* quota / mode privé */
    }
  }

  function restoreProgress() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved.savedAt || Date.now() - saved.savedAt > STORAGE_TTL_MS) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      if (saved.productId && (!state.productId || state.productId === saved.productId)) {
        state.productId = saved.productId;
      }
      if (saved.orderId) state.orderId = state.orderId || saved.orderId;
      if (saved.token) state.token = state.token || saved.token;
      if (saved.sessionId) state.sessionId = state.sessionId || saved.sessionId;
      if (saved.shortDraft) state.shortDraft = saved.shortDraft;
      if (!params.get('step') && saved.step > 1) {
        state.step = Math.max(state.step, saved.step);
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  function clearProgress() {
    sessionStorage.removeItem(STORAGE_KEY);
  }

  function syncUrl() {
    const qs = new URLSearchParams();
    if (state.productId) qs.set('product', state.productId);
    if (state.orderId) qs.set('order', state.orderId);
    if (state.token) qs.set('token', state.token);
    if (state.sessionId) qs.set('session_id', state.sessionId);
    qs.set('step', String(state.step));
    const next = `?${qs}`;
    if (window.location.search !== next) {
      history.replaceState(null, '', next);
    }
  }

  function stepFromOrder(order) {
    if (!order) return state.step;
    if (order.step >= 6) return 6;
    if (order.step >= 5) return 5;
    if (order.step >= 4 || order.payment?.status === 'paid') return 4;
    if (order.order_id) return 3;
    return 2;
  }

  function persistAndRender() {
    saveProgress();
    syncUrl();
    render();
  }

  function updateStepper(step) {
    document.querySelectorAll('.stepper-step').forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle('active', s === step);
      el.classList.toggle('done', s < step);
    });
  }

  function gymsOptions() {
    return `
      <option value="">Choisir une salle</option>
      <option value="minimes">Minimes</option>
      <option value="ramonville">Ramonville</option>
      <option value="etats-unis">États-Unis</option>
      <option value="st-cyprien">Saint-Cyprien</option>
      <option value="portet">Portet</option>`;
  }

  async function loadConfig() {
    const res = await fetch('/api/config');
    state.config = await res.json();
  }

  async function loadProduct() {
    if (!state.productId) return;
    const res = await fetch('/api/products');
    const data = await res.json();
    state.product = (data.products || []).find((p) => p.id === state.productId);
  }

  async function loadOrder() {
    if (!state.orderId || !state.token) return false;
    const qs = new URLSearchParams({ token: state.token });
    if (state.sessionId) qs.set('session_id', state.sessionId);
    const res = await fetch(`/api/orders/${state.orderId}?${qs}`);
    if (!res.ok) return false;
    const data = await res.json();
    state.order = data.order;
    state.product = state.order.product_snapshot;
    if (!state.productId && state.product?.id) state.productId = state.product.id;
    state.step = stepFromOrder(state.order);
    return true;
  }

  function orderErrorMessage(data) {
    if (data.error === 'not_found') {
      return 'Dossier introuvable. Rechargez la page depuis le lien reçu après paiement, ou contactez le club.';
    }
    return (data.errors || [data.error]).join(', ');
  }

  function bindShortDraftAutosave(form) {
    let timer;
    const capture = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.shortDraft = Object.fromEntries(new FormData(form).entries());
        saveProgress();
      }, 400);
    };
    form.querySelectorAll('input').forEach((el) => {
      el.addEventListener('input', capture);
      el.addEventListener('change', capture);
    });
  }

  function renderStep1() {
    const p = state.product;
    if (!p) {
      stepContent.innerHTML = '<p>Produit introuvable. <a href="/abonnements">Voir les offres</a></p>';
      return;
    }
    stepContent.innerHTML = `
      <h1>Votre offre</h1>
      <p class="sub">Vérifiez votre choix avant de continuer.</p>
      <div class="offer-card" style="margin-bottom:24px">
        <h3>${p.display_name || p.name}</h3>
        <div class="offer-price">${p.stripe_price_label || p.price_label}</div>
        ${p.installments_note ? `<p class="offer-price-sub">${p.installments_note}</p>` : ''}
      </div>
      <div class="info-box">Nos cours sont accessibles aux débutants. L'ambiance est bienveillante et motivante.</div>
      <button type="button" class="btn block" id="toStep2">Commencer l'inscription</button>`;
    document.getElementById('toStep2').onclick = () => {
      state.step = 2;
      persistAndRender();
    };
  }

  function renderStep2() {
    const short = state.order?.customer_short || state.shortDraft || {};
    stepContent.innerHTML = `
      <h1>Vos coordonnées</h1>
      <p class="sub">Quelques informations pour préparer votre inscription — rien de plus pour l'instant.</p>
      <form id="shortForm" class="form-grid">
        <div><label for="first_name">Prénom *</label><input id="first_name" name="first_name" required value="${short.first_name || ''}" /></div>
        <div><label for="last_name">Nom *</label><input id="last_name" name="last_name" required value="${short.last_name || ''}" /></div>
        <div class="full"><label for="email">Email *</label><input id="email" name="email" type="email" required value="${short.email || ''}" /></div>
        <div class="full"><label for="phone">Téléphone *</label><input id="phone" name="phone" type="tel" required value="${short.phone || ''}" /></div>
        <div class="full"><label for="birthdate">Date de naissance *</label><input id="birthdate" name="birthdate" type="date" required value="${short.birthdate || ''}" /></div>
        <div class="full"><button type="submit" class="btn block">Continuer vers le paiement</button></div>
      </form>`;
    const form = document.getElementById('shortForm');
    bindShortDraftAutosave(form);
    form.onsubmit = async (e) => {
      e.preventDefault();
      setMsg('Envoi…');
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.product_id = state.productId;
      state.shortDraft = body;
      saveProgress();
      const res = await fetch('/api/orders/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg((data.errors || [data.error]).join(', '), 'err');
        return;
      }
      state.orderId = data.order_id;
      state.token = data.access_token;
      state.step = 3;
      state.shortDraft = null;
      setMsg('');
      saveProgress();
      syncUrl();
      await loadOrder();
      render();
    };
  }

  function renderStep3() {
    const p = state.product;
    const needsIban = p?.requires_iban;
    stepContent.innerHTML = `
      <h1>Paiement</h1>
      <p class="sub">Montant à payer aujourd'hui : <strong>${p?.stripe_price_label || p?.price_label || '—'}</strong></p>
      <form id="payForm">
        ${needsIban ? `
        <div class="full"><label for="iban">IBAN (prélèvements suivants) *</label>
        <input id="iban" name="iban" placeholder="FR76 3000 6000 0112 3456 7890 189" required />
        <p class="info-box">Votre IBAN sera enregistré pour les échéances suivantes dans Deciplus.</p></div>` : ''}
        ${state.config?.badge_fee_notice && needsIban ? `<div class="notice-important"><strong>Badge d'accès</strong><p>${state.config.badge_fee_notice}</p></div>` : ''}
        <button type="submit" class="btn stripe block" id="payBtn">${p?.requires_payment === false ? 'Continuer gratuitement' : 'Payer par carte bancaire'}</button>
      </form>`;
    document.getElementById('payForm').onsubmit = async (e) => {
      e.preventDefault();
      setMsg('Redirection…');
      saveProgress();
      const body = { token: state.token };
      if (needsIban) body.iban = document.getElementById('iban').value;
      const res = await fetch(`/api/orders/${state.orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg((data.errors || [data.error]).join(', '), 'err');
        return;
      }
      if (data.url) window.location.href = data.url;
      else if (data.redirect) window.location.href = data.redirect;
    };
  }

  function renderStep4() {
    const full = state.order?.customer_full || {};
    stepContent.innerHTML = `
      <h1>Complétez votre dossier</h1>
      <p class="sub">Ces informations complètent votre fiche membre Deciplus. Votre abonnement donne accès aux 5 centres.</p>
      <form id="fullForm" class="form-grid" enctype="multipart/form-data">
        <input type="hidden" name="token" value="${state.token}" />
        ${state.sessionId ? `<input type="hidden" name="session_id" value="${state.sessionId}" />` : ''}
        <div><label for="gender">Sexe *</label>
          <select id="gender" name="gender" required>
            <option value="">—</option>
            <option value="M" ${full.gender === 'M' ? 'selected' : ''}>Homme</option>
            <option value="F" ${full.gender === 'F' ? 'selected' : ''}>Femme</option>
          </select></div>
        <div><label for="gym">Salle principale *</label>
          <select id="gym" name="gym" required>${gymsOptions()}</select></div>
        <div class="full"><label for="address">Adresse *</label><input id="address" name="address" required value="${full.address || ''}" /></div>
        <div><label for="postal_code">Code postal *</label><input id="postal_code" name="postal_code" required value="${full.postal_code || ''}" /></div>
        <div><label for="city">Ville *</label><input id="city" name="city" required value="${full.city || ''}" /></div>
        <div class="full"><label for="emergency_contact">Contact d'urgence (optionnel)</label><input id="emergency_contact" name="emergency_contact" placeholder="Nom + téléphone" value="${full.emergency_contact || ''}" /></div>
        <div class="full"><label for="medical_info">Informations médicales (optionnel)</label><textarea id="medical_info" name="medical_info" rows="2">${full.medical_info || ''}</textarea></div>
        <div class="full"><label for="photo">Photo de profil (optionnel)</label><input id="photo" name="photo" type="file" accept="image/*" /></div>
        ${state.product?.requires_iban ? `<div class="full info-box" style="margin-top:0">Votre IBAN a déjà été enregistré à l'étape paiement pour les prélèvements suivants.</div>` : ''}
        <div class="full"><button type="submit" class="btn block">Continuer vers la signature</button></div>
      </form>`;
    if (full.gym) document.getElementById('gym').value = full.gym;
    document.getElementById('fullForm').onsubmit = async (e) => {
      e.preventDefault();
      setMsg('Enregistrement…');
      const fd = new FormData(e.target);
      const res = await fetch(`/api/orders/${state.orderId}/profile`, { method: 'PATCH', body: fd });
      const data = await res.json();
      if (!data.ok) {
        setMsg(orderErrorMessage(data), 'err');
        return;
      }
      state.step = 5;
      setMsg('');
      saveProgress();
      syncUrl();
      await loadOrder();
      render();
    };
  }

  const LEGAL = {
    cgv: 'https://boutique.boxingcenter.fr/content/3-conditions',
    reglement: 'https://boxingcenter.fr/participez-seance-essai/',
  };

  function renderStep5() {
    stepContent.innerHTML = `
      <h1>Signature et validation</h1>
      <p class="sub">Lisez les documents, cochez les cases puis validez — cela vaut signature électronique de votre contrat.</p>
      <div class="e-sign-panel">
        <div class="e-sign-icon" aria-hidden="true">✍</div>
        <p><strong>Comment ça marche ?</strong> Pas de paraphe à dessiner : en cliquant sur « Valider mon inscription », vous signez électroniquement votre contrat d'adhésion. Un PDF signé vous sera envoyé par email.</p>
      </div>
      <div class="consent-box">
        <label><input type="checkbox" id="consent_cgv" required />
          J'accepte les <a class="legal-link" href="${LEGAL.cgv}" target="_blank" rel="noopener">conditions générales de vente</a> *</label>
      </div>
      <div class="consent-box">
        <label><input type="checkbox" id="consent_reglement" required />
          J'accepte le <a class="legal-link" href="${LEGAL.reglement}" target="_blank" rel="noopener">règlement intérieur du club</a> *</label>
      </div>
      <button type="button" class="btn block" id="signBtn">Valider mon inscription — signer électroniquement</button>
      <a href="/api/orders/${state.orderId}/contract.pdf?token=${state.token}${state.sessionId ? `&session_id=${state.sessionId}` : ''}" class="btn secondary block" style="margin-top:12px" target="_blank">Prévisualiser le contrat</a>`;
    document.getElementById('signBtn').onclick = async () => {
      if (!document.getElementById('consent_cgv').checked || !document.getElementById('consent_reglement').checked) {
        setMsg('Veuillez accepter les conditions.', 'err');
        return;
      }
      setMsg('Finalisation…');
      const res = await fetch(`/api/orders/${state.orderId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: state.token,
          session_id: state.sessionId || undefined,
          consent_cgv: true,
          consent_reglement: true,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(data.error || 'Erreur', 'err');
        return;
      }
      state.step = 6;
      clearProgress();
      setMsg('');
      saveProgress();
      syncUrl();
      render();
    };
  }

  function renderStep6() {
    const p = state.product;
    stepContent.innerHTML = `
      <div class="success-page" style="margin:20px auto">
        <div class="success-icon" aria-hidden="true"></div>
        <h1>Inscription confirmée !</h1>
        <p>Bienvenue chez Boxing Center. Un email de confirmation avec votre contrat vous a été envoyé.</p>
        <div class="info-box" style="text-align:left">
          <strong>Référence :</strong> ${state.orderId}<br />
          <strong>Offre :</strong> ${p?.display_name || p?.name || '—'}<br />
          <strong>Prochaine étape :</strong> présentez-vous 15 min avant votre premier cours.
        </div>
        <a href="/" class="btn block" style="margin-top:24px">Retour à l'accueil</a>
        <a href="/api/orders/${state.orderId}/contract.pdf?token=${state.token}" class="btn secondary block" style="margin-top:12px">Télécharger mon contrat</a>
      </div>`;
  }

  async function confirmStripeReturn() {
    const sessionId = params.get('session_id');
    if (!sessionId) return;
    state.sessionId = sessionId;
    await fetch('/api/checkout/confirm-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    await loadOrder();
  }

  function render() {
    updateStepper(state.step);
    if (state.step === 1) renderStep1();
    else if (state.step === 2) renderStep2();
    else if (state.step === 3) renderStep3();
    else if (state.step === 4) renderStep4();
    else if (state.step === 5) renderStep5();
    else renderStep6();
    saveProgress();
  }

  async function init() {
    restoreProgress();
    await loadConfig();

    if (state.orderId && state.token) {
      await confirmStripeReturn();
      const loaded = await loadOrder();
      if (!loaded && state.step > 3) {
        setMsg(
          'Session expirée sur le serveur — reprenez depuis le lien reçu après paiement ou contactez le club.',
          'err'
        );
      }
    } else {
      await loadProduct();
      if (state.step > 1 && state.productId) {
        /* étape restaurée localement (ex. formulaire identité) */
      } else if (!state.productId) {
        state.step = 1;
      }
    }

    if (!state.productId && state.product) state.productId = state.product.id;

    if (state.step === 1 && state.orderId && state.order) {
      state.step = stepFromOrder(state.order);
    }

    syncUrl();
    render();
  }

  window.addEventListener('beforeunload', saveProgress);

  init();
})();
