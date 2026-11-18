'use strict';

/**
 * Back-office FIGHT & Furious (Boxing Center x garage Moteka, gala du 11 au 13 decembre 2026).
 * Suivi en lecture de la billetterie (boxplus_billets) et du jeu concours Moteka
 * (moteka_concours, moteka_tickets, moteka_lots, moteka_tirages), meme projet Supabase.
 *
 *   GET  /api/admin/fight-furious/billetterie
 *   GET  /api/admin/fight-furious/billetterie/export.csv
 *   POST /api/admin/fight-furious/billetterie/:id/renvoyer
 *   GET  /api/admin/fight-furious/concours
 *   GET  /api/admin/fight-furious/concours/export.csv
 *   GET  /api/admin/fight-furious/concours/:id/preuve
 *   GET  /api/admin/fight-furious/tirages
 *
 * La validation des avis et les tirages se font dans le back-office Moteka (MOTEKA_ADMIN_URL).
 * La colonne avis_preuve (image en data URL, lourde) n'est jamais lue dans les listes.
 */

const bil = require('./billetterie');

const TABLES_MANQUANTES = 'Tables a creer : executer les SQL';
const PRODUITS_ORDRE = ['vendredi', 'samedi', 'dimanche', 'weekend'];
const DATES_TIRAGE = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'];
const COLONNES_PARTICIPANT =
  'id, prenom, nom, telephone, email, amis, avis, avis_statut, avis_le, tickets, source, created_at';

function baseBillet() {
  return String(process.env.BILLETTERIE_PUBLIC_URL || 'https://boutique.boxingcenter.fr').trim().replace(/\/$/, '');
}

function motekaAdminUrl() {
  return String(process.env.MOTEKA_ADMIN_URL || 'https://fight-and-furious.boxingcenter.fr/admin').trim().replace(/\/$/, '');
}

function liensMoteka() {
  const admin = motekaAdminUrl();
  return { admin, tirage: `${admin}/tirage` };
}

/** Table absente : Postgres 42P01 ou PostgREST PGRST205 (table hors du cache de schema). */
function tableManquante(err) {
  if (!err) return false;
  const code = String(err.code || '');
  if (code === '42P01' || code === 'PGRST205') return true;
  const msg = String(err.message || err).toLowerCase();
  return /relation .* does not exist/.test(msg) || msg.includes('could not find the table') || msg.includes('schema cache');
}

/* ---------- Logique pure ---------- */

