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
    if (
      product.supports_installment_choice ||
      product.id === 'offre-saison' ||
      /1\s*[x×]\s*ou\s*4\s*[x×]/i.test(product.badge || '')
    ) {
      return 'En une fois ou en 4× sans frais';
    }
    if (/comptant/i.test(product.name || '') || product.subsection === 'comptant') {
      return 'Paiement unique — pas de prélèvement';
    }
    if (product.supports_billing_choice) {
      return 'Sans engagement — carte ou prélèvement';
    }
    if (/4\s*[x×]\s*sans\s*frais/i.test(product.badge || '') || /sans\s*frais/i.test(product.badge || '')) {
      return 'Paiement en 4× sans frais';
    }
    if (product.id === 'offre-duo' || /offre\s*a\s*29/i.test(product.name || '')) {
      return '29 € / 4 semaines';
    }
    if (product.requires_iban) return '1ʳᵉ échéance par carte · puis prélèvement';
    return 'Paiement sécurisé par carte';
  }

  function formatDuration(product) {
    const n = product.name || '';
    if (/12\s*mois/i.test(n)) return '12 mois';
    if (/6\s*mois/i.test(n)) return '6 mois';
    if (/3\s*mois/i.test(n)) return '3 mois';
    if (/4\s*semaines/i.test(n)) return '4 semaines (renouvelable)';
    if (/baby\s*boxe/i.test(n)) return 'Saison';
    if (/boxe\s*educative|éducative/i.test(n)) return 'Saison';
    if (/association/i.test(n)) return 'Saison associative';
    if (product.tab === 'seance-essai') return '1 séance';
    if (product.tab === 'coachings') return 'Selon pack';
    if (product.subsection === 'enfants') return 'Saison';
    return product.duration_label || 'Selon formule';
  }

  function offerDescription(product) {
    if (product.description) return product.description;
    const n = String(product.name || '');
    if (/comptant/i.test(n) || product.subsection === 'comptant') {
      const dur = formatDuration(product);
      return `Réglez une seule fois et entraînez-vous pendant ${dur} : accès illimité aux salles et à toutes les disciplines, sans aucun prélèvement mensuel.`;
    }
    if (product.id === 'offre-duo' || /offre\s*a\s*29/i.test(n)) {
      return '29 € par personne toutes les 4 semaines. Accès illimité aux 5 salles et à toutes les disciplines.';
    }
    if (/4\s*semaines/i.test(n) || product.requires_iban) {
      return 'Formule flexible : 1ʳᵉ échéance par carte, puis renouvellement toutes les 4 semaines. Accès illimité aux salles et disciplines.';
    }
    if (/baby\s*boxe/i.test(n)) {
      return 'Éveil sportif et boxe ludique pour les tout-petits, encadrés par des coachs spécialisés, sur toute la saison.';
    }
    if (/educative|éducative/i.test(n)) {
      return 'Boxe éducative pour enfants et ados : technique, respect et confiance en soi, tout au long de la saison.';
    }
    return '';
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
        ${offerDescription(product) ? `<p class="offer-desc">${esc(offerDescription(product))}</p>` : ''}
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

  window.BCOffers = {
    renderOfferCard,
    renderOfferGrid,
    esc,
    isFeaturedOffer,
    offerDescription,
    formatPaymentMode,
    formatDuration,
  };
})();
