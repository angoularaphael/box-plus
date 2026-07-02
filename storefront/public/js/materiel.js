(async function () {
  const grid = document.getElementById('materielGrid');
  const filtersEl = document.getElementById('materielFilters');

  function L(path) {
    return window.BCPaths?.link(path) || path;
  }

  function A(path) {
    return window.BCPaths?.asset(path) || path.replace(/^\//, '');
  }

  function stockInfo(stock) {
    if (stock > 5) return { cls: 'stock-ok', label: 'En stock' };
    if (stock > 0) return { cls: 'stock-low', label: `Plus que ${stock}` };
    return { cls: 'stock-out', label: 'Rupture' };
  }

  function renderFilters(categories, active) {
    if (!filtersEl) return;
    const items = [{ slug: 'all', label: 'Tout' }, ...categories.filter((c) => c.id !== 16)];
    filtersEl.innerHTML = items
      .map(
        (c) =>
          `<button type="button" class="filter-chip ${active === c.slug ? 'active' : ''}" data-cat="${c.slug}">${c.label}</button>`
      )
      .join('');
    filtersEl.querySelectorAll('.filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat;
        const url = new URL(location.href);
        if (cat === 'all') url.searchParams.delete('category');
        else url.searchParams.set('category', cat);
        history.replaceState(null, '', url);
        load(cat);
      });
    });
  }

  function renderProduct(p) {
    const stock = stockInfo(p.stock);
    const img = p.image
      ? `<img src="${A(p.image)}" alt="" class="materiel-img-photo" loading="lazy" />`
      : `<div class="materiel-img-placeholder">${(p.category_label || p.category || 'Produit').slice(0, 12)}</div>`;
    const disabled = p.stock <= 0 ? 'disabled' : '';
    const variantId = p.default_variant_id || p.combinations?.[0]?.id || '';
    return `
      <article class="materiel-card">
        <a href="${L('/materiel/produit')}?id=${encodeURIComponent(p.id)}" class="materiel-img-link">${img}</a>
        <div class="materiel-body">
          <span class="materiel-cat">${p.category_label || p.category || ''}</span>
          <h4><a href="${L('/materiel/produit')}?id=${encodeURIComponent(p.id)}">${p.name}</a></h4>
          <div class="materiel-price">${p.price_label}</div>
          <div class="${stock.cls}">${stock.label}</div>
          <div class="materiel-actions">
            <button type="button" class="btn sm block add-cart-btn" data-id="${p.id}" data-variant="${variantId}" data-name="${p.name.replace(/"/g, '&quot;')}" data-price="${p.price_cents}" data-label="${p.price_label}" data-image="${p.image || ''}" ${disabled}>Ajouter au panier</button>
          </div>
        </div>
      </article>`;
  }

  async function load(category) {
    const cat = category || new URLSearchParams(location.search).get('category') || 'all';
    grid.innerHTML = '<p style="color:var(--bc-muted);text-align:center">Chargement…</p>';
    try {
      const qs = cat && cat !== 'all' ? `?category=${encodeURIComponent(cat)}&all=1` : '?all=1';
      const res = await fetch(`/api/materiel${qs}`);
      const data = await res.json();
      renderFilters(data.categories || [], cat);
      const products = data.products || [];
      if (!products.length) {
        grid.innerHTML = '<p style="text-align:center;color:var(--bc-muted)">Aucun produit dans cette catégorie.</p>';
        return;
      }
      grid.innerHTML = products.map(renderProduct).join('');
      grid.querySelectorAll('.add-cart-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!window.BCCart) return;
          window.BCCart.add({
            product_id: btn.dataset.id,
            variant_id: btn.dataset.variant || null,
            name: btn.dataset.name,
            price_cents: Number(btn.dataset.price),
            price_label: btn.dataset.label,
            image: btn.dataset.image || null,
            qty: 1,
          });
          btn.textContent = 'Ajouté ✓';
          setTimeout(() => {
            btn.textContent = 'Ajouter au panier';
          }, 1500);
        });
      });
    } catch {
      grid.innerHTML = '<p style="text-align:center;color:var(--bc-muted)">Erreur de chargement.</p>';
    }
  }

  await load();
})();
