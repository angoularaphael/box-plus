(async function () {
  const featuredEl = document.getElementById('featuredOffers');
  const offersSection = document.getElementById('offres');
  const testimonialsEl = document.getElementById('testimonialsGrid');
  const gymsEl = document.getElementById('gymsGrid');

  try {
    const res = await fetch(`${window.BCPaths?.link('/api/products') || '/api/products'}?featured=3`);
    const data = await res.json();
    const products = data.products || [];

    if (!products.length) {
      if (offersSection) offersSection.hidden = true;
    } else {
      if (offersSection) offersSection.hidden = false;
      BCOffers.renderOfferGrid(products, featuredEl, {
        featuredIds: data.featured_home || [],
        animate: true,
      });
    }
  } catch {
    if (featuredEl) {
      featuredEl.innerHTML = '<p style="text-align:center;color:var(--bc-muted)">Chargement des offres…</p>';
    }
  }

  try {
    const tRes = await fetch(`${window.BCPaths?.asset('/data/testimonials.json') || 'data/testimonials.json'}`);
    if (tRes.ok) {
      const items = await tRes.json();
      const initials = (name) =>
        (name || '')
          .split(/[\s.]+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0].toUpperCase())
          .join('');
      testimonialsEl.innerHTML = `<div class="testimonials-grid" data-reveal-group>${items
        .map((t) => {
          const n = Math.max(1, Math.min(5, t.rating || 5));
          return `
        <div class="testimonial-card" data-reveal>
          <div class="testimonial-head">
            <span class="testimonial-avatar" aria-hidden="true">${initials(t.author)}</span>
            <div>
              <div class="testimonial-author">${t.author}</div>
              <div class="testimonial-meta">${t.meta || ''}</div>
            </div>
            <span class="testimonial-rating" aria-label="Note ${n} sur 5">${'★'.repeat(n)}</span>
          </div>
          <p class="testimonial-text">« ${t.text} »</p>
        </div>`;
        })
        .join('')}</div>`;
    }
  } catch {
    /* optional */
  }

  // Real per-salle facts (researched) + official salle pages on boxingcenter.fr
  // (same URLs as the ExerciseGym JSON-LD entities in lib/seo.js).
  const gyms = [
    { name: 'Minimes', desc: 'Le berceau du club (2016) · 3 rings', img: 'img/bc/gym/gym-01.jpg', url: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-minimes/' },
    { name: 'Ramonville', desc: 'Octogone 7 m · 300 m² extérieur', img: 'img/bc/gym/gym-06.jpg', url: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-ramonville/' },
    { name: 'États-Unis', desc: 'Cage MMA · large choix de disciplines', img: 'img/bc/gym/gym-11.jpg', url: 'https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-etats-unis/' },
    { name: 'Saint-Cyprien', desc: '1 200 m² · la plus récente (2025)', img: 'img/bc/gym/gym-16.jpg', url: 'https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-saint-cyprien/' },
    { name: 'Portet', desc: 'Crosstraining & Hyrox', img: 'img/bc/gym/portet-exterior.jpg', url: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-portet-sur-garonne-2/' },
  ];

  if (gymsEl) {
    gymsEl.innerHTML = `<div class="gyms-grid" data-reveal-group>${gyms
      .map(
        (g) => `
      <a class="gym-card" href="${g.url}" target="_blank" rel="noopener" data-reveal>
        <img src="${g.img}" alt="Boxing Center ${g.name}" loading="lazy" />
        <div class="gym-card__body">
          <h4>${g.name}</h4>
          <p>${g.desc}</p>
        </div>
      </a>`
      )
      .join('')}</div>`;
  }

  if (window.BCMotion?.refresh) window.BCMotion.refresh();
})();
