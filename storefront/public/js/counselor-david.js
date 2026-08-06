/**
 * Conseiller virtuel David — chat messagerie (FSM rétention).
 */
window.BCCounselor = (function () {
  const REASONS = [
    { id: 'time', label: "Je n'ai plus le temps de venir à la salle" },
    { id: 'move', label: 'Je déménage' },
    { id: 'medical', label: 'Raison médicale / blessure' },
    { id: 'club', label: "Changement de club / d'activité sportive" },
    { id: 'money', label: 'Raison financière' },
    { id: 'other', label: 'Autre' },
  ];

  const REPLIES = {
    time: "Avez-vous pu consulter les plannings de nos cinq salles ? Votre abonnement donne aussi l'accès libre de 10h à 21h, 6 jours sur 7 — un autre créneau ou une autre salle pourrait mieux vous convenir.",
    move: 'Votre abonnement donne accès aux 5 centres Boxing Center. Votre nouveau domicile ne se situe-t-il pas à proximité de l’un d’entre eux ?',
    medical:
      'En cas de blessure, vous pouvez suspendre votre abonnement sans frais et conserver vos conditions tarifaires préférentielles à la reprise.',
    club: 'Vous avez accès aux 5 salles, à toutes les disciplines, et à des associations partenaires (Nobles Arts Portésiens, Toulouse Mini Boxing Club).',
    money:
      'J’ai bien compris que le prix est un frein. Exceptionnellement, une offre promotionnelle à 29 € peut être envisagée avec votre manager — souhaitez-vous en parler avant de résilier ?',
    other: 'Pouvez-vous me préciser la raison ?',
  };

  function bubble(role, html) {
    const extra = role === 'typing' ? ' typing' : '';
    return `<div class="chat-row ${role}${extra}"><div class="chat-bubble chat-bubble-enter">${html}</div></div>`;
  }

  function typingHtml() {
    return `<span class="chat-typing-dot"></span><span class="chat-typing-dot"></span><span class="chat-typing-dot"></span>`;
  }

  function render(root, onReadyToCancel) {
    let step = 'hello';
    let reasonId = null;
    let busy = false;
    const history = [];

    function push(role, html) {
      history.push({ role, html });
    }

    function paint(footerOverride) {
      const body = history.map((h) => bubble(h.role, h.html)).join('');
      let footer = footerOverride || '';

      if (!footerOverride) {
        if (step === 'hello') {
          footer = `
          <form id="counselorHello" class="chat-compose">
            <input id="counselorMsg" placeholder="Écrivez votre message…" required autocomplete="off" ${busy ? 'disabled' : ''} />
            <button type="submit" class="btn sm" ${busy ? 'disabled' : ''}>Envoyer</button>
          </form>`;
        } else if (step === 'reason') {
          footer = `<div class="chat-quick">${REASONS.map(
            (r) => `<button type="button" class="chat-chip" data-reason="${r.id}" ${busy ? 'disabled' : ''}>${r.label}</button>`
          ).join('')}</div>`;
        } else if (step === 'retain') {
          footer = `
          <div class="chat-quick">
            <button type="button" class="chat-chip" id="keepAbo" ${busy ? 'disabled' : ''}>Je reste / autre chose</button>
            <button type="button" class="chat-chip danger" id="stillCancel" ${busy ? 'disabled' : ''}>Je veux quand même résilier</button>
          </div>`;
        } else if (step === 'confirm') {
          footer = `
          <div class="chat-quick">
            <button type="button" class="chat-chip" id="abortCancel" ${busy ? 'disabled' : ''}>Non, je reste</button>
            <button type="button" class="chat-chip danger" id="confirmCancel" ${busy ? 'disabled' : ''}>Oui, je confirme</button>
          </div>`;
        } else if (step === 'form') {
          footer = `
          <form id="cancelForm" class="chat-form form-grid">
            <div><label>Prénom *</label><input name="first_name" required /></div>
            <div><label>Nom *</label><input name="last_name" required /></div>
            <div><label>Naissance *</label><input name="birthdate" type="date" required min="1900-01-01" /></div>
            <div><label>Téléphone *</label><input name="phone" type="tel" required /></div>
            <div class="full"><label>Email *</label><input name="email" type="email" required /></div>
            <div class="full"><label>Adresse *</label><input name="address" required /></div>
            <div><label>Salle *</label>
              <select name="gym" required>
                <option value="minimes">Minimes</option>
                <option value="ramonville">Ramonville</option>
                <option value="portet">Portet</option>
                <option value="etats-unis">États-Unis</option>
                <option value="st-cyprien">St-Cyprien</option>
              </select>
            </div>
            <div><label>Date résiliation *</label><input name="cancel_date" type="date" required /></div>
            <input type="hidden" name="reason" value="${reasonId || 'other'}" />
            <div class="full"><button type="submit" class="btn block">Envoyer la demande</button></div>
          </form>
          <p class="form-msg" id="cancelMsg" hidden></p>`;
        }
      }

      root.innerHTML = `<div class="chat-thread">${body}</div>${footer}`;
      const thread = root.querySelector('.chat-thread');
      if (thread) thread.scrollTop = thread.scrollHeight;
      bind();
    }

    function replySoon(botHtml, nextStep, delayMs) {
      busy = true;
      push('typing', typingHtml());
      paint();
      const wait = delayMs != null ? delayMs : 700 + Math.min(1200, Math.floor(String(botHtml).length * 12));
      window.setTimeout(() => {
        history.pop();
        push('bot', botHtml);
        if (nextStep) step = nextStep;
        busy = false;
        paint();
      }, wait);
    }

    function bind() {
      if (step === 'hello') {
        const form = root.querySelector('#counselorHello');
        if (!form) return;
        form.onsubmit = (e) => {
          e.preventDefault();
          if (busy) return;
          const msg = root.querySelector('#counselorMsg').value.trim();
          if (!msg) return;
          push('user', msg);
          if (/résili|resili|annul/i.test(msg)) {
            replySoon(
              "C'est noté. Pouvez-vous choisir la raison de votre demande de résiliation ?",
              'reason'
            );
          } else {
            replySoon(
              'Je suis désolé, je traite uniquement les demandes de résiliation. Pour le reste : <a href="https://boxingcenter.fr" target="_blank" rel="noopener">boxingcenter.fr</a> ou le standard du club.',
              'done'
            );
          }
        };
      }

      if (step === 'reason') {
        root.querySelectorAll('[data-reason]').forEach((btn) => {
          btn.onclick = () => {
            if (busy) return;
            reasonId = btn.dataset.reason;
            push('user', btn.textContent);
            replySoon(REPLIES[reasonId] || REPLIES.other, 'retain');
          };
        });
      }

      if (step === 'retain') {
        const keep = root.querySelector('#keepAbo');
        const still = root.querySelector('#stillCancel');
        if (keep) {
          keep.onclick = () => {
            if (busy) return;
            push('user', 'Je reste');
            replySoon(
              'Parfait — ravis de vous garder. Votre manager de salle peut aussi ajuster votre formule.',
              'done'
            );
          };
        }
        if (still) {
          still.onclick = () => {
            if (busy) return;
            push('user', 'Je veux quand même résilier');
            replySoon(
              'En cas de résiliation, vous ne pourrez plus bénéficier de votre tarif promotionnel en cas de réinscription. Êtes-vous certain de vouloir résilier ?',
              'confirm'
            );
          };
        }
      }

      if (step === 'confirm') {
        const abort = root.querySelector('#abortCancel');
        const confirm = root.querySelector('#confirmCancel');
        if (abort) {
          abort.onclick = () => {
            if (busy) return;
            push('user', 'Non, je reste');
            replySoon('Très bien. Votre abonnement continue. À bientôt en salle !', 'done');
          };
        }
        if (confirm) {
          confirm.onclick = () => {
            if (busy) return;
            push('user', 'Oui, je confirme');
            replySoon(
              'Très bien. Je prends note. Merci de renseigner les informations ci-dessous pour traiter la résiliation dans Deciplus.',
              'form'
            );
          };
        }
      }

      if (step === 'form') {
        const form = root.querySelector('#cancelForm');
        if (!form) return;
        form.onsubmit = async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          if (typeof onReadyToCancel === 'function') {
            await onReadyToCancel(data, root.querySelector('#cancelMsg'));
          }
        };
      }
    }

    busy = true;
    push('typing', typingHtml());
    paint();
    window.setTimeout(() => {
      history.pop();
      push(
        'bot',
        'Bonjour, je suis David, conseiller virtuel de Boxing Center. En quoi puis-je vous aider ?'
      );
      busy = false;
      paint();
    }, 900);
  }

  return { render, REASONS };
})();
