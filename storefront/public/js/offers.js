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
      return 'En une fois ou 4× (25 % CB + RIB)';
    }
    if (/comptant/i.test(product.name || '') || product.subsection === 'comptant') {
      return 'Paiement unique — pas de prélèvement';
    }
    if (product.supports_billing_choice) {
      return '29 € toutes les 4 semaines — 1ʳᵉ échéance par CB puis prélèvements';
    }
    if (/4\s*[x×]\s*sans\s*frais/i.test(product.badge || '') || /sans\s*frais/i.test(product.badge || '')) {
      return 'Paiement en 4× sans frais';
    }
    if (product.id === 'offre-duo' || /offre\s*a\s*29/i.test(product.name || '')) {
      return '29 € toutes les 4 semaines — 1ʳᵉ échéance par CB puis prélèvements';
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
      return 'Paiement CB à la première échéance, puis 29 € toutes les 4 semaines.';
    }
    if (product.description) return product.description;
    if (/baby\s*boxe/i.test(n)) {
      return 'Éveil sportif et boxe ludique pour les tout-petits, encadrés par des coachs spécialisés, sur toute la saison. Paiement en 1× ou 4× : 25 % par carte puis RIB pour 3 prélèvements.';
    }
    if (/educative|éducative/i.test(n)) {
      return 'Boxe éducative pour enfants et ados : technique, respect et confiance en soi, tout au long de la saison. Paiement en 1× ou 4× : 25 % par carte puis RIB pour 3 prélèvements.';
    }
    if (hasInstallmentChoice(product) || /comptant/i.test(n) || product.subsection === 'comptant') {
      const dur = formatDuration(product);
      if (hasInstallmentChoice(product)) {
        return `Réglez en une fois ou en 4× sans frais : 25 % par carte puis RIB pour les 3 échéances suivantes (${dur}). Accès illimité, sans prélèvement mensuel.`;
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
    return `
      <div class="fourx-schedule fourx-schedule--card">
        <p class="fourx-schedule__title">4× sans frais PayPlug</p>
        <ul>
          <li><strong>Aujourd’hui</strong> — ${quart}&nbsp;€ (25&nbsp;%) par carte</li>
          <li><strong>Ensuite</strong> — RIB pour 3 prélèvements automatiques</li>
        </ul>
        <p class="fourx-schedule__note">PayPal 4× également disponible si éligible.</p>
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
      ? '29 € toutes les 4 semaines, sans engagement et sans préavis en cas de résiliation, accès aux 5 salles et à toutes les disciplines'
      : '';
    const priceSubtitle = isDuo ? '29 € — première échéance' : product.price_subtitle;

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

  /** Places restantes : courbe hebdo locale (lundi 00h → dimanche 23h59), unique par navigateur. */
  const SCARCITY_STORAGE = 'bc_scarcity_week_v2';
  const SCARCITY_TZ = 'Europe/Paris';
  const WEEKDAY_IDX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i += 1) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parisParts(date = new Date()) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: SCARCITY_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      })
        .formatToParts(date)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value])
    );
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
      weekday: parts.weekday,
      dayIndex: WEEKDAY_IDX[parts.weekday] ?? 0,
    };
  }

  function mondayWeekKey(parts) {
    const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    utc.setUTCDate(utc.getUTCDate() - parts.dayIndex);
    return utc.toISOString().slice(0, 10);
  }

  function ensureVisitorState() {
    let state = null;
    try {
      state = JSON.parse(localStorage.getItem(SCARCITY_STORAGE) || 'null');
    } catch {
      state = null;
    }
    if (!state || typeof state.seed !== 'number') {
      let seed = Math.floor(Math.random() * 0xffffffff);
      try {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        seed = buf[0] || seed;
      } catch {
        /* ignore */
      }
      state = { seed };
    }
    const weekKey = mondayWeekKey(parisParts());
    if (state.weekKey !== weekKey) {
      state.weekKey = weekKey;
      state.plans = {};
      state.lastShown = {};
    }
    if (!state.lastShown || typeof state.lastShown !== 'object') {
      state.lastShown = {};
    }
    try {
      localStorage.setItem(SCARCITY_STORAGE, JSON.stringify(state));
    } catch {
      /* private mode */
    }
    return state;
  }

  function buildWeekEndTargets(seed, weekKey, offerId, start, end) {
    const rng = mulberry32(hashSeed(`${seed}:${weekKey}:${offerId}`));
    const targets = [];
    let current = start;
    const minDrop = Math.max(8, Math.round((start - end) / 10));
    const maxDrop = Math.max(minDrop + 4, Math.round((start - end) / 4.2));

    for (let day = 0; day < 6; day += 1) {
      const daysAfter = 6 - day;
      const remainingDrop = current - end;
      const avg = remainingDrop / (daysAfter + 1);
      let drop = Math.round(avg + (rng() - 0.35) * (maxDrop - minDrop));
      drop = Math.max(minDrop, Math.min(maxDrop, drop));
      const maxAllowed = remainingDrop - minDrop * daysAfter;
      drop = Math.min(drop, Math.max(minDrop, maxAllowed));
      current = Math.max(end + minDrop * daysAfter, current - drop);
      if (current >= (targets[targets.length - 1] ?? start)) {
        current = Math.max(end + minDrop * daysAfter, (targets[targets.length - 1] ?? start) - minDrop);
      }
      targets.push(current);
    }
    targets.push(end);
    return targets;
  }

  function getOfferPlan(state, offerId, start, end) {
    if (!state.plans) state.plans = {};
    if (!state.plans[offerId]) {
      state.plans[offerId] = buildWeekEndTargets(state.seed, state.weekKey, offerId, start, end);
      try {
        localStorage.setItem(SCARCITY_STORAGE, JSON.stringify(state));
      } catch {
        /* ignore */
      }
    }
    return state.plans[offerId];
  }

  function remainingFromPlan(plan, start, end, date = new Date()) {
    const parts = parisParts(date);
    const dayIndex = parts.dayIndex;
    const dayStart = dayIndex === 0 ? start : plan[dayIndex - 1];
    const dayEnd = plan[dayIndex];
    const dayFraction = Math.min(
      1,
      Math.max(0, (parts.hour * 3600 + parts.minute * 60 + parts.second) / 86400)
    );
    // Légère accélération en fin de journée (pression) — courbe strictement descendante.
    const eased = dayFraction * dayFraction * (3 - 2 * dayFraction);
    const value = dayStart + (dayEnd - dayStart) * eased;
    return Math.max(end, Math.min(start, Math.round(value)));
  }

  function persistState(state) {
    try {
      localStorage.setItem(SCARCITY_STORAGE, JSON.stringify(state));
    } catch {
      /* private mode */
    }
  }

  function lockNeverIncrease(state, offerKey, restantes, floor) {
    const prev = Number(state.lastShown[offerKey]);
    let next = restantes;
    if (Number.isFinite(prev) && prev >= floor) {
      next = Math.min(next, prev);
    }
    if (state.lastShown[offerKey] !== next) {
      state.lastShown[offerKey] = next;
      persistState(state);
    }
    return next;
  }

  function computeWeeklyRemaining(offerId) {
    const state = ensureVisitorState();
    if (offerId === 'offre-saison' || offerId === 'offre-259' || offerId === 'saison') {
      const start = 50;
      const end = 3;
      const plan = getOfferPlan(state, 'offre-saison', start, end);
      const restantes = lockNeverIncrease(
        state,
        'offre-saison',
        remainingFromPlan(plan, start, end),
        end
      );
      return { restantes, quota: start };
    }
    const start = 100;
    const end = 3;
    const plan = getOfferPlan(state, 'offre-duo', start, end);
    const restantes = lockNeverIncrease(
      state,
      'offre-duo',
      remainingFromPlan(plan, start, end),
      end
    );
    return { restantes, quota: start };
  }

  async function initScarcity() {
    try {
      let duoSoldOut = false;
      let saisonSoldOut = false;
      try {
        const res = await fetch('/api/offre-rentree/places');
        const data = await res.json();
        if (data?.ok) {
          duoSoldOut = Boolean(data.offers?.['offre-duo']?.sold_out);
          saisonSoldOut = Boolean(data.offers?.['offre-saison']?.sold_out);
        }
      } catch {
        /* offline: courbe locale seule */
      }

      const duoWeekly = computeWeeklyRemaining('offre-duo');
      const saisonWeekly = computeWeeklyRemaining('offre-saison');
      const targetDuo = duoSoldOut ? 0 : duoWeekly.restantes;
      const targetSaison = saisonSoldOut ? 0 : saisonWeekly.restantes;

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
          if (duoSoldOut) {
            el.innerHTML = '<span class="scarcity-pill scarcity-pill--soldout">❌ Rupture de stock</span>';
          } else {
            el.innerHTML = `<span class="scarcity-pill">Plus que <strong>${targetDuo}</strong> places</span>`;
          }
        } else if (target === 'offre-saison' || target === 'offre-259' || target === 'saison') {
          if (saisonSoldOut) {
            el.innerHTML = '<span class="scarcity-pill scarcity-pill--soldout">❌ Rupture de stock</span>';
          } else {
            el.innerHTML = `<span class="scarcity-pill">Plus que <strong>${targetSaison}</strong> places</span>`;
          }
        }
      });

      /* Gérer la fermeture en cas de rupture de stock */
      if (duoSoldOut) {
        document.querySelectorAll('[data-product="offre-duo"], [data-track="offer29_cta"], [data-track="hub_cta_29"]').forEach((btn) => {
          btn.classList.add('sold-out');
          btn.textContent = 'Offre Épuisée';
          btn.removeAttribute('href');
        });
      }
      if (saisonSoldOut) {
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
    computeWeeklyRemaining,
  };
})();
