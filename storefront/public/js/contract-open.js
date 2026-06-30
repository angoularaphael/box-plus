window.BCContract = {
  openView(orderId, { token, sessionId } = {}) {
    const qs = new URLSearchParams({ order: orderId });
    if (token) qs.set('token', token);
    if (sessionId) qs.set('session_id', sessionId);
    window.open(`/contrat?${qs}`, '_blank', 'noopener,noreferrer');
  },

  openAdminView(orderId) {
    const qs = new URLSearchParams({ order: orderId, admin: '1' });
    window.open(`/contrat?${qs}`, '_blank', 'noopener,noreferrer');
  },
};
