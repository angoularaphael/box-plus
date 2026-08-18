(function () {
  const form = document.getElementById('aventureForm');
  const err = document.getElementById('aventureErr');
  const submit = document.getElementById('aventureSubmit');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const data = Object.fromEntries(new FormData(form).entries());
    submit.disabled = true;
    submit.textContent = 'On s’occupe de ta fiche…';
    try {
      const res = await fetch('/api/balma-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: data.first_name,
          last_name: data.last_name,
          offer: data.offer,
          prelevement: data.prelevement === '1',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        err.textContent = json.error || (json.errors && json.errors[0]) || 'Impossible d’enregistrer.';
        submit.disabled = false;
        submit.textContent = 'Enregistrer et continuer';
        return;
      }
      window.location.href = json.redirect;
    } catch {
      err.textContent = 'Réseau indisponible. Réessaie dans un instant.';
      submit.disabled = false;
      submit.textContent = 'Enregistrer et continuer';
    }
  });
})();