function nombre(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function payloadDe(row) {
  const p = row && typeof row.payload === 'object' && row.payload ? row.payload : {};
  return p;
}

/** Une commande billetterie a plat, depuis une ligne boxplus_billets. */
function ligneCommande(row, base = baseBillet()) {
  const p = payloadDe(row);
  const client = p.client || {};
  const produit = row.produit || p.produit || '';
  const methode = String(p.payment?.method || '').toLowerCase();
  const token = p.access_token || '';
  return {
    order_id: row.order_id || p.order_id || '',
    date: p.paid_at || row.updated_at || row.created_at || p.created_at || null,
    created_at: row.created_at || p.created_at || null,
    prenom: client.prenom || '',
    nom: client.nom || '',
    email: row.email || client.email || '',
    produit,
    produit_nom: p.produit_nom || bil.PRODUITS[produit]?.nom || produit,
    quantite: nombre(row.quantite ?? p.quantite),
    total_cents: nombre(row.total_cents ?? p.total_cents),
    methode,
    status: row.status || p.status || 'pending',
    codes: Array.isArray(p.billets) ? p.billets.map((b) => b.code).filter(Boolean) : [],
    emailed_at: p.emailed_at || null,
    renvoye_at: p.renvoye_at || null,
    lien: token && (row.order_id || p.order_id) ? bil.billetUrl(base, { order_id: row.order_id || p.order_id, access_token: token }) : null,
  };
}

function statsBillets(commandes) {
  const parProduit = {};
  for (const id of PRODUITS_ORDRE) {
    parProduit[id] = { id, nom: bil.PRODUITS[id]?.nom || id, billets: 0, commandes: 0, ca_cents: 0 };
  }
  const methodes = {
    paypal: { commandes: 0, ca_cents: 0 },
    payplug: { commandes: 0, ca_cents: 0 },
  };
  let commandesPayees = 0;
  let billets = 0;
  let ca = 0;
  let enAttente = 0;
  for (const c of commandes) {
    if (c.status !== 'paid') {
      if (c.status === 'pending') enAttente += 1;
      continue;
    }
    commandesPayees += 1;
    billets += c.quantite;
    ca += c.total_cents;
    if (!parProduit[c.produit]) {
      parProduit[c.produit] = { id: c.produit, nom: c.produit_nom || c.produit, billets: 0, commandes: 0, ca_cents: 0 };
    }
    parProduit[c.produit].billets += c.quantite;
    parProduit[c.produit].commandes += 1;
    parProduit[c.produit].ca_cents += c.total_cents;
    const m = methodes[c.methode] || (methodes[c.methode || 'autre'] = { commandes: 0, ca_cents: 0 });
    m.commandes += 1;
    m.ca_cents += c.total_cents;
  }
  return {
    commandes_payees: commandesPayees,
    billets_payes: billets,
    ca_cents: ca,
    en_attente: enAttente,
    par_produit: Object.values(parProduit),
    methodes,
  };
}

function trierRecent(liste, champ = 'date') {
  return liste.slice().sort((a, b) => String(b[champ] || '').localeCompare(String(a[champ] || '')));
}

function amisDe(p) {
  return Array.isArray(p?.amis) ? p.amis.filter((a) => a && (a.prenom || a.email || a.telephone)) : [];
}

function statutAvis(p) {
  const s = String(p?.avis_statut || '').toLowerCase();
  if (['a_verifier', 'valide', 'refuse'].includes(s)) return s;
  return 'aucun';
}

/** Participants enrichis : numeros de tickets (avec motif) et gains. */
function lignesParticipants(participants, tickets, tirages, lots) {
  const parParticipant = new Map();
  for (const t of tickets || []) {
    if (!t?.participant_id) continue;
    if (!parParticipant.has(t.participant_id)) parParticipant.set(t.participant_id, []);
    parParticipant.get(t.participant_id).push({ numero: nombre(t.numero), motif: t.motif || '' });
  }
  const lotParId = new Map((lots || []).map((l) => [l.id, l]));
  const gains = new Map();
  for (const t of tirages || []) {
    if (!t?.participant_id) continue;
    if (!gains.has(t.participant_id)) gains.set(t.participant_id, []);
    gains.get(t.participant_id).push({
      date_tirage: t.date_tirage || null,
      numero: nombre(t.numero),
      lot: lotParId.get(t.lot_id)?.nom || '',
    });
  }
  return (participants || []).map((p) => {
    const nums = (parParticipant.get(p.id) || []).sort((a, b) => a.numero - b.numero);
    return {
      id: p.id,
      prenom: p.prenom || '',
      nom: p.nom || '',
      telephone: p.telephone || '',
      email: p.email || '',
      amis: amisDe(p),
      avis_statut: statutAvis(p),
      avis_le: p.avis_le || null,
      tickets: nums,
      nb_tickets: nums.length || nombre(p.tickets),
      gains: gains.get(p.id) || [],
      source: p.source || '',
      created_at: p.created_at || null,
    };
  });
}

function statsConcours(lignes, tickets) {
  const avis = { aucun: 0, a_verifier: 0, valide: 0, refuse: 0 };
  let avecAmis = 0;
  let gagnants = 0;
  let ticketsParticipants = 0;
  for (const p of lignes) {
    avis[p.avis_statut] = (avis[p.avis_statut] || 0) + 1;
    if (p.amis.length) avecAmis += 1;
    if (p.gains.length) gagnants += 1;
    ticketsParticipants += p.nb_tickets;
  }
  const nbTickets = Array.isArray(tickets) && tickets.length ? tickets.length : ticketsParticipants;
  return {
    inscrits: lignes.length,
    tickets: nbTickets,
    avec_amis: avecAmis,
    amis_invites: lignes.reduce((n, p) => n + p.amis.length, 0),
    gagnants,
    avis,
  };
}

/** Planning des 6 tirages (23 au 28 novembre 2026), complete par l'historique reel. */
function planningTirages(tirages, lots, participants) {
  const lotParId = new Map((lots || []).map((l) => [l.id, l]));
  const partParId = new Map((participants || []).map((p) => [p.id, p]));
  const lignes = (tirages || []).map((t) => {
    const p = partParId.get(t.participant_id) || {};
    const l = lotParId.get(t.lot_id) || {};
    return {
      id: t.id,
      date_tirage: t.date_tirage || null,
      numero: t.numero == null ? null : nombre(t.numero),
      gagnant: [p.prenom, p.nom].filter(Boolean).join(' '),
      email: p.email || '',
      telephone: p.telephone || '',
      lot: l.nom || '',
      created_at: t.created_at || null,
      a_venir: false,
    };
  });
  const faites = new Set(lignes.map((l) => String(l.date_tirage || '').slice(0, 10)));
  for (const d of DATES_TIRAGE) {
    if (!faites.has(d)) {
      lignes.push({ id: null, date_tirage: d, numero: null, gagnant: '', email: '', telephone: '', lot: '', created_at: null, a_venir: true });
    }
  }
  return lignes.sort((a, b) => String(a.date_tirage || '').localeCompare(String(b.date_tirage || '')));
}

function filtrer(liste, q, champs) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return liste;
  return liste.filter((x) => champs(x).some((v) => String(v || '').toLowerCase().includes(s)));
}

