(function () {
  const gymSelect = document.getElementById('c_gym');
  const currentSelect = document.getElementById('c_current');
  const targetSelect = document.getElementById('c_target');
  const gymList = document.getElementById('gymList');
  const changeMsg = document.getElementById('changeMsg');
  const chatWidget = document.getElementById('chatWidget');
  const chatFab = document.getElementById('chatFab');

  const GYMS = [
    { id: 'minimes', label: 'Minimes', address: '12 rue de Fenouillet, 31200 Toulouse' },
    { id: 'ramonville', label: 'Ramonville', address: '33 rue des Ormes, 31530 Ramonville' },
    { id: 'portet', label: 'Portet', address: 'Portet-sur-Garonne' },
    { id: 'etats-unis', label: 'États-Unis', address: '388 avenue des États-Unis, 31200 Toulouse' },
    { id: 'st-cyprien', label: 'St-Cyprien', address: '11 Rue Sainte-Lucie, 31300 Toulouse' },
  ];

  gymList.innerHTML = GYMS.map(
    (g) =>
      `<li class="manage-gym-item"><strong>${g.label}</strong><span>${g.address}</span></li>`
  ).join('');

  gymSelect.innerHTML = GYMS.map((g) => `<option value="${g.id}">${g.label}</option>`).join('');

  function openChat() {
    chatWidget.hidden = false;
    chatFab.hidden = true;
    const root = document.getElementById('counselorRoot');
    if (!root.dataset.ready) {
      root.dataset.ready = '1';
      window.BCCounselor.render(root, async (formData, msgEl) => {
        msgEl.hidden = false;
        msgEl.textContent = 'Envoi de la demande…';
        msgEl.className = 'form-msg';
        const res = await fetch('/api/membership/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        const data = await res.json();
        if (!data.ok) {
          msgEl.textContent =
            data.error ||
            "Je suis désolé, mais nous n'avons pas pu trouver d'abonnement correspondant à ces informations.";
          msgEl.className = 'form-msg err';
          return;
        }
        msgEl.textContent =
          'Demande envoyée. La résiliation est traitée dans Deciplus par notre bot. Vous recevrez une confirmation.';
        msgEl.className = 'form-msg';
      });
    }
  }

  function closeChat() {
    chatWidget.hidden = true;
    chatFab.hidden = false;
  }

  document.getElementById('openCounselor').onclick = openChat;
  chatFab.onclick = openChat;
  document.getElementById('closeCounselor').onclick = closeChat;

  async function loadOptions() {
    const res = await fetch('/api/membership/options');
    const data = await res.json();
    if (!data.ok) return;
    currentSelect.innerHTML = (data.current_plans || [])
      .map((p) => `<option value="${p.id}">${p.label}</option>`)
      .join('');
    targetSelect.innerHTML = (data.comptant_targets || [])
      .map(
        (p) =>
          `<option value="${p.id}">${p.name}${p.price_label ? ` — ${p.price_label}` : ''}</option>`
      )
      .join('');
  }

  document.getElementById('changeForm').onsubmit = async (e) => {
    e.preventDefault();
    changeMsg.hidden = false;
    changeMsg.textContent = 'Redirection vers le paiement…';
    changeMsg.className = 'form-msg';
    const body = Object.fromEntries(new FormData(e.target).entries());
    const res = await fetch('/api/membership/change/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      changeMsg.textContent = data.error || 'Erreur';
      changeMsg.className = 'form-msg err';
      return;
    }
    if (data.url) window.location.href = data.url;
  };

  const params = new URLSearchParams(location.search);
  if (params.get('change') === '1' && params.get('session_id')) {
    fetch('/api/membership/change/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: params.get('session_id') }),
    })
      .then((r) => r.json())
      .then((data) => {
        changeMsg.hidden = false;
        changeMsg.className = data.ok ? 'form-msg' : 'form-msg err';
        changeMsg.textContent = data.ok
          ? 'Paiement reçu — bascule prélèvement → comptant en cours dans Deciplus.'
          : data.error || 'Confirmation impossible';
      })
      .catch(() => {});
  }

  loadOptions().catch(() => {});
})();
