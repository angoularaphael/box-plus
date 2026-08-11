/**
 * Chloée — chat d’accueil boutique (FAQ / légal / offres). Pas de résiliation.
 */
window.BCChloe = (function () {
  function bubble(role, html) {
    const extra = role === 'typing' ? ' typing' : '';
    return `<div class="chat-row ${role}${extra}"><div class="chat-bubble chat-bubble-enter">${html}</div></div>`;
  }

  function typingHtml() {
    return `<span class="chat-typing-dot"></span><span class="chat-typing-dot"></span><span class="chat-typing-dot"></span>`;
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function link(path) {
    return window.BCPaths?.link(path) || path;
  }

  function mount() {
    if (document.getElementById('chloeWidget')) return;
    const path = window.BCLayout?.currentPath?.() || location.pathname;
    if (/gerer-abonnement|inscription|checkout|panier|admin|success|contrat|mon-inscription/i.test(path)) {
      return;
    }

    const root = document.createElement('div');
    root.innerHTML = `
      <div id="chloeWidget" class="chat-widget chloe-widget" hidden>
        <div class="chat-widget-panel">
          <header class="chat-widget-header">
            <div class="chat-avatar chat-avatar--chloe" aria-hidden="true"><span>C</span></div>
            <div>
              <strong>Chloée</strong>
              <span class="chat-status"><span class="chat-online-dot"></span> Accueil boutique · en ligne</span>
            </div>
            <button type="button" class="chat-close" id="closeChloe" aria-label="Fermer">×</button>
          </header>
          <div class="chat-messages" id="chloeRoot" role="log" aria-live="polite"></div>
        </div>
      </div>
      <button type="button" class="chat-fab chat-fab--chloe" id="chloeFab" aria-label="Discuter avec Chloée">
        <span class="chat-fab-icon chat-fab-icon--chloe" aria-hidden="true"><span>C</span><span class="chat-fab-pulse"></span></span>
        <span class="chat-fab-label">Chloée</span>
      </button>`;
    document.body.appendChild(root);

    const widget = document.getElementById('chloeWidget');
    const fab = document.getElementById('chloeFab');
    const messages = document.getElementById('chloeRoot');
    let busy = false;
    const history = [];

    function paint() {
      const body = history.map((h) => bubble(h.role, h.html)).join('');
      messages.innerHTML = `<div class="chat-thread">${body}</div>
        <form id="chloeForm" class="chat-compose">
          <input id="chloeMsg" placeholder="Pose ta question…" required autocomplete="off" ${busy ? 'disabled' : ''} />
          <button type="submit" class="btn sm" ${busy ? 'disabled' : ''}>Envoyer</button>
        </form>
        <div class="chat-quick">
          <a class="chat-chip" href="${link('/offre/29')}">Offre 29,99 €</a>
          <a class="chat-chip" href="${link('/offre/259')}">Offre 259 €</a>
          <a class="chat-chip" href="${link('/gerer-abonnement')}">Gérer mon abo</a>
        </div>`;
      const thread = messages.querySelector('.chat-thread');
      if (thread) thread.scrollTop = thread.scrollHeight;
      const form = messages.querySelector('#chloeForm');
      if (form) {
        form.onsubmit = async (e) => {
          e.preventDefault();
          if (busy) return;
          const input = messages.querySelector('#chloeMsg');
          const msg = input?.value?.trim();
          if (!msg) return;
          history.push({ role: 'user', html: esc(msg) });
          busy = true;
          history.push({ role: 'typing', html: typingHtml() });
          paint();
          let reply =
            'Je peux t’aider sur les offres, salles, CGV ou essai. Pour une résiliation, passe par « Gérer mon abo » (David).';
          try {
            const payload = {
              free_text: msg,
              messages: history
                .filter((h) => h.role === 'user' || h.role === 'bot')
                .map((h) => ({
                  role: h.role === 'bot' ? 'assistant' : 'user',
                  content: String(h.html || '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim(),
                }))
                .filter((m) => m.content)
                .slice(-12),
            };
            const res = await fetch('/api/membership/welcome-counsel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (data.ok && data.reply) reply = data.reply;
          } catch {
            /* fallback */
          }
          history.pop();
          history.push({ role: 'bot', html: esc(reply) });
          busy = false;
          paint();
        };
      }
    }

    function open() {
      widget.hidden = false;
      fab.hidden = true;
      if (!messages.dataset.ready) {
        messages.dataset.ready = '1';
        busy = true;
        history.push({ role: 'typing', html: typingHtml() });
        paint();
        setTimeout(() => {
          history.pop();
          history.push({
            role: 'bot',
            html:
              'Salut, je suis <strong>Chloée</strong> ! Questions sur les offres 29,99&nbsp;€ / 259&nbsp;€, les salles, les CGV ou l’essai ? Je suis là. Pour résilier, David t’attend sur « Gérer mon abo ».',
          });
          busy = false;
          paint();
        }, 700);
      }
    }

    function close() {
      widget.hidden = true;
      fab.hidden = false;
    }

    fab.onclick = open;
    document.getElementById('closeChloe').onclick = close;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  return { mount };
})();