/* ---------- CSV (separateur ; pour Excel FR, BOM UTF-8) ---------- */

function celluleCsv(v) {
  let s = v == null ? '' : String(v);
  // Pas de formule a l'ouverture dans un tableur.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function versCsv(colonnes, lignes) {
  const head = colonnes.map((c) => celluleCsv(c.titre)).join(';');
  const body = lignes.map((l) => colonnes.map((c) => celluleCsv(c.valeur(l))).join(';'));
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
}

function eurosCsv(cents) {
  return (nombre(cents) / 100).toFixed(2).replace('.', ',');
}

function dateCsv(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
}

const MOTIFS = { inscription: 'inscription', amis: 'amis', avis: 'avis' };

function csvBillets(commandes) {
  return versCsv(
    [
      { titre: 'Date', valeur: (c) => dateCsv(c.date) },
      { titre: 'Commande', valeur: (c) => c.order_id },
      { titre: 'Prenom', valeur: (c) => c.prenom },
      { titre: 'Nom', valeur: (c) => c.nom },
      { titre: 'Email', valeur: (c) => c.email },
      { titre: 'Produit', valeur: (c) => c.produit_nom },
      { titre: 'Quantite', valeur: (c) => c.quantite },
      { titre: 'Montant (EUR)', valeur: (c) => eurosCsv(c.total_cents) },
      { titre: 'Moyen', valeur: (c) => (c.methode === 'paypal' ? 'PayPal' : c.methode === 'payplug' ? 'PayPlug' : c.methode) },
      { titre: 'Codes billets', valeur: (c) => c.codes.join(' ') },
      { titre: 'Lien billet', valeur: (c) => c.lien || '' },
    ],
    commandes
  );
}

function csvParticipants(lignes) {
  return versCsv(
    [
      { titre: 'Inscrit le', valeur: (p) => dateCsv(p.created_at) },
      { titre: 'Prenom', valeur: (p) => p.prenom },
      { titre: 'Nom', valeur: (p) => p.nom },
      { titre: 'Telephone', valeur: (p) => p.telephone },
      { titre: 'Email', valeur: (p) => p.email },
      { titre: 'Nb tickets', valeur: (p) => p.nb_tickets },
      { titre: 'Tickets', valeur: (p) => p.tickets.map((t) => `${t.numero} (${MOTIFS[t.motif] || t.motif})`).join(', ') },
      {
        titre: 'Amis',
        valeur: (p) => p.amis.map((a) => [a.prenom, a.email, a.telephone].filter(Boolean).join(' ')).join(' | '),
      },
      { titre: 'Avis', valeur: (p) => p.avis_statut },
      { titre: 'Gagnant', valeur: (p) => (p.gains.length ? p.gains.map((g) => `${g.date_tirage} ${g.lot}`).join(' | ') : 'non') },
      { titre: 'Source', valeur: (p) => p.source },
    ],
    lignes
  );
}

/* ---------- Lecture Supabase ---------- */

function supabase() {
  return require('./supabase').getSupabase();
}

