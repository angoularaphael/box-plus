/**
 * Chloe — chat d’accueil boutique (FAQ / légal / offres). Pas de résiliation.
 */
window.BCChloe = (function () {
  const AVATAR = '/img/chloe-conseillere-avatar.png';

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

  function formatBotHtml(text) {
    let s = esc(String(text || ''));
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      if (s.includes(`href="${url}`)) return url;
      return `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  function link(path) {
    return window.BCPaths?.link(path) || path;
  }

  function asset(path) {
    return window.BCPaths?.asset?.(path) || window.BCLayout?.A?.(path) || path;
  }

  function mount() {
    if (document.getElementById('chloeWidget')) return;
    const path = window.BCLayout?.currentPath?.() || location.pathname;
    if (/gerer-abonnement|regulariser|inscription|checkout|panier|admin|success|contrat|mon-inscription/i.test(path)) {
      return;
    }

    const photo = asset(AVATAR);
    const root = document.createElement('div');
    root.innerHTML = `
      <div id="chloeWidget" class="chat-widget chloe-widget" hidden>
        <div class="chat-widget-panel">
          <header class="chat-widget-header">
            <div class="chat-avatar" aria-hidden="true">
              <span class="chat-avatar-ring"></span>
              <img class="chat-avatar-photo" src="${photo}" alt="" />
            </div>
            <div>
              <strong>Chloe</strong>
              <span class="chat-status"><span class="chat-online-dot"></span> Accueil boutique · en ligne</span>
            </div>
            <button type="button" class="chat-close" id="closeChloe" aria-label="Fermer">×</button>
          </header>
          <div class="chat-messages" id="chloeRoot" role="log" aria-live="polite"></div>
        </div>
      </div>
      <button type="button" class="chat-fab chat-fab--chloe" id="chloeFab" aria-label="Discuter avec Chloe">
        <span class="chat-fab-icon" aria-hidden="true">
          <img class="chat-fab-photo" src="${photo}" alt="" />
          <span class="chat-fab-pulse"></span>
        </span>
        <span class="chat-fab-label">Chloe</span>
      </button>`;
    document.body.appendChild(root);

    const widget = document.getElementById('chloeWidget');
    const fab = document.getElementById('chloeFab');
    const messages = document.getElementById('chloeRoot');
    let busy = false;
    let gate = null;
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
            'Je suis là pour les offres, les salles, les documents ou l’essai — dis-moi ce dont tu as besoin.';
          let openUrl = '';
          try {
            if (gate === 'code') {
              const res = await fetch('/api/studio/unlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: msg }),
              });
              const data = await res.json().catch(() => ({}));
              reply = data.reply || reply;
              if (data.ok && data.url) {
                gate = null;
                openUrl = data.url;
              }
            } else {
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
              if (data.next === 'code') gate = 'code';
              if (data.next === 'open' && data.url) openUrl = data.url;
            }
          } catch {
            /* fallback */
          }
          history.pop();
          history.push({ role: 'bot', html: formatBotHtml(reply) });
          busy = false;
          paint();
          if (openUrl) {
            setTimeout(() => {
              window.location.href = openUrl;
            }, 450);
          }
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
          const greets = [
            'Hey ! Moi c’est <strong>Chloe</strong> 👋 Bienvenue chez Boxing Center. Je peux t’aider à choisir une offre, trouver ta salle ou préparer ton essai — tu veux partir sur quoi ?',
            'Salut, <strong>Chloe</strong> ici 👋 Offres, salles, essai… dis-moi ce que tu cherches, je te guide.',
            'Bienvenue ! Je suis <strong>Chloe</strong>. Tu vises plutôt une formule, une salle près de chez toi, ou un essai pour commencer ?',
          ];
          history.push({
            role: 'bot',
            html: greets[Math.floor(Math.random() * greets.length)],
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
