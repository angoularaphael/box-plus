/**
 * Rendu cartes offres partagé
 */
(function () {
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function hasInstallmentChoice(product) {
    const id = String(product.id || '');
    const legacy = String(product.legacy_id || '');
    const title = String(product.name || product.display_name || '');
    return (
      product.supports_installment_choice === true ||
      id === 'offre-saison' ||
      legacy === 'offre-saison' ||
      id === 'baby-boxe' ||
      legacy === 'baby-boxe' ||
      id === 'dp-93' ||
      id === 'boxe-educative' ||
      legacy === 'boxe-educative' ||
      id === 'dp-45' ||
      /BABY\s*BOXE/i.test(title) ||
      /BOXE\s*EDUCATIVE/i.test(title) ||
      /1\s*[x×]\s*ou\s*4\s*[x×]/i.test(String(product.badge || ''))
    );
  }

  function formatPaymentMode(product) {
    if (!product.requires_payment) return 'Gratuit';
    if (hasInstallmentChoice(product)) {
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
      return '29,99 € toutes les 4 semaines — 1ʳᵉ échéance CB puis prélèvement';
    }
    if (product.requires_iban) return '1ʳᵉ échéance par carte · prélèvement sans engagement';
    return 'Paiement sécurisé par carte';
  }

  function formatDuration(product) {
    const n = product.name || '';
    if (product.id === 'offre-duo' || /offre\s*a\s*29/i.test(n)) return 'Sans engagement';
    if (product.duration_label) return product.duration_label;
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
    return 'Selon formule';
  }

  function offerDescription(product) {
    if (product.description) return product.description;
    const n = String(product.name || '');
    if (/baby\s*boxe/i.test(n)) {
      return 'Éveil sportif et boxe ludique pour les tout-petits, encadrés par des coachs spécialisés, sur toute la saison. Paiement comptant en 1× ou 4× sans frais.';
    }
    if (/educative|éducative/i.test(n)) {
      return 'Boxe éducative pour enfants et ados : technique, respect et confiance en soi, tout au long de la saison. Paiement comptant en 1× ou 4× sans frais.';
    }
    if (hasInstallmentChoice(product) || /comptant/i.test(n) || product.subsection === 'comptant') {
      const dur = formatDuration(product);
      if (hasInstallmentChoice(product)) {
        return `Réglez en une fois ou en 4× sans frais pour ${dur} : accès illimité, sans prélèvement mensuel.`;
      }
      return `Réglez une seule fois et entraînez-vous pendant ${dur} : accès illimité aux salles et à toutes les disciplines, sans aucun prélèvement mensuel.`;
    }
    if (product.id === 'offre-duo' || /offre\s*a\s*29/i.test(n)) {
      return '29,99 € toutes les 4 semaines, sans engagement et sans préavis en cas de résiliation. Accès aux 5 salles et à toutes les disciplines.';
    }
    if (/4\s*semaines/i.test(n) || product.requires_iban) {
      return 'Formule flexible : 1ʳᵉ échéance par carte, puis prélèvement sans engagement toutes les 4 semaines. Accès illimité aux salles et disciplines.';
    }
    return '';
  }

  function isFeaturedOffer(product, opts = {}) {
    if (product.featured_home) return true;
    const ids = opts.featuredIds || [];
    return ids.includes(product.id) || (product.legacy_id && ids.includes(product.legacy_id));
  }

  function formatFrDate(d) {
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function fourXSchedulePreview(product) {
    if (!hasInstallmentChoice(product) || !product.requires_payment) return '';
    const total = Number(product.price_cents || 0) / 100;
    if (!(total > 0)) return '';
    const quart = (total / 4).toFixed(2).replace('.', ',');
    const today = new Date();
    const dates = [0, 30, 60, 90].map((days) => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return formatFrDate(d);
    });
    return `
      <div class="fourx-schedule fourx-schedule--card">
        <p class="fourx-schedule__title">Calendrier indicatif 4× sans frais</p>
        <ul>
          <li><strong>Aujourd’hui</strong> — ${quart}&nbsp;€</li>
          <li><strong>${dates[1]}</strong> — ${quart}&nbsp;€</li>
          <li><strong>${dates[2]}</strong> — ${quart}&nbsp;€</li>
          <li><strong>${dates[3]}</strong> — ${quart}&nbsp;€</li>
        </ul>
      </div>`;
  }

  function renderOfferCard(product, opts = {}) {
    const featured = isFeaturedOffer(product, opts);
    const displayName = product.display_name || product.name;
    const price = product.marketing_price_label || product.stripe_price_label || product.price_label || '—';
    const priceWas = product.price_was_label || '';
    const benefits = product.benefits || [];
    const defaultBenefits = product.tab === 'abonnements'
      ? [
          'Accès aux 5 salles',
          'Cours illimités + accès libre',
          'Encadrement coach professionnel',
          'Accès libre inclus de 10h à 21h30',
        ]
      : [];

    const list = benefits.length ? benefits : defaultBenefits;
    const reveal = opts.animate ? ' data-reveal' : '';
    const isDuo = product.id === 'offre-duo' || /offre\s*a\s*29/i.test(product.name || '');
    const retainNote = isDuo
      ? '29,99 € toutes les 4 semaines, sans engagement et sans préavis en cas de résiliation, accès aux 5 salles et à toutes les disciplines'
      : '';

    return `
      <article class="offer-card ${featured ? 'featured' : ''}" data-id="${esc(product.id)}"${reveal}>
        ${featured ? '<span class="offer-badge">Populaire</span>' : ''}
        ${product.badge ? `<span class="offer-tag">${esc(product.badge)}</span>` : ''}
        <h3>${esc(displayName)}</h3>
        <div class="offer-price${priceWas ? ' offer-price--promo' : ''}">
          ${priceWas ? `<span class="offer-price-was">${esc(priceWas)}</span>` : ''}
          <span class="offer-price-now">${esc(price)}</span>
        </div>
        ${product.price_subtitle ? `<div class="offer-price-sub">${esc(product.price_subtitle)}</div>` : ''}
        ${product.installments_note ? `<div class="offer-price-sub">${esc(product.installments_note)}</div>` : ''}
        ${offerDescription(product) ? `<p class="offer-desc">${esc(offerDescription(product))}</p>` : ''}
        ${fourXSchedulePreview(product)}
        <ul class="offer-benefits">
          ${list.map((b) => `<li>${esc(b)}</li>`).join('')}
        </ul>
        <div class="offer-meta">
          <div><strong>Durée :</strong> ${esc(formatDuration(product))}</div>
          <div><strong>Paiement :</strong> ${esc(formatPaymentMode(product))}</div>
          ${retainNote ? `<div><strong>À retenir :</strong> ${esc(retainNote)}</div>` : ''}
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
