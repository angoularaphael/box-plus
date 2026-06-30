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
    document.getElementById('tabOffers').hidden = name !== 'offers';
    document.getElementById('tabContracts').hidden = name !== 'contracts';
    document.querySelectorAll('.admin-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === name);
    });
    if (name === 'contracts') loadOrders();
    if (location.hash !== `#${name}`) {
      history.replaceState(null, '', `#${name}`);
    }
  }

  document.querySelectorAll('.admin-tab').forEach((btn) => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });

  if (location.hash === '#contracts' || location.pathname.endsWith('/contrats')) {
    showTab('contracts');
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
    featuredHome = [...(data.featured_home || [])];
    renderMerch();
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
        '<tr><td colspan="9" style="text-align:center;color:var(--bc-muted);padding:24px">Aucune inscription trouvée</td></tr>';
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
        const checked = featuredHome.includes(p.id);
        const inputId = `feat-${p.id}`;
        return `
        <div class="admin-featured-card${checked ? ' is-selected' : ''}">
          <input type="checkbox" class="admin-checkbox" id="${escapeHtml(inputId)}" value="${escapeHtml(p.id)}"
            ${checked ? 'checked' : ''} data-feat-id="${escapeHtml(p.id)}" />
          <label class="admin-featured-label" for="${escapeHtml(inputId)}">
            <span class="admin-featured-name">${escapeHtml(p.display_name || p.name)}</span>
            <span class="admin-featured-id">${escapeHtml(p.id)}</span>
          </label>
        </div>`;
      })
      .join('');

    el.querySelectorAll('.admin-checkbox').forEach((cb) => {
      cb.onchange = () => toggleFeatured(cb.dataset.featId, cb.checked, cb);
    });
  }

  function toggleFeatured(id, checked, inputEl) {
    if (checked) {
      if (featuredHome.length >= 3) {
        alert('Maximum 3 offres à la une');
        if (inputEl) inputEl.checked = false;
        return;
      }
      featuredHome.push(id);
    } else {
      featuredHome = featuredHome.filter((x) => x !== id);
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
      cb.onchange = () => patch(cb.dataset.id, { active: cb.checked });
    });
    root.querySelectorAll('.save-row').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const name = root.querySelector(`.edit-name[data-id="${id}"]`).value;
        const sort = Number(root.querySelector(`.edit-sort[data-id="${id}"]`).value);
        patch(id, { display_name: name, sort_order: sort });
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

  async function patch(product_id, patchBody) {
    await fetch('/api/admin/merch', {
      method: 'PUT',
      credentials: 'include',
      headers: headers(),
      body: JSON.stringify({ product_id, patch: patchBody }),
    });
    await loadMerch();
  }

  function renderMerch() {
    renderFeatured();
    renderTable();
  }

  document.getElementById('saveFeatured').onclick = async () => {
    await fetch('/api/admin/merch/featured', {
      method: 'POST',
      credentials: 'include',
      headers: headers(),
      body: JSON.stringify({ ids: featuredHome.slice(0, 3) }),
    });
    alert('Offres à la une enregistrées');
    await loadMerch();
  };

  document.getElementById('syncMaterielBtn').onclick = async () => {
    const msg = document.getElementById('syncMaterielMsg');
    msg.textContent = 'Synchronisation…';
    msg.className = 'form-msg';
    try {
      const res = await fetch('/api/admin/sync-materiel', {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échec sync');
      msg.textContent = `OK — ${data.updated} produits mis à jour (${data.synced_at})`;
      msg.className = 'form-msg ok';
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg err';
    }
  };

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
      }
    } catch {
      /* redirect handled */
    }
  })();
})();
