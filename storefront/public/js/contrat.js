(function () {
  const params = new URLSearchParams(location.search);
  const orderId = params.get('order');
  const token = params.get('token');
  const sessionId = params.get('session_id');
  const isAdmin = params.get('admin') === '1';
  const errEl = document.getElementById('contractErr');
  const frame = document.getElementById('pdfFrame');

  if (!orderId || (!isAdmin && !token)) {
    errEl.hidden = false;
    errEl.textContent = 'Lien invalide.';
    return;
  }

  let pdfUrl;
  if (isAdmin) {
    pdfUrl = `/api/admin/orders/${encodeURIComponent(orderId)}/contract.pdf`;
  } else {
    const qs = new URLSearchParams({ token });
    if (sessionId) qs.set('session_id', sessionId);
    pdfUrl = `/api/orders/${encodeURIComponent(orderId)}/contract.pdf?${qs}`;
  }

  frame.src = pdfUrl;

  fetch(pdfUrl, { credentials: 'include' })
    .then((res) => {
      if (!res.ok) {
        errEl.hidden = false;
        errEl.textContent =
          res.status === 403
            ? 'Accès refusé — vérifiez votre lien d\'inscription.'
            : res.status === 404
              ? 'Contrat introuvable — complétez d\'abord votre dossier.'
              : 'Impossible d\'afficher le contrat pour le moment.';
      }
    })
    .catch(() => {
      errEl.hidden = false;
      errEl.textContent = 'Impossible de charger le contrat.';
    });

  document.getElementById('downloadBtn').onclick = async () => {
    try {
      const res = await fetch(pdfUrl, { credentials: 'include' });
      if (!res.ok) throw new Error('Téléchargement impossible');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contrat-${orderId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      errEl.hidden = false;
      errEl.textContent = err.message || 'Erreur lors du téléchargement';
    }
  };
})();
