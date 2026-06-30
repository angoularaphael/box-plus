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
    el.innerHTML = products
      .map(
        (p) => `
      <label style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:14px">
        <input type="checkbox" value="${p.id}" ${featuredHome.includes(p.id) ? 'checked' : ''}
          onchange="window._toggleFeatured('${p.id}', this.checked)" />
        ${p.display_name || p.name} (${p.id})
      </label>`
      )
      .join('');
  }

  window._toggleFeatured = (id, checked) => {
    if (checked) {
      if (featuredHome.length >= 3) {
        alert('Maximum 3 offres à la une');
        loadMerch();
        return;
      }
      featuredHome.push(id);
    } else {
      featuredHome = featuredHome.filter((x) => x !== id);
    }
  };

  function renderTable() {
    const tbody = document.getElementById('productsBody');
    tbody.innerHTML = products
      .map(
        (p) => `
      <tr>
        <td><label class="toggle-switch"><input type="checkbox" ${p.active !== false ? 'checked' : ''} data-id="${p.id}" class="toggle-active" /><span class="toggle-slider"></span></label></td>
        <td><code>${p.id}</code></td>
        <td><input value="${p.display_name || p.name}" data-id="${p.id}" class="edit-name" style="padding:6px;font-size:13px" /></td>
        <td>${p.tab || '—'}</td>
        <td><input type="number" value="${p.sort_order ?? 99}" data-id="${p.id}" class="edit-sort" style="width:60px;padding:6px" /></td>
        <td><button type="button" class="btn sm save-row" data-id="${p.id}">Sauver</button></td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('.toggle-active').forEach((cb) => {
      cb.onchange = () => patch(cb.dataset.id, { active: cb.checked });
    });
    tbody.querySelectorAll('.save-row').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const name = tbody.querySelector(`.edit-name[data-id="${id}"]`).value;
        const sort = Number(tbody.querySelector(`.edit-sort[data-id="${id}"]`).value);
        patch(id, { display_name: name, sort_order: sort });
      };
    });
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
