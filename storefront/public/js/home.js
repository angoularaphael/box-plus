(async function () {
  const featuredEl = document.getElementById('featuredOffers');
  const testimonialsEl = document.getElementById('testimonialsGrid');
  const gymsEl = document.getElementById('gymsGrid');

  try {
    const res = await fetch(`${window.BCPaths?.link('/api/products') || '/api/products'}?featured=3`);
    const data = await res.json();
    BCOffers.renderOfferGrid(data.products || [], featuredEl, { featured: true });
  } catch {
    if (featuredEl) featuredEl.innerHTML = '<p style="text-align:center;color:var(--bc-muted)">Chargement des offres…</p>';
  }

  try {
    const tRes = await fetch(`${window.BCPaths?.asset('/data/testimonials.json') || 'data/testimonials.json'}`);
    if (tRes.ok) {
      const items = await tRes.json();
      testimonialsEl.innerHTML = items
        .map(
          (t) => `
        <div class="testimonial-card">
          <div class="testimonial-rating">Recommandé</div>
          <p class="testimonial-text">« ${t.text} »</p>
          <div class="testimonial-author">${t.author}</div>
          <div class="testimonial-meta">${t.meta || ''}</div>
        </div>`
        )
        .join('');
    }
  } catch {
    /* optional */
  }

  const gyms = [
    { name: 'Minimes', desc: 'Cours collectifs, accueil débutants' },
    { name: 'Ramonville', desc: 'Ambiance conviviale, tous niveaux' },
    { name: 'États-Unis', desc: 'Large choix de disciplines' },
    { name: 'Saint-Cyprien', desc: 'Centre historique du club' },
    { name: 'Portet', desc: 'Encadrement personnalisé' },
  ];

  if (gymsEl) {
    gymsEl.innerHTML = gyms
      .map(
        (g) => `
      <div class="gym-card">
        <h4>${g.name}</h4>
        <p>${g.desc}</p>
      </div>`
      )
      .join('');
  }
})();
