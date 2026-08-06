(async function () {
  const grid = document.getElementById('offersGrid');
  const tabs = document.querySelectorAll('.subsection-tab');
  let currentSub = 'prelevement';
  let loadSeq = 0;

  const hash = window.location.hash.replace('#', '');
  if (hash && ['prelevement', 'comptant', 'enfants', 'promo'].includes(hash)) {
    currentSub = hash;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.sub === hash));
  }

  async function load(sub) {
    const seq = ++loadSeq;
    grid.innerHTML = '<p style="color:var(--bc-muted)">Chargement…</p>';
    try {
      const res = await fetch(`/api/products?tab=abonnements&subsection=${encodeURIComponent(sub)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== loadSeq) return;
      const products = data.products || [];
      if (!products.length) {
        grid.innerHTML =
          '<p style="color:var(--bc-muted)">Aucune offre dans cette catégorie pour le moment.</p>';
        return;
      }
      BCOffers.renderOfferGrid(products, grid, { animate: true });
    } catch (err) {
      if (seq !== loadSeq) return;
      grid.innerHTML = `<p style="color:#c62828">Impossible de charger les offres. <button type="button" class="btn sm secondary" id="retryOffers">Réessayer</button></p>`;
      const btn = document.getElementById('retryOffers');
      if (btn) btn.onclick = () => load(currentSub);
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentSub = tab.dataset.sub;
      if (window.location.hash.replace('#', '') !== currentSub) {
        window.location.hash = currentSub;
      }
      load(currentSub);
    });
  });

  window.addEventListener('hashchange', () => {
    const next = window.location.hash.replace('#', '');
    if (!['prelevement', 'comptant', 'enfants', 'promo'].includes(next)) return;
    if (next === currentSub) return;
    currentSub = next;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.sub === next));
    load(currentSub);
  });

  await load(currentSub);
})();
