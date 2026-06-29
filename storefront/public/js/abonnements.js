(async function () {
  const grid = document.getElementById('offersGrid');
  const tabs = document.querySelectorAll('.subsection-tab');
  let currentSub = 'prelevement';

  const hash = window.location.hash.replace('#', '');
  if (hash && ['prelevement', 'comptant', 'enfants', 'promo'].includes(hash)) {
    currentSub = hash;
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.sub === hash));
  }

  async function load(sub) {
    grid.innerHTML = '<p style="color:var(--bc-muted)">Chargement…</p>';
    const res = await fetch(`/api/products?tab=abonnements&subsection=${sub}`);
    const data = await res.json();
    BCOffers.renderOfferGrid(data.products || [], grid);
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentSub = tab.dataset.sub;
      window.location.hash = currentSub;
      load(currentSub);
    });
  });

  await load(currentSub);
})();
