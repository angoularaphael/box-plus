(function () {
  const params = new URLSearchParams(window.location.search);
  const STORAGE_KEY = 'bc_inscription_progress';
  const STORAGE_TTL_MS = 48 * 60 * 60 * 1000;

  function readStoredProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeStoredProgress(data) {
    const raw = JSON.stringify(data);
    try {
      localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      /* quota */
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, raw);
    } catch {
      /* quota */
    }
  }

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
    gymDraft: null,
    photoUploaded: false,
    emailWarning: null,
  };

  const stepContent = document.getElementById('stepContent');
  const formMsg = document.getElementById('formMsg');

  function setMsg(text, type) {
    formMsg.textContent = text || '';
    formMsg.className = 'form-msg' + (type ? ` ${type}` : '');
  }

  /** Redimensionne la photo (min 200px Deciplus, max ~900px pour le job bot). */
  async function prepareMemberPhoto(file) {
    if (!file || !file.type?.startsWith('image/')) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const min = 200;
      const max = 900;
      let w = bitmap.width;
      let h = bitmap.height;
      if (!w || !h) return file;
      if (w < min || h < min) {
        const scale = Math.max(min / w, min / h);
        w = Math.max(min, Math.round(w * scale));
        h = Math.max(min, Math.round(h * scale));
      } else if (w > max || h > max) {
        const scale = Math.min(max / w, max / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      } else if (file.type === 'image/jpeg' && file.size < 900 * 1024) {
        bitmap.close?.();
        return file;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close?.();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
      if (!blob) return file;
      return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    } catch {
      return file;
    }
  }

  function saveProgress() {
    writeStoredProgress({
      productId: state.productId,
      orderId: state.orderId,
      token: state.token,
      sessionId: state.sessionId,
      step: state.step,
      shortDraft: state.shortDraft,
      gymDraft: state.gymDraft,
      photoUploaded: state.photoUploaded,
      customerShort: state.order?.customer_short || null,
      productSnapshot: state.product || state.order?.product_snapshot || null,
      savedAt: Date.now(),
    });
  }

  function restoreProgress() {
    try {
      const saved = readStoredProgress();
      if (!saved) return;
      if (!saved.savedAt || Date.now() - saved.savedAt > STORAGE_TTL_MS) {
        localStorage.removeItem(STORAGE_KEY);
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
      if (saved.gymDraft) state.gymDraft = saved.gymDraft;
      if (saved.photoUploaded) state.photoUploaded = true;
      if (saved.customerShort && !state.order?.customer_short) {
        state.order = state.order || {};
        state.order.customer_short = saved.customerShort;
      }
      if (saved.productSnapshot && !state.product) {
        state.product = saved.productSnapshot;
      }
      const urlStep = Number(params.get('step') || 0);
      if (saved.step > 1) {
        if (!urlStep || (saved.orderId && state.orderId === saved.orderId && saved.step > urlStep)) {
          state.step = Math.max(state.step, saved.step);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }

  function clearProgress() {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  }

  function syncUrl() {
    const qs = new URLSearchParams();
    if (state.productId) qs.set('product', state.productId);
    if (state.orderId) qs.set('order', state.orderId);
    if (state.token) qs.set('token', state.token);
    if (state.sessionId) qs.set('session_id', state.sessionId);
    qs.set('step', String(state.step));
    const path = '/inscription';
    const next = `${path}?${qs}`;
    if (location.pathname !== path || location.search !== `?${qs}`) {
      history.replaceState(null, '', next);
    }
  }

  function orderRequiresPayment(order) {
    const p = order?.product_snapshot || state.product;
    return p?.requires_payment !== false;
  }

  function orderNeedsIban(order) {
    const p = order?.product_snapshot || state.product;
    const plan = order?.payment?.billing_plan || 'rib';
    // Badge ~72h toujours IBAN — IBAN requis pour abonnements / prélèvement
    if (order?.payment?.iban) return false;
    if (plan === 'rib' || p?.requires_iban) return true;
    if (p?.sale_type === 'abonnement') return true;
    if (/abonnement/i.test(String(p?.category || ''))) return true;
    return false;
  }

  function paymentFailureMessage(reason) {
    if (reason === 'cancelled') {
      return 'Paiement annulé — vous n\'avez pas été débité. Vous pouvez réessayer ci-dessous.';
    }
    return 'Le paiement n\'a pas pu être finalisé — vous n\'avez pas été débité. Vous pouvez réessayer.';
  }

  function stepFromOrder(order) {
    if (!order) return state.step;
    const paid = order.payment?.status === 'paid';
    const needsPay = orderRequiresPayment(order);
    const needsIban = orderNeedsIban(order) && !order.payment?.iban;

    if (order.signature?.signed_at || order.step >= 8) return needsPay && !paid ? 4 : 8;
    if (order.step >= 7) return needsPay && !paid ? 4 : 7;
    if (order.step >= 6) return needsPay && !paid ? 4 : 6;
    if (order.step >= 5) return needsPay && !paid ? 4 : needsIban ? 5 : 6;
    if (paid) return needsIban ? 5 : 6;
    if (order.customer_short) return 4;
    if (order.customer_full?.gym) return 3;
    if (order.order_id) return 2;
    return 1;
  }

  function persistAndRender() {
    saveProgress();
    syncUrl();
    void render();
  }

  function goToStep(step) {
    setMsg('');
    state.step = step;
    try {
      window.BCTrack?.track('funnel_step', {
        step,
        order_id: state.orderId || undefined,
        product_id: state.productId || undefined,
      });
    } catch {
      /* ignore */
    }
    persistAndRender();
  }

  async function ensureProductLoaded() {
    if (state.product?.display_name || state.product?.name) return state.product;
    if (state.order?.product_snapshot) {
      state.product = state.order.product_snapshot;
      if (!state.productId && state.product.id) state.productId = state.product.id;
      return state.product;
    }
    if (!state.productId) return null;
    return loadProduct();
  }

  function backButton(label, targetStep) {
    return `<button type="button" class="btn secondary block step-back" data-step="${targetStep}">${label}</button>`;
  }

  function bindBackButtons() {
    stepContent.querySelectorAll('.step-back').forEach((btn) => {
      btn.onclick = () => goToStep(Number(btn.dataset.step));
    });
  }

  function updateStepper(step) {
    document.querySelectorAll('.stepper-step').forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle('active', s === step);
      el.classList.toggle('done', s < step);
    });
  }

  function gymsOptions(selected) {
    const gyms = [
      ['minimes', 'Minimes'],
      ['ramonville', 'Ramonville'],
      ['etats-unis', 'États-Unis'],
      ['st-cyprien', 'Saint-Cyprien'],
      ['portet', 'Portet'],
    ];
    return (
      `<option value="">Choisir une salle</option>` +
      gyms
        .map(
          ([v, l]) =>
            `<option value="${v}" ${selected === v ? 'selected' : ''}>${l}</option>`
        )
        .join('')
    );
  }

  async function loadConfig() {
    const res = await fetch('/api/config');
    state.config = await res.json();
  }

  async function loadProduct() {
    if (!state.productId) return null;
    const pid = state.productId;
    const res = await fetch('/api/products');
    const data = await res.json();
    state.product = (data.products || []).find((p) => p.id === pid || p.legacy_id === pid);
    if (!state.product) {
      const one = await fetch(`/api/products/${encodeURIComponent(pid)}`);
      if (one.ok) {
        const body = await one.json();
        state.product = body.product;
      }
    }
    if (state.product?.id && state.product.id !== pid) {
      state.productId = state.product.id;
    }
    return state.product;
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
    if (state.order.documents?.photo) state.photoUploaded = true;
    state.step = stepFromOrder(state.order);
    return true;
  }

  function orderErrorMessage(data) {
    if (data.message) return data.message;
    if (data.error === 'payment_not_completed' || data.error === 'payment_required') {
      return paymentFailureMessage();
    }
    if (data.error === 'not_found') {
      return 'Dossier introuvable. Revenez à l\'étape identité et recommencez, ou contactez le club.';
    }
    return (data.errors || [data.error]).filter(Boolean).join(', ');
  }

  function payRequestBody(extra = {}) {
    const short = state.order?.customer_short || state.shortDraft;
    return {
      token: state.token,
      product_id: state.productId,
      gym: state.order?.customer_full?.gym || state.gymDraft || undefined,
      customer_short: short
        ? {
            first_name: short.first_name,
            last_name: short.last_name,
            email: short.email,
            phone: short.phone,
            birthdate: short.birthdate,
          }
        : undefined,
      product_snapshot: state.product || state.order?.product_snapshot,
      session_id: state.sessionId || undefined,
      ...extra,
    };
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

  function priceLabel(product) {
    return product?.stripe_price_label || product?.price_label || '—';
  }

  async function ensureProductForPayment() {
    if (!state.productId) return;
    const hasLabel = state.product?.stripe_price_label || state.product?.price_label;
    if (hasLabel) return;
    await loadProduct();
    if (!state.product) return;
    const snap = state.order?.product_snapshot;
    if (snap) state.product = { ...snap, ...state.product };
  }

  function bindBillingPlanForm() {
    const payBtn = document.getElementById('payBtn');
    const radios = document.querySelectorAll('input[name="billing_plan"]');
    if (!radios.length || !payBtn) return;
    const refresh = () => {
      const plan = document.querySelector('input[name="billing_plan"]:checked')?.value || 'rib';
      payBtn.textContent = plan === 'cb' ? 'Payer par carte' : 'Payer';
    };
    radios.forEach((r) => r.addEventListener('change', refresh));
    refresh();
  }

  async function renderStep4() {
    if (state.order?.payment?.status === 'paid') {
      state.step = stepFromOrder(state.order);
      if (state.step !== 4) {
        persistAndRender();
        return;
      }
    }
    if (state.sessionId) {
      await confirmStripeReturn();
      if (state.order?.payment?.status === 'paid') {
        persistAndRender();
        return;
      }
    }
    await ensureProductForPayment();
    const p = state.product;
    const supportsChoice = Boolean(p?.supports_billing_choice);
    const isComptantLike =
      /comptant/i.test(String(p?.name || '')) ||
      p?.subsection === 'comptant' ||
      /4\s*[x×]\s*sans\s*frais/i.test(String(p?.badge || p?.name || '')) ||
      /sans\s*frais/i.test(String(p?.badge || ''));
    const isPrelevementOnly = Boolean(p?.requires_iban) && !supportsChoice && !isComptantLike;
    const savedPlan = state.order?.payment?.billing_plan || 'rib';

    let billingHtml = '';
    if (supportsChoice) {
      // Les 2 modes : Prélèvement ou CB
      billingHtml = `
        <div class="full billing-plan-block">
          <div class="billing-choice-row" role="radiogroup" aria-label="Mode de paiement">
            <label class="billing-choice">
              <input type="radio" name="billing_plan" value="rib" ${savedPlan !== 'cb' ? 'checked' : ''} />
              <span class="billing-choice-text">
                <strong>Prélèvement (RIB)</strong>
                <small>1ère CB, puis SEPA</small>
              </span>
            </label>
            <label class="billing-choice">
              <input type="radio" name="billing_plan" value="cb" ${savedPlan === 'cb' ? 'checked' : ''} />
              <span class="billing-choice-text">
                <strong>Carte bancaire</strong>
                <small>Toutes les 4 semaines</small>
              </span>
            </label>
          </div>
        </div>`;
    } else if (isPrelevementOnly) {
      // Une seule option : prélèvement déjà coché
      billingHtml = `
        <div class="full billing-plan-block">
          <div class="billing-choice-row" role="radiogroup" aria-label="Mode de paiement">
            <label class="billing-choice">
              <input type="radio" name="billing_plan" value="rib" checked />
              <span class="billing-choice-text">
                <strong>Prélèvement (RIB)</strong>
                <small>1ère CB, puis SEPA</small>
              </span>
            </label>
          </div>
        </div>`;
    }
    // Comptant / 4× sans frais : pas de choix, juste Payer (CB)

    stepContent.innerHTML = `
      <h1>Paiement</h1>
      <p class="sub">Montant : <strong>${priceLabel(p)}</strong></p>
      <form id="payForm">
        ${billingHtml}
        <button type="submit" class="btn stripe block" id="payBtn">${
          p?.requires_payment === false ? 'Continuer' : 'Payer'
        }</button>
        ${backButton('← Retour', 3)}
      </form>`;
    bindBillingPlanForm();
    document.getElementById('payForm').onsubmit = async (e) => {
      e.preventDefault();
      setMsg('Redirection…');
      saveProgress();
      const body = payRequestBody();
      const planInput = document.querySelector('input[name="billing_plan"]:checked');
      if (planInput) body.billing_plan = planInput.value;
      else if (isPrelevementOnly || (p?.requires_iban && !isComptantLike)) body.billing_plan = 'rib';
      // Badge ~72h auto IBAN — jamais affiché / demandé
      body.badge_timing = 'deferred';
      body.badge_method = 'iban';
      const res = await fetch(`/api/orders/${state.orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(orderErrorMessage(data), 'err');
        return;
      }
      if (data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      if (data.url) window.location.href = data.url;
    };
    bindBackButtons();
  }

  function guardPaidStep() {
    if (!orderRequiresPayment(state.order) || state.order?.payment?.status === 'paid') return false;
    state.step = 4;
    setMsg(paymentFailureMessage(), 'err');
    persistAndRender();
    return true;
  }

  /* ——— Steps ——— */

  function renderStep1() {
    const p = state.product;
    if (!p) {
      stepContent.innerHTML = `
        <h1>Votre offre</h1>
        <p class="sub">Cette offre est introuvable ou n'est plus disponible.</p>
        <a href="/abonnements" class="btn block">Voir les offres disponibles</a>`;
      return;
    }
    stepContent.innerHTML = `
      <h1>Votre offre</h1>
      <div class="offer-card" style="margin-bottom:24px">
        <h3>${p.display_name || p.name}</h3>
        <div class="offer-price">${p.stripe_price_label || p.price_label}</div>
        ${p.installments_note ? `<p class="offer-price-sub">${p.installments_note}</p>` : ''}
      </div>
      <button type="button" class="btn block" id="toStep2">Continuer</button>
      <a href="/abonnements" class="btn secondary block" style="margin-top:12px">← Choisir une autre offre</a>`;
    document.getElementById('toStep2').onclick = () => goToStep(2);
  }

  function renderStep2() {
    const selected = state.order?.customer_full?.gym || state.gymDraft || '';
    stepContent.innerHTML = `
      <h1>Votre salle</h1>
      <form id="gymForm" class="form-grid">
        <div class="full"><label for="gym">Salle principale *</label>
          <select id="gym" name="gym" required>${gymsOptions(selected)}</select></div>
        <div class="full"><button type="submit" class="btn block">Continuer</button></div>
        <div class="full">${backButton('← Retour à l\'offre', 1)}</div>
      </form>`;
    bindBackButtons();
    document.getElementById('gymForm').onsubmit = async (e) => {
      e.preventDefault();
      const gym = document.getElementById('gym').value;
      if (!gym) {
        setMsg('Choisissez une salle', 'err');
        return;
      }
      setMsg('Enregistrement…');
      state.gymDraft = gym;
      saveProgress();

      if (!state.orderId) {
        const res = await fetch('/api/orders/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: state.productId, gym }),
        });
        const data = await res.json();
        if (!data.ok) {
          setMsg((data.errors || [data.error]).join(', '), 'err');
          return;
        }
        state.orderId = data.order_id;
        state.token = data.access_token;
        state.order = {
          order_id: data.order_id,
          customer_full: { gym },
          product_snapshot: state.product,
        };
      } else {
        const res = await fetch(`/api/orders/${state.orderId}/gym`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: state.token, gym }),
        });
        const data = await res.json();
        if (!data.ok) {
          setMsg(orderErrorMessage(data), 'err');
          return;
        }
        state.order = state.order || {};
        state.order.customer_full = { ...(state.order.customer_full || {}), gym };
      }
      setMsg('');
      goToStep(3);
    };
  }

  function renderStep3() {
    const short = state.order?.customer_short || state.shortDraft || {};
    stepContent.innerHTML = `
      <h1>Vos coordonnées</h1>
      <form id="shortForm" class="form-grid">
        <div><label for="first_name">Prénom *</label><input id="first_name" name="first_name" required value="${short.first_name || ''}" /></div>
        <div><label for="last_name">Nom *</label><input id="last_name" name="last_name" required value="${short.last_name || ''}" /></div>
        <div class="full"><label for="email">Email *</label><input id="email" name="email" type="email" required value="${short.email || ''}" /></div>
        <div class="full"><label for="phone">Téléphone *</label><input id="phone" name="phone" type="tel" required value="${short.phone || ''}" /></div>
        <div class="full"><label for="birthdate">Date de naissance *</label><input id="birthdate" name="birthdate" type="date" required value="${short.birthdate || ''}" /></div>
        <div class="full"><button type="submit" class="btn block">Continuer</button></div>
        <div class="full">${backButton('← Retour à la salle', 2)}</div>
      </form>`;
    const form = document.getElementById('shortForm');
    bindShortDraftAutosave(form);
    bindBackButtons();
    form.onsubmit = async (e) => {
      e.preventDefault();
      setMsg('Envoi…');
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.token = state.token;
      body.gym = state.order?.customer_full?.gym || state.gymDraft;
      state.shortDraft = body;
      saveProgress();

      if (!state.orderId) {
        const res = await fetch('/api/orders/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, product_id: state.productId }),
        });
        const data = await res.json();
        if (!data.ok) {
          setMsg((data.errors || [data.error]).join(', '), 'err');
          return;
        }
        state.orderId = data.order_id;
        state.token = data.access_token;
      } else {
        const res = await fetch(`/api/orders/${state.orderId}/identity`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) {
          setMsg(orderErrorMessage(data), 'err');
          return;
        }
      }

      state.shortDraft = null;
      state.order = {
        ...(state.order || {}),
        order_id: state.orderId,
        customer_short: {
          first_name: body.first_name,
          last_name: body.last_name,
          email: body.email,
          phone: body.phone,
          birthdate: body.birthdate,
        },
        product_snapshot: state.product,
      };
      setMsg('');
      await loadOrder();
      goToStep(4);
    };
  }

  function renderStep5() {
    if (guardPaidStep()) return;
    if (!orderNeedsIban(state.order) || state.order?.payment?.iban) {
      goToStep(6);
      return;
    }
    stepContent.innerHTML = `
      <h1>IBAN</h1>
      <form id="ibanForm" class="form-grid">
        <div class="full">
          <label for="iban">IBAN *</label>
          <input id="iban" name="iban" required placeholder="FR76 3000 6000 0112 3456 7890 189" value="${state.order?.payment?.iban || ''}" />
        </div>
        ${
          state.config?.badge_fee_notice
            ? ''
            : ''
        }
        <div class="full"><button type="submit" class="btn block">Continuer</button></div>
        <div class="full">${backButton('← Retour', 4)}</div>
      </form>`;
    bindBackButtons();
    document.getElementById('ibanForm').onsubmit = async (e) => {
      e.preventDefault();
      setMsg('Enregistrement…');
      const iban = document.getElementById('iban').value;
      const res = await fetch(`/api/orders/${state.orderId}/iban`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: state.token,
          session_id: state.sessionId || undefined,
          iban,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(orderErrorMessage(data), 'err');
        return;
      }
      setMsg('');
      await loadOrder();
      goToStep(6);
    };
  }

  function renderStep6() {
    if (guardPaidStep()) return;
    if (orderNeedsIban(state.order) && !state.order?.payment?.iban) {
      goToStep(5);
      return;
    }
    const full = state.order?.customer_full || {};
    const photoOk = state.photoUploaded || Boolean(state.order?.documents?.photo) || Boolean(state.order?.documents?.photo_base64);
    stepContent.innerHTML = `
      <h1>Votre dossier</h1>
      <form id="fullForm" class="form-grid">
        <input type="hidden" name="token" value="${state.token}" />
        ${state.sessionId ? `<input type="hidden" name="session_id" value="${state.sessionId}" />` : ''}
        <div><label for="gender">Sexe *</label>
          <select id="gender" name="gender" required>
            <option value="">—</option>
            <option value="M" ${full.gender === 'M' ? 'selected' : ''}>Homme</option>
            <option value="F" ${full.gender === 'F' ? 'selected' : ''}>Femme</option>
          </select></div>
        <div class="full"><label for="address">Adresse *</label><input id="address" name="address" required value="${full.address || ''}" /></div>
        <div><label for="postal_code">Code postal *</label><input id="postal_code" name="postal_code" required value="${full.postal_code || ''}" /></div>
        <div><label for="city">Ville *</label><input id="city" name="city" required value="${full.city || ''}" /></div>
        <div class="full"><label for="photo">Photo *</label>
          <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="user" ${photoOk ? '' : 'required'} />
        </div>
        <div class="full"><label for="emergency_contact">Contact d'urgence (optionnel)</label><input id="emergency_contact" name="emergency_contact" placeholder="Nom + téléphone" value="${full.emergency_contact || ''}" /></div>
        <div class="full"><label for="medical_info">Informations médicales (optionnel)</label><textarea id="medical_info" name="medical_info" rows="2">${full.medical_info || ''}</textarea></div>
        <div class="full"><button type="submit" class="btn block">Continuer</button></div>
        <div class="full">${backButton('← Retour', orderNeedsIban(state.order) ? 5 : 4)}</div>
      </form>`;
    document.getElementById('fullForm').onsubmit = async (e) => {
      e.preventDefault();
      setMsg('Enregistrement…');
      const photoInput = document.getElementById('photo');
      if (photoInput?.files?.[0]) {
        const prepared = await prepareMemberPhoto(photoInput.files[0]);
        const fd = new FormData();
        fd.append('photo', prepared);
        fd.append('token', state.token);
        const photoRes = await fetch(`/api/orders/${state.orderId}/photo`, {
          method: 'POST',
          body: fd,
        });
        const photoData = await photoRes.json();
        if (!photoData.ok) {
          setMsg(orderErrorMessage(photoData) || 'Échec upload photo', 'err');
          return;
        }
        state.photoUploaded = true;
      } else if (!photoOk) {
        setMsg('Ajoutez une photo', 'err');
        return;
      }

      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      delete body.photo;
      const res = await fetch(`/api/orders/${state.orderId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(orderErrorMessage(data), 'err');
        return;
      }
      setMsg('');
      await loadOrder();
      goToStep(7);
    };
    bindBackButtons();
  }

  const LEGAL = {
    cgv: '/cgv',
    reglement: '/reglement-interieur',
  };

  function initSignaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const cssW = canvas.clientWidth || 640;
    const cssH = 180;
    canvas.width = Math.floor(cssW * ratio);
    canvas.height = Math.floor(cssH * ratio);
    canvas.style.height = `${cssH}px`;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0B1F3A';

    let drawing = false;
    let strokes = 0;

    function pos(ev) {
      const rect = canvas.getBoundingClientRect();
      const src = ev.touches ? ev.touches[0] : ev;
      return { x: src.clientX - rect.left, y: src.clientY - rect.top };
    }

    function start(ev) {
      ev.preventDefault();
      drawing = true;
      const p = pos(ev);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function move(ev) {
      if (!drawing) return;
      ev.preventDefault();
      const p = pos(ev);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      strokes += 1;
    }

    function end(ev) {
      if (!drawing) return;
      ev.preventDefault();
      drawing = false;
    }

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);

    return {
      clear() {
        ctx.clearRect(0, 0, cssW, cssH);
        strokes = 0;
      },
      hasInk() {
        return strokes > 8;
      },
      toDataURL() {
        return canvas.toDataURL('image/png');
      },
    };
  }

  function renderStep7() {
    if (guardPaidStep()) return;
    stepContent.innerHTML = `
      <h1>Signature</h1>
      <canvas id="sigPad" class="signature-pad" width="640" height="180" style="width:100%;display:block;cursor:crosshair"></canvas>
      <div class="signature-actions">
        <button type="button" class="btn secondary" id="clearSig">Effacer</button>
      </div>
      <div class="consent-box">
        <label><input type="checkbox" id="consent_cgv" required />
          J'accepte les <a class="legal-link" href="${LEGAL.cgv}" target="_blank" rel="noopener">conditions générales de vente</a> *</label>
      </div>
      <div class="consent-box">
        <label><input type="checkbox" id="consent_reglement" required />
          J'accepte le <a class="legal-link" href="${LEGAL.reglement}" target="_blank" rel="noopener">règlement intérieur du club</a> *</label>
      </div>
      <button type="button" class="btn block" id="signBtn">Valider</button>
      <button type="button" class="btn secondary block" id="previewContractBtn" style="margin-top:12px">Prévisualiser le contrat</button>
      ${backButton('← Retour', 6)}`;

    const pad = initSignaturePad(document.getElementById('sigPad'));
    document.getElementById('clearSig').onclick = () => pad.clear();
    document.getElementById('previewContractBtn').onclick = () => {
      window.BCContract.openView(state.orderId, {
        token: state.token,
        sessionId: state.sessionId,
      });
    };
    document.getElementById('signBtn').onclick = async () => {
      if (!document.getElementById('consent_cgv').checked || !document.getElementById('consent_reglement').checked) {
        setMsg('Veuillez accepter les conditions.', 'err');
        return;
      }
      if (!pad.hasInk()) {
        setMsg('Signez dans le cadre avant de valider.', 'err');
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
          signature_image: pad.toDataURL(),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg(data.error || 'Erreur', 'err');
        return;
      }
      state.step = 8;
      state.emailWarning = data.email_warning || null;
      clearProgress();
      setMsg('');
      syncUrl();
      await render();
    };
    bindBackButtons();
  }

  function renderStep8() {
    if (guardPaidStep()) return;
    const p = state.product;
    const emailNote = state.emailWarning
      ? `<div class="notice-important" style="margin-top:16px;text-align:left"><strong>Email non envoyé</strong><p>Votre inscription est bien enregistrée. L'email de confirmation n'a pas pu être envoyé (${state.emailWarning}). Téléchargez votre contrat ci-dessous ou contactez le club.</p></div>`
      : '';
    stepContent.innerHTML = `
      <div class="success-page" style="margin:20px auto">
        <div class="success-icon" aria-hidden="true"></div>
        <h1>Inscription confirmée</h1>
        ${emailNote}
        <div class="info-box" style="text-align:left">
          <strong>Référence :</strong> ${state.orderId}<br />
          <strong>Offre :</strong> ${p?.display_name || p?.name || '—'}
        </div>
        <a href="/" class="btn block" style="margin-top:24px">Retour à l'accueil</a>
        <button type="button" class="btn secondary block" id="downloadContractBtn" style="margin-top:12px">Télécharger mon contrat</button>
      </div>`;
    document.getElementById('downloadContractBtn').onclick = () => {
      window.BCContract.openView(state.orderId, { token: state.token });
    };
  }

  let stripeConfirmDone = false;

  async function confirmStripeReturn() {
    const sessionId = params.get('session_id') || state.sessionId;
    if (!sessionId || stripeConfirmDone) return false;
    stripeConfirmDone = true;
    state.sessionId = sessionId;

    let data = {};
    const res = await fetch('/api/checkout/confirm-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    await loadOrder();

    if (state.order?.payment?.status === 'paid') {
      state.step = stepFromOrder(state.order);
      setMsg('');
      return true;
    }

    state.step = 4;
    state.sessionId = null;
    setMsg(paymentFailureMessage(), 'err');
    syncUrl();
    return false;
  }

  async function render() {
    updateStepper(state.step);
    if (state.step === 1) {
      await ensureProductLoaded();
      renderStep1();
    } else if (state.step === 2) renderStep2();
    else if (state.step === 3) renderStep3();
    else if (state.step === 4) await renderStep4();
    else if (state.step === 5) renderStep5();
    else if (state.step === 6) renderStep6();
    else if (state.step === 7) renderStep7();
    else renderStep8();
    saveProgress();
  }

  async function init() {
    restoreProgress();
    await loadConfig();

    if (params.get('cancelled')) {
      state.step = 4;
      state.sessionId = null;
      setMsg(paymentFailureMessage('cancelled'), 'err');
      params.delete('cancelled');
      syncUrl();
    }

    if (state.orderId && state.token) {
      await confirmStripeReturn();
      const loaded = await loadOrder();
      if (state.order?.payment?.status === 'paid') {
        state.step = Math.max(state.step, stepFromOrder(state.order));
      } else if (orderRequiresPayment(state.order) && state.step > 4) {
        state.step = 4;
      } else if (!loaded && state.step >= 4) {
        setMsg(
          'Impossible de recharger votre dossier — vous pouvez tout de même payer si vos coordonnées sont enregistrées.',
          'err'
        );
      }
    }

    await ensureProductLoaded();

    if (!state.productId && !state.product) {
      state.step = 1;
    }

    if (!state.productId && state.product) state.productId = state.product.id;

    if (state.step === 1 && state.orderId && state.order) {
      state.step = stepFromOrder(state.order);
    }

    syncUrl();
    await render();
  }

  window.addEventListener('beforeunload', saveProgress);

  init();
})();