/** Lit toute une table par pages de 1000 (limite PostgREST). */
async function toutLire(table, colonnes, { ordre, asc = false } = {}) {
  const sb = supabase();
  const out = [];
  const page = 1000;
  for (let from = 0; from < 100000; from += page) {
    let q = sb.from(table).select(colonnes).range(from, from + page - 1);
    if (ordre) q = q.order(ordre, { ascending: asc });
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return out;
}

async function chargerCommandes() {
  const rows = await toutLire(bil.TABLE, 'order_id, payload, email, produit, status, quantite, total_cents, created_at, updated_at', {
    ordre: 'created_at',
  });
  return rows.map((r) => ligneCommande(r));
}

async function chargerConcours() {
  const [participants, tickets, lots, tirages] = await Promise.all([
    toutLire('moteka_concours', COLONNES_PARTICIPANT, { ordre: 'created_at' }),
    toutLire('moteka_tickets', 'numero, participant_id, motif, created_at', { ordre: 'numero', asc: true }),
    toutLire('moteka_lots', 'id, ordre, nom, description, actif', { ordre: 'ordre', asc: true }),
    toutLire('moteka_tirages', 'id, date_tirage, numero, participant_id, lot_id, created_at', { ordre: 'date_tirage', asc: true }),
  ]);
  return { participants, tickets, lots, tirages };
}

function jourParis(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
}

/** Ventes payees par jour (14 derniers jours, jours vides inclus). */
function ventesParJour(commandes, { jours = 14, maintenant = new Date() } = {}) {
  const cles = [];
  for (let i = jours - 1; i >= 0; i -= 1) {
    cles.push(jourParis(new Date(maintenant.getTime() - i * 86400000).toISOString()));
  }
  const map = new Map(cles.map((k) => [k, { jour: k, commandes: 0, billets: 0, ca_cents: 0 }]));
  for (const c of commandes) {
    if (c.status !== 'paid') continue;
    const row = map.get(jourParis(c.date));
    if (!row) continue;
    row.commandes += 1;
    row.billets += c.quantite;
    row.ca_cents += c.total_cents;
  }
  return [...map.values()];
}

/**
 * Bloc FIGHT & Furious de /api/admin/stats. Ne leve jamais : chaque partie
 * (billetterie, concours) echoue seule et l'indique, tables absentes comprises.
 */
async function resumeStats() {
  const out = {
    ok: true,
    page: '/admin/fight-furious',
    liens: liensMoteka(),
    evenement: bil.EVENEMENT,
    tables_manquantes: [],
    billetterie: null,
    concours: null,
    tirages: null,
  };
  const noter = (partie, err) => {
    if (tableManquante(err)) {
      out.tables_manquantes.push(partie);
      return { ok: false, tables_manquantes: true, error: TABLES_MANQUANTES };
    }
    return { ok: false, error: err?.message || String(err) };
  };
  const [b, c] = await Promise.allSettled([chargerCommandes(), chargerConcours()]);
  if (b.status === 'fulfilled') {
    out.billetterie = { ok: true, ...statsBillets(b.value), ventes_par_jour: ventesParJour(b.value) };
  } else {
    out.billetterie = noter('billetterie', b.reason);
  }
  if (c.status === 'fulfilled') {
    const { participants, tickets, lots, tirages } = c.value;
    const lignes = lignesParticipants(participants, tickets, tirages, lots);
    out.concours = { ok: true, ...statsConcours(lignes, tickets) };
    out.tirages = { ok: true, lots: lots.length, faits: tirages.length, liste: planningTirages(tirages, lots, participants) };
  } else {
    out.concours = noter('concours', c.reason);
    out.tirages = { ok: false, error: out.concours.error };
  }
  out.ok = Boolean(out.billetterie?.ok || out.concours?.ok);
  if (!out.ok && out.tables_manquantes.length) out.error = TABLES_MANQUANTES;
  else if (!out.ok) out.error = out.billetterie?.error || out.concours?.error;
  return out;
}

/* ---------- Routes ---------- */

function erreur(res, err) {
  if (tableManquante(err)) {
    return res.status(503).json({ ok: false, tables_manquantes: true, error: TABLES_MANQUANTES, detail: err.message || String(err) });
  }
  const msg = err?.message || String(err);
  return res.status(500).json({ ok: false, error: msg });
}

function envoyerCsv(res, nom, contenu) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(contenu);
}

