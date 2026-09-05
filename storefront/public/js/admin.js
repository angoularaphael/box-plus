(function () {
  const adminPanel = document.getElementById('adminPanel');
  let products = [];
  let featuredHome = [];
  let orders = [];
  let coachings = [];
  let currentUser = null;

  const STEP_LABELS = {
    1: 'Offre',
    2: 'Salle',
    3: 'Identité',
    4: 'Paiement',
    5: 'IBAN',
    6: 'Dossier',
    7: 'Signature',
    8: 'Confirmé',
  };

  const GYM_LABELS = {
    minimes: 'Minimes',
    ramonville: 'Ramonville',
    portet: 'Portet',
    'etats-unis': 'États-Unis',
    'st-cyprien': 'Saint-Cyprien',
    balma: 'Balma',
  };

  function sortOrdersForDisplay(list) {
    return [...list].sort((a, b) => {
      const ta = orderDateMs(a);
      const tb = orderDateMs(b);
      if (tb !== ta) return tb - ta;
      return String(b.order_id || '').localeCompare(String(a.order_id || ''), 'fr');
    });
  }

  function gymLabel(gym) {
    const key = String(gym || '').trim();
    if (!key) return '—';
    return GYM_LABELS[key] || GYM_LABELS[key.toLowerCase()] || key;
  }

  const CATALOG_SECTIONS = [
    { key: 'promo', label: 'Offres promotionnelles' },
    { key: 'prelevement', label: 'Prélèvement sans engagement' },
    { key: 'comptant', label: 'Comptant' },
    { key: 'enfants', label: 'Enfants — Baby boxe & boxe éducative' },
    { key: 'coachings', label: 'Coachings' },
    { key: 'essai', label: "Séance d'essai" },
    { key: 'other', label: 'Autres offres' },
  ];

  function catalogSectionKey(product) {
    if (product.tab === 'coachings') return 'coachings';
    if (product.tab === 'seance-essai' || product.id === 'seance-essai') return 'essai';
    const sub = product.subsection || 'other';
    if (CATALOG_SECTIONS.some((s) => s.key === sub)) return sub;
    return 'other';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function headers(json = true) {
    const h = {};
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      try {
        return document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }
  }

  async function fetchResumeLink(orderId, kind = 'resume') {
    const id = String(orderId || '').trim();
    const qs = kind === 'pay' ? '?kind=pay' : '';
    const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}/resume-link${qs}`, {
      credentials: 'include',
      headers: headers(false),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.message || data.error || 'Impossible de générer le lien');
    }
    return data;
  }

  function showResumeBox(data) {
    const box = document.getElementById('resumeLinkBox');
    if (!box) return;
    const pay = data.kind === 'pay';
    box.hidden = false;
    box.innerHTML = `
      <p><strong>${escapeHtml(data.message || (pay ? 'Lien de paiement' : 'Lien de reprise'))}</strong>${data.name ? ` — ${escapeHtml(data.name)}` : ''}</p>
      <div class="resume-link-box__row">
        <input type="text" readonly value="${escapeHtml(data.url)}" id="resumeLinkUrl" />
        <button type="button" class="btn sm" id="resumeCopyBtn">Copier</button>
        ${
          data.email && data.email !== '—'
            ? `<button type="button" class="btn sm secondary" id="resumeSendBtn">Envoyer par e-mail</button>`
            : ''
        }
        ${
          data.phone
            ? `<button type="button" class="btn sm secondary" id="resumeSmsBtn">Envoyer par SMS</button>`
            : ''
        }
        ${
          (data.email && data.email !== '—') || data.phone
            ? `<button type="button" class="btn sm" id="resumeBothBtn">Envoyer mail + SMS</button>`
            : ''
        }
      </div>`;
    const input = document.getElementById('resumeLinkUrl');
    input?.focus();
    input?.select();
    document.getElementById('resumeCopyBtn')?.addEventListener('click', async () => {
      const ok = await copyText(data.url);
      const btn = document.getElementById('resumeCopyBtn');
      if (btn) btn.textContent = ok ? 'Copié' : 'Sélectionnez le lien';
    });
    document.getElementById('resumeSendBtn')?.addEventListener('click', () => sendResumeEmail(data));
    document.getElementById('resumeSmsBtn')?.addEventListener('click', () => sendResumeSms(data));
    document.getElementById('resumeBothBtn')?.addEventListener('click', () => sendResumeBoth(data));
  }

  async function sendResumeEmail(data) {
    const btn = document.getElementById('resumeSendBtn');
    const msg = document.getElementById('ordersMsg');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(data.order_id)}/send-resume-email`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true),
        body: JSON.stringify({ kind: data.kind || 'resume' }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        throw new Error(out.message || out.error || 'Envoi impossible');
      }
      if (btn) btn.textContent = 'Envoyé';
      if (msg) {
        msg.textContent = out.message || `E-mail envoyé à ${out.to}`;
        msg.className = 'form-msg ok';
      }
      if (typeof window.panToast === 'function') window.panToast(out.message || 'E-mail envoyé', 'ok');
    } catch (err) {
      if (btn) btn.disabled = false;
      if (msg) {
        msg.textContent = err.message;
        msg.className = 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast(err.message, 'err');
    }
  }

  async function sendResumeSms(data) {
    const btn = document.getElementById('resumeSmsBtn');
    const msg = document.getElementById('ordersMsg');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(data.order_id)}/send-resume-whatsapp`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true),
        body: JSON.stringify({ kind: data.kind || 'resume' }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        throw new Error(out.message || out.error || 'Envoi SMS impossible');
      }
      if (btn) btn.textContent = 'Envoyé';
      if (msg) {
        msg.textContent = out.message || `SMS envoyé au ${out.to}`;
        msg.className = 'form-msg ok';
      }
      if (typeof window.panToast === 'function') window.panToast(out.message || 'SMS envoyé', 'ok');
    } catch (err) {
      if (btn) btn.disabled = false;
      if (msg) {
        msg.textContent = err.message;
        msg.className = 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast(err.message, 'err');
    }
  }

  async function sendResumeBoth(data) {
    const btn = document.getElementById('resumeBothBtn');
    const msg = document.getElementById('ordersMsg');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(data.order_id)}/send-resume-notify`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true),
        body: JSON.stringify({ kind: data.kind || 'resume', email: true, sms: true }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        throw new Error(out.message || out.error || 'Envoi impossible');
      }
      if (btn) btn.textContent = 'Envoyé';
      if (msg) {
        msg.textContent = out.message || 'E-mail et SMS envoyés';
        msg.className = 'form-msg ok';
      }
      if (typeof window.panToast === 'function') window.panToast(out.message || 'E-mail et SMS envoyés', 'ok');
    } catch (err) {
      if (btn) btn.disabled = false;
      if (msg) {
        msg.textContent = err.message;
        msg.className = 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast(err.message, 'err');
    }
  }

  async function sendResumeWhatsApp(data) {
    return sendResumeSms(data);
  }

  async function generateResumeLink(orderId, btn, kind = 'resume') {
    const msg = document.getElementById('ordersMsg');
    const id = String(orderId || '').trim();
    const pay = kind === 'pay';
    if (!id) {
      if (msg) {
        msg.textContent = 'Indiquez une référence (colonne Référence).';
        msg.className = 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast('Indiquez une référence', 'err');
      return null;
    }
    if (btn) btn.disabled = true;
    try {
      const data = await fetchResumeLink(id, kind);
      const copied = await copyText(data.url);
      showResumeBox(data);
      if (msg) {
        msg.textContent = copied
          ? `${data.message}. Lien copié — envoyez-le à la personne.`
          : `${data.message}. Copiez le lien ci-dessous.`;
        msg.className = 'form-msg ok';
      }
      if (typeof window.panToast === 'function') {
        window.panToast(
          copied ? (pay ? 'Lien de paiement copié' : 'Lien de reprise copié') : 'Lien généré',
          'ok'
        );
      }
      return data;
    } catch (err) {
      if (msg) {
        msg.textContent = err.message;
        msg.className = 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast(err.message, 'err');
      return null;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.BCAdminResume = {
    generate: generateResumeLink,
    generatePay: (orderId, btn) => generateResumeLink(orderId, btn, 'pay'),
  };

  function selectedOrderIds() {
    return [...document.querySelectorAll('.order-pick:checked')].map((el) => el.dataset.id).filter(Boolean);
  }

  function canDiffuseOrder(o) {
    const hasMail = o.email && o.email !== '—';
    const hasPhone = Boolean(o.phone);
    return (o.can_resume || o.can_pay) && (hasMail || hasPhone);
  }

  async function sendDiffusion(channel = 'email') {
    const ids = selectedOrderIds();
    const msg = document.getElementById('ordersMsg');
    const viaSms = channel === 'sms' || channel === 'whatsapp';
    const viaBoth = channel === 'both';
    if (!ids.length) {
      if (msg) {
        msg.textContent = 'Cochez les personnes à relancer.';
        msg.className = 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast('Cochez les personnes à relancer', 'err');
      return;
    }
    if (ids.length > 40) {
      const text = `Maximum 40 destinataires. Décochez ${ids.length - 40} personne(s).`;
      if (msg) {
        msg.textContent = text;
        msg.className = 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast(text, 'err');
      return;
    }
    const failed = document.getElementById('ordersFilter')?.value === 'failed';
    const confirmText = viaBoth
      ? `Envoyer e-mail + SMS de reprise à ${ids.length} personne(s) ?`
      : viaSms
        ? `Envoyer le SMS de reprise à ${ids.length} personne(s) ?`
        : failed
          ? `Envoyer le mail de paiement (carte refusée) à ${ids.length} personne(s) ?`
          : `Envoyer le mail de reprise à ${ids.length} personne(s) ?`;
    if (!confirm(confirmText)) return;
    const btnId = viaBoth ? 'diffusionBothBtn' : viaSms ? 'diffusionSmsBtn' : 'diffusionBtn';
    const btn = document.getElementById(btnId) || document.getElementById('diffusionWaBtn');
    if (btn) btn.disabled = true;
    try {
      const path = viaBoth
        ? '/api/admin/orders/send-resume-notify-batch'
        : viaSms
          ? '/api/admin/orders/send-resume-whatsapp-batch'
          : '/api/admin/orders/send-resume-email-batch';
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true),
        body: JSON.stringify({ order_ids: ids, email: true, sms: true }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok && !out.sent) {
        throw new Error(out.message || out.error || 'Diffusion impossible');
      }
      if (msg) {
        msg.textContent = out.message || `${out.sent || 0} envoi(s)`;
        msg.className = out.sent ? 'form-msg ok' : 'form-msg err';
      }
      if (typeof window.panToast === 'function') {
        window.panToast(out.message || 'Diffusion envoyée', out.sent ? 'ok' : 'err');
      }
    } catch (err) {
      if (msg) {
        msg.textContent = err.message;
        msg.className = 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast(err.message, 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function showTab(name) {
    ['tabOffers', 'tabMateriel', 'tabContracts', 'tabCustomOffers', 'tabCoachings', 'tabStats', 'tabWhatsapp'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = id !== `tab${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    });
    document.querySelectorAll('.admin-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === name);
    });
    if (name === 'contracts') loadOrders();
    if (name === 'coachings') loadCoachings();
    if (name === 'materiel') {
      loadMateriel();
      loadMaterielSales();
    }
    if (name === 'stats') initStats();
    if (name === 'whatsapp') loadWhatsApp(true);
    if (location.hash !== `#${name}`) {
      history.replaceState(null, '', `/admin/#${name}`);
    }
  }

  document.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  if (location.hash === '#contracts' || location.pathname.endsWith('/contrats')) {
    showTab('contracts');
  } else if (location.hash === '#customOffers' || location.hash === '#offres-perso') {
    showTab('customOffers');
  } else if (location.hash === '#materiel') {
    showTab('materiel');
  } else if (location.hash === '#stats') {
    showTab('stats');
  }

  async function ensureAuth() {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) {
      location.replace('/admin/login');
      throw new Error('unauthorized');
    }
    const data = await res.json();
    currentUser = data.user;
    const line = document.getElementById('adminUserLine');
    if (line && currentUser) {
      line.textContent = `${currentUser.name || currentUser.email} (${currentUser.email})`;
    }
    adminPanel.hidden = false;
  }

  async function loadMerch() {
    const res = await fetch('/api/admin/merch', { credentials: 'include', headers: headers(false) });
    if (!res.ok) throw new Error('unauthorized');
    const data = await res.json();
    products = data.products || [];
    featuredHome = resolveFeaturedIds(data.featured_home || []);
    renderMerch();
  }

  function resolveFeaturedIds(ids) {
    const canonical = new Map();
    for (const p of products) {
      canonical.set(p.id, p.id);
      if (p.legacy_id) canonical.set(p.legacy_id, p.id);
    }
    // Drop unknown / orphan ids — they inflate "3/3" with no checkbox
    return [...new Set((ids || []).map((id) => canonical.get(id)).filter(Boolean))].slice(0, 3);
  }

  function isFeaturedProduct(p) {
    return featuredHome.includes(p.id) || (p.legacy_id && featuredHome.includes(p.legacy_id));
  }

  function visibleFeaturedCount() {
    return products.filter((p) => isFeaturedProduct(p)).length;
  }

  async function loadOrders() {
    const msg = document.getElementById('ordersMsg');
    msg.textContent = 'Chargement…';
    msg.className = 'form-msg';
    try {
      const res = await fetch('/api/admin/orders', { credentials: 'include', headers: headers(false) });
      if (!res.ok) throw new Error('Accès refusé');
      const data = await res.json();
      orders = data.orders || [];
      msg.textContent = '';
      fillGymFilter();
      renderOrders();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg err';
    }
  }

  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function isCoachingOrder(o) {
    return o.action === 'coaching_booking' || String(o.order_id || '').startsWith('COACH-');
  }

  function fillGymFilter() {
    const sel = document.getElementById('ordersGymFilter');
    if (!sel) return;
    const current = sel.value || 'all';
    const seen = new Map(Object.entries(GYM_LABELS));
    orders.forEach((o) => {
      if (o.gym && !seen.has(o.gym)) seen.set(o.gym, o.gym_label || gymLabel(o.gym));
    });
    const opts = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
    sel.innerHTML =
      '<option value="all">Toutes les salles</option>' +
      opts.map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`).join('');
    if ([...sel.options].some((opt) => opt.value === current)) sel.value = current;
  }

  function orderDateMs(o) {
    const t = Date.parse(o.created_at || o.updated_at || '');
    return Number.isFinite(t) ? t : 0;
  }

  function inOrdersDateRange(o) {
    const fromVal = document.getElementById('ordersDateFrom')?.value || '';
    const toVal = document.getElementById('ordersDateTo')?.value || '';
    if (!fromVal && !toVal) return true;
    const t = orderDateMs(o);
    if (!t) return false;
    if (fromVal) {
      const from = new Date(`${fromVal}T00:00:00`).getTime();
      if (t < from) return false;
    }
    if (toVal) {
      const to = new Date(`${toVal}T23:59:59.999`).getTime();
      if (t > to) return false;
    }
    return true;
  }

  function filteredOrders() {
    const q = (document.getElementById('ordersSearch')?.value || '').toLowerCase().trim();
    const filter = document.getElementById('ordersFilter')?.value || 'all';
    const gym = document.getElementById('ordersGymFilter')?.value || 'all';
    const paidEmails = new Set(
      orders
        .filter((o) => o.payment_status === 'paid' || o.payment_status === 'free' || o.signed)
        .map((o) => String(o.email || '').trim().toLowerCase())
        .filter((e) => e && e !== '—' && e.includes('@'))
    );
    return orders.filter((o) => {
      if (isCoachingOrder(o)) return false;
      const hasVisibleContent = [o.name, o.email, o.product].some(
        (v) => String(v || '').trim() && String(v || '').trim() !== '—'
      );
      if (!hasVisibleContent) return false;
      if (filter === 'signed' && !o.signed) return false;
      if (filter === 'progress' && o.signed) return false;
      if (filter === 'paid_unsigned' && !(o.payment_status === 'paid' && !o.signed)) return false;
      if (filter === 'unpaid' && o.payment_status !== 'past_due' && !o.access_blocked) return false;
      if (filter === 'failed' && !isRefusedPayment(o)) return false;
      if (filter === 'aventure' && !(o.aventure || o.source === 'balma_retour')) return false;
      if (gym !== 'all' && String(o.gym || '') !== gym) return false;
      if (!inOrdersDateRange(o)) return false;
      const emptyName = !String(o.name || '').trim() || o.name === '—';
      const emptyEmail = !String(o.email || '').trim() || o.email === '—';
      if (emptyName && emptyEmail && o.payment_status !== 'paid' && o.payment_status !== 'free' && !o.signed) {
        return false;
      }
      const email = String(o.email || '').trim().toLowerCase();
      if (
        email &&
        paidEmails.has(email) &&
        o.payment_status !== 'paid' &&
        o.payment_status !== 'free' &&
        !o.signed
      ) {
        return false;
      }
      if (!q) return true;
      const hay = `${o.order_id} ${o.name} ${o.email} ${o.product} ${o.gym || ''} ${o.gym_label || gymLabel(o.gym)} ${o.aventure ? 'aventure balma' : ''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function isRefusedPayment(o) {
    const st = String(o.payment_status || '').toLowerCase();
    return st === 'failed' || st === 'refused' || st === 'canceled' || st === 'cancelled';
  }

  function ensureRefusedFilterOption() {
    const sel = document.getElementById('ordersFilter');
    if (!sel) return;
    if ([...sel.options].some((o) => o.value === 'failed')) return;
    const opt = document.createElement('option');
    opt.value = 'failed';
    opt.textContent = 'Paiements refusés';
    const unpaid = [...sel.options].find((o) => o.value === 'unpaid');
    if (unpaid) unpaid.after(opt);
    else sel.appendChild(opt);
  }

  function paymentBadge(o) {
    if (!o.payment_status) return '<span class="badge">—</span>';
    if (o.payment_status === 'paid') return '<span class="badge ok">Payé</span>';
    if (isRefusedPayment(o)) return '<span class="badge err">Refusé</span>';
    if (o.payment_status === 'past_due') {
      return `<span class="badge pending">Impayé${o.access_blocked ? ' · bloqué' : ''}</span>`;
    }
    return '<span class="badge pending">En attente</span>';
  }

  async function loadCoachings() {
    const msg = document.getElementById('coachingsMsg');
    if (msg) {
      msg.textContent = 'Chargement…';
      msg.className = 'form-msg';
    }
    try {
      const res = await fetch('/api/admin/coachings', { credentials: 'include', headers: headers(false) });
      if (!res.ok) throw new Error('Accès refusé');
      const data = await res.json();
      coachings = data.orders || [];
      if (msg) msg.textContent = '';
      renderCoachings();
    } catch (err) {
      if (msg) {
        msg.textContent = err.message;
        msg.className = 'form-msg err';
      }
    }
  }

  function filteredCoachings() {
    const q = (document.getElementById('coachingsSearch')?.value || '').toLowerCase().trim();
    if (!q) return coachings;
    return coachings.filter((o) => {
      const hay = `${o.order_id} ${o.name} ${o.email} ${o.phone} ${o.gym} ${o.activity} ${o.product} ${o.slot}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderCoachings() {
    const tbody = document.getElementById('coachingsBody');
    const countEl = document.getElementById('coachingsCount');
    if (!tbody) return;
    const list = filteredCoachings();
    if (countEl) {
      countEl.textContent =
        list.length === coachings.length
          ? `${coachings.length} réservation(s)`
          : `${list.length} sur ${coachings.length} réservation(s)`;
    }
    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="10" style="text-align:center;color:var(--bc-muted);padding:24px">Aucune réservation coaching</td></tr>';
      return;
    }
    tbody.innerHTML = list
      .map((o) => {
        const status =
          o.booking_status === 'sent' || o.email_sent
            ? '<span class="badge ok">Mail envoyé</span>'
            : o.booking_status === 'queued' || o.booking_status === 'brevo_not_configured'
              ? '<span class="badge pending">En file</span>'
              : `<span class="badge pending">${escapeHtml(o.step_label || o.booking_status || 'Reçu')}</span>`;
        return `
      <tr>
        <td><code style="font-size:11px">${escapeHtml(o.order_id)}</code></td>
        <td>${escapeHtml(o.name)}</td>
        <td><a href="mailto:${encodeURIComponent(o.email)}" style="color:var(--bc-cta)">${escapeHtml(o.email)}</a></td>
        <td><a href="tel:${escapeHtml(o.phone || '')}">${escapeHtml(o.phone || '—')}</a></td>
        <td>${escapeHtml(o.gym || '—')}</td>
        <td>${escapeHtml(o.activity || '—')}</td>
        <td>${escapeHtml(o.booking_date || '—')}</td>
        <td>${escapeHtml(o.slot || '—')}</td>
        <td>${status}</td>
        <td>
          <button type="button" class="btn sm secondary del-coach" data-id="${escapeHtml(o.order_id)}" title="Supprimer">✕</button>
        </td>
      </tr>`;
      })
      .join('');

    tbody.querySelectorAll('.del-coach').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        if (!confirm(`Supprimer la réservation ${id} ?`)) return;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: headers(false),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || 'Erreur');
          coachings = coachings.filter((o) => o.order_id !== id);
          renderCoachings();
        } catch (err) {
          const msg = document.getElementById('coachingsMsg');
          if (msg) {
            msg.textContent = err.message;
            msg.className = 'form-msg err';
          }
          btn.disabled = false;
        }
      };
    });
  }

  function renderOrders() {
    const tbody = document.getElementById('ordersBody');
    const list = sortOrdersForDisplay(filteredOrders());
    const selectAll = document.getElementById('ordersSelectAll');
    if (selectAll) selectAll.checked = false;
    document.getElementById('ordersCount').textContent =
      list.length === orders.length
        ? `${orders.length} inscription(s)`
        : `${list.length} sur ${orders.length} inscription(s)`;

    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="13" style="text-align:center;color:var(--bc-muted);padding:24px">Aucune inscription trouvée</td></tr>';
      return;
    }

    tbody.innerHTML = list
      .map(
        (o) => `
      <tr>
        <td><input type="checkbox" class="order-pick" data-id="${escapeHtml(o.order_id)}" ${canDiffuseOrder(o) ? '' : 'disabled'} /></td>
        <td><code style="font-size:11px">${escapeHtml(o.order_id)}</code></td>
        <td>${escapeHtml(o.name)}</td>
        <td>${
          o.aventure || o.source === 'balma_retour' || o.origine === 'Aventure Balma'
            ? `<span class="badge aventure" title="Parcours Aventure Balma — 5 salles Boxing Center">Aventure Balma</span>${
                o.manual_migration || o.bot_status === 'manual_ok'
                  ? ' <span class="badge pending" title="Migration Deciplus faite par le coach, hors bot">Migré à la main</span>'
                  : ''
              }`
            : o.source === 'custom_offer' || o.origine === 'Offre perso'
              ? '<span class="badge pending" title="Lien d’offre personnalisée">Offre perso</span>'
              : '<span class="badge pending">Boutique</span>'
        }</td>
        <td><a href="mailto:${encodeURIComponent(o.email)}" style="color:var(--bc-cta)">${escapeHtml(o.email)}</a></td>
        <td>${escapeHtml(o.product)}</td>
        <td>${escapeHtml(o.gym_label || gymLabel(o.gym))}</td>
        <td>${escapeHtml(o.step_label || STEP_LABELS[o.step] || o.step)}</td>
        <td>${paymentBadge(o)}</td>
        <td>${o.signed ? `✓ ${formatDate(o.signed_at)}` : '—'}</td>
        <td style="font-size:12px">${formatDate(o.created_at)}</td>
        <td>
          ${
            o.action
              ? '—'
              : `<button type="button" class="btn sm dl-contract" data-id="${escapeHtml(o.order_id)}">PDF</button>`
          }
        </td>
        <td>
          ${
            o.can_resume
              ? `<button type="button" class="btn sm resume-order" data-id="${escapeHtml(o.order_id)}">Lien de reprise</button>`
              : ''
          }
          ${
            o.can_pay
              ? `<button type="button" class="btn sm pay-order" data-id="${escapeHtml(o.order_id)}">Payer</button>`
              : ''
          }
          <button type="button" class="btn sm secondary del-order" data-id="${escapeHtml(o.order_id)}" title="Supprimer">✕</button>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('.dl-contract').forEach((btn) => {
      btn.onclick = () => {
        if (window.BCContract) {
          window.BCContract.openAdminView(btn.dataset.id);
        }
      };
    });

    tbody.querySelectorAll('.resume-order').forEach((btn) => {
      btn.onclick = () => generateResumeLink(btn.dataset.id, btn);
    });
    tbody.querySelectorAll('.pay-order').forEach((btn) => {
      btn.onclick = () => generateResumeLink(btn.dataset.id, btn, 'pay');
    });

    tbody.querySelectorAll('.del-order').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const msg = document.getElementById('ordersMsg');
        if (!confirm(`Supprimer l'inscription ${id} ? Cette action est irréversible.`)) return;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: headers(false),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || 'Erreur');
          orders = orders.filter((o) => o.order_id !== id);
          renderOrders();
          if (msg) {
            msg.textContent = `Inscription ${id} supprimée.`;
            msg.className = 'form-msg ok';
          }
        } catch (err) {
          if (msg) {
            msg.textContent = err.message;
            msg.className = 'form-msg err';
          }
          btn.disabled = false;
        }
      };
    });
  }

  function setCatalogMsg(text, type) {
    const el = document.getElementById('catalogMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'form-msg' + (type ? ` ${type}` : '');
  }

  function applyLocalProductPatch(product_id, patchBody) {
    const idx = products.findIndex((p) => p.id === product_id);
    if (idx < 0) return null;
    const prev = { ...products[idx] };
    products[idx] = { ...products[idx], ...patchBody };
    if (patchBody.display_name != null) products[idx].display_name = patchBody.display_name;
    return prev;
  }

  function flashSaved(btn) {
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = '✓ Enregistré';
    btn.disabled = true;
    btn.classList.add('is-saved');
    setTimeout(() => {
      btn.textContent = prev;
      btn.disabled = false;
      btn.classList.remove('is-saved');
    }, 1800);
  }

  function updateFeaturedCardLabel(productId, displayName) {
    const card = document.querySelector(`.admin-featured-card input[data-feat-id="${CSS.escape(productId)}"]`);
    if (!card) return;
    const nameEl = card.closest('.admin-featured-card')?.querySelector('.admin-featured-name');
    if (nameEl) nameEl.textContent = displayName;
  }

  function renderFeatured() {
    const el = document.getElementById('featuredList');
    const countEl = document.getElementById('featuredCount');
    featuredHome = resolveFeaturedIds(featuredHome);
    if (countEl) countEl.textContent = `${visibleFeaturedCount()} / 3`;

    if (!products.length) {
      el.innerHTML = '<p class="admin-empty">Aucune offre dans le catalogue.</p>';
      return;
    }

    el.innerHTML = products
      .map((p) => {
        const checked = isFeaturedProduct(p);
        const inputId = `feat-${p.id}`;
        return `
        <div class="admin-featured-card${checked ? ' is-selected' : ''}">
          <input type="checkbox" class="admin-checkbox admin-feat-checkbox" id="${escapeHtml(inputId)}" value="${escapeHtml(p.id)}"
            ${checked ? 'checked' : ''} data-feat-id="${escapeHtml(p.id)}" />
          <label class="admin-featured-label" for="${escapeHtml(inputId)}">
            <span class="admin-featured-name">${escapeHtml(p.display_name || p.name)}</span>
            <span class="admin-featured-id">${escapeHtml(p.id)}</span>
          </label>
        </div>`;
      })
      .join('');

    el.querySelectorAll('.admin-feat-checkbox').forEach((cb) => {
      cb.onchange = () => toggleFeatured(cb.dataset.featId, cb.checked, cb);
    });
  }

  function toggleFeatured(id, checked, inputEl) {
    const pid = resolveFeaturedIds([id])[0] || id;
    if (checked) {
      if (visibleFeaturedCount() >= 3 && !isFeaturedProduct({ id: pid })) {
        alert('Maximum 3 offres à la une');
        if (inputEl) inputEl.checked = false;
        return;
      }
      if (!featuredHome.includes(pid)) featuredHome.push(pid);
      featuredHome = resolveFeaturedIds(featuredHome);
    } else {
      featuredHome = featuredHome.filter((x) => x !== pid);
    }
    renderFeatured();
  }

  window._toggleFeatured = toggleFeatured;

  function productRowHtml(p) {
    return `
      <tr>
        <td><label class="toggle-switch"><input type="checkbox" ${p.active !== false ? 'checked' : ''} data-id="${escapeHtml(p.id)}" class="toggle-active admin-checkbox" /><span class="toggle-slider"></span></label></td>
        <td><code class="admin-code">${escapeHtml(p.id)}</code></td>
        <td><input value="${escapeHtml(p.display_name || p.name)}" data-id="${escapeHtml(p.id)}" class="edit-name admin-input-inline" /></td>
        <td><span class="admin-tab-pill">${escapeHtml(p.tab || '—')}</span></td>
        <td><input type="number" value="${p.sort_order ?? 99}" data-id="${escapeHtml(p.id)}" class="edit-sort admin-input-sort" /></td>
        <td style="white-space:nowrap">
          <button type="button" class="btn sm save-row" data-id="${escapeHtml(p.id)}">Sauver</button>
          <button type="button" class="btn sm secondary edit-full" data-id="${escapeHtml(p.id)}">Détails</button>
        </td>
      </tr>`;
  }

  function bindTableActions(root) {
    root.querySelectorAll('.toggle-active').forEach((cb) => {
      cb.onchange = async () => {
        const id = cb.dataset.id;
        const prevActive = !cb.checked;
        applyLocalProductPatch(id, { active: cb.checked });
        setCatalogMsg('Enregistrement…');
        try {
          await patch(id, { active: cb.checked }, { silent: true });
          setCatalogMsg(cb.checked ? 'Offre activée.' : 'Offre désactivée.', 'ok');
          renderFeatured();
        } catch {
          applyLocalProductPatch(id, { active: prevActive });
          cb.checked = prevActive;
        }
      };
    });
    root.querySelectorAll('.save-row').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const name = root.querySelector(`.edit-name[data-id="${CSS.escape(id)}"]`)?.value;
        const sort = Number(root.querySelector(`.edit-sort[data-id="${CSS.escape(id)}"]`)?.value);
        const prev = applyLocalProductPatch(id, { display_name: name, sort_order: sort });
        updateFeaturedCardLabel(id, name);
        setCatalogMsg('Enregistrement…');
        try {
          await patch(id, { display_name: name, sort_order: sort }, { triggerEl: btn, silent: true });
          setCatalogMsg('Modifications enregistrées.', 'ok');
        } catch {
          if (prev) {
            const idx = products.findIndex((p) => p.id === id);
            if (idx >= 0) products[idx] = prev;
            renderTable();
            renderFeatured();
          }
        }
      };
    });
    root.querySelectorAll('.edit-full').forEach((btn) => {
      btn.onclick = () => openProductEditor(btn.dataset.id);
    });
  }

  function openProductEditor(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const modal = document.getElementById('productEditModal');
    if (!modal) return;
    modal.hidden = false;
    modal.style.display = 'grid';
    document.getElementById('pe_id').value = p.id;
    document.getElementById('pe_display_name').value = p.display_name || p.name || '';
    document.getElementById('pe_duration').value = p.duration_label || '';
    document.getElementById('pe_audience').value = p.audience || '';
    document.getElementById('pe_badge').value = p.badge || '';
    document.getElementById('pe_marketing_price').value = p.marketing_price_label || '';
    document.getElementById('pe_price_subtitle').value = p.price_subtitle || '';
    document.getElementById('pe_installments').value = p.installments_note || '';
    document.getElementById('pe_benefits').value = Array.isArray(p.benefits) ? p.benefits.join('\n') : '';
    document.getElementById('pe_search').value = p.deciplus_product_search || '';
    /* Le prix se saisit en EUROS et se stocke en centimes : demander des
       centimes a un humain, c'est fabriquer l'erreur de facteur cent. */
    document.getElementById('pe_price_eur').value =
      p.price_cents != null ? (Number(p.price_cents) / 100).toFixed(2).replace(/\.00$/, '') : '';
    document.getElementById('pe_iban').value = p.requires_iban ? '1' : '';
    document.getElementById('pe_promo_start').value = (p.promo_start || '').slice(0, 10);
    document.getElementById('pe_promo_end').value = (p.promo_end || '').slice(0, 10);
    document.getElementById('pe_image').value = p.image || '';
    document.getElementById('pe_msg').textContent = '';
  }

  function closeProductEditor() {
    const modal = document.getElementById('productEditModal');
    if (modal) {
      modal.hidden = true;
      modal.style.display = 'none';
    }
  }

  async function saveProductEditor(e) {
    e.preventDefault();
    const id = document.getElementById('pe_id').value;
    const benefitsRaw = document.getElementById('pe_benefits').value || '';
    const benefits = benefitsRaw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const body = {
      display_name: document.getElementById('pe_display_name').value,
      duration_label: document.getElementById('pe_duration').value || null,
      audience: document.getElementById('pe_audience').value || null,
      badge: document.getElementById('pe_badge').value || null,
      marketing_price_label: document.getElementById('pe_marketing_price').value || null,
      price_subtitle: document.getElementById('pe_price_subtitle').value || null,
      installments_note: document.getElementById('pe_installments').value || null,
      benefits,
      deciplus_product_search: document.getElementById('pe_search').value || null,
    };
    /* Un champ laisse VIDE ne doit rien ecraser : on ne l'envoie pas.
       Envoyer `null` effacerait le prix au premier enregistrement d'une
       modification de libelle. */
    const eur = document.getElementById('pe_price_eur').value.trim();
    if (eur !== '') body.price_cents = Math.round(parseFloat(eur.replace(',', '.')) * 100);
    body.requires_iban = document.getElementById('pe_iban').value === '1';
    body.promo_start = document.getElementById('pe_promo_start').value || null;
    body.promo_end = document.getElementById('pe_promo_end').value || null;
    const img = document.getElementById('pe_image').value.trim();
    if (img !== '') body.image = img;
    const msg = document.getElementById('pe_msg');
    msg.textContent = 'Enregistrement…';
    msg.className = 'form-msg';
    try {
      await patch(id, body, { silent: true });
      applyLocalProductPatch(id, body);
      renderMerch();
      msg.textContent = 'Offre mise à jour.';
      msg.className = 'form-msg ok';
      setTimeout(closeProductEditor, 600);
    } catch (err) {
      msg.textContent = err.message || 'Erreur';
      msg.className = 'form-msg err';
    }
  }

  function renderTable() {
    const container = document.getElementById('productsCatalog');
    const grouped = new Map();
    for (const p of products) {
      const key = catalogSectionKey(p);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(p);
    }

    const sections = CATALOG_SECTIONS.filter((s) => grouped.has(s.key) && grouped.get(s.key).length)
      .map((s) => {
        const items = grouped.get(s.key);
        return `
        <div class="admin-catalog-block">
          <div class="admin-catalog-block-head">
            <h3 class="admin-catalog-block-title">${escapeHtml(s.label)}</h3>
            <span class="admin-section-badge">${items.length} offre${items.length > 1 ? 's' : ''}</span>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Actif</th>
                  <th>ID</th>
                  <th>Nom affiché</th>
                  <th>Onglet</th>
                  <th>Tri</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${items.map(productRowHtml).join('')}</tbody>
            </table>
          </div>
        </div>`;
      })
      .join('');

    container.innerHTML =
      sections || '<p class="admin-empty">Aucune offre à afficher.</p>';
    bindTableActions(container);
  }

  async function patch(product_id, patchBody, opts = {}) {
    const res = await fetch('/api/admin/merch', {
      method: 'PUT',
      credentials: 'include',
      headers: headers(),
      body: JSON.stringify({ product_id, patch: patchBody }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Échec enregistrement');

    if (data.product) {
      const idx = products.findIndex((p) => p.id === product_id);
      if (idx >= 0) products[idx] = data.product;
      else products.push(data.product);
      if (!opts.silent) renderFeatured();
    }

    if (data.warning && !opts.silent) {
      setCatalogMsg(data.warning, 'err');
    } else if (!opts.silent) {
      setCatalogMsg('Modifications enregistrées.', 'ok');
    }

    if (opts.triggerEl) flashSaved(opts.triggerEl);
    return data;
  }

  function renderMerch() {
    renderFeatured();
    renderTable();
  }

  /* ================================================================
     LES PLACES DE L'OFFRE DE RENTREE.

     Ce que le patron pose ici est ce que les quatre sites du club
     affichent. On lui montre aussi l'ecart : combien d'inscriptions
     payees en ligne sont deja tombees depuis son dernier reglage, et
     donc quel nombre les visiteurs voient VRAIMENT en ce moment. Sans
     cet ecart, il reglerait a l'aveugle.
     ================================================================ */
  function setPlacesMsg(text, type) {
    const el = document.getElementById('placesMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'form-msg' + (type ? ` ${type}` : '');
  }

  function peindrePlaces(d) {
    const badge = document.getElementById('placesBadge');
    const etat = document.getElementById('placesEtat');
    if (!d || !d.ok) {
      if (badge) badge.textContent = '—';
      if (etat) etat.textContent = '';
      return;
    }
    const r = d.reglage || {};
    document.getElementById('placesQuota').value = r.quota || '';
    document.getElementById('placesRestantes').value = r.restantes || '';
    document.getElementById('placesFin').value = r.fin || '';
    if (badge) badge.textContent = `${d.affiche} affichée${d.affiche > 1 ? 's' : ''}`;
    if (etat) {
      const ecart = (r.restantes || 0) - d.affiche;
      etat.textContent = r.maj
        ? `Réglé le ${formatDate(r.maj)} · ${d.ventes_en_ligne} inscription(s) payée(s) en ligne au total`
          + (ecart > 0 ? ` · ${ecart} vendue(s) depuis votre réglage, déjà déduite(s)` : '')
          + (d.affiche === 0 ? ' · les sites n’affichent plus rien (complet)' : '')
        : 'Jamais réglé : les sites n’affichent aucun compteur.';
    }
  }

  async function loadPlaces() {
    try {
      const res = await fetch('/api/admin/offre-rentree', { credentials: 'include', headers: headers(false) });
      peindrePlaces(await res.json());
    } catch { /* le panneau reste vide, ce qui est la bonne reponse */ }
  }

  const btnPlaces = document.getElementById('savePlaces');
  if (btnPlaces) {
    btnPlaces.onclick = async () => {
      btnPlaces.disabled = true;
      setPlacesMsg('Enregistrement…');
      try {
        const res = await fetch('/api/admin/offre-rentree', {
          method: 'PUT',
          credentials: 'include',
          headers: headers(true),
          body: JSON.stringify({
            quota: document.getElementById('placesQuota').value,
            restantes: document.getElementById('placesRestantes').value,
            fin: document.getElementById('placesFin').value,
          }),
        });
        const d = await res.json();
        if (!res.ok || !d.ok) throw new Error(d.error || 'Enregistrement refusé');
        peindrePlaces(d);
        setPlacesMsg(
          d.affiche > 0
            ? `Enregistré — les sites affichent « plus que ${d.affiche} places ».`
            : 'Enregistré — à zéro, les sites n’affichent aucun compteur.',
          'ok'
        );
      } catch (err) {
        setPlacesMsg(err.message || 'Enregistrement impossible', 'error');
      } finally {
        btnPlaces.disabled = false;
      }
    };
    loadPlaces();
  }

  document.getElementById('saveFeatured').onclick = async () => {
    const msg = document.getElementById('featuredMsg');
    msg.textContent = 'Enregistrement…';
    msg.className = 'form-msg';
    try {
      const res = await fetch('/api/admin/merch/featured', {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify({ ids: featuredHome.slice(0, 3) }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Échec enregistrement');
      featuredHome = resolveFeaturedIds(data.featured_home || featuredHome);
      renderFeatured();
      msg.textContent = data.warning || 'Offres à la une enregistrées.';
      msg.className = data.warning ? 'form-msg err' : 'form-msg ok';
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg err';
    }
  };

  document.getElementById('addOfferForm').onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('addOfferMsg');
    msg.textContent = 'Création…';
    msg.className = 'form-msg';
    const fd = new FormData(e.target);
    const priceEuros = fd.get('price_euros');
    const ibanMode = fd.get('requires_iban');
    const body = {
      display_name: fd.get('display_name'),
      tab: fd.get('tab'),
      subsection: fd.get('subsection'),
    };
    if (priceEuros !== '' && priceEuros != null) {
      body.price_cents = Math.round(Number(priceEuros) * 100);
    }
    if (ibanMode === '1') body.requires_iban = true;
    if (ibanMode === '0') body.requires_iban = false;
    try {
      const res = await fetch('/api/admin/merch/create', {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échec création');
      msg.textContent = `Offre créée : ${data.id}`;
      msg.className = 'form-msg ok';
      e.target.reset();
      if (data.product) {
        products.push(data.product);
        renderMerch();
      } else {
        await loadMerch();
      }
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg err';
    }
  };

  /* ─────────────────────────────────────────────
     ONGLET MATERIEL
  ───────────────────────────────────────────── */
  let materielProducts = [];
  let materielCategories = [];
  let materielLoaded = false;
  let materielSales = [];
  let materielSalesLoaded = false;
  let materielSalesPage = 1;
  const MATERIEL_SALES_PER_PAGE = 10;

  function notifyLabel(sale) {
    const n = sale.manager_notify || {};
    if (n.sent && n.via === 'email') {
      return { text: `Email (${n.manager || sale.manager_name || '—'})`, cls: 'badge ok' };
    }
    if (n.sent) return { text: `Envoyé (${n.manager || sale.manager_name || '—'})`, cls: 'badge ok' };
    if (n.skipped === 'awaiting_signal' || n.pending) {
      return { text: 'En attente Signal', cls: 'badge warn' };
    }
    if (n.skipped === 'demo') return { text: 'Ignoré (démo)', cls: 'badge warn' };
    if (n.error) return { text: n.error, cls: 'badge err' };
    if (sale.source === 'upsell' && sale.payment_status === 'paid') {
      return { text: 'À la signature', cls: 'badge warn' };
    }
    if (sale.payment_status !== 'paid') return { text: 'Après paiement', cls: 'badge' };
    return { text: 'Pas encore', cls: 'badge warn' };
  }

  function renderMaterielSalesPager() {
    const pager = document.getElementById('materielSalesPager');
    const info = document.getElementById('materielSalesPagerInfo');
    const prev = document.getElementById('materielSalesPrev');
    const next = document.getElementById('materielSalesNext');
    const total = materielSales.length;
    const pages = Math.max(1, Math.ceil(total / MATERIEL_SALES_PER_PAGE));
    if (materielSalesPage > pages) materielSalesPage = pages;
    if (materielSalesPage < 1) materielSalesPage = 1;
    if (pager) pager.hidden = total <= MATERIEL_SALES_PER_PAGE;
    const start = total ? (materielSalesPage - 1) * MATERIEL_SALES_PER_PAGE + 1 : 0;
    const end = Math.min(materielSalesPage * MATERIEL_SALES_PER_PAGE, total);
    if (info) info.textContent = total ? `${start}–${end} sur ${total}` : '';
    if (prev) prev.disabled = materielSalesPage <= 1;
    if (next) next.disabled = materielSalesPage >= pages;
  }

  function renderMaterielSales() {
    const tbody = document.getElementById('materielSalesBody');
    const countEl = document.getElementById('materielSalesCount');
    if (!tbody) return;
    if (!materielSales.length) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;color:var(--bc-muted);padding:24px">Aucune vente matériel payée pour l’instant.</td></tr>';
      if (countEl) countEl.textContent = '';
      renderMaterielSalesPager();
      return;
    }
    const start = (materielSalesPage - 1) * MATERIEL_SALES_PER_PAGE;
    const pageRows = materielSales.slice(start, start + MATERIEL_SALES_PER_PAGE);
    tbody.innerHTML = pageRows
      .map((s) => {
        const wa = notifyLabel(s);
        const when = s.paid_at || s.created_at;
        const dateTxt = when
          ? new Date(when).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
          : '—';
        const name = [s.customer?.first_name, s.customer?.last_name].filter(Boolean).join(' ') || '—';
        const paid = s.payment_status === 'paid';
        const facture = paid
          ? `<a class="btn sm secondary" href="/api/admin/orders/${encodeURIComponent(s.order_id)}/contract.pdf" target="_blank">Facture</a>`
          : '';
        const relance = paid
          ? `<button type="button" class="btn sm" data-notify-sale="${escapeHtml(s.order_id)}">${s.manager_notify?.sent ? 'Renvoyer' : 'Notifier'}</button>`
          : '';
        return `<tr>
          <td>${escapeHtml(dateTxt)}<div style="color:var(--bc-muted);font-size:11px">${escapeHtml(s.order_id || '')}${s.source === 'upsell' ? ' · upsell' : ''}</div></td>
          <td><strong>${escapeHtml(name)}</strong><div style="color:var(--bc-muted);font-size:12px">${escapeHtml(s.customer?.phone || '')}</div></td>
          <td>${escapeHtml(s.product || '—')}</td>
          <td style="text-align:right;font-weight:600">${fmtEur(s.total_cents)}</td>
          <td>${escapeHtml(s.pickup_label || s.pickup_gym || '—')}</td>
          <td>${escapeHtml(s.manager_name || '—')}</td>
          <td><span class="${wa.cls}">${escapeHtml(wa.text)}</span></td>
          <td style="display:flex;gap:6px;flex-wrap:wrap">${relance}${facture}</td>
        </tr>`;
      })
      .join('');
    if (countEl) {
      const pages = Math.max(1, Math.ceil(materielSales.length / MATERIEL_SALES_PER_PAGE));
      countEl.textContent = `${materielSales.length} vente(s) · page ${materielSalesPage}/${pages} · 10 par page`;
    }
    renderMaterielSalesPager();
    tbody.querySelectorAll('[data-notify-sale]').forEach((btn) => {
      btn.addEventListener('click', () => notifyMaterielManager(btn.dataset.notifySale, btn));
    });
  }

  async function loadMaterielSales(force = false) {
    if (materielSalesLoaded && !force) {
      renderMaterielSales();
      return;
    }
    const msg = document.getElementById('materielSalesMsg');
    try {
      const res = await fetch('/api/admin/materiel-orders', { credentials: 'include', headers: headers(false) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'unauthorized');
      materielSales = data.orders || [];
      materielSalesLoaded = true;
      materielSalesPage = 1;
      renderMaterielSales();
      if (msg) {
        msg.textContent = '';
        msg.className = 'form-msg';
      }
    } catch (err) {
      if (msg) {
        msg.textContent = err.message || 'Impossible de charger les ventes';
        msg.className = 'form-msg err';
      }
    }
  }

  async function notifyMaterielManager(orderId, btn) {
    const msg = document.getElementById('materielSalesMsg');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/admin/materiel-orders/${encodeURIComponent(orderId)}/notify-manager`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Envoi WhatsApp impossible');
      const idx = materielSales.findIndex((s) => s.order_id === orderId);
      if (idx >= 0 && data.sale) materielSales[idx] = data.sale;
      renderMaterielSales();
      const sent = data.notify?.sent;
      const text = sent
        ? `WhatsApp envoyé à ${data.notify?.manager || 'le manager'}`
        : data.notify?.error || 'WhatsApp non envoyé';
      if (msg) {
        msg.textContent = text;
        msg.className = sent ? 'form-msg ok' : 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast(text, sent ? '' : 'err');
    } catch (err) {
      if (msg) {
        msg.textContent = err.message;
        msg.className = 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast(err.message, 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.getElementById('refreshMaterielSalesBtn')?.addEventListener('click', () => {
    loadMaterielSales(true);
  });

  document.getElementById('materielSalesPrev')?.addEventListener('click', () => {
    if (materielSalesPage <= 1) return;
    materielSalesPage -= 1;
    renderMaterielSales();
    document.getElementById('materielSalesTable')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  document.getElementById('materielSalesNext')?.addEventListener('click', () => {
    const pages = Math.max(1, Math.ceil(materielSales.length / MATERIEL_SALES_PER_PAGE));
    if (materielSalesPage >= pages) return;
    materielSalesPage += 1;
    renderMaterielSales();
    document.getElementById('materielSalesTable')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  document.getElementById('flushMaterielCoachBtn')?.addEventListener('click', async () => {
    const msg = document.getElementById('materielSalesMsg');
    const btn = document.getElementById('flushMaterielCoachBtn');
    if (
      !window.confirm(
        'Renvoyer toutes les ventes matériel en attente aux coachs (Signal/SMS) ?\n\nÀ utiliser une fois les téléphones branchés.'
      )
    ) {
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/admin/materiel-orders/flush-coach-notify', {
        method: 'POST',
        credentials: 'include',
        headers: headers(true),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Envoi impossible');
      const text = `${data.sent || 0} notification(s) envoyée(s) sur ${data.flushed || 0} vente(s) en attente`;
      if (msg) {
        msg.textContent = text;
        msg.className = 'form-msg ok';
      }
      if (typeof window.panToast === 'function') window.panToast(text);
      await loadMaterielSales(true);
    } catch (err) {
      if (msg) {
        msg.textContent = err.message || 'Envoi impossible';
        msg.className = 'form-msg err';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('purgeUnpaidMaterielBtn')?.addEventListener('click', async () => {
    const msg = document.getElementById('materielSalesMsg');
    const btn = document.getElementById('purgeUnpaidMaterielBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/admin/materiel-orders/purge-unpaid', {
        method: 'POST',
        credentials: 'include',
        headers: headers(true),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Purge impossible');
      const n = data.count || 0;
      const text = n ? `${n} brouillon(s) impayé(s) supprimé(s)` : 'Aucun brouillon impayé';
      if (msg) {
        msg.textContent = text;
        msg.className = 'form-msg ok';
      }
      if (typeof window.panToast === 'function') window.panToast(text);
      await loadMaterielSales(true);
    } catch (err) {
      if (msg) {
        msg.textContent = err.message || 'Purge impossible';
        msg.className = 'form-msg err';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  function setMaterielMsg(text, type) {
    const el = document.getElementById('materielMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'form-msg' + (type ? ` ${type}` : '');
  }

  function filteredMateriel() {
    const q = (document.getElementById('materielSearch')?.value || '').toLowerCase().trim();
    const cat = document.getElementById('materielCatFilter')?.value || '';
    return materielProducts.filter((p) => {
      if (cat && p.category !== cat) return false;
      if (!q) return true;
      return (
        (p.name || '').toLowerCase().includes(q) ||
        (p.reference || '').toLowerCase().includes(q) ||
        (p.category_label || '').toLowerCase().includes(q)
      );
    });
  }

  function stockClass(stock) {
    if (stock > 5) return 'badge ok';
    if (stock > 0) return 'badge warn';
    return 'badge err';
  }

  function renderMaterielTable() {
    const tbody = document.getElementById('materielBody');
    const countEl = document.getElementById('materielCount');
    const list = filteredMateriel();

    if (countEl) {
      countEl.textContent =
        list.length === materielProducts.length
          ? `${materielProducts.length} produit(s)`
          : `${list.length} sur ${materielProducts.length} produit(s)`;
    }

    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="7" style="text-align:center;color:var(--bc-muted);padding:24px">Aucun produit trouvé</td></tr>';
      return;
    }

    tbody.innerHTML = list
      .map((p) => {
        const img = p.image
          ? `<img src="${escapeHtml(p.image)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0" />`
          : `<div style="width:40px;height:40px;background:#f1f5f9;border-radius:6px;border:1px solid #e2e8f0"></div>`;
        const stockBadge = `<span class="${stockClass(p.stock)}" style="font-size:11px">${p.stock > 0 ? p.stock : 'Rupture'}</span>`;
        return `
        <tr data-id="${escapeHtml(p.id)}" style="${p.active === false ? 'opacity:0.55' : ''}">
          <td>
            <label class="toggle-switch">
              <input type="checkbox" class="mat-toggle admin-checkbox" data-id="${escapeHtml(p.id)}" ${p.active !== false ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
          </td>
          <td>${img}</td>
          <td>
            <div style="font-weight:600;font-size:13px;line-height:1.3">${escapeHtml(p.name)}</div>
            <div style="font-size:11px;color:var(--bc-muted);margin-top:2px">${escapeHtml(p.reference || p.id)}</div>
          </td>
          <td><span style="font-size:12px;background:#f1f5f9;padding:2px 8px;border-radius:4px;color:#475569">${escapeHtml(p.category_label || p.category || '—')}</span></td>
          <td style="text-align:right;font-weight:700;white-space:nowrap">${escapeHtml(p.price_label || '—')}</td>
          <td style="text-align:right">${stockBadge}</td>
          <td style="display:flex;gap:4px;flex-wrap:wrap">
            <button type="button" class="btn sm secondary mat-edit-btn" data-id="${escapeHtml(p.id)}" style="font-size:11px">Éditer</button>
            <a href="/materiel/produit?id=${encodeURIComponent(p.id)}" target="_blank" class="btn sm secondary" style="font-size:11px">Voir</a>
          </td>
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('.mat-edit-btn').forEach((btn) => {
      btn.onclick = () => openEditRow(btn.dataset.id, tbody);
    });

    tbody.querySelectorAll('.mat-toggle').forEach((cb) => {
      cb.onchange = async () => {
        const id = cb.dataset.id;
        const active = cb.checked;
        const row = tbody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
        if (row) row.style.opacity = active ? '1' : '0.55';
        setMaterielMsg('Enregistrement…');
        try {
          const res = await fetch(`/api/admin/materiel/${encodeURIComponent(id)}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active }),
          });
          const text = await res.text();
          let data;
          try { data = JSON.parse(text); } catch { data = {}; }
          if (!res.ok || !data.ok) throw new Error(data.error || `Erreur ${res.status}`);
          const idx = materielProducts.findIndex((p) => p.id === id);
          if (idx >= 0) materielProducts[idx] = { ...materielProducts[idx], active };
          setMaterielMsg(active ? 'Produit activé.' : 'Produit désactivé.', 'ok');
        } catch (err) {
          cb.checked = !active;
          if (row) row.style.opacity = !active ? '0.55' : '1';
          setMaterielMsg(err.message, 'err');
        }
      };
    });
  }

  function populateCatFilter() {
    const sel = document.getElementById('materielCatFilter');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Toutes les catégories</option>';
    materielCategories
      .filter((c) => c.id !== 16)
      .forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.slug;
        opt.textContent = c.label;
        if (c.slug === current) opt.selected = true;
        sel.appendChild(opt);
      });
  }

  async function loadMateriel() {
    if (materielLoaded) { renderMaterielTable(); return; }
    setMaterielMsg('Chargement du catalogue…');
    try {
      const res = await fetch('/api/materiel?all=1', { credentials: 'include' });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data = await res.json();
      materielProducts = data.products || [];
      materielCategories = data.categories || [];
      materielLoaded = true;
      const info = document.getElementById('materielSyncInfo');
      if (info) {
        const syncDate = data.synced_at
          ? new Date(data.synced_at).toLocaleString('fr-FR')
          : 'date inconnue';
        info.textContent = `Catalogue synchronisé le ${syncDate} — ${materielProducts.length} produit(s)`;
      }
      populateCatFilter();
      setMaterielMsg('');
      renderMaterielTable();
    } catch (err) {
      setMaterielMsg(err.message, 'err');
    }
  }

  document.getElementById('materielSearch')?.addEventListener('input', renderMaterielTable);
  document.getElementById('materielCatFilter')?.addEventListener('change', renderMaterielTable);

  // ─── Ajout produit matériel ───
  const toggleAddBtn = document.getElementById('toggleAddProductBtn');
  const addProductForm = document.getElementById('addProductForm');
  const cancelAddBtn = document.getElementById('cancelAddProductBtn');

  toggleAddBtn?.addEventListener('click', () => {
    const hidden = addProductForm.hidden;
    addProductForm.hidden = !hidden;
    toggleAddBtn.textContent = hidden ? 'Masquer le formulaire' : 'Afficher le formulaire';
  });
  cancelAddBtn?.addEventListener('click', () => {
    addProductForm.hidden = true;
    addProductForm.reset();
    const preview = document.getElementById('prd_img_preview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    toggleAddBtn.textContent = 'Afficher le formulaire';
  });

  // Image file → base64 preview
  document.getElementById('prd_img_file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setAddProductMsg('Image trop grande (max 2 Mo)', 'err');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = document.getElementById('prd_img_preview');
      if (preview) { preview.src = ev.target.result; preview.style.display = 'block'; }
      document.getElementById('prd_img_url').value = '';
      document.getElementById('prd_img_url').dataset.base64 = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('prd_img_url')?.addEventListener('input', () => {
    delete document.getElementById('prd_img_url').dataset.base64;
    const preview = document.getElementById('prd_img_preview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    document.getElementById('prd_img_file').value = '';
  });

  function setAddProductMsg(msg, type) {
    const el = document.getElementById('addProductMsg');
    if (!el) return;
    el.textContent = msg;
    el.className = `form-msg${type === 'err' ? ' err' : type === 'ok' ? ' ok' : ''}`;
  }

  addProductForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const imgUrlEl = document.getElementById('prd_img_url');
    const imgSrc = imgUrlEl?.dataset.base64 || imgUrlEl?.value?.trim() || null;
    const priceEuros = parseFloat(document.getElementById('prd_price').value) || 0;
    const body = {
      name: document.getElementById('prd_name').value.trim(),
      reference: document.getElementById('prd_ref').value.trim(),
      category: document.getElementById('prd_cat').value.trim(),
      category_label: document.getElementById('prd_cat_label').value.trim(),
      price_cents: Math.round(priceEuros * 100),
      stock: parseInt(document.getElementById('prd_stock').value, 10) || 0,
      description: document.getElementById('prd_desc').value.trim(),
      image: imgSrc,
    };
    if (!body.name) { setAddProductMsg('Le nom est requis.', 'err'); return; }
    setAddProductMsg('Création en cours…');
    try {
      const res = await fetch('/api/admin/materiel', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setAddProductMsg('Produit créé !', 'ok');
      addProductForm.reset();
      const preview = document.getElementById('prd_img_preview');
      if (preview) { preview.src = ''; preview.style.display = 'none'; }
      delete imgUrlEl.dataset.base64;
      // Rafraîchir le catalogue
      materielLoaded = false;
      await loadMateriel();
    } catch (err) {
      setAddProductMsg(err.message, 'err');
    }
  });

  // ─── Édition inline produit matériel ───
  function openEditRow(id, tbody) {
    const p = materielProducts.find((x) => x.id === id);
    if (!p) return;
    const existing = tbody.querySelector(`tr.mat-edit-row[data-edit="${CSS.escape(id)}"]`);
    if (existing) { existing.remove(); return; }
    const priceEuros = ((p.price_cents || 0) / 100).toFixed(2);
    const tr = document.createElement('tr');
    tr.className = 'mat-edit-row';
    tr.dataset.edit = id;
    tr.style.background = '#f8fafc';
    tr.innerHTML = `<td colspan="7" style="padding:12px 8px">
      <div class="mat-edit-form">
        <div class="mat-edit-grid">
          <div><label style="font-size:12px;color:#64748b">Nom</label><input class="me-name" value="${escapeHtml(p.name)}" style="width:100%" /></div>
          <div><label style="font-size:12px;color:#64748b">Prix (€)</label><input class="me-price" type="number" min="0" step="0.01" value="${priceEuros}" /></div>
          <div><label style="font-size:12px;color:#64748b">Stock</label><input class="me-stock" type="number" min="0" value="${p.stock ?? 0}" /></div>
          <div><label style="font-size:12px;color:#64748b">Catégorie</label><input class="me-cat" value="${escapeHtml(p.category_label || p.category || '')}" /></div>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button type="button" class="btn sm me-save">Sauvegarder</button>
          <button type="button" class="btn sm secondary me-cancel">Annuler</button>
        </div>
        <p class="form-msg me-msg" style="margin-top:6px"></p>
      </div>
    </td>`;
    const srcRow = tbody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
    if (srcRow) srcRow.after(tr);

    tr.querySelector('.me-cancel').onclick = () => tr.remove();
    tr.querySelector('.me-save').onclick = async () => {
      const priceC = Math.round(parseFloat(tr.querySelector('.me-price').value) * 100) || 0;
      const patch = {
        name: tr.querySelector('.me-name').value.trim(),
        price_cents: priceC,
        price_label: priceC > 0 ? `${(priceC / 100).toFixed(2).replace('.', ',')} €` : 'Gratuit',
        stock: parseInt(tr.querySelector('.me-stock').value, 10) || 0,
        category_label: tr.querySelector('.me-cat').value.trim(),
      };
      const msg = tr.querySelector('.me-msg');
      msg.textContent = 'Enregistrement…';
      try {
        const res = await fetch(`/api/admin/materiel/${encodeURIComponent(id)}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `Erreur ${res.status}`);
        const idx = materielProducts.findIndex((x) => x.id === id);
        if (idx >= 0) materielProducts[idx] = { ...materielProducts[idx], ...patch };
        msg.textContent = 'Sauvegardé !';
        msg.className = 'form-msg ok';
        setTimeout(() => tr.remove(), 1000);
        renderMaterielTable();
      } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-msg err';
      }
    };
  }

  // ─── Stats ───
  function fmtEur(cents) {
    return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
  }
  function fmtMonth(k) {
    if (!k || !k.includes('-')) return k;
    const [y, m] = k.split('-');
    return new Date(Number(y), Number(m) - 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }

  let statsLoaded = false;
  function initStats() {
    if (statsLoaded) return;
    // Pre-fill dates: current month
    const now = new Date();
    const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const fromEl = document.getElementById('statsFrom');
    const toEl = document.getElementById('statsTo');
    if (fromEl && !fromEl.value) {
      fromEl.value = ym(now);
    }
    if (toEl && !toEl.value) toEl.value = ym(now);
    loadStats();
  }

  function setStatsMsg(msg, type) {
    const el = document.getElementById('statsMsg');
    if (!el) return;
    el.textContent = msg;
    el.className = `form-msg${type === 'err' ? ' err' : type === 'ok' ? ' ok' : ''}`;
  }

  async function loadStats() {
    setStatsMsg('Chargement des stats…');
    const from = document.getElementById('statsFrom')?.value || '';
    const to = document.getElementById('statsTo')?.value || '';
    const dayEl = document.getElementById('statsDay');
    if (dayEl && !dayEl.value) {
      const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
      dayEl.value = iso;
    }
    const day = dayEl?.value || '';
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (day) params.set('day', day);
      const qs = params.toString();
      const url = `/api/admin/stats${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      // KPI cards
      const kpis = document.getElementById('statsKpis');
      if (kpis) {
        kpis.style.display = '';
        document.getElementById('kpiMaterielRev').textContent = fmtEur(data.totals.materiel_revenue);
        document.getElementById('kpiMaterielOrders').textContent = data.totals.materiel_orders;
        document.getElementById('kpiInscRev').textContent = fmtEur(data.totals.inscription_revenue);
        document.getElementById('kpiInscOrders').textContent = data.totals.inscription_orders;
        const totalRev = document.getElementById('kpiTotalRev');
        if (totalRev) {
          totalRev.textContent = fmtEur(
            data.totals.revenue ??
              (data.totals.materiel_revenue || 0) + (data.totals.inscription_revenue || 0)
          );
        }
        const todayEl = document.getElementById('kpiTodaySales');
        if (todayEl) todayEl.textContent = String(data.today?.count ?? 0);
        const bestEl = document.getElementById('kpiBestDay');
        if (bestEl) {
          const b = data.best_day;
          bestEl.textContent = b
            ? `${b.total} · ${new Date(`${b.day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
            : '—';
        }
        const lookupEl = document.getElementById('kpiLookupDay');
        if (lookupEl) {
          const l = data.lookup_day;
          lookupEl.textContent = l ? String(l.total) : '—';
        }
        const kpiVisits = document.getElementById('kpiVisits');
        if (kpiVisits) kpiVisits.textContent = data.visits?.unique_visitors ?? data.visits?.total ?? '—';
        const kpiConv = document.getElementById('kpiFunnelConv');
        if (kpiConv) kpiConv.textContent = `${data.funnel?.conversion_pct ?? 0} %`;
      }

      const gymWrap = document.getElementById('gymSalesWrap');
      const gymBody = document.getElementById('gymSalesBody');
      if (gymBody) {
        const gyms = data.by_gym || [];
        gymBody.innerHTML = gyms.length
          ? gyms
              .map(
                (g) => `
            <tr>
              <td style="font-weight:600">${escapeHtml(g.label || gymLabel(g.gym))}</td>
              <td style="text-align:right">${g.inscription_orders || 0}</td>
              <td style="text-align:right">${fmtEur(g.inscription_revenue || 0)}</td>
              <td style="text-align:right">${g.materiel_orders || 0}</td>
              <td style="text-align:right">${fmtEur(g.materiel_revenue || 0)}</td>
              <td style="text-align:right;font-weight:700;color:var(--bc-navy)">${fmtEur(g.revenue || 0)}</td>
            </tr>`
              )
              .join('')
          : '<tr><td colspan="6" style="text-align:center;color:var(--bc-muted)">Aucune vente sur cette période</td></tr>';
        if (gymWrap) gymWrap.hidden = false;
        const setTxt = (id, v) => {
          const el = document.getElementById(id);
          if (el) el.textContent = v;
        };
        setTxt('gymTotalInsc', String(data.totals.inscription_orders || 0));
        setTxt('gymTotalInscRev', fmtEur(data.totals.inscription_revenue || 0));
        setTxt('gymTotalMat', String(data.totals.materiel_orders || 0));
        setTxt('gymTotalMatRev', fmtEur(data.totals.materiel_revenue || 0));
        setTxt(
          'gymTotalRev',
          fmtEur(data.totals.revenue ?? (data.totals.materiel_revenue || 0) + (data.totals.inscription_revenue || 0))
        );
      }

      const funnelWrap = document.getElementById('funnelWrap');
      const funnelBody = document.getElementById('funnelBody');
      if (funnelBody && data.funnel?.funnel) {
        funnelBody.innerHTML = data.funnel.funnel
          .map(
            (f) => `
          <tr>
            <td>${escapeHtml(f.step)}. ${escapeHtml(f.label)}</td>
            <td style="text-align:right;font-weight:600">${f.reached}</td>
            <td style="text-align:right">${f.drop_pct_from_prev ? `−${f.drop_pct_from_prev} %` : '—'}</td>
          </tr>`
          )
          .join('');
        const sum = document.getElementById('funnelSummary');
        if (sum) {
          sum.textContent = `${data.funnel.started} dossiers démarrés · ${data.funnel.confirmed} confirmés · ${data.funnel.abandoned} en cours / abandonnés`;
        }
        if (funnelWrap) funnelWrap.hidden = false;
      }

      const visitsWrap = document.getElementById('visitsWrap');
      const visitsBody = document.getElementById('visitsBody');
      if (visitsBody) {
        const pages = data.visits?.top_pages || [];
        visitsBody.innerHTML = pages.length
          ? pages.map((p) => `<tr><td>${escapeHtml(p.path)}</td><td style="text-align:right">${escapeHtml(p.count)}</td></tr>`).join('')
          : '<tr><td colspan="2" style="text-align:center;color:var(--bc-muted)">Pas encore de visites trackées</td></tr>';
        let visitsHint = document.getElementById('visitsSummary');
        if (!visitsHint && visitsWrap) {
          visitsHint = document.createElement('p');
          visitsHint.id = 'visitsSummary';
          visitsHint.className = 'admin-section-desc';
          visitsWrap.appendChild(visitsHint);
        }
        if (visitsHint) {
          const uniques = data.visits?.unique_visitors ?? data.visits?.total ?? 0;
          const views = data.visits?.pageviews ?? 0;
          visitsHint.textContent = `${uniques} visiteur${uniques > 1 ? 's' : ''} unique${uniques > 1 ? 's' : ''} · ${views} page${views > 1 ? 's' : ''} vue${views > 1 ? 's' : ''}`;
        }
        if (visitsWrap) visitsWrap.hidden = false;
      }

      const flux = data.seance_offerte;
      const fluxWrap = document.getElementById('fluxWrap');
      const fluxChart = document.getElementById('fluxChart');
      const fluxSummary = document.getElementById('fluxSummary');
      if (fluxWrap && fluxChart) {
        const daily = flux?.days || [];
        const max = Math.max(1, ...daily.map((d) => d.total || 0));
        fluxChart.innerHTML = daily.length
          ? daily
              .map((d) => {
                const h = Math.max(8, Math.round(((d.total || 0) / max) * 120));
                const flyerH = Math.round(((d.flyer || 0) / max) * 120);
                return `<div class="flux-col" title="${escapeHtml(d.day)} : ${d.total} visites dont ${d.flyer} flyer">
                  <div class="flux-stack">
                    <div class="flux-bar flux-bar--all" style="height:${h}px"></div>
                    <div class="flux-bar flux-bar--flyer" style="height:${flyerH}px"></div>
                  </div>
                  <span class="flux-n">${d.total}</span>
                  <small>${escapeHtml(String(d.day).slice(5))}</small>
                </div>`;
              })
              .join('')
          : '<p class="admin-section-desc">Pas encore de visites séance offerte.</p>';
        if (fluxSummary) {
          fluxSummary.textContent = `${flux?.total || 0} visites · ${flux?.flyer || 0} depuis le flyer QR · ${flux?.other || 0} autres`;
        }
        fluxWrap.hidden = false;
      }

      const dailyWrap = document.getElementById('dailySalesWrap');
      const dailyChart = document.getElementById('dailySalesChart');
      const dailySummary = document.getElementById('dailySalesSummary');
      if (dailyWrap && dailyChart) {
        const daily = data.daily_sales || [];
        const max = Math.max(1, ...daily.map((d) => d.total || 0));
        dailyChart.innerHTML = daily.length
          ? daily
              .map((d) => {
                const h = Math.max(d.total ? 8 : 4, Math.round(((d.total || 0) / max) * 120));
                const label = String(d.day || '').slice(5);
                return `<div class="flux-col" title="${escapeHtml(d.day)} : ${d.total} vente(s) (${d.inscriptions} abo, ${d.materiel} matériel)">
                  <div class="flux-stack">
                    <div class="flux-bar flux-bar--all" style="height:${h}px"></div>
                  </div>
                  <span class="flux-n">${d.total}</span>
                  <small>${escapeHtml(label)}</small>
                </div>`;
              })
              .join('')
          : '<p class="admin-section-desc">Pas encore de ventes quotidiennes.</p>';
        if (dailySummary) {
          const sum = daily.reduce((n, d) => n + (d.total || 0), 0);
          const best = data.best_day;
          const looked = data.lookup_day;
          const lookedTxt = looked
            ? ` · ${new Date(`${looked.day}T12:00:00`).toLocaleDateString('fr-FR')} : ${looked.total} vente(s) (${looked.inscriptions} abo, ${looked.materiel} matériel)`
            : '';
          const bestTxt = best
            ? ` · meilleur jour ${new Date(`${best.day}T12:00:00`).toLocaleDateString('fr-FR')} (${best.total} ventes, ${fmtEur(best.revenue)})`
            : '';
          dailySummary.textContent = `${sum} vente(s) sur 14 jours · aujourd’hui ${data.today?.count || 0} (${fmtEur(data.today?.revenue || 0)})${lookedTxt}${bestTxt}${
            data.missing_deciplus_sale
              ? ` · ${data.missing_deciplus_sale} vente(s) Payplug sans contrat Deciplus (relance auto)`
              : ''
          }`;
        }
        dailyWrap.hidden = false;
      }

      const topWrap = document.getElementById('topSoldWrap');
      const topBody = document.getElementById('topSoldBody');
      if (topBody) {
        const kindLabel = { abonnement: 'Abonnement', aventure: 'Aventure Balma', materiel: 'Matériel' };
        const top = data.top_products || [];
        topBody.innerHTML = top.length
          ? top
              .map(
                (p) => `
            <tr>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(kindLabel[p.kind] || p.kind)}</td>
              <td style="text-align:right;font-weight:600">${p.qty}</td>
              <td style="text-align:right">${fmtEur(p.revenue)}</td>
            </tr>`
              )
              .join('')
          : '<tr><td colspan="4" style="text-align:center;color:var(--bc-muted)">Aucune vente sur cette période</td></tr>';
        if (topWrap) topWrap.hidden = false;
      }

      // Table
      const wrap = document.getElementById('statsTableWrap');
      const body = document.getElementById('statsBody');
      if (body) {
        if (!data.rows.length) {
          body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--bc-muted);padding:24px">Aucune vente sur cette période.</td></tr>';
        } else {
          body.innerHTML = data.rows.map((r) => `
            <tr>
              <td style="font-weight:600">${fmtMonth(r.month)}</td>
              <td style="text-align:right">${r.materiel_orders}</td>
              <td style="text-align:right;font-weight:600">${fmtEur(r.materiel_revenue)}</td>
              <td style="text-align:right">${r.inscription_orders}</td>
              <td style="text-align:right;font-weight:600">${fmtEur(r.inscription_revenue)}</td>
              <td style="text-align:right;font-weight:700;color:var(--bc-navy)">${fmtEur(r.materiel_revenue + r.inscription_revenue)}</td>
            </tr>`).join('');
        }
        if (wrap) wrap.hidden = false;
      }

      const missingWrap = document.getElementById('missingFichesWrap');
      const missingBody = document.getElementById('missingFichesBody');
      const missingSum = document.getElementById('missingFichesSummary');
      const missing = data.missing_fiches || [];
      const reasonLabel = {
        en_cours: 'En cours (2 min)',
        envoye_sans_retour: 'Envoyé, pas d’ID Deciplus',
        bot_error: 'Erreur bot',
        jamais_envoye: 'Pas encore envoyé',
      };
      if (missingBody) {
        missingBody.innerHTML = missing.length
          ? missing
              .map((m) => `
            <tr>
              <td style="font-weight:600">${escapeHtml(m.name || m.order_id)}</td>
              <td>${escapeHtml(gymLabel(m.gym) || m.gym || '—')}</td>
              <td>${m.paid_at ? new Date(m.paid_at).toLocaleString('fr-FR') : '—'}</td>
              <td>${m.signed ? 'Signé' : 'Non signé'}</td>
              <td>${escapeHtml(reasonLabel[m.reason] || m.bot_status || (m.dispatched ? 'envoyé' : 'pas encore'))}</td>
            </tr>`
              )
              .join('')
          : '';
      }
      if (missingSum) {
        missingSum.textContent = missing.length
          ? `${data.missing_fiches_count || missing.length} payée(s) sans fiche. Le bouton relance 6 dossiers à la fois — recliquer jusqu’à ce que la liste descende.`
          : '';
      }
      if (missingWrap) missingWrap.hidden = missing.length === 0;

      const stockWrap = document.getElementById('materielStockWrap');
      const stockBody = document.getElementById('materielStockBody');
      if (stockBody) {
        const stocks = data.stock_rows || [];
        stockBody.innerHTML = stocks.length
          ? stocks
              .map((s) => `
            <tr>
              <td style="font-weight:600">${escapeHtml(s.name)}</td>
              <td style="text-align:right">${s.sold_inscription || 0}</td>
              <td style="text-align:right">${s.sold_boutique || 0}</td>
              <td style="text-align:right;font-weight:600">${s.sold_qty || 0}</td>
              <td style="text-align:right">${s.stock == null ? '—' : s.stock}</td>
              <td style="text-align:right">${fmtEur(s.revenue || 0)}</td>
            </tr>`
              )
              .join('')
          : '<tr><td colspan="6" style="text-align:center;color:var(--bc-muted)">Aucune vente matériel sur cette période</td></tr>';
        if (stockWrap) stockWrap.hidden = false;
      }

      const inscMatWrap = document.getElementById('inscriptionMaterielWrap');
      const inscMatBody = document.getElementById('inscriptionMaterielBody');
      if (inscMatBody) {
        const buyers = data.inscription_materiel || [];
        inscMatBody.innerHTML = buyers.length
          ? buyers
              .map((b) => `
            <tr>
              <td style="font-weight:600">${escapeHtml(b.name)}</td>
              <td>${escapeHtml(b.product)}</td>
              <td>${escapeHtml(b.pickup || gymLabel(b.gym) || '—')}</td>
              <td>${b.paid_at ? new Date(b.paid_at).toLocaleString('fr-FR') : '—'}</td>
              <td style="text-align:right">${fmtEur(b.revenue || 0)}</td>
            </tr>`
              )
              .join('')
          : '<tr><td colspan="5" style="text-align:center;color:var(--bc-muted)">Personne n’a pris de matériel pendant l’inscription sur cette période</td></tr>';
        if (inscMatWrap) inscMatWrap.hidden = false;
      }

      applyStatsKind();
      statsLoaded = true;
      setStatsMsg('');
    } catch (err) {
      setStatsMsg(err.message, 'err');
    }
  }

  document.getElementById('loadStatsBtn')?.addEventListener('click', () => {
    statsLoaded = false;
    loadStats();
  });

  function applyStatsKind() {
    const materielOn = document.querySelector('#statsKindBar .pan-filtre.is-on')?.dataset.statsKind === 'materiel';
    const offresBlocks = ['funnelWrap', 'visitsWrap', 'fluxWrap'];
    const materielBlocks = ['materielStockWrap', 'inscriptionMaterielWrap'];
    offresBlocks.forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.hasAttribute('data-empty-keep')) el.style.display = materielOn ? 'none' : '';
    });
    materielBlocks.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = materielOn ? '' : 'none';
    });
  }

  document.getElementById('statsKindBar')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-stats-kind]');
    if (!btn) return;
    document.querySelectorAll('#statsKindBar .pan-filtre').forEach((b) => b.classList.toggle('is-on', b === btn));
    applyStatsKind();
  });

  document.getElementById('requeueFichesBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('requeueFichesBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Relance…';
    }
    try {
      const res = await fetch('/api/admin/requeue-missing-fiches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setStatsMsg(
        data.count
          ? `${data.count} dossier(s) envoyés au bot${data.remaining ? ` · ${data.remaining} encore à relancer — recliquer` : ''}.`
          : 'Aucune fiche prête à relancer pour le moment (ou déjà en cours).',
        'ok'
      );
      statsLoaded = false;
      loadStats();
    } catch (err) {
      setStatsMsg(err.message || 'Relance impossible', 'err');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Créer les fiches';
      }
    }
  });

  let waTimer = null;
  async function loadWhatsApp(withQr = false) {
    const badge = document.getElementById('waBadge');
    const wrap = document.getElementById('waQrWrap');
    try {
      const res = await fetch(`/api/admin/whatsapp${withQr ? '?qr=1' : ''}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error('unreachable');
      if (badge) {
        badge.textContent = data.connected ? 'Connecté' : data.connecting ? 'Scan en cours' : 'Déconnecté';
      }
      const hint = document.getElementById('waOutboundHint');
      if (hint) {
        if (data.outbound?.promoPaused || data.outbound?.allPaused) {
          const until = data.outbound?.until
            ? new Date(data.outbound.until).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
            : '';
          hint.textContent = until
            ? `Envois promo coupés jusqu’au ${until} — file 10/10. Les relances clients passent par e-mail.`
            : 'Envois promo coupés — file 10/10. Relances clients par e-mail.';
        } else {
          hint.textContent = 'File 10 messages puis pause. Pas d’envoi groupé.';
        }
      }
      if (wrap) {
        if (data.connected) {
          const paused = data.outbound?.promoPaused || data.outbound?.allPaused;
          const rest = data.outbound?.restUntil
            ? ` Pause file jusqu’à ${new Date(data.outbound.restUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`
            : '';
          wrap.innerHTML = paused
            ? '<p class="admin-section-desc">Connecté — <strong>envois promo coupés</strong> (compte restreint). Les notifs managers passent encore, 10 messages puis une pause. Relances clients : e-mail seulement.</p>'
            : `<p class="admin-section-desc">Connecté. Envois par paquets de 10, avec une pause entre chaque page.${escapeHtml(rest)}</p>`;
          if (waTimer) { clearInterval(waTimer); waTimer = null; }
        } else if (data.pairingCode) {
          wrap.innerHTML = `<p class="admin-section-desc">Code à saisir dans WhatsApp</p><p style="font-size:28px;letter-spacing:.18em;font-weight:800;margin:8px 0">${escapeHtml(data.pairingCode)}</p>`;
          if (!waTimer) waTimer = setInterval(() => loadWhatsApp(true), 4000);
        } else if (data.qr) {
          wrap.innerHTML = `<img alt="QR WhatsApp" src="${data.qr}" style="width:min(280px,100%);border-radius:12px;background:#fff;padding:8px" />`;
          if (!waTimer) waTimer = setInterval(() => loadWhatsApp(true), 4000);
        } else {
          const why = data.qrError || data.error || '';
          wrap.innerHTML = `<p class="admin-section-desc">${why ? escapeHtml(why) : 'Clique « Afficher le QR », puis scanne tout de suite (le code expire).'}</p>`;
        }
      }
    } catch {
      if (badge) badge.textContent = 'Déconnecté';
      if (wrap) {
        wrap.innerHTML = '<p class="admin-section-desc">Le QR n’est pas disponible pour le moment. Réessaie dans un instant.</p>';
      }
    }
  }

  document.getElementById('waRefreshBtn')?.addEventListener('click', () => loadWhatsApp(true));
  document.getElementById('waStartBtn')?.addEventListener('click', async () => {
    try {
      await fetch('/api/admin/whatsapp?action=start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'qr', forceQr: true }),
      });
      if (waTimer) clearInterval(waTimer);
      waTimer = setInterval(() => loadWhatsApp(true), 4000);
      await loadWhatsApp(true);
    } catch {
      const wrap = document.getElementById('waQrWrap');
      if (wrap) wrap.innerHTML = '<p class="admin-section-desc">Impossible d’afficher le QR. Réessaie dans un instant.</p>';
    }
  });
  document.getElementById('waPairBtn')?.addEventListener('click', async () => {
    const phone = document.getElementById('waPhone')?.value || '';
    const hint = document.getElementById('waPairHint');
    try {
      const res = await fetch('/api/admin/whatsapp?action=start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'pair', phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Code impossible');
      if (hint) {
        hint.textContent = data.pairingCode
          ? `Saisis ${data.pairingCode} tout de suite dans WhatsApp → Appareils connectés → Lier avec un numéro.`
          : (data.error || data.qrError || 'Code demandé — actualise si rien ne s’affiche.');
      }
      if (waTimer) clearInterval(waTimer);
      waTimer = setInterval(() => loadWhatsApp(true), 4000);
      await loadWhatsApp(true);
    } catch (err) {
      if (hint) hint.textContent = err.message || 'Impossible d’obtenir un code.';
    }
  });
  document.getElementById('waLogoutBtn')?.addEventListener('click', async () => {
    try {
      await fetch('/api/admin/whatsapp?action=logout', { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
    await loadWhatsApp(false);
  });
  document.getElementById('waClearQueueBtn')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/admin/whatsapp?action=clear-queue', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'File non vidée');
      if (typeof window.panToast === 'function') window.panToast('File WhatsApp vidée');
    } catch (err) {
      if (typeof window.panToast === 'function') window.panToast(err.message || 'File non vidée', 'err');
    }
    await loadWhatsApp(false);
  });

  document.getElementById('logoutBtn').onclick = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    location.replace('/admin/login');
  };

  document.getElementById('productEditForm')?.addEventListener('submit', saveProductEditor);
  document.getElementById('pe_close')?.addEventListener('click', closeProductEditor);
  document.getElementById('productEditModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'productEditModal') closeProductEditor();
  });

  document.getElementById('refreshOrdersBtn').onclick = loadOrders;
  document.getElementById('customOfferForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const msg = document.getElementById('customOfferMsg');
    const box = document.getElementById('customOfferResult');
    const btn = form.querySelector('button[type="submit"]');
    if (msg) {
      msg.textContent = '';
      msg.className = 'form-msg';
    }
    if (box) {
      box.hidden = true;
      box.innerHTML = '';
    }
    const fd = new FormData(form);
    const body = {
      price_euros: fd.get('price_euros'),
      mode: fd.get('mode'),
      party_size: fd.get('party_size') || 1,
      label: fd.get('label'),
      gym: fd.get('gym'),
      first_name: fd.get('first_name'),
      last_name: fd.get('last_name'),
      email: fd.get('email'),
      phone: fd.get('phone'),
    };
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/admin/custom-offers', {
        method: 'POST',
        credentials: 'include',
        headers: headers(true),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Impossible de créer l’offre');
      if (box) {
        box.hidden = false;
        box.innerHTML = `
          <p><strong>${escapeHtml(data.product?.display_name || 'Offre personnalisée')}</strong>
            — ${escapeHtml(data.price_label || '')}
            · ${
              data.product?.supports_installment_choice
                ? 'Comptant — 1× ou 4× sans frais'
                : data.mode === 'comptant'
                  ? 'Comptant'
                  : 'Abonnement 4 semaines'
            }
            · ${Number(data.party_size || data.product?.party_size || 1) > 1
              ? `${Number(data.party_size || data.product?.party_size)} personnes`
              : '1 personne'}</p>
          <p class="admin-section-desc">Envoie ce lien. La personne voit l’offre, paie, puis complète le dossier.</p>
          <p><code id="customOfferUrl">${escapeHtml(data.landing_url)}</code></p>
          <button type="button" class="btn sm" id="customOfferCopy">Copier le lien</button>
        `;
        document.getElementById('customOfferCopy')?.addEventListener('click', async () => {
          const ok = await copyText(data.landing_url);
          if (typeof window.panToast === 'function') {
            window.panToast(ok ? 'Lien copié' : 'Copie manuelle', ok ? undefined : 'err');
          }
        });
      }
      if (msg) {
        msg.textContent = `Lien créé (${data.order_id})`;
        msg.className = 'form-msg ok';
      }
      form.reset();
      if (typeof window.panToast === 'function') window.panToast('Lien d’offre personnalisée prêt');
    } catch (err) {
      if (msg) {
        msg.textContent = err.message;
        msg.className = 'form-msg err';
      }
      if (typeof window.panToast === 'function') window.panToast(err.message, 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  document.getElementById('ordersSearch').oninput = renderOrders;
  ensureRefusedFilterOption();
  document.getElementById('ordersFilter').onchange = renderOrders;
  document.getElementById('ordersGymFilter')?.addEventListener('change', renderOrders);
  document.getElementById('ordersDateFrom')?.addEventListener('change', renderOrders);
  document.getElementById('ordersDateTo')?.addEventListener('change', renderOrders);
  document.getElementById('resumeLinkBtn')?.addEventListener('click', () => {
    const id = document.getElementById('resumeRefInput')?.value || '';
    generateResumeLink(id, document.getElementById('resumeLinkBtn'));
  });
  document.getElementById('payLinkBtn')?.addEventListener('click', () => {
    const id = document.getElementById('resumeRefInput')?.value || '';
    generateResumeLink(id, document.getElementById('payLinkBtn'), 'pay');
  });
  document.getElementById('diffusionBtn')?.addEventListener('click', () => sendDiffusion('email'));
  document.getElementById('diffusionSmsBtn')?.addEventListener('click', () => sendDiffusion('sms'));
  document.getElementById('diffusionBothBtn')?.addEventListener('click', () => sendDiffusion('both'));
  document.getElementById('diffusionWaBtn')?.addEventListener('click', () => sendDiffusion('sms'));
  document.getElementById('ordersSelectAll')?.addEventListener('change', (e) => {
    const on = Boolean(e.target.checked);
    document.querySelectorAll('.order-pick:not(:disabled)').forEach((cb) => {
      cb.checked = on;
    });
  });
  document.getElementById('resumeRefInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('resumeLinkBtn')?.click();
    }
  });
  document.getElementById('refreshCoachingsBtn')?.addEventListener('click', loadCoachings);
  document.getElementById('coachingsSearch')?.addEventListener('input', renderCoachings);

  (async function init() {
    try {
      ensureRefusedFilterOption();
      await ensureAuth();
      await loadMerch();
      if (location.hash === '#contracts' || location.pathname.endsWith('/contrats')) {
        showTab('contracts');
      } else if (location.hash === '#materiel') {
        showTab('materiel');
      }
    } catch {
      /* redirect handled */
    }
  })();
})();
