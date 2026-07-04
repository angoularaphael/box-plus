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

  const gyms = [
    { name: 'Minimes', desc: 'Cours collectifs · accueil débutants', img: 'img/bc/gym/gym-01.jpg' },
    { name: 'Ramonville', desc: 'Ambiance conviviale · tous niveaux', img: 'img/bc/gym/gym-06.jpg' },
    { name: 'États-Unis', desc: 'Large choix de disciplines', img: 'img/bc/gym/gym-11.jpg' },
    { name: 'Saint-Cyprien', desc: 'Centre historique du club', img: 'img/bc/gym/gym-16.jpg' },
    { name: 'Portet', desc: 'Crosstraining & Hyrox', img: 'img/bc/gym/portet-exterior.jpg' },
  ];

  if (gymsEl) {
    const gymHref = window.BCPaths?.link('/abonnements') || '/abonnements';
    gymsEl.innerHTML = `<div class="gyms-grid" data-reveal-group>${gyms
      .map(
        (g) => `
      <a class="gym-card" href="${gymHref}" data-reveal>
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
