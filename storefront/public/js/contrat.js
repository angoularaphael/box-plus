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

  let objectUrl = null;

  function showError(message) {
    errEl.hidden = false;
    errEl.textContent = message;
  }

  function errorFromStatus(status) {
    if (status === 401) return 'Reconnectez-vous à l’espace admin pour voir la facture.';
    if (status === 403) return 'Accès refusé — vérifiez votre lien d\'inscription.';
    if (status === 404) return 'Facture introuvable — complétez d\'abord votre dossier.';
    return 'Impossible d\'afficher la facture pour le moment.';
  }

  fetch(pdfUrl, { credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) {
        showError(errorFromStatus(res.status));
        return;
      }
      const type = String(res.headers.get('content-type') || '');
      const blob = await res.blob();
      if (!type.includes('pdf') && blob.type && !blob.type.includes('pdf')) {
        showError(errorFromStatus(res.status));
        return;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      frame.src = objectUrl;
    })
    .catch(() => {
      showError('Impossible de charger la facture.');
    });

  document.getElementById('downloadBtn').onclick = async () => {
    try {
      const src = objectUrl || pdfUrl;
      const res = objectUrl
        ? await fetch(objectUrl)
        : await fetch(pdfUrl, { credentials: 'include' });
      if (!res.ok) throw new Error('Téléchargement impossible');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-${orderId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showError(err.message || 'Erreur lors du téléchargement');
    }
  };
})();
