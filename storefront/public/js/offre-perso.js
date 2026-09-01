(function () {
  const params = new URLSearchParams(location.search);
  const orderId = String(params.get('order') || '').trim();
  const token = String(params.get('token') || params.get('bc_token') || '').trim();
  const title = document.getElementById('offerTitle');
  const lead = document.getElementById('offerLead');
  const priceEl = document.getElementById('offerPrice');
  const modeEl = document.getElementById('offerMode');
  const benefitsEl = document.getElementById('offerBenefits');
  const cta = document.getElementById('offerCta');
  const status = document.getElementById('offerStatus');

  function fail(message) {
    if (lead) lead.textContent = message;
    if (status) status.textContent = '';
  }

  if (!orderId || !token) {
    fail('Lien incomplet. Demandez un nouveau lien à Boxing Center.');
    return;
  }

  fetch(`/api/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`)
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok || !data.order) {
        fail(data.message || 'Cette offre est introuvable ou a déjà été utilisée.');
        return;
      }
      const order = data.order;
      const product = order.product_snapshot || {};
      const comptant = product.subsection === 'comptant' || product.requires_iban === false;
      const fourX =
        product.supports_installment_choice === true ||
        /1\s*[x×]\s*ou\s*4\s*[x×]/i.test(String(product.badge || product.duration_label || ''));
      const people = Number(product.party_size || order.party_size || 1);
      const peopleLabel = people > 1 ? `Offre pour ${people} personnes` : '';
      const name = product.display_name || product.name || 'Votre offre Boxing Center';
      const price = product.price_label || '';
      if (title) title.textContent = name;
      if (lead) {
        lead.textContent = !comptant
          ? '1ʳᵉ échéance aujourd’hui, puis prélèvement toutes les 4 semaines, sans engagement. Ensuite le dossier (infos manquantes uniquement).'
          : fourX
            ? 'Payez en une fois ou en 4× sans frais, puis vous complétez uniquement les infos encore manquantes.'
            : 'Paiement unique, puis vous complétez uniquement les infos encore manquantes.';
      }
      if (priceEl) priceEl.textContent = price;
      if (modeEl) {
        const modeBits = [
          !comptant
            ? 'Abonnement — 4 semaines, sans engagement'
            : fourX
              ? 'Comptant — 1× ou 4× sans frais'
              : 'Comptant — un seul paiement',
          peopleLabel,
        ].filter(Boolean);
        modeEl.textContent = modeBits.join(' · ');
      }
      const benefits = Array.isArray(product.benefits) ? product.benefits : [];
      if (benefitsEl) {
        benefitsEl.innerHTML = benefits
          .map((b) => `<li>${String(b).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`)
          .join('');
      }
      const qs = new URLSearchParams({
        order: order.order_id,
        token,
        bc_token: token,
      });
      if (product.id) qs.set('product', product.id);
      if (cta) {
        cta.innerHTML = `<a class="btn btn--lg" href="/inscription?${qs}">Payer puis m’inscrire</a>`;
      }
    })
    .catch(() => fail('Impossible de charger l’offre. Réessayez dans un instant.'));
})();