function registerFightFuriousAdminRoutes(app, { isAuthorizedAdmin, logInfo = () => {} } = {}) {
  if (typeof isAuthorizedAdmin !== 'function') throw new Error('isAuthorizedAdmin requis');

  const garde = (handler) => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!(await isAuthorizedAdmin(req))) return res.status(401).json({ ok: false, error: 'unauthorized' });
    try {
      return await handler(req, res);
    } catch (err) {
      return erreur(res, err);
    }
  };

  app.get(
    '/api/admin/fight-furious/resume',
    garde(async (_req, res) => {
      res.json(await resumeStats());
    })
  );

  app.get(
    '/api/admin/fight-furious/billetterie',
    garde(async (req, res) => {
      const toutes = await chargerCommandes();
      const payees = trierRecent(toutes.filter((c) => c.status === 'paid'));
      const attente = trierRecent(toutes.filter((c) => c.status === 'pending'), 'created_at');
      res.json({
        ok: true,
        evenement: bil.EVENEMENT,
        stats: statsBillets(toutes),
        commandes: filtrer(payees, req.query.q, (c) => [c.prenom, c.nom, c.email, c.order_id, c.produit_nom, ...c.codes]),
        en_attente: attente.slice(0, 50).map(({ lien, codes, ...c }) => c),
      });
    })
  );

  app.get(
    '/api/admin/fight-furious/billetterie/export.csv',
    garde(async (req, res) => {
      const toutes = await chargerCommandes();
      const payees = trierRecent(toutes.filter((c) => c.status === 'paid'));
      const lignes = filtrer(payees, req.query.q, (c) => [c.prenom, c.nom, c.email, c.order_id, c.produit_nom, ...c.codes]);
      envoyerCsv(res, 'fight-furious-billets.csv', csvBillets(lignes));
    })
  );

  app.post(
    '/api/admin/fight-furious/billetterie/:id/renvoyer',
    garde(async (req, res) => {
      const id = bil.idSur(req.params.id);
      if (!id) return res.status(400).json({ ok: false, error: 'Commande invalide' });
      const sb = supabase();
      const { data, error } = await sb.from(bil.TABLE).select('payload, status').eq('order_id', id).maybeSingle();
      if (error) throw error;
      const commande = data?.payload;
      if (!commande) return res.status(404).json({ ok: false, error: 'Commande introuvable' });
      if ((data.status || commande.status) !== 'paid') {
        return res.status(409).json({ ok: false, error: 'Commande non payee : aucun billet a renvoyer' });
      }
      await bil.envoyerMails(commande, baseBillet());
      const maintenant = new Date().toISOString();
      const neuf = { ...commande, renvoye_at: maintenant, updated_at: maintenant };
      const { error: errMaj } = await sb
        .from(bil.TABLE)
        .update({ payload: neuf, updated_at: maintenant })
        .eq('order_id', id);
      if (errMaj) throw errMaj;
      logInfo('Fight & Furious : billet renvoye', { order_id: id });
      res.json({ ok: true, order_id: id, email: commande.client?.email || null, renvoye_at: maintenant });
    })
  );

  app.get(
    '/api/admin/fight-furious/concours',
    garde(async (req, res) => {
      const { participants, tickets, lots, tirages } = await chargerConcours();
      const lignes = lignesParticipants(participants, tickets, tirages, lots);
      res.json({
        ok: true,
        liens: liensMoteka(),
        stats: statsConcours(lignes, tickets),
        participants: filtrer(lignes, req.query.q, (p) => [p.prenom, p.nom, p.email, p.telephone, ...p.tickets.map((t) => t.numero)]),
      });
    })
  );

  app.get(
    '/api/admin/fight-furious/concours/export.csv',
    garde(async (req, res) => {
      const { participants, tickets, lots, tirages } = await chargerConcours();
      const lignes = filtrer(
        lignesParticipants(participants, tickets, tirages, lots),
        req.query.q,
        (p) => [p.prenom, p.nom, p.email, p.telephone, ...p.tickets.map((t) => t.numero)]
      );
      envoyerCsv(res, 'fight-furious-concours.csv', csvParticipants(lignes));
    })
  );

  app.get(
    '/api/admin/fight-furious/concours/:id/preuve',
    garde(async (req, res) => {
      const id = String(req.params.id || '');
      if (!/^[0-9a-f-]{32,36}$/i.test(id)) return res.status(400).json({ ok: false, error: 'Participant invalide' });
      const { data, error } = await supabase()
        .from('moteka_concours')
        .select('id, avis_preuve, avis_statut, avis_le')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ ok: false, error: 'Participant introuvable' });
      const preuve = typeof data.avis_preuve === 'string' && data.avis_preuve.startsWith('data:image/') ? data.avis_preuve : null;
      res.json({ ok: true, id: data.id, avis_statut: statutAvis(data), avis_le: data.avis_le || null, preuve });
    })
  );

  app.get(
    '/api/admin/fight-furious/tirages',
    garde(async (_req, res) => {
      const { participants, lots, tirages } = await chargerConcours();
      res.json({
        ok: true,
        liens: liensMoteka(),
        dates: DATES_TIRAGE,
        lots,
        tirages: planningTirages(tirages, lots, participants),
      });
    })
  );
}

module.exports = {
  TABLES_MANQUANTES,
  DATES_TIRAGE,
  PRODUITS_ORDRE,
  tableManquante,
  ligneCommande,
  statsBillets,
  lignesParticipants,
  statsConcours,
  planningTirages,
  filtrer,
  celluleCsv,
  versCsv,
  csvBillets,
  csvParticipants,
  liensMoteka,
  ventesParJour,
  resumeStats,
  registerFightFuriousAdminRoutes,
};
