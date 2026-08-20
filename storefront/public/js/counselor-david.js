/**
 * Conseiller virtuel David — chat messagerie (rétention + IA Groq).
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

  const GYM_PAGES = {
    minimes: {
      label: 'Minimes',
      manager: 'Medhi',
      url: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-minimes/',
    },
    ramonville: {
      label: 'Ramonville',
      manager: 'Pascal',
      url: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-toulouse-ramonville/',
    },
    portet: {
      label: 'Portet',
      manager: 'Valentin',
      url: 'https://boxingcenter.fr/salle-de-sport-toulouse/salle-de-boxe-portet-sur-garonne-2/',
    },
    'etats-unis': {
      label: 'États-Unis',
      manager: 'Sébastien',
      url: 'https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-etats-unis/',
    },
    'st-cyprien': {
      label: 'St-Cyprien',
      manager: 'Daddy',
      url: 'https://boxingcenter.fr/salle-de-sport-toulouse/boxing-center-salle-de-toulouse-saint-cyprien/',
    },
  };

  const CLUB_STANDARD = {
    display: '09 39 03 67 48',
    tel: '+33939036748',
  };

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

  function render(root, onReadyToCancel) {
    let step = 'hello';
    let reasonId = null;
    let reasonLabel = null;
    let freeText = '';
    let busy = false;
    const history = [];

    function push(role, html) {
      history.push({ role, html });
    }

    function paint() {
      const body = history.map((h) => bubble(h.role, h.html)).join('');
      let footer = '';

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
      } else if (step === 'detail') {
        footer = `
          <form id="counselorDetail" class="chat-compose chat-compose-col">
            <textarea id="counselorDetailMsg" rows="3" placeholder="Précisez votre situation…" required ${busy ? 'disabled' : ''}></textarea>
            <button type="submit" class="btn sm" ${busy ? 'disabled' : ''}>Envoyer</button>
          </form>`;
      } else if (step === 'retain') {
        footer = `
          <form id="counselorMore" class="chat-compose">
            <input id="counselorMoreMsg" placeholder="Répondre à David…" autocomplete="off" ${busy ? 'disabled' : ''} />
            <button type="submit" class="btn sm" ${busy ? 'disabled' : ''}>Envoyer</button>
          </form>
          <div class="chat-quick">
            <button type="button" class="chat-chip" id="keepAbo" ${busy ? 'disabled' : ''}>Je reste — merci pour les infos</button>
            <button type="button" class="chat-chip" id="contactManager" ${busy ? 'disabled' : ''}>Contacter mon manager</button>
            <button type="button" class="chat-chip danger" id="stillCancel" ${busy ? 'disabled' : ''}>Continuer vers la résiliation</button>
          </div>`;
      } else if (step === 'formula') {
        footer = `
          <div class="chat-quick">
            <p class="chat-choice-title">Votre formule actuelle :</p>
            <button type="button" class="chat-chip" data-formula="prelevement" ${busy ? 'disabled' : ''}>Prélèvement (sans engagement)</button>
            <button type="button" class="chat-chip" data-formula="comptant" ${busy ? 'disabled' : ''}>Comptant / forfait (1× ou 4×)</button>
          </div>`;
      } else if (step === 'manager' || step === 'gym_redirect') {
        footer = `
          <div class="chat-quick">
            <p class="chat-choice-title">Choisissez votre salle :</p>
            ${Object.entries(GYM_PAGES)
              .map(
                ([id, g]) =>
                  `<button type="button" class="chat-chip" data-manager-gym="${id}">${g.label}</button>`
              )
              .join('')}
          </div>`;
      } else if (step === 'confirm') {
        footer = `
          <div class="chat-quick">
            <button type="button" class="chat-chip" id="abortCancel" ${busy ? 'disabled' : ''}>Non, je reste</button>
            <button type="button" class="chat-chip danger" id="confirmCancel" ${busy ? 'disabled' : ''}>Oui, je confirme</button>
          </div>`;
      } else if (step === 'form') {
        footer = `
          <p class="chat-form-hint">Les informations doivent être <strong>identiques à celles de votre inscription</strong> : nom, prénom, date de naissance et téléphone (majuscules / minuscules indifférentes). On vérifie ta fiche sur les <strong>5 salles Boxing Center</strong> (Minimes, Ramonville, États-Unis, Saint-Cyprien, Portet) — <strong>pas Balma</strong>.</p>
          <form id="cancelForm" class="chat-form form-grid">
            <div><label>Prénom *</label><input name="first_name" required /></div>
            <div><label>Nom *</label><input name="last_name" required /></div>
            <div><label>Naissance *</label><input name="birthdate" type="date" required min="1900-01-01" /></div>
            <div><label>Téléphone *</label><input name="phone" type="tel" required /></div>
            <div class="full"><label>Email (pour recevoir la confirmation)</label><input name="email" type="email" /></div>
            <div class="full"><label>Salle *</label>
              <select name="gym" required>
                <option value="minimes">Minimes</option>
                <option value="ramonville">Ramonville</option>
                <option value="portet">Portet</option>
                <option value="etats-unis">États-Unis</option>
                <option value="st-cyprien">St-Cyprien</option>
              </select>
            </div>
            <input type="hidden" name="reason" value="${reasonId || 'other'}" />
            <input type="hidden" name="reason_detail" value="${esc(freeText).replace(/"/g, '&quot;')}" />
            <div class="full"><button type="submit" class="btn block">Envoyer la demande</button></div>
          </form>
          <p class="form-msg" id="cancelMsg" hidden></p>`;
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
      const wait = delayMs != null ? delayMs : 650 + Math.min(1100, Math.floor(String(botHtml).length * 10));
      window.setTimeout(() => {
        history.pop();
        push('bot', botHtml);
        if (nextStep) step = nextStep;
        busy = false;
        paint();
      }, wait);
    }

    async function askAiGuide() {
      busy = true;
      push('typing', typingHtml());
      paint();
      let reply =
        'Merci pour ces précisions. Avant de décider, un échange avec votre manager de salle peut souvent aider. Que souhaitez-vous faire ?';
      try {
        const messages = history
          .filter((h) => h.role === 'user' || h.role === 'bot')
          .map((h) => ({
            role: h.role === 'bot' ? 'assistant' : 'user',
            content: String(h.html || '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim(),
          }))
          .filter((m) => m.content);
        const res = await fetch('/api/membership/counsel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason_id: reasonId,
            reason_label: reasonLabel,
            free_text: freeText,
            messages,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok && data.reply) reply = data.reply;
      } catch {
        /* fallback ci-dessus */
      }
      history.pop();
      push('bot', reply);
      step = 'retain';
      busy = false;
      paint();
    }

    async function showManagerContact(gym, label) {
      const gymInfo = GYM_PAGES[gym] || {};
      const manager = gymInfo.manager || 'votre manager';
      const url = gymInfo.url || '';
      busy = true;
      push('typing', typingHtml());
      paint();
      history.pop();
      push(
        'bot',
        url
          ? `Pour un échange en présentiel, adressez-vous à <strong>${esc(manager)}</strong> (salle ${esc(label)}). Voici la page de votre salle : <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`
          : `Pour un échange en présentiel, adressez-vous à <strong>${esc(manager)}</strong> à la salle ${esc(label)}.`
      );
      step = 'done';
      busy = false;
      paint();
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
          push('user', esc(msg));
          if (/résili|resili|annul|arrêter|arreter|quitter|partir/i.test(msg)) {
            replySoon(
              "C'est noté. Pouvez-vous choisir la raison de votre demande de résiliation ?",
              'reason'
            );
          } else {
            reasonId = 'other';
            reasonLabel = 'Autre';
            freeText = msg;
            askAiGuide();
          }
        };
      }

      if (step === 'reason') {
        root.querySelectorAll('[data-reason]').forEach((btn) => {
          btn.onclick = () => {
            if (busy) return;
            reasonId = btn.dataset.reason;
            reasonLabel = btn.textContent;
            push('user', esc(btn.textContent));
            replySoon(
              'Pouvez-vous préciser votre situation en quelques mots ? Cela m’aide à vous orienter au mieux.',
              'detail',
              700
            );
          };
        });
      }

      if (step === 'detail') {
        const form = root.querySelector('#counselorDetail');
        if (!form) return;
        form.onsubmit = (e) => {
          e.preventDefault();
          if (busy) return;
          const msg = root.querySelector('#counselorDetailMsg').value.trim();
          if (!msg) return;
          freeText = msg;
          push('user', esc(msg));
          askAiGuide();
        };
      }

      if (step === 'retain') {
        const more = root.querySelector('#counselorMore');
        if (more) {
          more.onsubmit = (e) => {
            e.preventDefault();
            if (busy) return;
            const msg = root.querySelector('#counselorMoreMsg').value.trim();
            if (!msg) return;
            freeText = `${freeText}\n${msg}`.trim();
            push('user', esc(msg));
            askAiGuide();
          };
        }
        const keep = root.querySelector('#keepAbo');
        const manager = root.querySelector('#contactManager');
        const still = root.querySelector('#stillCancel');
        if (manager) {
          manager.onclick = () => {
            if (busy) return;
            push('user', 'Contacter mon manager');
            replySoon('Choisissez votre salle pour obtenir le bon contact.', 'manager', 450);
          };
        }
        if (keep) {
          keep.onclick = () => {
            if (busy) return;
            push('user', 'Je reste — merci pour les infos');
            replySoon(
              'Super, content de vous garder avec nous ! Si besoin, votre manager de salle pourra aussi ajuster créneaux ou formule. À bientôt sur le ring.',
              'done'
            );
          };
        }
        if (still) {
          still.onclick = () => {
            if (busy) return;
            push('user', 'Continuer vers la résiliation');
            replySoon(
              'Je ne traite que les abonnements <strong>par prélèvement</strong> (sans engagement). Les formules <strong>comptant</strong> (forfait 1× / 4×, année 259&nbsp;€, etc.) ne peuvent pas être résiliées ici — contactez votre manager en salle. Quelle est votre formule ?',
              'formula'
            );
          };
        }
      }

      if (step === 'formula') {
        root.querySelectorAll('[data-formula]').forEach((btn) => {
          btn.onclick = () => {
            if (busy) return;
            const formula = btn.dataset.formula;
            push('user', btn.textContent.trim());
            if (formula === 'comptant') {
              replySoon(
                'Merci. Les formules comptant ne passent pas par ce tunnel. Choisissez votre salle pour voir le manager à contacter en présentiel.',
                'manager'
              );
              return;
            }
            replySoon(
              'En cas de résiliation d’un prélèvement, vous ne pourrez plus bénéficier de votre tarif promotionnel en cas de réinscription. Votre demande doit être enregistrée <strong>plus de 72&nbsp;heures avant votre prochain prélèvement</strong> pour éviter cette échéance ; la résiliation prend effet à la fin de la période déjà payée. Êtes-vous certain de vouloir résilier ?',
              'confirm'
            );
          };
        });
      }

      if (step === 'manager' || step === 'gym_redirect') {
        root.querySelectorAll('[data-manager-gym]').forEach((btn) => {
          btn.onclick = () => {
            if (busy) return;
            const gymId = btn.dataset.managerGym;
            const gym = GYM_PAGES[gymId];
            const label = (gym && gym.label) || btn.textContent.trim();
            push('user', label);
            showManagerContact(gymId, label);
          };
        });
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
              'Très bien. Merci de renseigner les informations ci-dessous — le <strong>nom</strong>, le <strong>prénom</strong>, le <strong>téléphone</strong> et la <strong>date de naissance</strong> doivent correspondre à votre fiche adhérent (majuscules / minuscules indifférentes).',
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
        'Je suis David, conseiller virtuel de Boxing Center. Je peux vous accompagner pour résilier un abonnement <strong>par prélèvement</strong> (sans engagement).'
      );
      busy = false;
      paint();
    }, 900);
  }

  return { render, REASONS };
})();
