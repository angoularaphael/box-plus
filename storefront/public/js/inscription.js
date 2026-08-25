(function () {
  const params = new URLSearchParams(window.location.search);
  const STORAGE_KEY = 'bc_inscription_progress';
  const RESUME_COOKIE = 'bc_resume';
  const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function isAccessToken(value) {
    return /^[a-f0-9]{48}$/i.test(String(value || '').trim());
  }

  function pickUrlAccessToken(searchParams) {
    const bc = String(searchParams.get('bc_token') || '').trim();
    if (isAccessToken(bc)) return bc;
    const all = searchParams.getAll('token').map((t) => String(t || '').trim()).filter(Boolean);
    const hex = all.find(isAccessToken);
    if (hex) return hex;
    return all[0] || '';
  }

  function pickPaypalOrderIdFromUrl(searchParams) {
    const explicit = String(searchParams.get('paypal_order_id') || '').trim();
    if (explicit) return explicit;
    if (searchParams.get('paypal_return') !== '1') return '';
    const all = searchParams.getAll('token').map((t) => String(t || '').trim()).filter(Boolean);
    return all.find((t) => t && !isAccessToken(t) && /^[A-Z0-9_-]{8,30}$/i.test(t)) || '';
  }

  function isPspReturn(searchParams) {
    return (
      searchParams.get('payplug_return') === '1' ||
      searchParams.get('paypal_return') === '1' ||
      searchParams.get('cawl_return') === '1'
    );
  }

  function readStoredProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeResumeCookie(data) {
    if (!data?.orderId || !data?.token) return;
    const payload = encodeURIComponent(
      JSON.stringify({
        o: data.orderId,
        t: data.token,
        s: Number(data.step) || 1,
        p: data.productId || '',
        at: data.savedAt || Date.now(),
      })
    );
    const maxAge = Math.floor(STORAGE_TTL_MS / 1000);
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${RESUME_COOKIE}=${payload}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  }

  function readResumeCookie() {
    try {
      const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${RESUME_COOKIE}=([^;]*)`));
      if (!match) return null;
      const c = JSON.parse(decodeURIComponent(match[1]));
      if (!c?.o || !c?.t) return null;
      return {
        orderId: c.o,
        token: c.t,
        step: Number(c.s) || 1,
        productId: c.p || null,
        savedAt: c.at || Date.now(),
      };
    } catch {
      return null;
    }
  }

  function clearResumeCookie() {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${RESUME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
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
    writeResumeCookie(data);
  }

  const state = {
    productId: params.get('product'),
    orderId: params.get('order'),
    token: pickUrlAccessToken(params),
    sessionId: isPspReturn(params) ? null : params.get('session_id'),
    step: Number(params.get('step') || 1),
    product: null,
    order: null,
    config: null,
    shortDraft: null,
    gymDraft: null,
    photoUploaded: false,
    emailWarning: null,
    dispatchError: null,
    /** Après signature : plus aucun cache / saveProgress */
    tunnelComplete: false,
  };

  function isBalmaRetour() {
    return (
      params.get('source') === 'balma_retour' ||
      params.get('aventure') === '1' ||
      state.order?.source === 'balma_retour' ||
      state.order?.aventure === true ||
      state.order?.utm?.source === 'balma_retour'
    );
  }

  function aventureAfterPayStep() {
    return productRequiresIban(state.order || { product_snapshot: state.product }) &&
      state.order?.payment?.status === 'paid' &&
      !state.order?.payment?.iban
      ? 5
      : 6;
  }

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
    // Inscription terminée → ne jamais réécrire le cache (sinon « Retour » relance le tunnel)
    if (state.tunnelComplete || state.step >= 8) return;
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

  function adoptCheckoutIds(data) {
    if (!data) return;
    if (data.order_id) state.orderId = data.order_id;
    if (data.access_token) state.token = data.access_token;
    saveProgress();
    syncUrl();
  }

  function restoreProgress() {
    try {
      const saved = readStoredProgress() || readResumeCookie();
      if (!saved) return;
      if (!saved.savedAt || Date.now() - saved.savedAt > STORAGE_TTL_MS) {
        clearProgress();
        return;
      }
      // Ancien dossier déjà confirmé resté en cache → jeter
      if (Number(saved.step) >= 8 || saved.tunnelComplete) {
        clearProgress();
        return;
      }

      const urlProduct = params.get('product');
      // Nouveau produit choisi (via « Choisir une autre offre ») → ignorer l'ancien dossier
      if (
        urlProduct &&
        saved.productId &&
        urlProduct !== saved.productId &&
        !params.get('order')
      ) {
        clearProgress();
        state.productId = urlProduct;
        state.orderId = null;
        state.token = null;
        state.sessionId = null;
        state.order = null;
        state.step = 1;
        state.shortDraft = null;
        state.gymDraft = null;
        state.photoUploaded = false;
        return;
      }

      if (saved.productId && (!state.productId || state.productId === saved.productId)) {
        state.productId = saved.productId;
      }
      if (saved.orderId) state.orderId = state.orderId || saved.orderId;
      if (isAccessToken(saved.token) && !isAccessToken(state.token)) {
        state.token = saved.token;
      } else if (saved.token) state.token = state.token || saved.token;
      if (!isPspReturn(params) && saved.sessionId) {
        state.sessionId = state.sessionId || saved.sessionId;
      }
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
      clearProgress();
    }
  }

  function clearProgress() {
    try {
    localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    try {
    sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    clearResumeCookie();
  }

  /** Après validation + signature : vide tout le cache tunnel et coupe les réécritures. */
  function clearCacheAfterConfirm() {
    state.tunnelComplete = true;
    state.shortDraft = null;
    state.gymDraft = null;
    state.photoUploaded = false;
    clearProgress();
    try {
      sessionStorage.removeItem('bcp_prefill');
    } catch {
      /* ignore */
    }
    window.removeEventListener('beforeunload', saveProgress);
  }

  /** Quitter le tunnel pour choisir une autre offre — sans réinjecter l'ancien paiement. */
  function leaveToChooseAnotherOffer(e) {
    if (e) e.preventDefault();
    clearProgress();
    window.removeEventListener('beforeunload', saveProgress);
    const href =
      (window.BCPaths && typeof window.BCPaths.link === 'function'
        ? window.BCPaths.link('/abonnements')
        : null) || '/abonnements';
    window.location.href = href;
  }

  function syncUrl() {
    const qs = new URLSearchParams();
    if (state.productId) qs.set('product', state.productId);
    if (state.orderId) qs.set('order', state.orderId);
    if (state.token) {
      qs.set('token', state.token);
      qs.set('bc_token', state.token);
    }
    if (state.sessionId && state.order?.payment?.method === 'stripe') {
      qs.set('session_id', state.sessionId);
    }
    qs.set('step', String(state.step));
    if (isBalmaRetour()) {
      qs.set('aventure', '1');
      qs.set('source', 'balma_retour');
    }
    const path = '/inscription';
    const next = `${path}?${qs}`;
    if (location.pathname !== path || location.search !== `?${qs}`) {
      history.replaceState(null, '', next);
    }
  }

  function orderRequiresPayment(order) {
    const p = order?.product_snapshot || state.product;
    if (!p) return true;
    if (p.requires_payment === false) return false;
    if (Number(p.price_cents || 0) <= 0) return false;
    if (/gratuit/i.test(String(p.price_label || p.stripe_price_label || ''))) return false;
    return true;
  }

  /** Marque l’offre gratuite comme « payée » (free) puis enchaîne vers le dossier. */
  async function ensureFreeOrderMarked() {
    if (!state.orderId || !state.token) return false;
    if (state.order?.payment?.status === 'paid' || state.order?.payment?.status === 'free') {
      return true;
    }
    try {
      const res = await fetch(`/api/orders/${state.orderId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: state.token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) return false;
      await loadOrder();
      return true;
    } catch {
      return false;
    }
  }

  function nextStepAfterIdentity() {
    if (!orderRequiresPayment(state.order || { product_snapshot: state.product })) {
      return productRequiresIban(state.order) ? 5 : 6;
    }
    return 4;
  }

  function isComptantLikeProduct(p) {
    return (
      /comptant/i.test(String(p?.name || '')) ||
      p?.subsection === 'comptant' ||
      p?.supports_installment_choice === true ||
      /4\s*[x×]\s*sans\s*frais/i.test(String(p?.badge || p?.name || '')) ||
      /1\s*[x×]\s*ou\s*4\s*[x×]/i.test(String(p?.badge || '')) ||
      /sans\s*frais/i.test(String(p?.badge || ''))
    );
  }

  function isChildOfferProduct(p) {
    if (!p) return false;
    if (p.subsection === 'enfants') return true;
    const id = String(p.id || '');
    const legacy = String(p.legacy_id || '');
    if (id === 'baby-boxe' || legacy === 'baby-boxe' || id === 'dp-93') return true;
    if (id === 'boxe-educative' || legacy === 'boxe-educative' || id === 'dp-45') return true;
    const title = String(p.name || p.display_name || '');
    return /BABY\s*BOXE/i.test(title) || /BOXE\s*[EÉ]DUCATIVE/i.test(title);
  }

  function ageFromBirthdate(value) {
    const raw = String(value || '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const birth = new Date(y, mo - 1, d);
    if (birth.getFullYear() !== y || birth.getMonth() !== mo - 1 || birth.getDate() !== d) return null;
    const at = new Date();
    let age = at.getFullYear() - y;
    if (at.getMonth() < mo - 1 || (at.getMonth() === mo - 1 && at.getDate() < d)) age -= 1;
    return age;
  }

  function adultOfferAgeError(birthdate, product) {
    if (isChildOfferProduct(product)) return null;
    const age = ageFromBirthdate(birthdate);
    if (age == null) return 'Date de naissance requise';
    if (age < 15) {
      return 'Cette offre est réservée aux adultes (15 ans et plus). Pour un enfant, choisissez Baby Boxe ou Boxe éducative.';
    }
    return null;
  }

  function supportsInstallmentChoice(p) {
    const id = String(p?.id || '');
    const legacy = String(p?.legacy_id || '');
    const title = String(p?.name || p?.display_name || '');
    return (
      p?.supports_installment_choice === true ||
      id === 'offre-saison' ||
      legacy === 'offre-saison' ||
      id === 'baby-boxe' ||
      legacy === 'baby-boxe' ||
      id === 'dp-93' ||
      id === 'boxe-educative' ||
      legacy === 'boxe-educative' ||
      id === 'dp-45' ||
      /BABY\s*BOXE/i.test(title) ||
      /BOXE\s*EDUCATIVE/i.test(title) ||
      /1\s*[x×]\s*ou\s*4\s*[x×]/i.test(String(p?.badge || ''))
    );
  }

  function formatFrDate(d) {
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function buildFourXScheduleHtml(quartLabel, paypal = false) {
    const today = new Date();
    const dates = [0, 30, 60, 90].map((days) => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return formatFrDate(d);
    });
    if (paypal) {
      return `
      <div class="fourx-schedule__inner">
        <p class="fourx-schedule__title">PayPal 4× — si vous êtes éligible</p>
        <p class="fourx-schedule__note">PayPal affiche le <strong>montant total</strong>. Le 4× n’apparaît que si votre compte PayPal est éligible (Pay Later). Sinon le paiement se fait en une fois.</p>
      </div>`;
    }
    return `
      <div class="fourx-schedule__inner">
        <p class="fourx-schedule__title">Calendrier 4× sans frais (carte Oney)</p>
        <ul>
          <li><strong>Aujourd’hui</strong> — paiement immédiat de <strong>${quartLabel}&nbsp;€</strong></li>
          <li><strong>${dates[1]}</strong> — 2ᵉ échéance ${quartLabel}&nbsp;€</li>
          <li><strong>${dates[2]}</strong> — 3ᵉ échéance ${quartLabel}&nbsp;€</li>
          <li><strong>${dates[3]}</strong> — 4ᵉ échéance ${quartLabel}&nbsp;€</li>
        </ul>
        <p class="fourx-schedule__note">Dates estimées à partir d’aujourd’hui (± selon Oney / PayPlug).</p>
      </div>`;
  }

  /** L'offre demande un IBAN (étape visible) — indépendant du fait qu'il soit déjà saisi. */
  function productRequiresIban(order) {
    const p = order?.product_snapshot || state.product;
    if (isComptantLikeProduct(p) || p?.requires_iban === false) return false;
    const plan = order?.payment?.billing_plan;
    if (plan === 'rib' || plan === 'paypal' || p?.requires_iban) return true;
    if (/4\s*semaines/i.test(String(p?.name || '') + String(p?.duration_label || ''))) return true;
    return false;
  }

  /** IBAN encore manquant — pour bloquer l'avancée vers le dossier. */
  function orderNeedsIban(order) {
    return (
      productRequiresIban(order) &&
      !order?.payment?.iban &&
      !order?.payment?.has_iban
    );
  }

  function paymentLogosHtml(kind) {
    const paypalImg = `<img src="https://up.yimg.com/ib/th/id/OIP.h_nvZo9_TUEbrpVqSdXsGAHaHa?pid=Api&rs=1&c=1&qlt=95&w=122&h=122" alt="PayPal" height="28" />`;
    const cardImgs = `<img src="https://tse1.mm.bing.net/th/id/OIP.i6EmD8Ol2FWxjgKeOSjh1wHaDo?r=0&pid=Api&h=220&P=0" alt="CB Visa Mastercard" height="28" />
      <img src="https://tse2.mm.bing.net/th/id/OIP.aejxZDH8dT3Q7pQ8GBLV_AHaHa?r=0&pid=Api&h=220&P=0" alt="American Express" height="28" />`;
    if (kind === 'paypal') {
      return `<span class="pay-logos" aria-hidden="true">${paypalImg}</span>`;
    }
    if (kind === 'payplug') {
      return `<span class="pay-logos" aria-hidden="true">
        <img src="https://www.onatureshop.com/img/cms/Payplug-logo.png" alt="Paiement en 4× sans frais" height="32" style="background:#111;border-radius:6px;padding:2px 6px" />
      </span>`;
    }
    if (kind === 'card-paypal') {
      return `<span class="pay-logos" aria-hidden="true">${cardImgs}${paypalImg}</span>`;
    }
    return `<span class="pay-logos" aria-hidden="true">${cardImgs}</span>`;
  }

  async function loadPayFlags(gym) {
    try {
      const qs = gym ? `?gym=${encodeURIComponent(gym)}` : '';
      const res = await fetch(`/api/payments/config${qs}`);
      const cfg = await res.json().catch(() => ({}));
      return {
        preview: Boolean(cfg.preview),
        showCard: cfg.show_cawl === true || cfg.show_payplug !== false,
        showPaypal: cfg.show_paypal !== false,
        showCawl: cfg.show_cawl === true,
        oney4x: cfg.oney_4x === true,
        oney4xMessage: cfg.oney_4x_message || '',
        portetViaPaypal: cfg.portet_via_paypal === true,
        portetViaCawl: cfg.portet_via_cawl === true,
      };
    } catch {
      return {
        preview: false,
        showCard: true,
        showPaypal: true,
        showCawl: false,
        oney4x: false,
        portetViaPaypal: false,
        portetViaCawl: false,
      };
    }
  }

  function payChoice(name, value, checked, title, small, logoKind) {
    return `<label class="billing-choice">
      <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} />
      <span class="billing-choice-text">
        <strong>${title}</strong>
        <small>${small}</small>
        ${paymentLogosHtml(logoKind)}
      </span>
    </label>`;
  }

  function payMethodsHtml(opts) {
    const onlyPaypal = opts.showPaypal && !opts.showCard;
    const pickPaypal = onlyPaypal || (opts.preferPaypal && opts.showPaypal);
    let html = '';
    if (opts.showCard) {
      html += payChoice(
        opts.name,
        opts.cardValue,
        !pickPaypal,
        opts.cardTitle,
        opts.cardSmall,
        opts.cardLogo
      );
    }
    if (opts.showPaypal) {
      html += payChoice(
        opts.name,
        opts.paypalValue,
        pickPaypal,
        opts.paypalTitle,
        opts.paypalSmall,
        'paypal'
      );
    }
    return html;
  }

  function firstPaymentCaption(product) {
    const amount = priceLabel(product);
    if (supportsInstallmentChoice(product)) {
      return `Montant total : <strong>${amount}</strong> — payez en une fois ou en 4× sans frais`;
    }
    if (isComptantLikeProduct(product)) {
      return `Paiement de : <strong>${amount}</strong>`;
    }
    if (product?.requires_iban || /4\s*semaines/i.test(String(product?.name || product?.duration_label || ''))) {
      const haystack =
        String(product?.name || '') +
        String(product?.duration_label || '') +
        String(product?.tagline || '') +
        String(product?.id || '');
      const period = /4[\s-]*sem/i.test(haystack)
        ? '4 semaines'
        : String(product?.duration_label || '').replace(/^\//, '').trim() || 'mois';
      return `Paiement de la première échéance de : <strong>${amount} / ${period}</strong>`;
    }
    return `Montant : <strong>${amount}</strong>`;
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
    const missingIban = orderNeedsIban(order);

    if (order.signature?.signed_at || order.step >= 8) return needsPay && !paid ? 4 : 8;
    if (isBalmaRetour()) {
      if (order.step >= 7 && (paid || !needsPay)) return 7;
      if (order.step >= 6) return 6;
      if (paid || !needsPay) return aventureAfterPayStep();
      if (order.customer_short) return 4;
      return 4;
    }
    if (order.step >= 7) return needsPay && !paid ? 4 : 7;
    if (order.step >= 6) return needsPay && !paid ? 4 : 6;
    if (order.step >= 5) return needsPay && !paid ? 4 : missingIban ? 5 : 6;
    if (paid || !needsPay) return missingIban ? 5 : 6;
    if (order.customer_short) return needsPay ? 4 : missingIban ? 5 : 6;
    if (order.customer_full?.gym) return 3;
    if (order.order_id) return 2;
    return 1;
  }

  function scrollFunnelTop() {
    const el =
      document.getElementById('stepper') ||
      document.querySelector('.checkout-layout') ||
      document.getElementById('stepContent');
    const y = el
      ? el.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0) - 12
      : 0;
    window.scrollTo({ top: Math.max(0, y), behavior: 'auto' });
  }

  async function persistAndRender() {
    saveProgress();
    syncUrl();
    await render();
    scrollFunnelTop();
  }

  function goToStep(step) {
    if (isBalmaRetour()) {
      if (Number(step) < 4) step = 4;
    }
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
    void persistAndRender();
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
    if (isBalmaRetour()) return '';
    return `<button type="button" class="btn secondary block step-back" data-step="${targetStep}">${label}</button>`;
  }

  function lockAventureBackNav() {
    if (!isBalmaRetour() || window.__bcAventureLock) return;
    window.__bcAventureLock = true;
    history.pushState({ aventureLock: true }, '', location.href);
    window.addEventListener('popstate', () => {
      history.pushState({ aventureLock: true }, '', location.href);
    });
  }

  function bindBackButtons() {
    stepContent.querySelectorAll('.step-back').forEach((btn) => {
      btn.onclick = () => goToStep(Number(btn.dataset.step));
    });
  }

  function updateStepper(step) {
    const orderLike = state.order || { product_snapshot: state.product };
    const hideIban = !productRequiresIban(orderLike);
    const hidePay = !orderRequiresPayment(orderLike);
    const hideGym = isBalmaRetour();
    const hideOffer = isBalmaRetour();
    const hideIdentity = isBalmaRetour();
    const hideDossier = false;
    const visible = [];
    document.querySelectorAll('.stepper-step').forEach((el) => {
      const s = Number(el.dataset.step);
      const hide =
        (s === 5 && hideIban) ||
        (s === 4 && hidePay) ||
        (s === 2 && hideGym) ||
        (s === 1 && hideOffer) ||
        (s === 3 && hideIdentity) ||
        (s === 6 && hideDossier);
      el.hidden = hide;
      el.classList.toggle('stepper-skipped', hide);
      if (!hide) visible.push(el);
      el.classList.toggle('active', s === step);
      el.classList.toggle('done', s < step && !hide);
    });
    // Numérotation continue (1…n) sur les étapes visibles — pas de trou 3→6
    visible.forEach((el, i) => {
      const num = el.querySelector('.stepper-num');
      if (num) num.textContent = String(i + 1);
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
    const qs = new URLSearchParams({ token: state.token, bc_token: state.token });
    if (state.sessionId) qs.set('session_id', state.sessionId);
    const res = await fetch(`/api/orders/${state.orderId}?${qs}`);
    if (!res.ok) return false;
    const data = await res.json();
    state.order = data.order;
    state.product = state.order.product_snapshot;
    if (!state.productId && state.product?.id) state.productId = state.product.id;
    if (state.order.documents?.photo || state.order.documents?.photo_url || state.order.documents?.has_photo) {
      state.photoUploaded = true;
    }
    state.step = stepFromOrder(state.order);
    return true;
  }

  async function loadPaypalMessaging(amountEuros) {
    try {
      const gym = state.order?.customer_full?.gym || state.gymDraft || '';
      const qs = gym ? `?gym=${encodeURIComponent(gym)}` : '';
      const res = await fetch(`/api/payments/config${qs}`);
      const cfg = await res.json().catch(() => ({}));
      if (!cfg.ok || !cfg.paypal_client_id) return;
      const renderMsg = () => {
        if (!window.paypal?.Messages || !document.querySelector('[data-pp-message]')) return;
        window.paypal.Messages({ amount: amountEuros, style: { layout: 'text' } }).render('[data-pp-message]');
      };
      if (document.getElementById('paypal-sdk-js')) {
        renderMsg();
        return;
      }
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.id = 'paypal-sdk-js';
        s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.paypal_client_id)}&currency=EUR&components=messages&enable-funding=paylater`;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      renderMsg();
    } catch {
      /* messaging optionnel */
    }
  }

  function orderErrorMessage(data) {
    if (data.message) return data.message;
    if (data.error === 'payment_not_completed' || data.error === 'payment_required') {
      return paymentFailureMessage();
    }
    if (data.code === 'adult_offer_age' || /réservée aux adultes/i.test(String(data.error || ''))) {
      return (
        data.error ||
        'Cette offre est réservée aux adultes (15 ans et plus). Pour un enfant, choisissez Baby Boxe ou Boxe éducative.'
      );
    }
    if (data.code === 'oney_4x_unavailable' || /4× sans frais.*indisponible/i.test(String(data.error || ''))) {
      return (
        data.error ||
        'Le 4× sans frais par carte (PayPlug) est momentanément indisponible. Vous pouvez payer en 4× via PayPal, ou régler en une fois par carte ou PayPal.'
      );
    }
    if (data.error === 'payplug_not_configured') {
      return 'Paiement carte temporairement indisponible. Essayez PayPal, ou contactez le club.';
    }
    if (data.error === 'payplug_url_missing') {
      return 'Impossible d\'ouvrir le paiement PayPlug. Réessayez ou choisissez PayPal.';
    }
    if (data.error === 'cawl_not_configured') {
      return 'Paiement CAWL temporairement indisponible. Contactez le club.';
    }
    if (data.error === 'cawl_url_missing') {
      return 'Impossible d\'ouvrir le paiement CAWL. Réessayez, ou contactez le club.';
    }
    if (/CAWL Portet est mal configuré/i.test(String(data.error || ''))) {
      return data.error;
    }
    if (data.error === 'paypal_not_configured') {
      return 'PayPal temporairement indisponible. Choisissez la carte, ou contactez le club.';
    }
    if (/PayPal Portet est mal configuré|Client Authentication failed/i.test(String(data.error || ''))) {
      return (
        data.error ||
        'PayPal Portet est mal configuré. Payez par carte, ou réessayez plus tard.'
      );
    }
    if (data.error === 'paypal_url_missing') {
      return 'Impossible d\'ouvrir PayPal. Réessayez ou choisissez la carte.';
    }
    if (data.error === 'stripe_not_configured') {
      return 'Paiement temporairement indisponible. Contactez le club.';
    }
    if (data.error === 'not_found') {
      return 'Dossier introuvable. Revenez à l\'étape identité et recommencez, ou contactez le club.';
    }
    return (data.errors || [data.error]).filter(Boolean).join(', ');
  }

  function readReferralFriend() {
    try {
      const raw = sessionStorage.getItem('boxplus_referral_friend');
      if (!raw) return null;
      const friend = JSON.parse(raw);
      if (!friend || !friend.prenom || !friend.telephone) return null;
      return friend;
    } catch (e) {
      return null;
    }
  }

  function referralFriendPayload() {
    const friend = readReferralFriend();
    return friend ? { referral_friend: friend } : {};
  }

  function payRequestBody(extra = {}) {
    const short = state.order?.customer_short || state.shortDraft;
    const email = isBalmaRetour()
      ? document.getElementById('pay_email')?.value?.trim() || short?.email || ''
      : short?.email;
    const phone = isBalmaRetour() ? '' : short?.phone;
    return {
      token: state.token,
      product_id: state.productId,
      gym: state.order?.customer_full?.gym || state.gymDraft || 'minimes',
      email,
      phone,
      customer_short: short
        ? {
            first_name: short.first_name,
            last_name: short.last_name,
            email,
            phone,
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

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
    // Offre gratuite → pas d’écran paiement
    if (!orderRequiresPayment(state.order || { product_snapshot: state.product })) {
      await ensureFreeOrderMarked();
      state.step = nextStepAfterIdentity();
      if (state.step === 4) state.step = 6;
      persistAndRender();
      return;
    }
    if (state.order?.payment?.status === 'paid') {
      state.step = stepFromOrder(state.order);
      if (state.step !== 4) {
        persistAndRender();
        return;
      }
    }
    if (params.get('payplug_return') === '1') {
      await confirmPayplugReturn();
      if (state.order?.payment?.status === 'paid') {
        persistAndRender();
        return;
      }
    }
    if (params.get('cawl_return') === '1') {
      await confirmCawlReturn();
      if (state.order?.payment?.status === 'paid') {
        persistAndRender();
        return;
      }
    }
    if (params.get('paypal_return') === '1') {
      await confirmPaypalReturn();
      if (state.order?.payment?.status === 'paid') {
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
    const installmentChoice = supportsInstallmentChoice(p);
    const isComptantLike = isComptantLikeProduct(p) && !installmentChoice;
    const isPrelevement =
      !isComptantLike &&
      !installmentChoice &&
      (Boolean(p?.requires_iban) || Boolean(p?.supports_billing_choice));
    /* Essai / coaching / carte (et tout one-shot payant hors prélèvement / 4×) */
    const isOneShotPaid =
      !installmentChoice &&
      !isPrelevement &&
      orderRequiresPayment({ product_snapshot: p });
    const savedPlan = state.order?.payment?.billing_plan === 'paypal' ? 'paypal' : 'rib';
    const full = state.order?.customer_full || {};
    const payFlags = await loadPayFlags(full.gym);
    const portetViaCawl = payFlags.portetViaCawl === true;
    const oney4x = portetViaCawl ? true : payFlags.oney4x === true;
    const savedInstallment = state.order?.payment?.payment_plan === '4x' ? '4x' : 'once';
    const oneyNotice =
      installmentChoice && !oney4x
        ? `<p class="portet-pay-notice">${esc(
            payFlags.oney4xMessage ||
              'Le 4× sans frais par carte (PayPlug) est momentanément indisponible. Le 4× est disponible via PayPal, dans toutes les salles.'
          )}</p>`
        : '';
    const showCard = portetViaCawl || payFlags.showCard;
    const showPaypal = portetViaCawl ? false : payFlags.showPaypal;
    const portetViaPaypal = !portetViaCawl && payFlags.portetViaPaypal === true && showPaypal;
    const cardLogoKind = portetViaPaypal ? 'card-paypal' : 'card';
    const cardSmallOnce = portetViaPaypal
      ? 'Carte via PayPal'
      : portetViaCawl
        ? 'Paiement sécurisé CAWL'
        : 'Paiement sécurisé';
    const paypalMsgHtml = showPaypal
      ? `<div class="full" style="margin-top:8px">
              <div data-pp-message data-pp-style-layout="text" data-pp-style-logo-type="inline" data-pp-amount="${(Number(p.price_cents || 0) / 100).toFixed(2)}"></div>
            </div>`
      : '';
    const emptyPayHtml =
      '<p class="portet-pay-notice">Paiement temporairement indisponible. Contactez le club.</p>';
    const balmaBadgeNotice =
      isBalmaRetour() && (state.productId === 'offre-duo' || /29/.test(String(state.productId || '')))
        ? `<p class="portet-pay-notice">Badge d’accès : ton ancien badge est réactivé. Il n’est <strong>pas prélevé</strong> (offert, déjà réglé).</p>`
        : '';
    const previewNotice = payFlags.preview
      ? isBalmaRetour()
        ? '<p class="portet-pay-notice">Studio : paiement sandbox. Email obligatoire ici pour la confirmation — pas recopié sur la fiche Minimes.</p>'
        : '<p class="portet-pay-notice">Studio : tous les moyens branchés s’affichent. Les visiteurs verront les cases enregistrées après déconnexion.</p>'
      : '';

    let billingHtml = '';
    if (installmentChoice) {
      const quart = ((Number(p.price_cents || 0) / 100) / 4).toFixed(2).replace('.', ',');
      const savedMethod = state.order?.payment?.preferred_checkout || 'card';
      const onceMethods = payMethodsHtml({
        name: 'pay_method_once',
        cardValue: 'card',
        paypalValue: 'paypal',
        showCard,
        showPaypal,
        preferPaypal: savedMethod === 'paypal',
        cardTitle: 'Carte bancaire',
        cardSmall: cardSmallOnce,
        paypalTitle: 'PayPal',
        paypalSmall: 'Paiement sécurisé',
        cardLogo: cardLogoKind,
      });
      const fourMethods =
        payMethodsHtml({
          name: 'pay_method_4x',
          cardValue: 'payplug',
          paypalValue: 'paypal',
          showCard: showCard && oney4x,
          showPaypal,
          preferPaypal: !portetViaCawl,
          cardTitle: '4× sans frais',
          cardSmall: portetViaCawl ? 'Carte CAWL / Oney' : 'Carte PayPlug / Oney',
          paypalTitle: 'PayPal 4×',
          paypalSmall: '4× Pay Later si éligible — sinon paiement du montant total',
          cardLogo: 'payplug',
        }) + paypalMsgHtml;
      billingHtml = `
        <div class="full billing-plan-block">
          ${previewNotice}
          ${oneyNotice}
          <p class="sub" style="margin-top:0">Étape 1 — Comment souhaitez-vous régler ?</p>
          <div class="billing-choice-row" role="radiogroup" aria-label="Type de paiement">
            <label class="billing-choice">
              <input type="radio" name="payment_plan" value="once" ${savedInstallment !== '4x' ? 'checked' : ''} />
              <span class="billing-choice-text">
                <strong>En une seule fois</strong>
                <small>${priceLabel(p)}</small>
              </span>
            </label>
            <label class="billing-choice">
              <input type="radio" name="payment_plan" value="4x" ${savedInstallment === '4x' ? 'checked' : ''} />
              <span class="billing-choice-text">
                <strong>En 4× sans frais</strong>
                <small>${
                  oney4x
                    ? portetViaCawl
                      ? `Carte : ${quart}&nbsp;€ tout de suite, puis 3 échéances.`
                      : `Carte PayPlug/Oney : ${quart}&nbsp;€ tout de suite, puis 3 échéances. PayPal : 4× si éligible.`
                    : 'Pour le moment via PayPal uniquement (PayPlug 4× indisponible).'
                }</small>
              </span>
            </label>
          </div>
          <div id="fourXSchedule" class="fourx-schedule" style="display:none" aria-live="polite"></div>
          <p class="sub" style="margin:16px 0 8px">Étape 2 — Choisissez votre moyen de paiement</p>
          <div id="onceMethods" class="billing-choice-row">${onceMethods || emptyPayHtml}</div>
          <div id="fourXMethods" class="billing-choice-row" style="display:none">${fourMethods || emptyPayHtml}</div>
          <div id="fourXAddress" class="form-grid" style="display:none;margin-top:12px">
            <p class="sub full" style="margin:0 0 8px">Adresse et civilité requises pour le 4× carte (Oney) :</p>
            <div>
              <label>Civilité *</label>
              <select name="gender">
                <option value="">—</option>
                <option value="M" ${full.gender === 'M' ? 'selected' : ''}>Homme</option>
                <option value="F" ${full.gender === 'F' ? 'selected' : ''}>Femme</option>
              </select>
            </div>
            <div class="full"><label>Adresse *</label><input name="address" value="${esc(full.address || '')}" /></div>
            <div><label>Code postal *</label><input name="postal_code" inputmode="numeric" maxlength="5" pattern="\\d{5}" value="${esc(full.postal_code || '')}" /></div>
            <div><label>Ville *</label><input name="city" value="${esc(full.city || '')}" /></div>
          </div>
        </div>`;
    } else if (isPrelevement) {
      const methods = payMethodsHtml({
        name: 'billing_plan',
        cardValue: 'rib',
        paypalValue: 'paypal',
        showCard,
        showPaypal,
        preferPaypal: savedPlan === 'paypal',
        cardTitle: 'Carte bancaire',
        cardSmall: portetViaCawl
          ? '1ʳᵉ échéance par carte, puis prélèvement sans engagement'
          : portetViaPaypal
            ? '1ʳᵉ échéance via PayPal, puis prélèvement sans engagement'
            : '1ʳᵉ échéance par carte, puis prélèvement sans engagement',
        paypalTitle: 'PayPal',
        paypalSmall: '1ʳᵉ échéance PayPal, puis prélèvement sans engagement',
        cardLogo: cardLogoKind,
      });
      billingHtml = `
        <div class="full billing-plan-block">
          ${previewNotice}
          <div class="billing-choice-row" role="radiogroup" aria-label="Mode de paiement">
            ${methods || emptyPayHtml}
          </div>
        </div>`;
    } else if (isComptantLike || isOneShotPaid) {
      const savedOneShot =
        state.order?.payment?.preferred_checkout === 'paypal' ||
        state.order?.payment?.billing_plan === 'paypal'
          ? 'paypal'
          : 'card';
      const methods = payMethodsHtml({
        name: 'billing_plan',
        cardValue: 'card',
        paypalValue: 'paypal',
        showCard,
        showPaypal,
        preferPaypal: savedOneShot === 'paypal',
        cardTitle: 'Carte bancaire',
        cardSmall: portetViaCawl
          ? 'Paiement sécurisé CAWL'
          : portetViaPaypal
            ? 'Carte via PayPal'
            : 'En une seule fois',
        paypalTitle: 'PayPal',
        paypalSmall: 'En une seule fois',
        cardLogo: cardLogoKind,
      });
      billingHtml = `
        <div class="full billing-plan-block">
          ${previewNotice}
          <div class="billing-choice-row" role="radiogroup" aria-label="Mode de paiement">
            ${methods || emptyPayHtml}
          </div>
        </div>`;
    }

    const shortPay = state.order?.customer_short || state.shortDraft || {};
    const aventureEmailHtml = isBalmaRetour()
      ? `<div class="form-grid" style="margin-bottom:16px">
          <div class="full"><label for="pay_email">Email</label>
            <input id="pay_email" name="email" type="email" value="${esc(shortPay.email || '')}" autocomplete="email" />
            <p class="sub" style="margin:6px 0 0">À remplir seulement s’il y a plusieurs fiches au même nom.</p>
          </div>
        </div>`
      : '';
    stepContent.innerHTML = `
      <h1>Paiement</h1>
      ${
        isBalmaRetour() && (state.aventureDossierSaved || state.order?.customer_full?.address)
          ? `<div class="notice-important" style="margin:0 0 16px"><strong>Dossier enregistré</strong><p>Pas de téléphone ni d’e-mail sur la fiche Minimes — on ajoute « Balma » à ton prénom. Le club te recontacte. Tu peux aussi payer maintenant.</p></div>`
          : ''
      }
      <p class="sub">${firstPaymentCaption(p)}</p>
      ${balmaBadgeNotice}
      <form id="payForm">
        ${aventureEmailHtml}
        ${billingHtml}
        <button type="submit" class="btn stripe block" id="payBtn">${
          p?.requires_payment === false ? 'Continuer' : 'Payer'
        }</button>
        ${
          isBalmaRetour()
            ? `<button type="button" class="btn secondary block" id="aventureDossierBtn" style="margin-top:12px">Continuer le dossier sans payer maintenant</button>`
            : ''
        }
        ${backButton('← Retour', 3)}
      </form>`;
    bindBillingPlanForm();
    if (installmentChoice) {
      const quart = ((Number(p.price_cents || 0) / 100) / 4).toFixed(2).replace('.', ',');
      const syncInstallmentUi = () => {
        const plan = document.querySelector('input[name="payment_plan"]:checked')?.value || 'once';
        const onceBox = document.getElementById('onceMethods');
        const fourBox = document.getElementById('fourXMethods');
        const addrBox = document.getElementById('fourXAddress');
        const schedule = document.getElementById('fourXSchedule');
        const payBtn = document.getElementById('payBtn');
        const fourMethod =
          document.querySelector('input[name="pay_method_4x"]:checked')?.value ||
          (oney4x && showCard && !showPaypal ? 'payplug' : 'paypal');
        if (onceBox) onceBox.style.display = plan === 'once' ? '' : 'none';
        if (fourBox) fourBox.style.display = plan === '4x' ? '' : 'none';
        if (schedule) {
          schedule.style.display = plan === '4x' ? '' : 'none';
          if (plan === '4x') schedule.innerHTML = buildFourXScheduleHtml(quart, fourMethod === 'paypal');
        }
        const needAddress = plan === '4x' && fourMethod === 'payplug' && oney4x;
        if (addrBox) {
          addrBox.style.display = needAddress ? '' : 'none';
          addrBox.querySelectorAll('input').forEach((input) => {
            input.required = needAddress;
          });
        }
        if (payBtn) {
          const totalLabel = priceLabel(p);
          payBtn.textContent =
            plan === '4x'
              ? fourMethod === 'paypal'
                ? `Payer ${totalLabel} via PayPal (4× si éligible)`
                : `Payer ${quart} € maintenant (4× sans frais)`
              : 'Payer en une fois';
        }
      };
      document
        .querySelectorAll('input[name="payment_plan"], input[name="pay_method_4x"]')
        .forEach((el) => {
          el.addEventListener('change', syncInstallmentUi);
        });
      syncInstallmentUi();
      if (showPaypal) {
        loadPaypalMessaging((Number(p.price_cents || 0) / 100).toFixed(2)).catch(() => {});
      }
    } else if (showPaypal) {
      loadPaypalMessaging((Number(p?.price_cents || 0) / 100).toFixed(2)).catch(() => {});
    }
    const payBtnEl = document.getElementById('payBtn');
    if (payBtnEl && !showCard && !showPaypal) payBtnEl.disabled = true;
    document.getElementById('payForm').onsubmit = async (e) => {
      e.preventDefault();
      setMsg('Redirection…');
      saveProgress();
      const body = payRequestBody();
      const planInput = document.querySelector('input[name="billing_plan"]:checked');
      const installmentInput = document.querySelector('input[name="payment_plan"]:checked');
      if (installmentChoice) {
        body.payment_plan = installmentInput?.value || 'once';
        if (body.payment_plan === '4x') {
          const fourMethod =
            document.querySelector('input[name="pay_method_4x"]:checked')?.value || 'paypal';
          body.pay_method = fourMethod === 'payplug' && oney4x ? 'payplug' : 'paypal';
          body.billing_plan = body.pay_method === 'paypal' ? 'paypal' : null;
          if (body.pay_method === 'payplug') {
            body.address = document.querySelector('#fourXAddress input[name="address"]')?.value?.trim();
            body.postal_code = document
              .querySelector('#fourXAddress input[name="postal_code"]')
              ?.value?.trim();
            body.city = document.querySelector('#fourXAddress input[name="city"]')?.value?.trim();
            body.gender = document.querySelector('#fourXAddress select[name="gender"]')?.value;
            if (!body.gender) {
              setMsg('Civilité requise pour le paiement en 4× carte.', 'err');
              return;
            }
            if (!body.address || !body.city || !/^\d{5}$/.test(body.postal_code || '')) {
              setMsg('Adresse complète et code postal à 5 chiffres requis pour le 4× carte.', 'err');
              return;
            }
          }
        } else {
          const onceMethod =
            document.querySelector('input[name="pay_method_once"]:checked')?.value || 'card';
          body.pay_method = onceMethod;
          body.billing_plan = onceMethod === 'paypal' ? 'paypal' : null;
        }
      } else if (isComptantLike || isOneShotPaid) {
        const method = planInput?.value === 'paypal' ? 'paypal' : 'card';
        body.billing_plan = method === 'paypal' ? 'paypal' : null;
        body.pay_method = method;
      } else if (planInput) {
        body.billing_plan = planInput.value;
      } else if (isPrelevement) {
        body.billing_plan = 'rib';
      }
      if (portetViaCawl) {
        body.pay_method = 'cawl';
        if (body.billing_plan === 'paypal') {
          body.billing_plan = isPrelevement ? 'rib' : null;
        }
      } else if (portetViaPaypal) {
        const wasPaypalTile = body.pay_method === 'paypal';
        body.pay_method = 'paypal';
        body.billing_plan = 'paypal';
        body.paypal_landing = wasPaypalTile ? 'login' : 'billing';
        body.paypal_guest_card = !wasPaypalTile && body.payment_plan !== '4x';
      }
      if (isBalmaRetour() && (state.productId === 'offre-duo' || /29/.test(state.productId || ''))) {
        body.badge_timing = 'immediate';
        body.badge_method = 'comptant';
      } else {
        body.badge_timing = 'deferred';
        body.badge_method = 'iban';
      }
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
    const skipPayBtn = document.getElementById('aventureDossierBtn');
    if (skipPayBtn) {
      skipPayBtn.onclick = () => {
        setMsg('');
        goToStep(6);
      };
    }
  }

  function guardPaidStep() {
    if (isBalmaRetour() && (state.step === 5 || state.step === 6)) return false;
    if (!orderRequiresPayment(state.order) || state.order?.payment?.status === 'paid') return false;
    state.step = 4;
    setMsg(paymentFailureMessage(), 'err');
    persistAndRender();
    return true;
  }

  function roundClockHtml() {
    if (state.order?.payment?.status !== 'paid') return '';
    const paidAt = Date.parse(state.order?.payment?.paid_at || '');
    const deadlineAt = Date.parse(state.order?.funnel?.complete_deadline_at || '');
    const start = Number.isFinite(deadlineAt)
      ? deadlineAt - 30 * 60 * 1000
      : paidAt;
    if (!Number.isFinite(start)) return '';
    return `<aside class="round-clock" id="roundClock" data-paid-at="${start}" role="timer" aria-live="polite">
      <span class="round-clock__kicker">Round de 30 min</span>
      <span class="round-clock__time" id="roundClockTime">30:00</span>
      <p class="round-clock__copy" id="roundClockCopy">Le gong a sonné : tu as payé, mais tu n’es pas encore sur le ring. Finis dossier + signature avant la fin du round — sinon le club ne te verra pas inscrit.</p>
    </aside>`;
  }

  function bindRoundClock() {
    const root = document.getElementById('roundClock');
    const timeEl = document.getElementById('roundClockTime');
    const copyEl = document.getElementById('roundClockCopy');
    if (!root || !timeEl) return;
    const paidAt = Number(root.getAttribute('data-paid-at') || 0);
    const limitMs = 30 * 60 * 1000;
    let nudgeTries = 0;
    const fireNudge = () => {
      if (!state.orderId || !state.token || nudgeTries >= 6) return;
      nudgeTries += 1;
      fetch(`/api/orders/${encodeURIComponent(state.orderId)}/nudge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: state.token,
          bc_token: state.token,
          session_id: state.sessionId || undefined,
        }),
      })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (data?.complete || data?.skipped) return;
          window.setTimeout(fireNudge, 8000);
        })
        .catch(() => {
          window.setTimeout(fireNudge, 8000);
        });
    };
    const tick = () => {
      const left = Math.max(0, paidAt + limitMs - Date.now());
      const totalSec = Math.floor(left / 1000);
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
      const ss = String(totalSec % 60).padStart(2, '0');
      timeEl.textContent = `${mm}:${ss}`;
      root.classList.toggle('is-urgent', left > 0 && left <= 5 * 60 * 1000);
      root.classList.toggle('is-over', left <= 0);
      if (left <= 0) {
        if (copyEl) {
          copyEl.textContent =
            'Gong ! Le round est clos. On t’envoie un rappel — reviens signer pour être sur la feuille. Sans ça, tu n’es pas inscrit en salle.';
        }
        if (nudgeTries === 0) fireNudge();
      }
    };
    tick();
    if (root._roundTimer) clearInterval(root._roundTimer);
    root._roundTimer = setInterval(tick, 1000);
  }

  /* ——— Steps ——— */

  function renderStep1() {
    const p = state.product;
    if (!p) {
      stepContent.innerHTML = `
        <h1>Votre offre</h1>
        <p class="sub">Cette offre est introuvable ou n'est plus disponible.</p>
        <a href="/abonnements" class="btn block" id="seeOffers">Voir les offres disponibles</a>`;
      document.getElementById('seeOffers').onclick = leaveToChooseAnotherOffer;
      return;
    }
    const desc =
      (window.BCOffers && typeof window.BCOffers.offerDescription === 'function'
        ? window.BCOffers.offerDescription(p)
        : null) ||
      p.description ||
      '';
    const payMode =
      window.BCOffers && typeof window.BCOffers.formatPaymentMode === 'function'
        ? window.BCOffers.formatPaymentMode(p)
        : p.installments_note || '';
    const duration =
      window.BCOffers && typeof window.BCOffers.formatDuration === 'function'
        ? window.BCOffers.formatDuration(p)
        : p.duration_label || '';
    const benefits = Array.isArray(p.benefits) && p.benefits.length
      ? p.benefits
      : [
          'Accès aux 5 salles',
          'Cours illimités + accès libre',
          'Encadrement coach professionnel',
          'Accès libre inclus de 10h à 21h30',
        ];
    stepContent.innerHTML = `
      <h1>Votre offre</h1>
      <div class="offer-card" style="margin-bottom:24px">
        ${p.badge ? `<span class="offer-tag">${esc(p.badge)}</span>` : ''}
        <h3>${esc(p.display_name || p.name)}</h3>
        <div class="offer-price${p.price_was_label ? ' offer-price--promo' : ''}">
          ${p.price_was_label ? `<span class="offer-price-was">${esc(p.price_was_label)}</span>` : ''}
          <span class="offer-price-now">${esc(p.stripe_price_label || p.price_label)}</span>
        </div>
        ${p.installments_note ? `<p class="offer-price-sub">${esc(p.installments_note)}</p>` : ''}
        ${
          desc
            ? `<div class="offer-selection-description"><strong>À retenir</strong><p>${esc(desc)}</p></div>`
            : ''
        }
        <ul class="offer-benefits" style="margin-top:12px">
          ${benefits.map((b) => `<li>${esc(b)}</li>`).join('')}
        </ul>
        <div class="offer-meta" style="margin-top:12px">
          ${duration ? `<div><strong>Durée :</strong> ${esc(duration)}</div>` : ''}
          ${payMode ? `<div><strong>Paiement :</strong> ${esc(payMode)}</div>` : ''}
      </div>
      </div>
      <button type="button" class="btn block" id="toStep2">Continuer</button>`;
    document.getElementById('toStep2').onclick = () => {
      if (isBalmaRetour()) {
        state.gymDraft = 'minimes';
        goToStep(4);
        return;
      }
      goToStep(2);
    };
  }

  function renderStep2() {
    const selected = state.order?.customer_full?.gym || state.gymDraft || '';
    stepContent.innerHTML = `
      <h1>Votre salle</h1>
      <form id="gymForm" class="form-grid">
        <div class="full"><label for="gym">Salle principale *</label>
          <select id="gym" name="gym" required>${gymsOptions(selected)}</select>
        </div>
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
          body: JSON.stringify({
            product_id: state.productId,
            gym,
            source: params.get('source') || undefined,
          }),
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
          body: JSON.stringify({
            token: state.token,
            gym,
            product_id: state.productId,
            source: params.get('source') || undefined,
          }),
        });
        const data = await res.json();
        if (!data.ok && (data.error === 'not_found' || res.status === 404)) {
          const retry = await fetch('/api/orders/draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product_id: state.productId,
              gym,
              source: params.get('source') || undefined,
            }),
          });
          const created = await retry.json();
          if (!created.ok) {
            setMsg(orderErrorMessage(created), 'err');
            return;
          }
          adoptCheckoutIds(created);
        } else if (!data.ok) {
          setMsg(orderErrorMessage(data), 'err');
          return;
        } else {
          adoptCheckoutIds(data);
        }
        state.order = state.order || {};
        state.order.customer_full = { ...(state.order.customer_full || {}), gym };
      }
      setMsg('');
      goToStep(3);
    };
  }

  function renderStep3() {
    // coordonnées déjà données à l'assistant d'un site du club → préremplies ;
    // ce que l'utilisateur a saisi ICI (brouillon/commande) garde la priorité.
    let bcpPrefill = {};
    try { bcpPrefill = JSON.parse(sessionStorage.getItem('bcp_prefill') || '{}'); } catch (e) { /* vide */ }
    const fromTunnel = {
      first_name: params.get('prenom') || params.get('first_name') || '',
      last_name: params.get('nom') || params.get('last_name') || '',
      email: params.get('email') || '',
      phone: params.get('phone') || params.get('telephone') || '',
      birthdate: params.get('birthdate') || params.get('naissance') || '',
    };
    Object.keys(fromTunnel).forEach((k) => {
      if (!fromTunnel[k]) delete fromTunnel[k];
    });
    const short = {
      ...bcpPrefill,
      ...fromTunnel,
      ...(state.order?.customer_short || state.shortDraft || {}),
    };
    const birthMax = new Date().toISOString().slice(0, 10);
    stepContent.innerHTML = `
      <h1>Vos coordonnées</h1>
      <form id="shortForm" class="form-grid">
        <div><label for="first_name">Prénom *</label><input id="first_name" name="first_name" required value="${esc(short.first_name || '')}" /></div>
        <div><label for="last_name">Nom *</label><input id="last_name" name="last_name" required value="${esc(short.last_name || '')}" /></div>
        <div class="full"><label for="email">Email *</label><input id="email" name="email" type="email" required value="${esc(short.email || '')}" /></div>
        <div class="full"><label for="phone">Téléphone mobile *</label><input id="phone" name="phone" type="tel" required inputmode="tel" autocomplete="tel" placeholder="06 12 34 56 78" value="${esc(short.phone || '')}" /></div>
        <div class="full"><label for="birthdate">Date de naissance *</label>
          <input id="birthdate" name="birthdate" type="date" required
            min="1900-01-01" max="${birthMax}"
            value="${esc(short.birthdate || '')}" /></div>
        <div class="full"><button type="submit" class="btn block">Continuer</button></div>
        <div class="full">${backButton('← Retour à la salle', 2)}</div>
      </form>`;
    const form = document.getElementById('shortForm');
    bindShortDraftAutosave(form);
    bindBackButtons();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      // Conserver une date déjà en dossier / préremplie
      if (!body.birthdate && short.birthdate) body.birthdate = short.birthdate;
      const phoneDigits = String(body.phone || '').replace(/\D/g, '');
      const phoneOk =
        /^0[67]\d{8}$/.test(phoneDigits) ||
        /^33[67]\d{8}$/.test(phoneDigits) ||
        /^[67]\d{8}$/.test(phoneDigits);
      if (!phoneOk) {
        setMsg('Téléphone mobile FR requis (ex. 06 12 34 56 78).', 'err');
        return;
      }
      const birthErr = validateBirthdateClient(body.birthdate);
      if (birthErr) {
        setMsg(birthErr, 'err');
        return;
      }
      const ageErr = adultOfferAgeError(body.birthdate, state.product);
      if (ageErr) {
        setMsg(ageErr, 'err');
        return;
      }
      setMsg('Envoi…');
      body.token = state.token;
      body.gym = state.order?.customer_full?.gym || state.gymDraft || (isBalmaRetour() ? 'minimes' : undefined);
      state.shortDraft = body;
      saveProgress();

      if (!state.orderId) {
      const res = await fetch('/api/orders/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            product_id: state.productId,
            source: params.get('source') || undefined,
            ...referralFriendPayload(),
          }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg((data.errors || [data.error]).join(', '), 'err');
        return;
      }
      adoptCheckoutIds(data);
      } else {
        const res = await fetch(`/api/orders/${state.orderId}/identity`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            product_id: state.productId,
            product_snapshot: state.product || state.order?.product_snapshot,
            ...referralFriendPayload(),
          }),
        });
        const data = await res.json();
        if (!data.ok && (data.error === 'not_found' || res.status === 404)) {
          const retry = await fetch('/api/orders/draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...body,
              product_id: state.productId,
              source: params.get('source') || undefined,
              ...referralFriendPayload(),
            }),
          });
          const created = await retry.json();
          if (!created.ok) {
            setMsg((created.errors || [created.error]).join(', '), 'err');
            return;
          }
          adoptCheckoutIds(created);
        } else if (!data.ok) {
          setMsg(orderErrorMessage(data), 'err');
          return;
        } else {
          adoptCheckoutIds(data);
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
      if (!orderRequiresPayment(state.order || { product_snapshot: state.product })) {
        await ensureFreeOrderMarked();
        goToStep(nextStepAfterIdentity());
        return;
      }
      goToStep(4);
    };
  }

  function validateBirthdateClient(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      return 'Date de naissance invalide';
    }
    const [y, m, d] = String(value).split('-').map(Number);
    if (y < 1900 || y > new Date().getFullYear()) {
      return 'Année de naissance invalide';
    }
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
      return 'Date de naissance invalide';
    }
    if (dt > new Date()) return 'Date de naissance invalide';
    const age = ageFromBirthdate(value);
    if (age != null && age < 3) return 'L’adhérent doit avoir au moins 3 ans';
    return null;
  }

  function renderStep5() {
    if (guardPaidStep()) return;
    // Offre sans IBAN → passer. Sinon toujours afficher (même si déjà saisi) pour pouvoir modifier.
    if (!productRequiresIban(state.order)) {
      goToStep(6);
      return;
    }
    const existingIban = state.order?.payment?.iban || '';
    const ibanMasked = state.order?.payment?.iban_masked || '';
    const hasIban = Boolean(existingIban || state.order?.payment?.has_iban);
    const ibanFrMessage =
      'Seuls les IBAN français commençant par FR sont acceptés. Si vous n’en avez pas, rapprochez-vous du manager de votre salle.';
    stepContent.innerHTML = `
      ${roundClockHtml()}
      <h1>Coordonnées bancaires</h1>
      <p class="sub">Indiquez votre IBAN pour les prochaines échéances — prélèvement sans engagement, sans surprise.</p>
      <div class="notice-important" style="margin-bottom:20px">
        <strong>IBAN français uniquement</strong>
        <p>Seuls les IBAN commençant par FR sont acceptés. Si vous n’avez pas de compte bancaire français, rapprochez-vous du manager de votre salle.</p>
      </div>
      <form id="ibanForm" class="form-grid">
        <div class="full">
          <label for="iban">IBAN français (commence par FR) ${hasIban ? '' : '*'}</label>
          <input id="iban" name="iban" ${hasIban ? '' : 'required'} placeholder="${hasIban ? ibanMasked : 'FR76 3000 6000 0112 3456 7890 189'}" autocomplete="off" spellcheck="false" value="${esc(existingIban)}" />
          <p class="iban-fr-hint">Exemple : FR76 … — les IBAN étrangers (DE, ES, BE…) ne passent pas.</p>
        </div>
        <div class="full"><button type="submit" class="btn block">Continuer</button></div>
        <div class="full">${backButton('← Retour au paiement', 4)}</div>
      </form>`;
    bindBackButtons();
    document.getElementById('ibanForm').onsubmit = async (e) => {
      e.preventDefault();
      const iban = document.getElementById('iban').value;
      const compact = String(iban || '').replace(/\s+/g, '').toUpperCase();
      if (!compact.startsWith('FR')) {
        setMsg(ibanFrMessage, 'err');
        return;
      }
      setMsg('Enregistrement…');
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
      // Garde l'IBAN en local même si le rechargement serveur est en retard
      state.order = state.order || {};
      state.order.payment = { ...(state.order.payment || {}), iban: String(iban || '').replace(/\s+/g, '').toUpperCase() };
      state.order.customer_full = { ...(state.order.customer_full || {}), iban: state.order.payment.iban };
      setMsg('');
      await loadOrder();
      if (!state.order?.payment?.iban) {
        state.order.payment = { ...(state.order.payment || {}), iban: String(iban || '').replace(/\s+/g, '').toUpperCase() };
      }
      goToStep(6);
    };
    bindRoundClock();
  }

  function renderStep6() {
    if (guardPaidStep()) return;
    if (!isBalmaRetour() && orderNeedsIban(state.order)) {
      goToStep(5);
      return;
    }
    const full = state.order?.customer_full || {};
    const short = state.order?.customer_short || state.shortDraft || {};
    const birthMax = new Date().toISOString().slice(0, 10);
    const photoOk = state.photoUploaded || Boolean(state.order?.documents?.photo) || Boolean(state.order?.documents?.photo_base64) || Boolean(state.order?.documents?.photo_url) || Boolean(state.order?.documents?.has_photo);
    stepContent.innerHTML = `
      ${roundClockHtml()}
      <h1>Votre dossier</h1>
      ${
        isBalmaRetour()
          ? `<div class="notice-important" style="margin:0 0 20px">
        <strong>Fiche Boxing Center Minimes</strong>
        <p>Pas de téléphone ni d’e-mail sur cette fiche : on recopie tes infos Balma et on ajoute « Balma » à ton prénom. Même si le paiement n’est pas passé, complète ce dossier pour que le club puisse te recontacter.</p>
      </div>`
          : `<div class="notice-important" style="margin:0 0 20px">
        <strong>Anciens et nouveaux adhérents</strong>
        <p>Allez jusqu’au bout des étapes : ce dossier, puis la signature. Tant que ce n’est pas terminé, votre abonnement ne prend pas effet — que vous soyez déjà membre ou que vous rejoigniez Boxing Center.</p>
      </div>`
      }
      <form id="fullForm" class="form-grid">
        <input type="hidden" name="token" value="${state.token}" />
        ${state.sessionId ? `<input type="hidden" name="session_id" value="${state.sessionId}" />` : ''}
        <div><label for="gender">Sexe *</label>
          <select id="gender" name="gender" required>
            <option value="">—</option>
            <option value="M" ${full.gender === 'M' ? 'selected' : ''}>Homme</option>
            <option value="F" ${full.gender === 'F' ? 'selected' : ''}>Femme</option>
          </select></div>
        <div><label for="birthdate">Date de naissance *</label>
          <input id="birthdate" name="birthdate" type="date" required
            min="1900-01-01" max="${birthMax}"
            value="${short.birthdate || full.birthdate || ''}" /></div>
        <div class="full"><label for="address">Adresse *</label><input id="address" name="address" required value="${full.address || ''}" /></div>
        <div><label for="postal_code">Code postal *</label><input id="postal_code" name="postal_code" required value="${full.postal_code || ''}" /></div>
        <div><label for="city">Ville *</label><input id="city" name="city" required value="${full.city || ''}" /></div>
        <div class="full photo-capture-block">
          <label>Photo${isBalmaRetour() ? '' : ' *'}</label>
          <p class="field-hint">${
            isBalmaRetour()
              ? 'Optionnel : la photo de ta fiche Balma sera recopiée si tu n’en envoies pas.'
              : 'Importez une photo depuis votre téléphone ou votre ordinateur, ou prenez-en une avec la caméra. Elle sera collée à votre dossier adhérent (badge / fiche club).'
          }</p>
          ${photoOk ? '<p class="photo-already-ok">Photo déjà enregistrée — vous pouvez en choisir une autre ci-dessous.</p>' : ''}
          <div class="photo-capture-actions">
            <label class="btn secondary photo-file-label" for="photoFile">Importer une photo</label>
            <input id="photoFile" type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden />
            <button type="button" class="btn secondary" id="webcamBtn">Ouvrir la caméra</button>
          </div>
          <p class="field-hint" id="photoFileName" hidden></p>
          <video id="webcamPreview" playsinline muted hidden style="width:100%;max-width:320px;border-radius:8px;margin-top:10px;background:#111"></video>
          <canvas id="webcamCanvas" hidden></canvas>
          <img id="webcamSnap" alt="Aperçu photo" hidden style="width:100%;max-width:320px;border-radius:8px;margin-top:10px" />
          <button type="button" class="btn secondary" id="webcamCaptureBtn" hidden style="margin-top:8px">Capturer</button>
          <button type="button" class="btn secondary" id="webcamStopBtn" hidden style="margin-top:8px">Arrêter la caméra</button>
        </div>
        <div class="full"><button type="submit" class="btn block">Continuer</button></div>
        <div class="full">${backButton(
          productRequiresIban(state.order)
            ? '← Retour à l\'IBAN'
            : orderRequiresPayment(state.order)
              ? '← Retour au paiement'
              : '← Retour à l\'identité',
          productRequiresIban(state.order) ? 5 : orderRequiresPayment(state.order) ? 4 : 3
        )}</div>
      </form>`;

    let webcamStream = null;
    let photoBlob = null;
    const video = document.getElementById('webcamPreview');
    const canvas = document.getElementById('webcamCanvas');
    const snap = document.getElementById('webcamSnap');
    const fileInput = document.getElementById('photoFile');
    const fileNameHint = document.getElementById('photoFileName');

    function showPhotoPreview(blob, label) {
      if (!blob) return;
      photoBlob = blob;
      if (snap.src && snap.src.startsWith('blob:')) URL.revokeObjectURL(snap.src);
      snap.src = URL.createObjectURL(blob);
      snap.hidden = false;
      if (fileNameHint) {
        fileNameHint.hidden = !label;
        fileNameHint.textContent = label || '';
      }
    }

    async function stopWebcam() {
      if (webcamStream) {
        webcamStream.getTracks().forEach((t) => t.stop());
        webcamStream = null;
      }
      video.hidden = true;
      document.getElementById('webcamCaptureBtn').hidden = true;
      document.getElementById('webcamStopBtn').hidden = true;
    }

    document.getElementById('webcamBtn').onclick = async () => {
      try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        video.srcObject = webcamStream;
        await video.play();
        video.hidden = false;
        document.getElementById('webcamCaptureBtn').hidden = false;
        document.getElementById('webcamStopBtn').hidden = true;
        setMsg('');
      } catch (err) {
        setMsg('Caméra inaccessible. Autorisez la caméra dans votre navigateur puis réessayez.', 'err');
      }
    };

    document.getElementById('webcamCaptureBtn').onclick = () => {
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      canvas.toBlob(
        async (blob) => {
          if (!blob) return;
          if (fileInput) fileInput.value = '';
          showPhotoPreview(blob, '');
          await stopWebcam();
          setMsg('Photo capturée — vous pouvez continuer.');
        },
        'image/jpeg',
        0.92
      );
    };

    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!file.type || !file.type.startsWith('image/')) {
        setMsg('Choisissez une image JPEG, PNG ou WebP.', 'err');
        fileInput.value = '';
        return;
      }
      await stopWebcam();
      showPhotoPreview(file, file.name);
      setMsg('Photo importée — vous pouvez continuer.');
    };

    document.getElementById('webcamStopBtn').onclick = () => stopWebcam();
    // Bouton stop masqué — la caméra s'arrête automatiquement après capture
    document.getElementById('webcamStopBtn').hidden = true;

    document.getElementById('fullForm').onsubmit = async (e) => {
      e.preventDefault();
      setMsg('Enregistrement…');
      const source = photoBlob;
      if (source) {
        const prepared = await prepareMemberPhoto(source);
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
      } else if (!photoOk && !isBalmaRetour()) {
        setMsg('Importez une photo ou prenez-en une avec la caméra avant de continuer.', 'err');
        return;
      }

      await stopWebcam();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      const birthErr = validateBirthdateClient(body.birthdate);
      if (birthErr) {
        setMsg(birthErr, 'err');
        return;
      }
      const ageErr = adultOfferAgeError(body.birthdate, state.product || state.order?.product_snapshot);
      if (ageErr) {
        setMsg(ageErr, 'err');
        return;
      }
      // Renvoie l'IBAN déjà saisi — évite le faux « IBAN requis » si le store
      // distant n'a pas encore propagé payment.iban sur cette instance.
      if (!body.iban) {
        const stored = state.order?.payment?.iban || state.order?.customer_full?.iban;
        if (stored && !String(stored).includes('•')) body.iban = stored;
      }
      const res = await fetch(`/api/orders/${state.orderId}/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        if (data.error === 'iban_required') {
          setMsg(orderErrorMessage(data), 'err');
          goToStep(5);
          return;
        }
        setMsg(orderErrorMessage(data), 'err');
        return;
      }
      setMsg('');
      await loadOrder();
      if (
        isBalmaRetour() &&
        !['paid', 'free'].includes(String(state.order?.payment?.status || ''))
      ) {
        state.aventureDossierSaved = true;
        goToStep(4);
        return;
      }
      goToStep(7);
    };
    bindBackButtons();
    bindRoundClock();
  }

  const LEGAL = {
    cgv: '/cgv',
    reglement: '/reglement-interieur',
    medical: '/attestation-medicale',
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
      ${roundClockHtml()}
      <h1>Signature</h1>
      <canvas id="sigPad" class="signature-pad" width="640" height="180" style="width:100%;display:block;cursor:crosshair"></canvas>
      <div class="signature-actions">
        <button type="button" class="btn secondary" id="clearSig">Effacer</button>
      </div>
      <div class="consent-box">
        <label><input type="checkbox" id="consent_cgv" required />
          <span class="consent-text">J'accepte les <a class="legal-link" href="${LEGAL.cgv}" target="_blank" rel="noopener">conditions générales de vente</a> *</span></label>
      </div>
      <div class="consent-box">
        <label><input type="checkbox" id="consent_reglement" required />
          <span class="consent-text">J'accepte le <a class="legal-link" href="${LEGAL.reglement}" target="_blank" rel="noopener">règlement intérieur du club</a> *</span></label>
      </div>
      <div class="consent-box">
        <label><input type="checkbox" id="consent_medical" required />
          <span class="consent-text">J'atteste sur l'honneur l'absence de contre-indication à la pratique sportive et j'ai pris connaissance de la <a class="legal-link" href="${LEGAL.medical}" target="_blank" rel="noopener">déclaration médicale</a> *</span></label>
      </div>
      <button type="button" class="btn block" id="signBtn">Valider</button>
      <button type="button" class="btn secondary block" id="previewContractBtn" style="margin-top:12px">Prévisualiser la facture</button>
      ${backButton('← Retour', 6)}`;

    const pad = initSignaturePad(document.getElementById('sigPad'));
    document.getElementById('clearSig').onclick = () => pad.clear();
    document.getElementById('previewContractBtn').onclick = () => {
      window.BCContract.openView(state.orderId, {
        token: state.token,
        sessionId: state.sessionId,
        returnStep: 7,
      });
    };
    document.getElementById('signBtn').onclick = async () => {
      if (
        !document.getElementById('consent_cgv').checked ||
        !document.getElementById('consent_reglement').checked ||
        !document.getElementById('consent_medical').checked
      ) {
        setMsg('Veuillez accepter les conditions et la déclaration médicale.', 'err');
        return;
      }
      if (!pad.hasInk()) {
        setMsg('Signez dans le cadre avant de valider.', 'err');
        return;
      }
      const birthdate =
        state.order?.customer_short?.birthdate ||
        state.order?.customer_full?.birthdate ||
        state.shortDraft?.birthdate;
      const ageErr = adultOfferAgeError(birthdate, state.product || state.order?.product_snapshot);
      if (ageErr) {
        setMsg(ageErr, 'err');
        return;
      }
      setMsg('Finalisation…');
      const signBody = JSON.stringify({
          token: state.token,
          session_id: state.sessionId || undefined,
          consent_cgv: true,
          consent_reglement: true,
        consent_medical: true,
        signature_image: pad.toDataURL(),
      });
      const doSign = async () => {
        const res = await fetch(`/api/orders/${state.orderId}/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: signBody,
        });
        return res.json();
      };
      let data = await doSign();
      if (!data.ok && data.error === 'payment_required') {
        // Le paiement peut être confirmé côté Stripe mais pas encore synchronisé :
        // on resynchronise puis on retente automatiquement une fois.
        setMsg('Vérification du paiement…');
        if (state.sessionId) {
          await fetch('/api/checkout/confirm-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: state.sessionId }),
          }).catch(() => {});
        }
        await loadOrder();
        data = await doSign();
      }
      if (!data.ok) {
        setMsg(orderErrorMessage(data) || 'Erreur', 'err');
        return;
      }
      state.step = 8;
      state.emailWarning = data.email_warning || null;
      state.dispatchError = data.dispatch_error || null;
      clearCacheAfterConfirm();
      setMsg('');
      syncUrl();
      await render();
    };
    bindBackButtons();
    bindRoundClock();
  }

  function renderStep8() {
    if (guardPaidStep()) return;
    // Garantit le cache vide même si on arrive ici via refresh / already_signed
    clearCacheAfterConfirm();
    const p = state.product;
    const emailNote = state.emailWarning
      ? `<div class="notice-important" style="margin-top:16px;text-align:left"><strong>Email non envoyé</strong><p>Votre inscription est bien enregistrée. L'email de confirmation n'a pas pu être envoyé (${esc(state.emailWarning)}). Téléchargez votre facture ci-dessous ou contactez le club.</p></div>`
      : '';
    const dispatchNote = state.dispatchError
      ? `<div class="notice-important" style="margin-top:12px;text-align:left"><strong>Traitement club en attente</strong><p>Votre paiement est OK. L'enregistrement automatique au club a échoué (${esc(state.dispatchError)}). Le club va finaliser votre dossier — gardez votre référence.</p></div>`
      : '';
    const homeHref =
      (window.BCPaths && typeof window.BCPaths.link === 'function'
        ? window.BCPaths.link('/')
        : null) || '/';
    stepContent.innerHTML = `
      <div class="success-page success-page--celebrate" style="margin:20px auto">
        <div class="success-icon-wrap" aria-hidden="true">
          <span class="success-ring"></span>
          <span class="success-burst">${Array.from({ length: 8 }, () => '<i></i>').join('')}</span>
          <div class="success-icon"></div>
        </div>
        <h1>Inscription confirmée</h1>
        <p class="sub" style="margin-top:-4px">${
          orderRequiresPayment(state.order)
            ? 'Merci — votre paiement est enregistré.'
            : 'Merci — votre inscription gratuite est enregistrée.'
        }</p>
        ${emailNote}
        ${dispatchNote}
        <div class="info-box" style="text-align:left">
          <strong>Référence :</strong> ${state.orderId}<br />
          <strong>Offre :</strong> ${p?.display_name || p?.name || '—'}
        </div>
        <div class="success-actions" style="display:flex;flex-direction:column;gap:12px;margin-top:24px">
          <a href="${homeHref}" class="btn block" id="confirmHomeBtn">Retour à l'accueil</a>
          <button type="button" class="btn secondary block" id="downloadContractBtn">Télécharger ma facture</button>
        </div>
      </div>`;
    document.getElementById('confirmHomeBtn')?.addEventListener('click', () => {
      clearCacheAfterConfirm();
    });
    document.getElementById('downloadContractBtn').onclick = () => {
      window.BCContract.openView(state.orderId, { token: state.token });
    };
  }

  let stripeConfirmDone = false;
  let payplugConfirmDone = false;
  let paypalConfirmDone = false;
  let cawlConfirmDone = false;

  async function confirmPayplugReturn() {
    if (params.get('payplug_return') !== '1' || payplugConfirmDone) return false;
    if (!state.orderId || !state.token) return false;
    payplugConfirmDone = true;
    setMsg('Vérification du paiement…');
    try {
      const res = await fetch('/api/checkout/confirm-payplug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: state.orderId,
          token: state.token,
          bc_token: state.token,
          payment_id: state.order?.payment?.payplug_payment_id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok && (data.paid || data.already_paid)) {
        await loadOrder();
        if (data.redirect) {
          window.location.href = data.redirect;
          return true;
        }
        state.step = stepFromOrder(state.order);
        setMsg('');
        return true;
      }
      if (data.pending) {
        setMsg(
          data.message ||
            'Votre paiement est en cours de validation. Cette page se mettra à jour automatiquement.',
          ''
        );
        window.setTimeout(async () => {
          payplugConfirmDone = false;
          await confirmPayplugReturn();
          if (state.order?.payment?.status === 'paid') persistAndRender();
        }, 4000);
        return false;
      }
      setMsg(data.message || data.error || 'Paiement non confirmé', 'err');
    } catch {
      setMsg('Impossible de vérifier le paiement pour le moment.', 'err');
    }
    return false;
  }

  async function confirmCawlReturn() {
    if (params.get('cawl_return') !== '1' || cawlConfirmDone) return false;
    if (!state.orderId || !state.token) return false;
    cawlConfirmDone = true;
    setMsg('Vérification du paiement…');
    try {
      const hostedId =
        String(params.get('hostedCheckoutId') || params.get('hosted_checkout_id') || '').trim() ||
        state.order?.payment?.cawl_hosted_checkout_id ||
        '';
      const res = await fetch('/api/checkout/confirm-cawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: state.orderId,
          token: state.token,
          bc_token: state.token,
          hosted_checkout_id: hostedId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok && (data.paid || data.already_paid)) {
        await loadOrder();
        if (data.redirect) {
          window.location.href = data.redirect;
          return true;
        }
        state.step = stepFromOrder(state.order);
        setMsg('');
        return true;
      }
      setMsg(data.message || data.error || 'Paiement non confirmé', 'err');
    } catch {
      setMsg('Impossible de vérifier le paiement pour le moment.', 'err');
    }
    return false;
  }

  async function confirmPaypalReturn() {
    if (params.get('paypal_return') !== '1' || paypalConfirmDone) return false;
    if (!state.orderId || !state.token) return false;
    paypalConfirmDone = true;
    setMsg('Vérification du paiement PayPal…');
    try {
      const res = await fetch('/api/checkout/confirm-paypal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: state.orderId,
          token: state.token,
          bc_token: state.token,
          paypal_order_id:
            pickPaypalOrderIdFromUrl(params) || state.order?.payment?.paypal_order_id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok && (data.paid || data.already_paid)) {
        await loadOrder();
        if (data.redirect) {
          window.location.href = data.redirect;
          return true;
        }
        state.step = stepFromOrder(state.order);
        setMsg('');
        return true;
      }
      setMsg(data.message || data.error || 'Paiement PayPal non confirmé', 'err');
    } catch {
      setMsg('Impossible de vérifier le paiement PayPal pour le moment.', 'err');
    }
    return false;
  }

  async function confirmStripeReturn() {
    if (isPspReturn(params)) return false;
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

    state.step = isBalmaRetour() ? 6 : 4;
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
    if (isBalmaRetour() && state.step < 4) {
      state.gymDraft = 'minimes';
      state.step = 4;
    }
    lockAventureBackNav();
    await loadConfig();

    if (state.orderId && state.token && !params.get('order')) {
      syncUrl();
    }

    if (params.get('cancelled')) {
      state.step = isBalmaRetour() ? 6 : 4;
      state.sessionId = null;
      setMsg(paymentFailureMessage('cancelled'), 'err');
      params.delete('cancelled');
      syncUrl();
    }

    if (state.orderId && state.token) {
      await confirmPayplugReturn();
      await confirmCawlReturn();
      await confirmPaypalReturn();
      await confirmStripeReturn();
      const loaded = await loadOrder();
      if (state.order?.payment?.status === 'paid') {
        state.step = Math.max(state.step, stepFromOrder(state.order));
      } else if (loaded && orderRequiresPayment(state.order) && state.step > 4 && !isBalmaRetour()) {
        state.step = 4;
      } else if (!loaded && state.step >= 4 && !isPspReturn(params)) {
        setMsg(
          'Impossible de recharger votre dossier — vous pouvez tout de même payer si vos coordonnées sont enregistrées.',
          'err'
        );
      }
      if (
        params.get('pay') === '1' &&
        state.order &&
        orderRequiresPayment(state.order) &&
        state.order.payment?.status !== 'paid' &&
        state.order.payment?.status !== 'free' &&
        state.order.customer_short
      ) {
        state.step = 4;
      }
    }

    await ensureProductLoaded();

    if (!state.productId && !state.product) {
      state.step = 1;
    }

    if (!state.productId && state.product) state.productId = state.product.id;

    // Ne pas forcer le paiement si l'utilisateur est explicitement sur l'étape offre
    // (ex. retour pour changer d'offre). Sinon reprendre le tunnel en cours.
    const explicitStep1 = Number(params.get('step') || 0) === 1;
    const orderProductId =
      state.order?.product_id || state.order?.product_snapshot?.id || state.order?.product_snapshot?.legacy_id;
    const productMismatch =
      state.productId &&
      orderProductId &&
      state.productId !== orderProductId &&
      state.productId !== state.order?.product_snapshot?.legacy_id;

    if (productMismatch && !params.get('order')) {
      // URL = nouvelle offre, dossier local = ancienne → repartir à zéro
      clearProgress();
      state.orderId = null;
      state.token = null;
      state.sessionId = null;
      state.order = null;
      state.step = 1;
    } else if (state.step === 1 && state.orderId && state.order && !explicitStep1) {
      state.step = stepFromOrder(state.order);
    }

    if (state.step >= 8 || state.order?.signature?.signed_at) {
      state.step = 8;
      clearCacheAfterConfirm();
    }

    syncUrl();
    await render();
  }

  window.addEventListener('beforeunload', saveProgress);
  window.addEventListener('pagehide', saveProgress);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveProgress();
  });

  init();
})();
