(function () {
  const form = document.getElementById('coachingBookForm');
  const msg = document.getElementById('coachingBookMsg');
  const dateInput = document.getElementById('cb_date');
  const gymSelect = document.getElementById('cb_gym');
  const activitySelect = document.getElementById('cb_activity');
  const slotSelect = document.getElementById('cb_slot');
  if (!form) return;

  function setMsg(text, kind) {
    if (!msg) return;
    msg.hidden = !text;
    msg.textContent = text || '';
    msg.className = 'form-msg' + (kind ? ` ${kind}` : '');
  }

  function fillSelect(el, items, placeholder) {
    if (!el) return;
    el.innerHTML =
      `<option value="">${placeholder}</option>` +
      (items || [])
        .map((it) => `<option value="${it.id}">${it.label}</option>`)
        .join('');
  }

  async function loadOptions() {
    try {
      const res = await fetch('/api/coachings/options');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'options');
      if (dateInput && data.min_date) {
        dateInput.min = data.min_date;
        if (!dateInput.value || dateInput.value < data.min_date) dateInput.value = data.min_date;
      }
      fillSelect(gymSelect, data.gyms, 'Choisir une salle');
      fillSelect(activitySelect, data.activities, 'Choisir une activité');
      fillSelect(slotSelect, data.slots, 'Choisir un créneau');
    } catch {
      setMsg('Impossible de charger les options. Rechargez la page.', 'err');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const body = Object.fromEntries(new FormData(form).entries());
    setMsg('Envoi de votre demande…');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/coachings/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        setMsg((data.errors && data.errors.join(' · ')) || data.error || 'Demande refusée', 'err');
        if (btn) btn.disabled = false;
        return;
      }
      const salle = data.manager_label ? ` (${data.manager_label})` : '';
      setMsg(
        `Demande envoyée${salle}. Le responsable de salle va vous recontacter. Un e-mail de confirmation vous a été adressé.`,
        'ok'
      );
      form.reset();
      await loadOptions();
    } catch {
      setMsg('Erreur de connexion. Réessayez.', 'err');
    }
    if (btn) btn.disabled = false;
  });

  loadOptions();
})();
