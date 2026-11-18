/* Back-office FIGHT & Furious : billetterie, jeu concours Moteka, tirages (lecture). */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (v) =>
    String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const eur = (c) => (Number(c || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const dateHeure = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? esc(iso)
      : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  };
  const jour = (iso) => {
    if (!iso) return '-';
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const moyen = (m) => (m === 'paypal' ? 'PayPal' : m === 'payplug' ? 'PayPlug' : esc(m || '-'));
  const kpi = (label, valeur, sous, mod) =>
    `<div class="pan-kpi${mod ? ` pan-kpi--${mod}` : ''}"><span class="pan-kpi__l">${esc(label)}</span><span class="pan-kpi__v">${esc(valeur)}</span>${sous ? `<span class="pan-kpi__s">${esc(sous)}</span>` : ''}</div>`;
  const toast = (t, type) => (typeof window.panToast === 'function' ? window.panToast(t, type) : alert(t));

  function message(zone, err) {
    const el = $(zone);
    if (!el) return;
    if (!err) {
      el.innerHTML = '';
      return;
    }
    const manquantes = err.tables_manquantes;
    el.innerHTML = `<p class="ff-msg ${manquantes ? 'ff-msg--warn' : 'ff-msg--err'}">${esc(
      manquantes ? 'Tables a creer : executer les SQL (Supabase, meme projet que la boutique).' : `Chargement impossible : ${err.error || 'erreur'}`
    )}</p>`;
  }

  async function api(url, opts) {
    const res = await fetch(url, { credentials: 'include', ...(opts || {}) });
    if (res.status === 401) {
      location.replace('/admin/login?next=/admin/fight-furious');
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const e = new Error(data.error || `Erreur ${res.status}`);
      e.data = data;
      throw e;
    }
    return data;
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }

  /* ---------- Billetterie ---------- */

  let commandes = [];

  function filtreBillets() {
    const q = ($('#bilQ').value || '').trim().toLowerCase();
    const liste = q
      ? commandes.filter((c) => [c.prenom, c.nom, c.email, c.order_id, c.produit_nom, ...(c.codes || [])].some((v) => String(v || '').toLowerCase().includes(q)))
      : commandes;
    $('#bilCsv').href = `/api/admin/fight-furious/billetterie/export.csv${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    $('#bilCompte').textContent = `${liste.length} commande(s) payee(s)${q ? ` sur ${commandes.length}` : ''}`;
    $('#bilBody').innerHTML = liste.length
      ? liste
          .map(
            (c) => `<tr>
          <td>${dateHeure(c.date)}</td>
          <td style="font-weight:600">${esc(`${c.prenom} ${c.nom}`.trim() || '-')}</td>
          <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '-'}</td>
          <td>${esc(c.produit_nom)}</td>
          <td style="text-align:right">${c.quantite}</td>
          <td style="text-align:right">${eur(c.total_cents)}</td>
          <td>${moyen(c.methode)}</td>
          <td class="ff-codes">${(c.codes || []).map(esc).join('<br />') || '-'}</td>
          <td><div class="ff-actions">
            ${c.lien ? `<a class="btn sm secondary" href="${esc(c.lien)}" target="_blank" rel="noopener noreferrer">Ouvrir</a><button type="button" class="btn sm secondary" data-copier="${esc(c.lien)}">Copier le lien</button>` : ''}
            <button type="button" class="btn sm" data-renvoyer="${esc(c.order_id)}" data-email="${esc(c.email)}">Renvoyer le billet par mail</button>
          </div>${c.renvoye_at ? `<span class="pan-kpi__s">Renvoye le ${dateHeure(c.renvoye_at)}</span>` : ''}</td>
        </tr>`
          )
          .join('')
      : `<tr><td colspan="9" class="ff-vide">${q ? 'Aucune commande ne correspond.' : 'Aucune commande payee pour le moment.'}</td></tr>`;
  }

  async function chargerBilletterie() {
    message('#bilMsg', null);
    try {
      const d = await api('/api/admin/fight-furious/billetterie');
      const s = d.stats;
      const m = s.methodes || {};
      $('#bilKpis').innerHTML =
        kpi('CA billetterie', eur(s.ca_cents), `${s.commandes_payees} commande(s) payee(s)`) +
        kpi('Billets payes', s.billets_payes) +
        (s.par_produit || []).map((p) => kpi(p.nom, p.billets, `${p.commandes} commande(s) - ${eur(p.ca_cents)}`)).join('') +
        kpi('PayPal', m.paypal?.commandes || 0, eur(m.paypal?.ca_cents)) +
        kpi('PayPlug', m.payplug?.commandes || 0, eur(m.payplug?.ca_cents)) +
        kpi('En attente', s.en_attente, 'Paiements non confirmes', s.en_attente ? 'alerte' : '');
      $('#bilProduits').innerHTML = (s.par_produit || [])
        .map((p) => `<tr><td style="font-weight:600">${esc(p.nom)}</td><td style="text-align:right">${p.billets}</td><td style="text-align:right">${p.commandes}</td><td style="text-align:right">${eur(p.ca_cents)}</td></tr>`)
        .join('');
      commandes = d.commandes || [];
      filtreBillets();
      const att = d.en_attente || [];
      $('#bilAttenteBloc').hidden = !att.length;
      $('#bilAttente').innerHTML = att
        .map(
          (c) => `<tr><td>${dateHeure(c.created_at)}</td><td>${esc(`${c.prenom} ${c.nom}`.trim())}</td><td>${esc(c.email)}</td><td>${esc(c.produit_nom)}</td><td style="text-align:right">${c.quantite}</td><td style="text-align:right">${eur(c.total_cents)}</td><td>${moyen(c.methode)}</td></tr>`
        )
        .join('');
    } catch (err) {
      if (err.message === 'unauthorized') return;
      message('#bilMsg', err.data || { error: err.message });
      $('#bilKpis').innerHTML = '';
      $('#bilProduits').innerHTML = '';
      $('#bilBody').innerHTML = '<tr><td colspan="9" class="ff-vide">Aucune donnee.</td></tr>';
      $('#bilCompte').textContent = '';
    }
  }

  async function renvoyer(btn) {
    const id = btn.dataset.renvoyer;
    if (!confirm(`Renvoyer le billet par mail a ${btn.dataset.email || 'ce client'} ?`)) return;
    btn.disabled = true;
    try {
      const d = await api(`/api/admin/fight-furious/billetterie/${encodeURIComponent(id)}/renvoyer`, { method: 'POST' });
      toast(`Billet renvoye a ${d.email || 'client'}`, 'ok');
      const c = commandes.find((x) => x.order_id === id);
      if (c) c.renvoye_at = d.renvoye_at;
      filtreBillets();
    } catch (err) {
      toast(`Envoi impossible : ${err.message}`, 'err');
      btn.disabled = false;
    }
  }

  /* ---------- Jeu concours ---------- */

  let participants = [];
  const AVIS = {
    aucun: ['Pas d\'avis', ''],
    a_verifier: ['A verifier', 'warn'],
    valide: ['Valide', 'ok'],
    refuse: ['Refuse', 'ko'],
  };
  const MOTIF = { inscription: 'inscription', amis: 'amis', avis: 'avis' };

  function filtreConcours() {
    const q = ($('#conQ').value || '').trim().toLowerCase();
    const liste = q
      ? participants.filter((p) =>
          [p.prenom, p.nom, p.email, p.telephone, ...(p.tickets || []).map((t) => t.numero)].some((v) => String(v || '').toLowerCase().includes(q))
        )
      : participants;
    $('#conCsv').href = `/api/admin/fight-furious/concours/export.csv${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    $('#conCompte').textContent = `${liste.length} participant(s)${q ? ` sur ${participants.length}` : ''}`;
    $('#conBody').innerHTML = liste.length
      ? liste
          .map((p) => {
            const [lib, mod] = AVIS[p.avis_statut] || AVIS.aucun;
            const tickets = (p.tickets || []).map((t) => `${t.numero} <span style="color:var(--bc-muted)">(${esc(MOTIF[t.motif] || t.motif)})</span>`).join('<br />');
            const amis = (p.amis || []).map((a) => esc([a.prenom, a.email, a.telephone].filter(Boolean).join(' - '))).join('<br />');
            const gains = (p.gains || []).map((g) => `<span class="ff-badge ff-badge--or">${esc(g.lot || 'Gagnant')}</span> <span class="pan-kpi__s">${esc(jour(g.date_tirage))}</span>`).join('');
            return `<tr>
          <td>${dateHeure(p.created_at)}</td>
          <td style="font-weight:600">${esc(`${p.prenom} ${p.nom}`.trim() || '-')}</td>
          <td>${p.telephone ? `<a href="tel:${esc(p.telephone)}">${esc(p.telephone)}</a>` : '-'}</td>
          <td>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '-'}</td>
          <td class="ff-codes">${tickets || (p.nb_tickets ? String(p.nb_tickets) : '-')}</td>
          <td class="ff-wrap">${amis || '-'}</td>
          <td><span class="ff-badge${mod ? ` ff-badge--${mod}` : ''}">${esc(lib)}</span>${
            p.avis_statut !== 'aucun' ? `<br /><button type="button" class="btn sm secondary" style="margin-top:6px" data-preuve="${esc(p.id)}" data-nom="${esc(`${p.prenom} ${p.nom}`)}">Voir la preuve</button>` : ''
          }</td>
          <td>${gains || '<span style="color:var(--bc-muted)">Non</span>'}</td>
        </tr>`;
          })
          .join('')
      : `<tr><td colspan="8" class="ff-vide">${q ? 'Aucun participant ne correspond.' : 'Aucun participant pour le moment.'}</td></tr>`;
  }

  async function chargerConcours() {
    message('#conMsg', null);
    try {
      const d = await api('/api/admin/fight-furious/concours');
      appliquerLiens(d.liens);
      const s = d.stats;
      const a = s.avis || {};
      $('#conKpis').innerHTML =
        kpi('Inscrits', s.inscrits) +
        kpi('Tickets', s.tickets) +
        kpi('Inscrits avec amis', s.avec_amis, `${s.amis_invites} ami(s) invite(s)`) +
        kpi('Avis a verifier', a.a_verifier || 0, 'Dans le back-office Moteka', a.a_verifier ? 'alerte' : '') +
        kpi('Avis valides', a.valide || 0, '', 'ok') +
        kpi('Avis refuses', a.refuse || 0) +
        kpi('Gagnants', s.gagnants);
      const info = $('#conAvisInfo');
      if (a.a_verifier) {
        info.style.display = '';
        info.innerHTML = `${a.a_verifier} avis a verifier. La validation se fait dans le <a href="${esc(d.liens?.admin)}" target="_blank" rel="noopener noreferrer">back-office Moteka</a>.`;
      } else {
        info.style.display = 'none';
      }
      participants = d.participants || [];
      filtreConcours();
    } catch (err) {
      if (err.message === 'unauthorized') return;
      message('#conMsg', err.data || { error: err.message });
      $('#conKpis').innerHTML = '';
      $('#conBody').innerHTML = '<tr><td colspan="8" class="ff-vide">Aucune donnee.</td></tr>';
      $('#conCompte').textContent = '';
    }
  }

  async function voirPreuve(btn) {
    const modal = $('#preuveModal');
    const corps = $('#preuveCorps');
    $('#preuveTitre').textContent = `Preuve de l'avis - ${btn.dataset.nom || ''}`.trim();
    corps.innerHTML = '<p class="ff-vide">Chargement...</p>';
    modal.hidden = false;
    $('#preuveFermer').focus();
    try {
      const d = await api(`/api/admin/fight-furious/concours/${encodeURIComponent(btn.dataset.preuve)}/preuve`);
      const [lib] = AVIS[d.avis_statut] || AVIS.aucun;
      corps.innerHTML = d.preuve
        ? `<p class="pan-kpi__s">Statut : ${esc(lib)}${d.avis_le ? ` - depose le ${dateHeure(d.avis_le)}` : ''}</p><img src="${esc(d.preuve)}" alt="Capture de l'avis depose" />`
        : '<p class="ff-vide">Aucune image de preuve pour ce participant.</p>';
    } catch (err) {
      corps.innerHTML = `<p class="ff-msg ff-msg--err">${esc(err.message)}</p>`;
    }
  }

  /* ---------- Tirages ---------- */

  async function chargerTirages() {
    message('#tirMsg', null);
    try {
      const d = await api('/api/admin/fight-furious/tirages');
      appliquerLiens(d.liens);
      $('#tirBody').innerHTML = (d.tirages || [])
        .map(
          (t) => `<tr>
        <td style="font-weight:600">${jour(t.date_tirage)}</td>
        <td style="text-align:right">${t.numero == null ? '-' : esc(t.numero)}</td>
        <td>${t.a_venir ? '<span class="ff-badge">A venir</span>' : esc(t.gagnant || '-')}</td>
        <td class="ff-wrap">${esc([t.telephone, t.email].filter(Boolean).join(' - ') || '-')}</td>
        <td>${esc(t.lot || '-')}</td>
      </tr>`
        )
        .join('');
      $('#lotsBody').innerHTML = (d.lots || []).length
        ? d.lots
            .map((l) => `<tr><td style="text-align:right">${esc(l.ordre ?? '-')}</td><td style="font-weight:600">${esc(l.nom)}</td><td class="ff-wrap">${esc(l.description || '-')}</td><td>${l.actif === false ? 'Non' : 'Oui'}</td></tr>`)
            .join('')
        : '<tr><td colspan="4" class="ff-vide">Aucun lot enregistre.</td></tr>';
    } catch (err) {
      if (err.message === 'unauthorized') return;
      message('#tirMsg', err.data || { error: err.message });
      $('#tirBody').innerHTML = '';
      $('#lotsBody').innerHTML = '';
    }
  }

  function appliquerLiens(liens) {
    if (!liens) return;
    if (liens.admin) $('#lienMoteka').href = liens.admin;
    if (liens.tirage) $('#lienTirage').href = liens.tirage;
  }

  /* ---------- Onglets et evenements ---------- */

  const chargeurs = { billetterie: chargerBilletterie, concours: chargerConcours, tirages: chargerTirages };
  const charges = {};

  function ouvrir(nom) {
    if (!chargeurs[nom]) nom = 'billetterie';
    $$('[data-onglet]').forEach((b) => {
      const on = b.dataset.onglet === nom;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $$('[data-section]').forEach((s) => (s.hidden = s.dataset.section !== nom));
    history.replaceState(null, '', `#${nom}`);
    if (!charges[nom]) {
      charges[nom] = true;
      chargeurs[nom]();
    }
  }

  function brancher() {
    $$('[data-onglet]').forEach((b) => (b.onclick = () => ouvrir(b.dataset.onglet)));
    $$('[data-recharger]').forEach((b) => (b.onclick = () => chargeurs[b.dataset.recharger]()));
    $('#bilQ').addEventListener('input', debounce(filtreBillets, 150));
    $('#conQ').addEventListener('input', debounce(filtreConcours, 150));
    document.addEventListener('click', (e) => {
      const r = e.target.closest('[data-renvoyer]');
      if (r) return renvoyer(r);
      const p = e.target.closest('[data-preuve]');
      if (p) return voirPreuve(p);
      const c = e.target.closest('[data-copier]');
      if (c) {
        const lien = c.dataset.copier;
        (navigator.clipboard ? navigator.clipboard.writeText(lien) : Promise.reject(new Error('x')))
          .then(() => toast('Lien du billet copie', 'ok'))
          .catch(() => prompt('Lien du billet', lien));
      }
    });
    const fermer = () => {
      $('#preuveModal').hidden = true;
      $('#preuveCorps').innerHTML = '';
    };
    $('#preuveFermer').onclick = fermer;
    $('#preuveModal').addEventListener('click', (e) => {
      if (e.target.id === 'preuveModal') fermer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#preuveModal').hidden) fermer();
    });
  }

  (async function init() {
    const me = await fetch('/api/auth/me', { credentials: 'include' }).catch(() => null);
    if (!me || !me.ok) {
      location.replace('/admin/login?next=/admin/fight-furious');
      return;
    }
    $('#ff').hidden = false;
    brancher();
    ouvrir(location.hash.slice(1));
  })();
})();
