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
    { name: 'Les Minimes', desc: 'Cours collectifs, accueil débutants', img: 'https://images.unsplash.com/photo-1549719386-74dfcbf7dbed?w=600&h=360&fit=crop' },
    { name: 'Ramonville', desc: 'Ambiance conviviale, tous niveaux', img: 'https://images.unsplash.com/photo-1517438322307-e67111335449?w=600&h=360&fit=crop' },
    { name: 'États-Unis', desc: 'Large choix de disciplines', img: 'https://images.unsplash.com/photo-1517438476312-10d79c077509?w=600&h=360&fit=crop' },
    { name: 'Saint-Cyprien', desc: 'Centre historique du club', img: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=600&h=360&fit=crop' },
    { name: 'Portet', desc: 'Encadrement personnalisé', img: 'https://images.unsplash.com/photo-1495555687398-3f50d6e79e1e?w=600&h=360&fit=crop' },
  ];

  if (gymsEl) {
    gymsEl.innerHTML = gyms
      .map(
        (g) => `
      <div class="gym-card animate-in">
        <img class="gym-card-img" src="${g.img}" alt="Salle ${g.name}" loading="lazy" />
        <div class="gym-card-body">
          <h4>${g.name}</h4>
          <p>${g.desc}</p>
        </div>
      </div>`
      )
      .join('');
  }
})();
