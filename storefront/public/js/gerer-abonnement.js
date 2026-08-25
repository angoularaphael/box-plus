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
    { id: 'ramonville', label: 'Ramonville', address: '33 rue des Ormes, 31520 Ramonville-Saint-Agne' },
    { id: 'portet', label: 'Portet', address: '61 route d\'Espagne, 31120 Portet-sur-Garonne' },
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
      [
        'change',
        'paypal_return',
        'payplug_return',
        'cawl_return',
        'payment_id',
        'paypal_order_id',
        'hosted_checkout_id',
        'hostedCheckoutId',
        'token',
        'PayerID',
        'session_id',
      ].forEach((k) => url.searchParams.delete(k));
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
      lead: 'Votre résiliation est prise en charge. Elle prend effet à la fin de la période déjà payée — une confirmation vous sera envoyée par e-mail avec la date exacte.',
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
            '<strong>Votre résiliation sera traitée.</strong><br/>Les informations correspondent : la demande est prise en charge. Elle prend effet à la fin de la période déjà payée ; une confirmation vous sera envoyée par e-mail avec la date exacte.';
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
    window.__bcChangeTargets = data.comptant_targets || [];
    targetSelect.innerHTML = (data.comptant_targets || [])
      .map(
        (p) =>
          `<option value="${p.id}" data-installment="${p.supports_installment_choice ? '1' : '0'}" data-cents="${p.price_cents || 0}">${p.name}${p.price_label ? ` — ${p.price_label}` : ''}</option>`
      )
      .join('');
  }

  const changePayPanel = document.getElementById('changePayPanel');
  const changePayLead = document.getElementById('changePayLead');
  const changePayChoices = document.getElementById('changePayChoices');
  const changePayBtn = document.getElementById('changePayBtn');
  const changePayBack = document.getElementById('changePayBack');
  let changeCheckoutBody = null;
  let changeProductSummary = null;

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

  let changePayFlags = { preview: false, showCard: true, showPaypal: true };

  async function loadPayFlags(gym) {
    try {
      const qs = gym ? `?gym=${encodeURIComponent(gym)}` : '';
      const res = await fetch(`/api/payments/config${qs}`);
      const cfg = await res.json().catch(() => ({}));
      return {
        preview: Boolean(cfg.preview),
        showCard: cfg.show_cawl === true || cfg.show_payplug !== false,
        showPaypal: cfg.show_paypal !== false,
        oney4x: cfg.oney_4x === true,
        oney4xMessage: cfg.oney_4x_message || '',
        portetViaPaypal: cfg.portet_via_paypal === true,
        portetViaCawl: cfg.portet_via_cawl === true,
        portetPaused: cfg.portet_paused === true,
        portetPausedMessage: cfg.portet_paused_message || '',
      };
    } catch {
      return {
        preview: false,
        showCard: true,
        showPaypal: true,
        oney4x: false,
        portetViaPaypal: false,
        portetViaCawl: false,
        portetPaused: false,
      };
    }
  }

  async function renderChangePayChoices({ product, gym }) {
    changePayFlags = await loadPayFlags(gym);
    const portetPaused = changePayFlags.portetPaused === true && !changePayFlags.preview;
    const portetViaCawl = !portetPaused && changePayFlags.portetViaCawl === true;
    const showCard = portetViaCawl || changePayFlags.showCard;
    const showPaypal = portetViaCawl ? false : changePayFlags.showPaypal;
    const oney4x = portetViaCawl ? true : changePayFlags.oney4x === true;
    const portetViaPaypal = !portetViaCawl && changePayFlags.portetViaPaypal === true && showPaypal;
    const cardLogoKind = portetViaPaypal ? 'card-paypal' : 'card';
    const cardSmall = portetViaCawl
      ? 'Paiement sécurisé CAWL'
      : portetViaPaypal
        ? 'Carte via PayPal'
        : 'PayPlug';
    const cents = Number(product?.price_cents || 0);
    const quart = cents > 0 ? (cents / 400).toFixed(2).replace('.', ',') : '';
    const installment =
      product?.supports_installment_choice === true ||
      product?.id === 'offre-saison' ||
      /259|12\s*mois|baby|educative|éducative/i.test(String(product?.name || product?.id || ''));

    const methodRow = (name, value, checked, title, small, logoKind) => `
      <label class="billing-choice">
        <input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} />
        <span class="billing-choice-text">
          <strong>${title}</strong>
          <small>${small}</small>
          ${logoKind ? paymentLogosHtml(logoKind) : ''}
        </span>
      </label>`;

    const methods = (name, cardVal, paypalVal, cardTitle, cardSmall, cardLogo, paypalSmall, opts = {}) => {
      const cardOn = opts.showCard !== undefined ? opts.showCard : showCard;
      const paypalOn = opts.showPaypal !== undefined ? opts.showPaypal : showPaypal;
      const preferPaypal = Boolean(opts.preferPaypal) || (paypalOn && !cardOn);
      let out = '';
      if (cardOn) {
        out += methodRow(name, cardVal, !preferPaypal, cardTitle, cardSmall, cardLogo);
      }
      if (paypalOn) {
        out += methodRow(name, paypalVal, preferPaypal || !cardOn, 'PayPal', paypalSmall, 'paypal');
      }
      return out || '<p class="portet-pay-notice">Paiement temporairement indisponible.</p>';
    };

    let html = '';
    if (changePayFlags.preview) {
      html += `<p class="portet-pay-notice">Studio : tous les moyens branchés s’affichent. Les visiteurs verront les cases enregistrées après déconnexion.</p>`;
    }
    if (portetPaused) {
      html += `<p class="portet-pay-notice">${
        changePayFlags.portetPausedMessage ||
        'Les paiements en ligne pour la salle de Portet sont momentanément indisponibles. Contactez le club ou passez à l’accueil.'
      }</p>`;
      changePayChoices.innerHTML = html;
      if (changePayBtn) {
        changePayBtn.disabled = true;
        changePayBtn.hidden = true;
      }
      return;
    }
    if (installment && !oney4x) {
      html += `<p class="portet-pay-notice">${
        changePayFlags.oney4xMessage ||
        'Le 4× sans frais par carte (PayPlug) est momentanément indisponible. Le 4× est disponible via PayPal, dans toutes les salles.'
      }</p>`;
    }
    if (installment) {
      html += `
        <p class="sub" style="margin:0 0 8px">Étape 1 — Comment souhaitez-vous régler ?</p>
        <div class="billing-choice-row" role="radiogroup" aria-label="Type de paiement">
          ${methodRow('change_payment_plan', 'once', true, 'En une seule fois', product?.price_label || '')}
          ${methodRow(
            'change_payment_plan',
            '4x',
            false,
            'En 4× sans frais',
            oney4x
              ? quart
                ? portetViaCawl
                  ? `Carte : ${quart} € tout de suite, puis 3 échéances`
                  : `Carte : ${quart} € tout de suite · PayPal : 4× si éligible`
                : '4 échéances'
              : 'Pour le moment via PayPal uniquement (PayPlug 4× indisponible).'
          )}
        </div>
        <div id="changeFourXSchedule" class="fourx-schedule" style="display:none;margin-top:10px"></div>
        <p class="sub" style="margin:16px 0 8px">Étape 2 — Moyen de paiement</p>
        <div id="changeOnceMethods" class="billing-choice-row">
          ${methods('change_pay_method_once', 'payplug', 'paypal', 'Carte bancaire', cardSmall, cardLogoKind, 'Paiement sécurisé')}
        </div>
        <div id="changeFourMethods" class="billing-choice-row" style="display:none">
          ${methods('change_pay_method_4x', portetViaCawl ? 'cawl' : 'payplug', 'paypal', '4× sans frais', portetViaCawl ? 'Carte bancaire' : 'Carte PayPlug / Oney', portetViaCawl ? 'card' : 'payplug', 'Pay Later si éligible — sinon montant total', { showCard: showCard && oney4x, preferPaypal: !portetViaCawl })}
        </div>
        ${
          showCard && oney4x
            ? `<div id="changeFourAddress" class="form-grid" style="display:none;margin-top:12px">
            <p class="sub full" style="margin:0 0 8px">Adresse et civilité requises pour le 4× carte :</p>
            <div>
              <label>Civilité *</label>
              <select name="gender" id="chg_gender">
                <option value="">—</option>
                <option value="M">Homme</option>
                <option value="F">Femme</option>
              </select>
            </div>
            <div class="full"><label>Adresse *</label><input name="address" id="chg_address" /></div>
            <div><label>Code postal *</label><input name="postal_code" id="chg_postal" inputmode="numeric" maxlength="5" pattern="\\d{5}" /></div>
            <div><label>Ville *</label><input name="city" id="chg_city" /></div>
          </div>`
            : ''
        }`;
    } else {
      html += `
        <div class="billing-choice-row" role="radiogroup" aria-label="Moyen de paiement">
          ${methods('change_pay_method', 'payplug', 'paypal', 'Carte bancaire', cardSmall, cardLogoKind, 'Paiement sécurisé')}
        </div>`;
    }
    changePayChoices.innerHTML = html;
    if (changePayBtn) {
      changePayBtn.disabled = false;
      changePayBtn.hidden = false;
    }

    if (installment) {
      const sync = () => {
        const plan = document.querySelector('input[name="change_payment_plan"]:checked')?.value || 'once';
        const once = document.getElementById('changeOnceMethods');
        const four = document.getElementById('changeFourMethods');
        const addr = document.getElementById('changeFourAddress');
        const schedule = document.getElementById('changeFourXSchedule');
        if (once) once.style.display = plan === 'once' ? '' : 'none';
        if (four) four.style.display = plan === '4x' ? '' : 'none';
        if (schedule) {
          schedule.style.display = plan === '4x' ? '' : 'none';
          if (plan === '4x' && quart) {
            const today = new Date();
            const dates = [0, 30, 60, 90].map((d) => {
              const x = new Date(today);
              x.setDate(x.getDate() + d);
              return x.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
            });
            schedule.innerHTML = `<p class="fourx-schedule__title">Calendrier indicatif 4×</p><ul>
              <li><strong>Aujourd’hui</strong> — ${quart}&nbsp;€</li>
              <li><strong>${dates[1]}</strong> — ${quart}&nbsp;€</li>
              <li><strong>${dates[2]}</strong> — ${quart}&nbsp;€</li>
              <li><strong>${dates[3]}</strong> — ${quart}&nbsp;€</li>
            </ul>`;
          }
        }
        const fourMethod =
          document.querySelector('input[name="change_pay_method_4x"]:checked')?.value || 'paypal';
        if (addr) {
          addr.style.display =
            plan === '4x' && (fourMethod === 'payplug' || fourMethod === 'cawl') && oney4x ? '' : 'none';
        }
      };
      changePayChoices
        .querySelectorAll('input[name="change_payment_plan"], input[name="change_pay_method_4x"]')
        .forEach((el) => el.addEventListener('change', sync));
      sync();
    }
  }

  async function showChangePayStep({ body, product, verifyOrderId }) {
    changeCheckoutBody = {
      ...body,
      verify_order_id: verifyOrderId,
    };
    const fromList = (window.__bcChangeTargets || []).find((p) => p.id === body.target_product_id);
    changeProductSummary = {
      ...(product || {}),
      ...(fromList || {}),
      supports_installment_choice:
        fromList?.supports_installment_choice ||
        product?.supports_installment_choice ||
        body.target_product_id === 'offre-saison',
    };
    const label =
      changeProductSummary?.price_label ||
      (changeProductSummary?.price_cents != null
        ? `${(Number(changeProductSummary.price_cents) / 100).toFixed(2).replace('.', ',')} €`
        : '');
    const name =
      changeProductSummary?.name ||
      targetSelect?.selectedOptions?.[0]?.textContent ||
      'abonnement comptant';
    await renderChangePayChoices({ product: changeProductSummary, gym: body.gym });
    changePayLead.textContent = label
      ? `Identité confirmée. Montant : ${label} (${name}).`
      : `Identité confirmée. Choisissez votre mode de paiement.`;
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

  async function startChangePayment() {
    if (!changeCheckoutBody) {
      changeMsg.hidden = false;
      changeMsg.className = 'form-msg err';
      changeMsg.textContent = 'Recommencez la vérification de vos informations.';
      return;
    }
    if (changePayFlags.portetPaused && !changePayFlags.preview) {
      changeMsg.hidden = false;
      changeMsg.className = 'form-msg err';
      changeMsg.textContent =
        changePayFlags.portetPausedMessage ||
        'Les paiements en ligne pour la salle de Portet sont momentanément indisponibles. Contactez le club ou passez à l’accueil.';
      return;
    }
    const oney4x = changePayFlags.oney4x === true;
    const installment =
      changeProductSummary?.supports_installment_choice ||
      document.querySelector('input[name="change_payment_plan"]');
    let paymentMethod = 'payplug';
    let paymentPlan = 'once';
    const extra = {};
    if (installment && document.querySelector('input[name="change_payment_plan"]')) {
      paymentPlan =
        document.querySelector('input[name="change_payment_plan"]:checked')?.value || 'once';
      if (paymentPlan === '4x') {
        paymentMethod =
          document.querySelector('input[name="change_pay_method_4x"]:checked')?.value || 'paypal';
        if (paymentMethod === 'cawl' || (paymentMethod === 'payplug' && oney4x)) {
          extra.address = document.getElementById('chg_address')?.value?.trim() || '';
          extra.postal_code = document.getElementById('chg_postal')?.value?.trim() || '';
          extra.city = document.getElementById('chg_city')?.value?.trim() || '';
          extra.gender = document.getElementById('chg_gender')?.value || '';
          if (!extra.gender) {
            changeMsg.hidden = false;
            changeMsg.className = 'form-msg err';
            changeMsg.textContent = 'Civilité requise pour le paiement en 4× carte.';
            return;
          }
          if (!extra.address || !extra.city || !/^\d{5}$/.test(extra.postal_code)) {
            changeMsg.hidden = false;
            changeMsg.className = 'form-msg err';
            changeMsg.textContent = 'Adresse complète et code postal à 5 chiffres requis pour le 4× carte.';
            return;
          }
        } else {
          paymentMethod = 'paypal';
        }
      } else {
        paymentMethod =
          document.querySelector('input[name="change_pay_method_once"]:checked')?.value ||
          (changePayFlags.showPaypal && !changePayFlags.showCard ? 'paypal' : 'payplug');
      }
    } else {
      paymentMethod =
        document.querySelector('input[name="change_pay_method"]:checked')?.value ||
        (changePayFlags.showPaypal && !changePayFlags.showCard ? 'paypal' : 'payplug');
    }

    if (changePayFlags.portetViaCawl) {
      paymentMethod = 'cawl';
    } else if (changePayFlags.portetViaPaypal) {
      extra.paypal_landing = paymentMethod === 'paypal' ? 'login' : 'billing';
      extra.paypal_guest_card = paymentMethod !== 'paypal';
      paymentMethod = 'paypal';
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
          ...extra,
          payment_method: paymentMethod,
          payment_plan: paymentPlan,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        changeMsg.textContent =
          data.error === 'paypal_not_configured'
            ? 'PayPal temporairement indisponible.'
            : data.error === 'portet_payments_paused'
              ? data.message || 'Les paiements Portet sont momentanément indisponibles.'
            : data.error === 'cawl_not_configured'
              ? 'Paiement CAWL temporairement indisponible.'
            : data.error === 'payplug_not_configured'
              ? 'Paiement carte temporairement indisponible. Essayez PayPal.'
              : data.error || 'Erreur';
        changeMsg.className = 'form-msg err';
        changePayBtn.disabled = false;
        return;
      }
      if (data.hosted_checkout_id) {
        sessionStorage.setItem('bc_change_cawl_id', data.hosted_checkout_id);
        sessionStorage.removeItem('bc_change_paypal_id');
        sessionStorage.removeItem('bc_change_payplug_id');
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
    const fromList = (window.__bcChangeTargets || []).find((p) => p.id === body.target_product_id);
    const productHint = {
      id: body.target_product_id,
      name: selectedOpt?.textContent || body.target_product_id,
      price_label: String(selectedOpt?.textContent || '').split('—')[1]?.trim() || '',
      price_cents: fromList?.price_cents || Number(selectedOpt?.dataset?.cents || 0),
      supports_installment_choice:
        fromList?.supports_installment_choice || selectedOpt?.dataset?.installment === '1',
    };
    await showChangePayStep({
      body,
      product: productHint,
      verifyOrderId: verify.order_id,
    });
    setChangeRateHint(null);
    if (submitBtn) submitBtn.disabled = false;
  };

  changePayBtn?.addEventListener('click', () => {
    void startChangePayment();
  });
  changePayBack?.addEventListener('click', backToChangeForm);

  const params = new URLSearchParams(location.search);
  async function confirmChangePayment() {
    if (params.get('change') !== '1') return;
    const fromPaypal = params.get('paypal_return') === '1';
    const fromPayplug = params.get('payplug_return') === '1';
    const fromCawl = params.get('cawl_return') === '1';
    const hostedCheckoutId = fromCawl
      ? params.get('hostedCheckoutId') ||
        params.get('hosted_checkout_id') ||
        sessionStorage.getItem('bc_change_cawl_id') ||
        ''
      : params.get('hosted_checkout_id') || sessionStorage.getItem('bc_change_cawl_id') || '';
    const paypalOrderId = fromPaypal
      ? params.get('paypal_order_id') ||
        params.get('token') ||
        sessionStorage.getItem('bc_change_paypal_id') ||
        ''
      : params.get('paypal_order_id') || sessionStorage.getItem('bc_change_paypal_id') || '';
    const paymentId = fromPaypal || fromCawl
      ? ''
      : params.get('payment_id') || sessionStorage.getItem('bc_change_payplug_id') || '';
    const sessionId = fromPaypal || fromPayplug || fromCawl ? '' : params.get('session_id') || '';
    if (!paymentId && !sessionId && !paypalOrderId && !hostedCheckoutId) {
      // Ancienne URL ?change=1 sans paiement → nettoyer sans popup
      if (!fromPaypal && !fromPayplug && !fromCawl) cleanChangeReturnUrl();
      return;
    }
    if (fromCawl && !hostedCheckoutId) {
      changeMsg.hidden = false;
      changeMsg.className = 'form-msg err';
      changeMsg.textContent =
        'Retour paiement incomplet (identifiant manquant). Réessayez le paiement par carte.';
      return;
    }
    if (fromPaypal && !paypalOrderId) {
      changeMsg.hidden = false;
      changeMsg.className = 'form-msg err';
      changeMsg.textContent =
        'Retour PayPal incomplet (identifiant manquant). Réessayez le paiement PayPal.';
      return;
    }

    const confirmKey = `bc_change_done_${paymentId || paypalOrderId || hostedCheckoutId || sessionId}`;
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
        fromCawl || hostedCheckoutId
          ? { hosted_checkout_id: hostedCheckoutId }
          : fromPaypal || (!paymentId && paypalOrderId)
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
      sessionStorage.removeItem('bc_change_cawl_id');
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
