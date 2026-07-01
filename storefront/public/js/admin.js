(function () {
  const adminPanel = document.getElementById('adminPanel');
  let products = [];
  let featuredHome = [];
  let orders = [];
  let currentUser = null;

  const STEP_LABELS = {
    1: 'Offre',
    2: 'Identité',
    3: 'Paiement',
    4: 'Dossier',
    5: 'Signature',
    6: 'Confirmé',
  };

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

  function showTab(name) {
    ['tabOffers','tabMateriel','tabContracts','tabStats'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = id !== `tab${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    });
    document.querySelectorAll('.admin-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === name);
    });
    if (name === 'contracts') loadOrders();
    if (name === 'materiel') loadMateriel();
    if (name === 'stats') initStats();
    if (location.hash !== `#${name}`) {
      history.replaceState(null, '', `/admin/#${name}`);
    }
  }

  document.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  if (location.hash === '#contracts' || location.pathname.endsWith('/contrats')) {
    showTab('contracts');
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
    return [...new Set(ids.map((id) => canonical.get(id) || id).filter(Boolean))].slice(0, 3);
  }

  function isFeaturedProduct(p) {
    return featuredHome.includes(p.id) || (p.legacy_id && featuredHome.includes(p.legacy_id));
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

  function filteredOrders() {
    const q = (document.getElementById('ordersSearch')?.value || '').toLowerCase().trim();
    const filter = document.getElementById('ordersFilter')?.value || 'all';
    return orders.filter((o) => {
      if (filter === 'signed' && !o.signed) return false;
      if (filter === 'progress' && o.signed) return false;
      if (!q) return true;
      const hay = `${o.order_id} ${o.name} ${o.email} ${o.product}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderOrders() {
    const tbody = document.getElementById('ordersBody');
    const list = filteredOrders();
    document.getElementById('ordersCount').textContent =
      list.length === orders.length
        ? `${orders.length} inscription(s)`
        : `${list.length} sur ${orders.length} inscription(s)`;

    if (!list.length) {
      tbody.innerHTML =
        '<tr><td colspan="10" style="text-align:center;color:var(--bc-muted);padding:24px">Aucune inscription trouvée</td></tr>';
      return;
    }

    tbody.innerHTML = list
      .map(
        (o) => `
      <tr>
        <td><code style="font-size:11px">${o.order_id}</code></td>
        <td>${o.name}</td>
        <td><a href="mailto:${o.email}" style="color:var(--bc-cta)">${o.email}</a></td>
        <td>${o.product}</td>
        <td>${STEP_LABELS[o.step] || o.step}</td>
        <td><span class="badge ${o.payment_status === 'paid' ? 'ok' : 'pending'}">${o.payment_status === 'paid' ? 'Payé' : 'En attente'}</span></td>
        <td>${o.signed ? `✓ ${formatDate(o.signed_at)}` : '—'}</td>
        <td style="font-size:12px">${formatDate(o.updated_at || o.created_at)}</td>
        <td>
          <button type="button" class="btn sm dl-contract" data-id="${o.order_id}">PDF</button>
        </td>
        <td>
          <button type="button" class="btn sm secondary del-order" data-id="${o.order_id}" title="Supprimer">✕</button>
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

    tbody.querySelectorAll('.del-order').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
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
          msg.textContent = `Inscription ${id} supprimée.`;
          msg.className = 'form-msg ok';
        } catch (err) {
          msg.textContent = err.message;
          msg.className = 'form-msg err';
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
    if (countEl) countEl.textContent = `${featuredHome.length} / 3`;

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
      if (featuredHome.length >= 3) {
        alert('Maximum 3 offres à la une');
        if (inputEl) inputEl.checked = false;
        return;
      }
      if (!featuredHome.includes(pid)) featuredHome.push(pid);
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
        <td><button type="button" class="btn sm save-row" data-id="${escapeHtml(p.id)}">Sauver</button></td>
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
      const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      fromEl.value = ym(start);
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
    try {
      const url = `/api/admin/stats${from || to ? `?from=${from}&to=${to}` : ''}`;
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

  document.getElementById('logoutBtn').onclick = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    location.replace('/admin/login');
  };

  document.getElementById('refreshOrdersBtn').onclick = loadOrders;
  document.getElementById('ordersSearch').oninput = renderOrders;
  document.getElementById('ordersFilter').onchange = renderOrders;

  (async function init() {
    try {
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
