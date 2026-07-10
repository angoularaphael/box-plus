/**
 * Rendu cartes offres partagé
 */
(function () {
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function formatPaymentMode(product) {
    if (!product.requires_payment) return 'Gratuit';
    if (product.supports_billing_choice) return 'RIB ou carte — toutes les 4 semaines';
    if (/comptant/i.test(product.name || '')) return 'Paiement comptant CB';
    if (product.requires_iban) return '1ère échéance CB · suite par prélèvement';
    return 'Paiement CB';
  }

  function formatDuration(product) {
    const n = product.name || '';
    if (/12\s*mois/i.test(n)) return '12 mois';
    if (/6\s*mois/i.test(n)) return '6 mois';
    if (/3\s*mois/i.test(n)) return '3 mois';
    if (/4\s*semaines/i.test(n)) return '4 semaines (renouvelable)';
    if (product.tab === 'seance-essai') return '1 séance';
    if (product.tab === 'coachings') return 'Selon pack';
    return product.duration_label || '—';
  }

  function isFeaturedOffer(product, opts = {}) {
    if (product.featured_home) return true;
    const ids = opts.featuredIds || [];
    return ids.includes(product.id) || (product.legacy_id && ids.includes(product.legacy_id));
  }

  function renderOfferCard(product, opts = {}) {
    const featured = isFeaturedOffer(product, opts);
    const displayName = product.display_name || product.name;
    const price = product.marketing_price_label || product.stripe_price_label || product.price_label || '—';
    const benefits = product.benefits || [];
    const defaultBenefits = product.tab === 'abonnements'
      ? ['Accès aux 5 salles', 'Toutes les disciplines', 'Encadrement coach']
      : [];

    const list = benefits.length ? benefits : defaultBenefits;
    const reveal = opts.animate ? ' data-reveal' : '';

    return `
      <article class="offer-card ${featured ? 'featured' : ''}" data-id="${esc(product.id)}"${reveal}>
        ${featured ? '<span class="offer-badge">Populaire</span>' : ''}
        ${product.badge ? `<span class="offer-tag">${esc(product.badge)}</span>` : ''}
        <h3>${esc(displayName)}</h3>
        <div class="offer-price">${esc(price)}</div>
        ${product.price_subtitle ? `<div class="offer-price-sub">${esc(product.price_subtitle)}</div>` : ''}
        ${product.installments_note ? `<div class="offer-price-sub">${esc(product.installments_note)}</div>` : ''}
        <ul class="offer-benefits">
          ${list.map((b) => `<li>${esc(b)}</li>`).join('')}
        </ul>
        <div class="offer-meta">
          <div><strong>Durée :</strong> ${esc(formatDuration(product))}</div>
          <div><strong>Paiement :</strong> ${esc(formatPaymentMode(product))}</div>
          ${product.audience ? `<div><strong>Public :</strong> ${esc(product.audience)}</div>` : ''}
        </div>
        <a href="${(window.BCPaths?.link('/inscription') || '/inscription')}?product=${encodeURIComponent(product.id)}" class="btn block ${featured ? '' : 'secondary'}">
          ${opts.cta || 'Je choisis cette formule'}
        </a>
      </article>`;
  }

  function renderOfferGrid(products, container, opts = {}) {
    if (!container) return;
    if (!products.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `<div class="products-grid" data-reveal-group>${products.map((p) => renderOfferCard(p, opts)).join('')}</div>`;
    if (opts.animate && window.BCMotion?.refresh) window.BCMotion.refresh();
  }

  window.BCOffers = { renderOfferCard, renderOfferGrid, esc, isFeaturedOffer };
})();
