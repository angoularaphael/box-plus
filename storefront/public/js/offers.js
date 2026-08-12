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
      return '29,99 € toutes les 4 semaines — 1ʳᵉ échéance par CB puis prélèvements';
    }
    if (/4\s*[x×]\s*sans\s*frais/i.test(product.badge || '') || /sans\s*frais/i.test(product.badge || '')) {
      return 'Paiement en 4× sans frais';
    }
    if (product.id === 'offre-duo' || /offre\s*a\s*29/i.test(product.name || '')) {
      return '29,99 € toutes les 4 semaines — 1ʳᵉ échéance par CB puis prélèvements';
    }
    if (product.requires_iban) return '1ʳᵉ échéance par carte · prélèvement sans engagement';
    return 'Carte bancaire ou PayPal';
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
    const n = String(product.name || '');
    if (product.id === 'offre-duo' || /offre\s*a\s*29/i.test(n)) {
      return 'Paiement CB à la première échéance, puis 29,99 € toutes les 4 semaines.';
    }
    if (product.description) return product.description;
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
    if (/4\s*semaines/i.test(n) || product.requires_iban) {
      return 'Formule flexible : 1ʳᵉ échéance par carte, puis prélèvement sans engagement toutes les 4 semaines. Accès illimité aux salles et disciplines.';
    }
    return '';
  }

  function isFeaturedOffer(product, opts = {}) {
    // Toutes les cartes de la une (featured_home) portent « Populaire »
    const ids = opts.featuredIds || [];
    if (ids.length) {
      return ids.includes(product.id) || (product.legacy_id && ids.includes(product.legacy_id));
    }
    if (product.featured_home === true) return true;
    return Boolean(product.featured);
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
    const priceSubtitle = isDuo ? '29,99 € — première échéance' : product.price_subtitle;

    return `
      <article class="offer-card ${featured ? 'featured' : ''}" data-id="${esc(product.id)}"${reveal}>
        ${product.image ? `<div class="offer-card__media"><img src="${esc(product.image)}" alt="" loading="lazy" width="640" height="400" /></div>` : ''}
        ${featured ? '<span class="offer-badge">Populaire</span>' : ''}
        <div class="offer-card__title-row">
          ${product.badge ? `<span class="offer-tag">${esc(product.badge)}</span>` : ''}
          <h3>${esc(displayName)}</h3>
        </div>
        <div class="offer-price${priceWas ? ' offer-price--promo' : ''}">
          ${priceWas ? `<span class="offer-price-was">${esc(priceWas)}</span>` : ''}
          <span class="offer-price-now">${esc(price)}</span>
        </div>
        ${priceSubtitle ? `<div class="offer-price-sub">${esc(priceSubtitle)}</div>` : ''}
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

  function spinReelDigit(reelEl, finalDigit, spinDuration) {
    const digitHeight = reelEl.offsetHeight || 38;
    const stripLen = 16 + Math.floor(Math.random() * 6); // 16-21 crans avant l'arrêt
    const digits = [];
    for (let i = 0; i < stripLen - 1; i++) {
      digits.push(Math.floor(Math.random() * 10));
    }
    digits.push(Number(finalDigit));

    const strip = document.createElement('div');
    strip.className = 'reel-strip';
    digits.forEach((d) => {
      const s = document.createElement('span');
      s.textContent = d;
      strip.appendChild(s);
    });

    reelEl.classList.add('spinning');
    reelEl.innerHTML = '';
    reelEl.appendChild(strip);

    // Force le reflow avant de déclencher la transition
    void strip.offsetHeight;
    strip.style.transition = `transform ${spinDuration}ms cubic-bezier(0.13, 0.85, 0.22, 1)`;
    requestAnimationFrame(() => {
      strip.style.transform = `translateY(-${(digits.length - 1) * digitHeight}px)`;
    });

    strip.addEventListener(
      'transitionend',
      () => {
        reelEl.classList.remove('spinning');
        reelEl.innerHTML = `<span>${finalDigit}</span>`;
      },
      { once: true }
    );
  }

  function spinMechanicalReels(assemblyEl, targetNum, subtextElId) {
    if (!assemblyEl) return;
    const digitsStr = String(targetNum).padStart(3, '0');
    const reelEls = assemblyEl.querySelectorAll('.reel-digit');

    // Chaque rouleau tourne comme une machine à sous, et se verrouille
    // séquentiellement de gauche à droite pour l'effet casino.
    reelEls.forEach((reel, idx) => {
      const spinDuration = 900 + idx * 450;
      spinReelDigit(reel, digitsStr[idx] || '0', spinDuration);
    });

    if (subtextElId) {
      const lastSpin = 900 + (reelEls.length - 1) * 450;
      setTimeout(() => {
        const subEl = document.getElementById(subtextElId);
        if (subEl) subEl.textContent = targetNum;
      }, lastSpin);
    }
  }

  function triggerPriceStrikeAnimation() {
    setTimeout(() => {
      document.querySelectorAll('.strike-line-svg').forEach((svg) => {
        svg.classList.add('active');
      });
    }, 450);
  }

  async function initScarcity() {
    try {
      const res = await fetch('/api/offre-rentree/places');
      const data = await res.json();
      if (!data.ok) return;

      const duo = data.offers?.['offre-duo'] || { quota: 100, restantes: 100, regular_price: 44, promo_price: 29, sold_out: false };
      const saison = data.offers?.['offre-saison'] || { quota: 50, restantes: 50, regular_price: 400, promo_price: 259, sold_out: false };

      const targetDuo = (duo.restantes > 0 && duo.restantes < duo.quota) ? duo.restantes : 70;
      const targetSaison = (saison.restantes > 0 && saison.restantes < saison.quota) ? saison.restantes : 25;

      /* Déclencher l'animation de rature des prix d'origine */
      triggerPriceStrikeAnimation();

      /* Déclencher l'animation des compteurs rouleaux métalliques 3D
         au moment où l'utilisateur scroll jusqu'à eux (une seule fois). */
      const runReelSpin = (assemblyEl) => {
        const target = assemblyEl.getAttribute('data-scarcity-reel');
        if (target === 'offre-duo' || target === 'offre-29' || target === 'duo') {
          spinMechanicalReels(assemblyEl, targetDuo, 'duo-sub-count');
        } else if (target === 'offre-saison' || target === 'offre-259' || target === 'saison') {
          spinMechanicalReels(assemblyEl, targetSaison, 'saison-sub-count');
        }
      };

      const reelAssemblies = document.querySelectorAll('[data-scarcity-reel]');
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (reduceMotion || !('IntersectionObserver' in window)) {
        reelAssemblies.forEach(runReelSpin);
      } else {
        const reelObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            runReelSpin(entry.target);
            reelObserver.unobserve(entry.target);
          });
        }, { threshold: 0.5 });
        reelAssemblies.forEach((el) => reelObserver.observe(el));
      }

      /* Hydrater badges de places restantes secondaires si présents */
      document.querySelectorAll('[data-scarcity]').forEach((el) => {
        const target = el.getAttribute('data-scarcity');
        if (target === 'offre-duo' || target === 'offre-29' || target === 'duo') {
          if (duo.sold_out) {
            el.innerHTML = '<span class="scarcity-pill scarcity-pill--soldout">❌ Rupture de stock</span>';
          }
        } else if (target === 'offre-saison' || target === 'offre-259' || target === 'saison') {
          if (saison.sold_out) {
            el.innerHTML = '<span class="scarcity-pill scarcity-pill--soldout">❌ Rupture de stock</span>';
          }
        }
      });

      /* Gérer la fermeture en cas de rupture de stock */
      if (duo.sold_out) {
        document.querySelectorAll('[data-product="offre-duo"], [data-track="offer29_cta"], [data-track="hub_cta_29"]').forEach((btn) => {
          btn.classList.add('sold-out');
          btn.textContent = 'Offre Épuisée';
          btn.removeAttribute('href');
        });
      }
      if (saison.sold_out) {
        document.querySelectorAll('[data-product="offre-saison"], [data-track="offer259_cta"], [data-track="hub_cta_259"]').forEach((btn) => {
          btn.classList.add('sold-out');
          btn.textContent = 'Offre Épuisée';
          btn.removeAttribute('href');
        });
      }
    } catch (err) {
      console.warn('Scarcity sync notice:', err.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScarcity);
  } else {
    initScarcity();
  }

  window.BCOffers = {
    renderOfferCard,
    renderOfferGrid,
    esc,
    isFeaturedOffer,
    offerDescription,
    formatPaymentMode,
    formatDuration,
    initScarcity,
    spinMechanicalReels,
    triggerPriceStrikeAnimation,
  };
})();
