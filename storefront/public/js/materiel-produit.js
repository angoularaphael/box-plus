(async function () {
  const root = document.getElementById('productDetail');
  // Id resolution: server-injected (slug URLs) > /materiel/produit/<slug> path > legacy ?id=
  const pathMatch = location.pathname.match(/\/materiel\/produit\/([^/?#]+)/);
  const id = window.__PRODUCT_ID__
    || (pathMatch ? decodeURIComponent(pathMatch[1]) : null)
    || new URLSearchParams(location.search).get('id');

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

    const combos = p.combinations?.length ? p.combinations : [{ id: p.id, label: 'Standard', price_cents: p.price_cents, price_label: p.price_label, stock: p.stock, image: p.image, images: p.images }];
    const hasVariants = combos.length > 1 || (combos[0]?.label && combos[0].label !== 'Standard');

    function galleryFor(combo) {
      if (combo?.images?.length) return combo.images.filter(Boolean);
      if (combo?.image) {
        const rest = (p.images || []).filter((src) => src !== combo.image);
        return [combo.image, ...rest];
      }
      return (p.images?.length ? p.images : p.image ? [p.image] : []).filter(Boolean);
    }

    function renderGallery(sources) {
      if (!sources.length) return '<div class="materiel-img-placeholder">Photo</div>';
      const main = sources[0];
      const thumbs = sources.length > 1
        ? `<div class="product-gallery-thumbs">${sources.map((src, i) =>
            `<button type="button" class="product-gallery-thumb${i === 0 ? ' is-active' : ''}" data-src="${A(src)}" aria-label="Photo ${i + 1}">
              <img src="${A(src)}" alt="" />
            </button>`
          ).join('')}</div>`
        : '';
      return `<div class="product-gallery-main"><img src="${A(main)}" alt="" class="product-gallery-img" id="productMainImg" /></div>${thumbs}`;
    }

    const initialCombo = combos.find((c) => String(c.id) === String(p.default_variant_id)) || combos[0];

    const pickupDelay = p.pickup_same_day
      ? 'Possibilité de retrait dès le jour même.'
      : 'Retrait sous 48h après commande.';
    const pickupNote = p.pickup_note || 'Choisissez votre salle de retrait au panier — retrait en club uniquement.';

    root.innerHTML = `
      <div class="breadcrumb"><a href="${L('/')}">Accueil</a> / <a href="${L('/materiel')}">Matériel</a> / ${p.name}</div>
      <div class="product-detail-grid">
        <div class="product-gallery" id="productGallery">${renderGallery(galleryFor(initialCombo))}</div>
        <div class="product-info">
          <span class="materiel-cat">${p.category_label || p.category || ''}</span>
          <h1>${p.name}</h1>
          <p class="product-ref">${p.reference ? `Réf. ${p.reference}` : ''}</p>
          <div class="materiel-price" id="productPrice">${p.price_label}${p.price_was_label ? ` <s class="materiel-price-was">${p.price_was_label}</s>` : ''}</div>
          <p id="productStock" class="stock-ok"></p>
          ${hasVariants ? `<label>Variante<select id="variantSelect">${combos.map((c) => `<option value="${c.id}" data-price="${c.price_cents}" data-label="${c.price_label}" data-stock="${c.stock}" data-image="${c.image || p.image || ''}" ${String(c.id) === String(p.default_variant_id) ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>` : ''}
          <p class="product-pickup"><strong>Retrait :</strong> ${pickupDelay} ${pickupNote}</p>
          <label>Quantité<input type="number" id="qtyInput" min="1" value="1" max="99" /></label>
          <button type="button" class="btn block" id="addBtn">Ajouter au panier</button>
          <a href="${L('/panier')}" class="btn secondary block" style="margin-top:8px">Voir le panier</a>
          ${p.description_short ? `<div class="product-desc"><h3>Description</h3><p>${p.description_short}</p></div>` : ''}
        </div>
      </div>`;

    document.title = `${p.name} — Matériel Boxing Center`;

    const variantSelect = document.getElementById('variantSelect');
    const priceEl = document.getElementById('productPrice');
    const stockEl = document.getElementById('productStock');
    const galleryEl = document.getElementById('productGallery');

    function selectedCombo() {
      if (!variantSelect) return combos[0];
      return combos.find((c) => String(c.id) === String(variantSelect.value)) || combos[0];
    }

    function bindThumbs() {
      galleryEl?.querySelectorAll('.product-gallery-thumb').forEach((btn) => {
        btn.addEventListener('click', () => {
          const main = document.getElementById('productMainImg');
          if (main && btn.dataset.src) main.src = btn.dataset.src;
          galleryEl.querySelectorAll('.product-gallery-thumb').forEach((b) => b.classList.toggle('is-active', b === btn));
        });
      });
    }

    function updateVariant() {
      const c = selectedCombo();
      if (p.price_was_label) {
        priceEl.innerHTML = `${c.price_label} <s class="materiel-price-was">${p.price_was_label}</s>`;
      } else {
        priceEl.textContent = c.price_label;
      }
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
      if (galleryEl) {
        galleryEl.innerHTML = renderGallery(galleryFor(c));
        bindThumbs();
      }
    }

    bindThumbs();
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
        image: c.image || p.image,
        qty,
      });
      document.getElementById('addBtn').textContent = 'Ajouté au panier ✓';
    });
  } catch {
    root.innerHTML = `<p>Produit introuvable. <a href="${L('/materiel')}">Retour au catalogue</a></p>`;
  }
})();
