(function () {
  let secret = sessionStorage.getItem('bc_admin_secret') || '';
  const loginPanel = document.getElementById('loginPanel');
  const adminPanel = document.getElementById('adminPanel');
  let products = [];
  let featuredHome = [];

  function headers() {
    return { 'Content-Type': 'application/json', 'x-admin-secret': secret };
  }

  async function loadMerch() {
    const res = await fetch('/api/admin/merch', { headers: { 'x-admin-secret': secret } });
    if (!res.ok) throw new Error('unauthorized');
    const data = await res.json();
    products = data.products || [];
    featuredHome = [...(data.featured_home || [])];
    render();
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

  async function patch(product_id, patch) {
    await fetch('/api/admin/merch', {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ product_id, patch }),
    });
    await loadMerch();
  }

  function render() {
    renderFeatured();
    renderTable();
  }

  document.getElementById('loginBtn').onclick = async () => {
    secret = document.getElementById('adminSecret').value;
    try {
      await loadMerch();
      sessionStorage.setItem('bc_admin_secret', secret);
      loginPanel.hidden = true;
      adminPanel.hidden = false;
    } catch {
      document.getElementById('loginMsg').textContent = 'Accès refusé';
      document.getElementById('loginMsg').className = 'form-msg err';
    }
  };

  document.getElementById('saveFeatured').onclick = async () => {
    await fetch('/api/admin/merch/featured', {
      method: 'POST',
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
      const res = await fetch('/api/admin/sync-materiel', { method: 'POST', headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échec sync');
      msg.textContent = `OK — ${data.updated} produits mis à jour (${data.synced_at})`;
      msg.className = 'form-msg ok';
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg err';
    }
  };

  if (secret) {
    loadMerch()
      .then(() => {
        loginPanel.hidden = true;
        adminPanel.hidden = false;
      })
      .catch(() => {});
  }
})();
