(function () {
  const FAQ_ITEMS = [
    { id: 'debutant', q: 'Je suis débutant, puis-je m\'inscrire ?', a: 'Oui, absolument ! Boxing Center est un club accessible aux débutants. Nos coachs adaptent les cours à chaque niveau. Vous n\'avez pas besoin d\'avoir déjà pratiqué la boxe ni d\'être en forme pour commencer.' },
    { id: 'violent', q: 'Est-ce que les cours sont violents ?', a: 'Non. Boxing Center est orienté loisir, apprentissage et remise en forme — pas la compétition professionnelle. Les entraînements sont encadrés, progressifs et dans une ambiance bienveillante. On peut pratiquer sans chercher à prendre de mauvais coups.' },
    { id: 'experience', q: 'Dois-je avoir déjà pratiqué la boxe ?', a: 'Pas du tout. La majorité de nos nouveaux adhérents découvrent la boxe chez nous. La séance d\'essai est idéale pour faire vos premiers pas.' },
    { id: 'femmes', q: 'Les femmes peuvent-elles participer à tous les cours ?', a: 'Oui, les femmes sont les bienvenues dans tous nos cours collectifs. Nos groupes sont mixtes et l\'encadrement veille à un environnement respectueux et motivant.' },
    { id: 'salles', q: 'Puis-je accéder aux 5 salles ?', a: 'Selon votre formule, votre abonnement donne accès à nos 5 centres : Minimes, Ramonville, États-Unis, Saint-Cyprien et Portet. Vous choisissez une salle principale à l\'inscription.' },
    { id: 'formule', q: 'Quelle formule choisir pour commencer ?', a: 'Pour tester : la séance d\'essai à 10 €. Pour la flexibilité : le prélèvement sans engagement. Pour économiser : le comptant 3, 6 ou 12 mois. Pour votre enfant : Baby Boxe ou Boxe éducative.' },
    { id: 'essai', q: 'Comment fonctionne la séance d\'essai ?', a: 'Réservez en ligne pour 10 €. Un coach vous accueille, vous explique le déroulé et vous participez à un cours adapté aux débutants. Aucun matériel spécifique n\'est requis pour commencer.' },
    { id: 'prelevement', q: 'Comment fonctionne le paiement par prélèvement ?', a: 'Vous payez la première échéance par carte bancaire, puis renseignez votre IBAN pour les prélèvements suivants. La formule est sans engagement longue durée — renouvelable toutes les 4 semaines.' },
    { id: 'cb-recurrent', q: 'Puis-je payer toutes les 4 semaines par carte ?', a: 'Oui, sur les formules sans engagement vous pouvez choisir « Carte bancaire toutes les 4 semaines » à l\'étape paiement. Stripe débite automatiquement votre carte ; aucun RIB n\'est demandé.' },
    { id: 'resiliation', q: 'Puis-je résilier une formule sans engagement ?', a: 'Oui, les formules sans engagement peuvent être résiliées selon les conditions prévues au contrat. Contactez votre salle pour les démarches.' },
    { id: 'materiel', q: 'Quel matériel faut-il pour commencer ?', a: 'Pour votre premier cours : tenue de sport et bouteille d\'eau suffisent. Nous vous conseillerons ensuite pour les gants et bandages — disponibles à la boutique du club.' },
    { id: 'enfant', q: 'Mon enfant peut-il s\'inscrire ?', a: 'Oui ! Baby Boxe accueille les 3-6 ans et la Boxe éducative les 7-16 ans. L\'encadrement est adapté à chaque tranche d\'âge.' },
  ];

  function renderFaq(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;
    // Hydrate server-rendered items when present (faq.html pre-renders them
    // for SEO/GEO); only build the DOM for empty containers (page subsets).
    if (!el.querySelector('.faq-item')) {
      el.innerHTML = items
        .map(
          (item) => `
      <div class="faq-item" data-id="${item.id}">
        <button type="button" class="faq-question" aria-expanded="false" aria-controls="faq-a-${item.id}">${item.q}</button>
        <div class="faq-answer" id="faq-a-${item.id}">${item.a}</div>
      </div>`
        )
        .join('');
    }
    el.querySelectorAll('.faq-question').forEach((btn) => {
      btn.addEventListener('click', () => {
        const open = btn.parentElement.classList.toggle('open');
        btn.setAttribute('aria-expanded', String(open));
      });
    });
  }

  function renderSubset(containerId, ids) {
    const items = FAQ_ITEMS.filter((i) => ids.includes(i.id));
    renderFaq(containerId, items);
  }

  function renderAll(containerId) {
    renderFaq(containerId, FAQ_ITEMS);
  }

  window.BCFaq = { FAQ_ITEMS, renderFaq, renderSubset, renderAll };
})();
