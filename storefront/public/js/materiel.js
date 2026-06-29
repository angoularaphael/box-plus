(async function () {
  const grid = document.getElementById('materielGrid');
  try {
    const res = await fetch('/api/materiel');
    const data = await res.json();
    const products = data.products || [];
    if (!products.length) {
      grid.innerHTML = '<p style="text-align:center;color:var(--bc-muted)">Catalogue matériel bientôt disponible.</p>';
      return;
    }
    grid.innerHTML = products
      .map((p) => {
        const stockClass = p.stock > 5 ? 'stock-ok' : p.stock > 0 ? 'stock-low' : 'stock-out';
        const stockLabel = p.stock > 5 ? 'En stock' : p.stock > 0 ? `Plus que ${p.stock}` : 'Rupture';
        return `
        <div class="materiel-card">
          <div class="materiel-img">${p.category || 'Produit'}</div>
          <div class="materiel-body">
            <h4>${p.name}</h4>
            <div class="materiel-price">${p.price_label}</div>
            <div class="${stockClass}">${stockLabel}</div>
            <a href="${(window.BCPaths?.link('/inscription') || '/inscription')}?product=${encodeURIComponent(p.id)}" class="btn sm block" style="margin-top:12px">Commander</a>
          </div>
        </div>`;
      })
      .join('');
  } catch {
    grid.innerHTML = '<p style="text-align:center;color:var(--bc-muted)">Erreur de chargement.</p>';
  }
})();
