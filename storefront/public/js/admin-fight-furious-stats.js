/* =====================================================================
   FIGHT & Furious dans les STATS de la boutique.

   /api/admin/stats renvoie une cle `fight_furious` (billetterie + jeu
   concours Moteka). Ce fichier n'ouvre pas admin.js : il observe la
   reponse de /api/admin/stats (un seul appel, celui des stats) et remplit
   le bloc #ffStatsWrap place sous les cartes de la vue Stats.
   Les listes detaillees sont sur /admin/fight-furious.
   ===================================================================== */
(function () {
  'use strict';

  const esc = (v) =>
    String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const eur = (c) =>
    (Number(c || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const jour = (iso) => {
    if (!iso) return '-';
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const kpi = (label, value, total) =>
    `<div class="stats-kpi${total ? ' stats-kpi--total' : ''}"><span class="stats-kpi-label">${esc(label)}</span><span class="stats-kpi-value">${esc(value)}</span></div>`;
  const encart = (texte) =>
    `<p class="admin-section-desc" style="margin:8px 0 0;padding:10px 12px;border:1px solid #fbbf24;background:#fffbeb;border-radius:10px">${esc(texte)}</p>`;

  function billetterie(b) {
    if (!b) return '';
    if (!b.ok) return `<h4 class="admin-catalog-block-title" style="font-size:15px;margin-top:16px">Billetterie</h4>${encart(b.error || 'Indisponible')}`;
    const m = b.methodes || {};
    const produits = (b.par_produit || [])
      .map((p) => `<tr><td style="font-weight:600">${esc(p.nom)}</td><td style="text-align:right">${p.billets}</td><td style="text-align:right">${p.commandes}</td><td style="text-align:right">${eur(p.ca_cents)}</td></tr>`)
      .join('');
    const jours = (b.ventes_par_jour || []).filter((j) => j.commandes > 0);
    const max = Math.max(1, ...(b.ventes_par_jour || []).map((j) => j.billets));
    const barres = (b.ventes_par_jour || [])
      .map((j) => `<div title="${esc(jour(j.jour))} : ${j.billets} billet(s), ${esc(eur(j.ca_cents))}" style="flex:1;min-width:6px;display:flex;flex-direction:column;justify-content:flex-end;height:64px"><div style="height:${Math.round((j.billets / max) * 100)}%;min-height:${j.billets ? 3 : 1}px;background:${j.billets ? 'var(--bc-red)' : 'var(--bc-border)'};border-radius:3px 3px 0 0"></div></div>`)
      .join('');
    return `
      <h4 class="admin-catalog-block-title" style="font-size:15px;margin-top:16px">Billetterie</h4>
      <div class="stats-kpi-grid">
        ${kpi('CA billetterie', eur(b.ca_cents), true)}
        ${kpi('Billets payes', b.billets_payes)}
        ${kpi('Commandes payees', b.commandes_payees)}
        ${kpi('PayPal', `${m.paypal?.commandes || 0} · ${eur(m.paypal?.ca_cents)}`)}
        ${kpi('PayPlug', `${m.payplug?.commandes || 0} · ${eur(m.payplug?.ca_cents)}`)}
        ${kpi('Commandes en attente', b.en_attente)}
      </div>
      <div style="overflow-x:auto;margin-top:12px">
        <table class="admin-table">
          <thead><tr><th>Billet</th><th style="text-align:right">Billets</th><th style="text-align:right">Commandes</th><th style="text-align:right">CA</th></tr></thead>
          <tbody>${produits}</tbody>
        </table>
      </div>
      <p class="admin-section-desc" style="margin:12px 0 4px">Billets vendus par jour (14 derniers jours) : ${jours.length ? `${jours.reduce((n, j) => n + j.billets, 0)} billet(s)` : 'aucune vente'}</p>
      <div style="display:flex;gap:3px;align-items:flex-end" aria-hidden="true">${barres}</div>`;
  }

  function concours(c, liens) {
    if (!c) return '';
    if (!c.ok) return `<h4 class="admin-catalog-block-title" style="font-size:15px;margin-top:20px">Jeu concours Moteka</h4>${encart(c.error || 'Indisponible')}`;
    const a = c.avis || {};
    return `
      <h4 class="admin-catalog-block-title" style="font-size:15px;margin-top:20px">Jeu concours Moteka</h4>
      <div class="stats-kpi-grid">
        ${kpi('Inscrits', c.inscrits, true)}
        ${kpi('Tickets', c.tickets)}
        ${kpi('Inscrits avec amis', c.avec_amis)}
        ${kpi('Amis invites', c.amis_invites)}
        ${kpi('Avis a verifier', a.a_verifier || 0)}
        ${kpi('Avis valides', a.valide || 0)}
        ${kpi('Avis refuses', a.refuse || 0)}
        ${kpi('Gagnants', c.gagnants)}
      </div>
      ${a.a_verifier ? `<p class="admin-section-desc" style="margin-top:8px">${a.a_verifier} avis a verifier : <a href="${esc(liens?.admin)}" target="_blank" rel="noopener noreferrer" style="color:var(--bc-cta)">ouvrir le back-office Moteka</a></p>` : ''}`;
  }

  function tirages(t, liens) {
    if (!t || !t.ok) return '';
    const lignes = (t.liste || [])
      .map((x) => `<tr><td>${esc(jour(x.date_tirage))}</td><td style="text-align:right">${x.numero == null ? '-' : esc(x.numero)}</td><td>${x.a_venir ? '<span style="color:var(--bc-muted)">A venir</span>' : esc(x.gagnant || '-')}</td><td>${esc(x.lot || '-')}</td></tr>`)
      .join('');
    return `
      <h4 class="admin-catalog-block-title" style="font-size:15px;margin-top:20px">Tirages (${t.faits || 0} / 5)</h4>
      <div style="overflow-x:auto;margin-top:8px">
        <table class="admin-table">
          <thead><tr><th>Date</th><th style="text-align:right">Numero</th><th>Gagnant</th><th>Lot</th></tr></thead>
          <tbody>${lignes}</tbody>
        </table>
      </div>
      <p class="admin-section-desc" style="margin-top:8px"><a href="${esc(liens?.tirage)}" target="_blank" rel="noopener noreferrer" style="color:var(--bc-cta)">Page de tirage Moteka</a></p>`;
  }

  function rendre(ff) {
    const wrap = document.getElementById('ffStatsWrap');
    if (!wrap) return;
    wrap.hidden = false;
    const page = (ff && ff.page) || '/admin/fight-furious';
    const tete = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <h3 class="admin-catalog-block-title" style="margin:0 0 4px">FIGHT &amp; Furious</h3>
          <p class="admin-section-desc" style="margin:0">Boxing Center x garage Moteka, gala du 11 au 13 decembre 2026. Chiffres cumules depuis l'ouverture (hors filtre de periode).</p>
        </div>
        <a class="btn sm secondary" href="${esc(page)}">Detail, listes et exports</a>
      </div>`;
    if (!ff) {
      wrap.innerHTML = tete + encart('Donnees FIGHT & Furious indisponibles.');
      return;
    }
    if (!ff.ok && !ff.billetterie && !ff.concours) {
      wrap.innerHTML = tete + encart(ff.error || 'Donnees FIGHT & Furious indisponibles.');
      return;
    }
    wrap.innerHTML = tete + billetterie(ff.billetterie) + concours(ff.concours, ff.liens) + tirages(ff.tirages, ff.liens);
  }

  window.BCFightFuriousStats = { rendre };

  /* Observe la reponse de /api/admin/stats sans la consommer (clone). */
  const fetchOrigine = window.fetch && window.fetch.bind(window);
  if (!fetchOrigine) return;
  window.fetch = function (input, init) {
    const p = fetchOrigine(input, init);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/\/api\/admin\/stats(\?|$)/.test(url)) {
        p.then((res) => {
          if (!res || !res.ok) return;
          res.clone().json().then((data) => {
            if (data && data.ok) rendre(data.fight_furious || null);
          }).catch(() => {});
        }).catch(() => {});
      }
    } catch {
      /* jamais bloquant */
    }
    return p;
  };
})();
