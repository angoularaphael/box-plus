/**
 * Conseiller virtuel David — FSM de rétention (transcript coach).
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
    time: "Avez-vous pu consulter les plannings de nos cinq salles ? Savez-vous que votre abonnement vous permet d'accéder à nos salles en accès libre de 10h à 21h, 6 jours sur 7 ? D'autres créneaux ou une autre salle pourraient mieux vous convenir.",
    move: "Savez-vous que votre abonnement vous donne accès à nos 5 centres Boxing Center ? Votre nouveau domicile ne se situe-t-il pas à proximité de l'un d'entre eux ?",
    medical:
      "En cas de blessure, vous pouvez suspendre votre abonnement pour la durée de votre choix sans frais supplémentaires et conserver ainsi vos conditions tarifaires préférentielles à votre reprise.",
    club: "Vous avez accès aux 5 salles Boxing Center, à toutes les disciplines, et à des associations partenaires (Nobles Arts Portésiens, Toulouse Mini Boxing Club) chez qui vous pourrez peut-être trouver une activité qui vous correspond mieux.",
    money:
      "J'ai bien compris que le prix est un frein. Exceptionnellement, je peux vous proposer de revenir sur une offre promotionnelle à 29 € — souhaitez-vous en parler avec votre manager de salle avant de résilier ?",
    other: 'Pouvez-vous me préciser la raison ?',
  };

  function render(root, onReadyToCancel) {
    let step = 'hello';
    let reasonId = null;

    function paint() {
      if (step === 'hello') {
        root.innerHTML = `
          <div class="counselor-bubble">Bonjour, je suis David, conseiller virtuel de Boxing Center. En quoi puis-je vous aider ?</div>
          <form id="counselorHello" class="form-grid" style="margin-top:12px">
            <div class="full"><input id="counselorMsg" placeholder="Ex. Je souhaite résilier mon abonnement" required /></div>
            <div class="full"><button type="submit" class="btn">Envoyer</button></div>
          </form>`;
        root.querySelector('#counselorHello').onsubmit = (e) => {
          e.preventDefault();
          const msg = root.querySelector('#counselorMsg').value || '';
          if (/résili|resili|annul/i.test(msg)) {
            step = 'reason';
            paint();
          } else {
            step = 'redirect';
            paint();
          }
        };
        return;
      }

      if (step === 'redirect') {
        root.innerHTML = `
          <div class="counselor-bubble">Je suis désolé, mais ma fonction est uniquement liée aux demandes de résiliation d'abonnement.
          Pour le reste, retrouvez toutes les infos sur <a href="https://boxingcenter.fr" target="_blank" rel="noopener">boxingcenter.fr</a>
          ou contactez le standard.</div>`;
        return;
      }

      if (step === 'reason') {
        root.innerHTML = `
          <div class="counselor-bubble">C'est noté. Pouvez-vous choisir parmi les choix ci-dessous la raison de votre demande de résiliation ?</div>
          <div class="counselor-reasons" id="reasonList"></div>`;
        const list = root.querySelector('#reasonList');
        REASONS.forEach((r) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn secondary block';
          btn.style.marginTop = '8px';
          btn.textContent = r.label;
          btn.onclick = () => {
            reasonId = r.id;
            step = 'retain';
            paint();
          };
          list.appendChild(btn);
        });
        return;
      }

      if (step === 'retain') {
        root.innerHTML = `
          <div class="counselor-bubble">${REPLIES[reasonId] || REPLIES.other}</div>
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
            <button type="button" class="btn secondary" id="keepAbo">Je reste / je souhaite autre chose</button>
            <button type="button" class="btn" id="stillCancel">Merci mais je veux quand même résilier</button>
          </div>`;
        root.querySelector('#keepAbo').onclick = () => {
          root.innerHTML = `<div class="counselor-bubble">Parfait — on est ravis de vous garder. N'hésitez pas à voir votre manager de salle pour ajuster votre formule.</div>`;
        };
        root.querySelector('#stillCancel').onclick = () => {
          step = 'confirm';
          paint();
        };
        return;
      }

      if (step === 'confirm') {
        root.innerHTML = `
          <div class="counselor-bubble">
            En cas de résiliation, vous ne pourrez plus bénéficier de votre tarif promotionnel en cas de réinscription.
            Êtes-vous certain de vouloir résilier votre abonnement ?
          </div>
          <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
            <button type="button" class="btn secondary" id="abortCancel">Non, je reste</button>
            <button type="button" class="btn" id="confirmCancel">Oui, je confirme la résiliation</button>
          </div>`;
        root.querySelector('#abortCancel').onclick = () => {
          root.innerHTML = `<div class="counselor-bubble">Très bien. Votre abonnement continue. À bientôt en salle !</div>`;
        };
        root.querySelector('#confirmCancel').onclick = () => {
          step = 'form';
          paint();
        };
        return;
      }

      if (step === 'form') {
        root.innerHTML = `
          <div class="counselor-bubble">Très bien. Je prends note de votre demande. Merci de renseigner les informations suivantes.</div>
          <form id="cancelForm" class="form-grid" style="margin-top:12px">
            <div><label>Prénom *</label><input name="first_name" required /></div>
            <div><label>Nom *</label><input name="last_name" required /></div>
            <div><label>Date de naissance *</label><input name="birthdate" type="date" required min="1900-01-01" /></div>
            <div><label>Téléphone *</label><input name="phone" type="tel" required /></div>
            <div class="full"><label>Email *</label><input name="email" type="email" required /></div>
            <div class="full"><label>Adresse postale *</label><input name="address" required /></div>
            <div><label>Salle principale *</label>
              <select name="gym" required>
                <option value="minimes">Minimes</option>
                <option value="ramonville">Ramonville</option>
                <option value="portet">Portet</option>
                <option value="etats-unis">États-Unis</option>
                <option value="st-cyprien">St-Cyprien</option>
              </select>
            </div>
            <div><label>Date de résiliation souhaitée *</label><input name="cancel_date" type="date" required /></div>
            <input type="hidden" name="reason" value="${reasonId || 'other'}" />
            <div class="full"><button type="submit" class="btn block">Envoyer la demande de résiliation</button></div>
          </form>
          <p class="form-msg" id="cancelMsg" hidden></p>`;
        root.querySelector('#cancelForm').onsubmit = async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          if (typeof onReadyToCancel === 'function') {
            await onReadyToCancel(data, root.querySelector('#cancelMsg'));
          }
        };
      }
    }

    paint();
  }

  return { render, REASONS };
})();
