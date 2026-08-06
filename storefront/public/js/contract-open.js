window.BCContract = {
  openView(orderId, { token, sessionId, returnStep } = {}) {
    const qs = new URLSearchParams({ order: orderId });
    if (token) qs.set('token', token);
    if (sessionId) qs.set('session_id', sessionId);
    if (returnStep) qs.set('return_step', String(returnStep));
    const returnUrl = `/inscription?order=${encodeURIComponent(orderId)}${
      token ? `&token=${encodeURIComponent(token)}` : ''
    }${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''}&step=${returnStep || 7}`;
    qs.set('return', returnUrl);
    window.open(`/contrat?${qs}`, '_blank', 'noopener');
  },

  openAdminView(orderId) {
    const qs = new URLSearchParams({ order: orderId, admin: '1' });
    window.open(`/contrat?${qs}`, '_blank', 'noopener');
  },
};
