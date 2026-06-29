(async function () {
  const root = document.getElementById('productDetail');
  const id = new URLSearchParams(location.search).get('id');

  function L(path) {
    return window.BCPaths?.link(path) || path;
  }

  function A(path) {
    return window.BCPaths?.asset(path) || path.replace(/^\//, '');
  }

  if (!id) {
    root.innerHTML = '<p>Produit introuvable.</p>';
    return;
  }

  try {
    const res = await fetch(`/api/materiel/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('not_found');
    const { product: p } = await res.json();

    const combos = p.combinations?.length ? p.combinations : [{ id: p.id, label: 'Standard', price_cents: p.price_cents, price_label: p.price_label, stock: p.stock }];
    const hasVariants = combos.length > 1 || (combos[0]?.label && combos[0].label !== 'Standard');

    const gallery = (p.images?.length ? p.images : p.image ? [p.image] : [])
      .map((src) => `<img src="${A(src)}" alt="" class="product-gallery-img" />`)
      .join('');

    root.innerHTML = `
      <div class="breadcrumb"><a href="${L('/')}">Accueil</a> / <a href="${L('/materiel')}">Matériel</a> / ${p.name}</div>
      <div class="product-detail-grid">
        <div class="product-gallery">${gallery || '<div class="materiel-img-placeholder">Photo</div>'}</div>
        <div class="product-info card-panel">
          <h1>${p.name}</h1>
          <p class="product-ref">${p.reference ? `Réf. ${p.reference}` : ''}</p>
          <div class="materiel-price" id="productPrice">${p.price_label}</div>
          <p id="productStock" class="stock-ok"></p>
          ${hasVariants ? `<label>Variante<select id="variantSelect">${combos.map((c) => `<option value="${c.id}" data-price="${c.price_cents}" data-label="${c.price_label}" data-stock="${c.stock}">${c.label}</option>`).join('')}</select></label>` : ''}
          <label>Quantité<input type="number" id="qtyInput" min="1" value="1" max="99" /></label>
          <button type="button" class="btn block" id="addBtn">Ajouter au panier</button>
          <a href="${L('/panier')}" class="btn outline block" style="margin-top:8px">Voir le panier</a>
          ${p.description_short ? `<div class="product-desc"><h3>Description</h3><p>${p.description_short}</p></div>` : ''}
        </div>
      </div>`;

    document.title = `${p.name} — Matériel Boxing Center`;

    const variantSelect = document.getElementById('variantSelect');
    const priceEl = document.getElementById('productPrice');
    const stockEl = document.getElementById('productStock');

    function selectedCombo() {
      if (!variantSelect) return combos[0];
      const opt = variantSelect.selectedOptions[0];
      return {
        id: Number(variantSelect.value),
        price_cents: Number(opt.dataset.price),
        price_label: opt.dataset.label,
        stock: Number(opt.dataset.stock),
        label: opt.textContent,
      };
    }

    function updateVariant() {
      const c = selectedCombo();
      priceEl.textContent = c.price_label;
      if (c.stock > 5) {
        stockEl.className = 'stock-ok';
        stockEl.textContent = 'En stock';
      } else if (c.stock > 0) {
        stockEl.className = 'stock-low';
        stockEl.textContent = `Plus que ${c.stock}`;
      } else {
        stockEl.className = 'stock-out';
        stockEl.textContent = 'Rupture de stock';
      }
      document.getElementById('addBtn').disabled = c.stock <= 0;
      document.getElementById('qtyInput').max = Math.max(1, c.stock);
    }

    if (variantSelect) {
      variantSelect.addEventListener('change', updateVariant);
      updateVariant();
    } else {
      updateVariant();
    }

    document.getElementById('addBtn').addEventListener('click', () => {
      const c = selectedCombo();
      const qty = Math.max(1, Number(document.getElementById('qtyInput').value) || 1);
      window.BCCart.add({
        product_id: p.id,
        variant_id: c.id,
        name: p.name,
        variant_label: c.label,
        price_cents: c.price_cents,
        price_label: c.price_label,
        image: p.image,
        qty,
      });
      document.getElementById('addBtn').textContent = 'Ajouté au panier ✓';
    });
  } catch {
    root.innerHTML = `<p>Produit introuvable. <a href="${L('/materiel')}">Retour au catalogue</a></p>`;
  }
})();
