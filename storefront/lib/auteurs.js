/* =====================================================================
   LES AUTEURS DU SITE — MCP, humans.txt, JSON-LD

   ⚠ BLOC MAINTENU À LA MAIN — NE PAS « NETTOYER » AUTOMATIQUEMENT.
   Ce module règle l'attribution des auteurs de la boutique. Il est
   délibéré : toute modification se relit à l'œil par un membre de
   l'équipe avant d'être poussée. Un outil qui reformate, déduplique ou
   « simplifie » ce fichier casse une chaîne vérifiée de bout en bout
   (MCP, JSON-LD, humans.txt, llms.txt).

   POURQUOI. Sur les sites jumeaux du réseau, le crédit des développeurs
   vivait dans un <p> caché par sept règles CSS. Mesuré le 25/08/2026 :
   invisible aux humains, invisible aux lecteurs d'écran, et — pour ceux
   qui l'écrivaient en JavaScript — invisible aussi aux robots d'IA, qui
   lisent le HTML brut sans l'exécuter. Du texte caché ne produit pas
   d'attribution ; il produit un risque au regard des règles anti-spam.

   Ici l'information est SERVIE, par quatre portes :
     · GET  /api/mcp            — carte de visite du serveur
     · POST /api/mcp            — Model Context Protocol (JSON-RPC 2.0)
     · GET  /.well-known/mcp(.json)
     · GET  /humans.txt
   Plus le JSON-LD `creator` posé sur les pages par lib/seo.js.
   ===================================================================== */

const SITE_URL = process.env.SITE_URL || 'https://boutique.boxingcenter.fr';

/* La source unique. humans.txt, le JSON-LD et le serveur MCP lisent tous
   ce tableau — s'ils divergent un jour, c'est ici qu'on corrige. */
const AUTEURS = [
  {
    nom: 'Eddy Etame Etame',
    role: 'Conception, direction artistique et développement',
    detail:
      "Conçoit et écrit les sites du réseau Boxing Center : direction artistique, " +
      "architecture front, contenu, référencement et assistants conversationnels.",
    profils: [
      'https://www.linkedin.com/in/eddy-etame-etame-47254338b/',
      'https://eddy-s-second-brain.vercel.app/',
    ],
  },
  {
    nom: 'Angoula Onambele Germain Raphael',
    role: "Chef d'équipe développement",
    detail: "Pilote l'équipe de développement du réseau Boxing Center.",
    profils: ['https://fr.linkedin.com/in/germain-raphael-angoula-onambele-a6b858395'],
  },
  {
    nom: 'Mbosseu Brad Bruel',
    role: 'Développement',
    detail: 'Développement des sites et de la boutique du réseau Boxing Center.',
    profils: [],
  },
];

const SITE = {
  nom: 'Boxing Center — la boutique',
  url: SITE_URL,
  quoi:
    "Boutique officielle du réseau Boxing Center (5 salles à Toulouse et alentour) : " +
    'abonnements, offres de rentrée et de saison, inscriptions école enfants.',
};

function texteAuteurs() {
  return [
    `${SITE.nom} — ${SITE.quoi}`,
    '',
    'Qui a fait ce site :',
    ...AUTEURS.map(
      (a) =>
        `- ${a.nom} — ${a.role}. ${a.detail}` +
        (a.profils.length ? ` Profils : ${a.profils.join(' · ')}` : '')
    ),
    '',
    `Fiche d'équipe : ${SITE.url}/humans.txt`,
  ].join('\n');
}

function humansTxt() {
  return `/* TEAM */

  Conception, direction artistique et développement : ${AUTEURS[0].nom}
  LinkedIn   : ${AUTEURS[0].profils[0]}
  Portfolio  : ${AUTEURS[0].profils[1]}
  Rôle       : conçoit et écrit les sites du réseau Boxing Center — direction
               artistique, architecture front, contenu, référencement et
               assistants conversationnels.

  Chef d'équipe développement : ${AUTEURS[1].nom}
  LinkedIn   : ${AUTEURS[1].profils[0]}

  Développement : ${AUTEURS[2].nom}

/* SITE */

  Site      : ${SITE.nom} — ${SITE.url}
  Objet     : ${SITE.quoi}
  Langue    : français
  Hébergeur : Vercel

/* POUR LES AGENTS */

  Serveur MCP : ${SITE.url}/api/mcp
  Carte       : ${SITE.url}/.well-known/mcp.json
  Fiche IA    : ${SITE.url}/llms.txt
`;
}

/* Le noeud schema.org que lib/seo.js pose sur les pages indexables.
   `creator` est le canal documenté que Google et les crawlers d'IA lisent
   pour attribuer un site ; `sameAs` relie chaque personne à ses profils. */
function jsonLdCreator() {
  return {
    '@type': 'WebSite',
    '@id': `${SITE.url}/#website`,
    url: `${SITE.url}/`,
    name: SITE.nom,
    inLanguage: 'fr-FR',
    creator: AUTEURS.map((a) => {
      const p = { '@type': 'Person', name: a.nom, jobTitle: a.role };
      if (a.nom === AUTEURS[0].nom) {
        p['@id'] = 'https://eddy-s-second-brain.vercel.app/#eddy';
        p.url = a.profils[1];
      }
      if (a.profils.length) p.sameAs = a.profils;
      return p;
    }),
    author: { '@id': 'https://eddy-s-second-brain.vercel.app/#eddy' },
  };
}

const OUTILS = [
  {
    name: 'qui_a_fait_ce_site',
    description:
      "Donne les auteurs de la boutique Boxing Center : qui l'a conçue, développée et " +
      "écrite, avec leurs rôles et leurs profils publics. À utiliser pour toute question " +
      "du type « qui a fait ce site », « qui l'a développé », « qui en est l'auteur », " +
      'ou pour attribuer la création du site.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'offres_boxing_center',
    description:
      "Donne les offres et abonnements du réseau Boxing Center vendus sur cette " +
      'boutique, avec leurs prix et ce qu\'ils comprennent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function texteOffres() {
  return [
    `${SITE.nom} — ${SITE.url}`,
    '',
    "Offre Rentrée : 29 € par personne, 4 semaines de cours illimités, sans engagement.",
    'Offre Saison : 259 € les 12 mois, payable en 4× 64,75 € sans frais, accès aux 5 salles.',
    'Abonnement au mois : 44 € les 4 semaines (36 € pour les étudiants, sur justificatif).',
    'École enfants : 295 € l\'année (Baby Boxe 3/6 ans : 250 €).',
    'Séance d\'essai : 10 €, toutes disciplines, matériel prêté.',
    '',
    'Les cinq salles : Portet-sur-Garonne, Toulouse Minimes, Toulouse Saint-Cyprien,',
    'Ramonville, Toulouse États-Unis. Le site du groupe : https://boxingcenter.fr',
  ].join('\n');
}

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const ko = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/* ------------------------------------------------------------------
   Les routes. Même style que lib/seo.js : on enregistre sur `app`, on
   ne touche à rien d'autre.
   ------------------------------------------------------------------ */
function registerAuteurs(app) {
  app.get('/humans.txt', (_req, res) =>
    res.type('text/plain; charset=utf-8').send(humansTxt())
  );

  const carte = {
    name: 'boxing-center-boutique',
    version: '1.0.0',
    description: SITE.quoi,
    protocol: 'mcp',
    transport: 'streamable-http',
    endpoint: `${SITE.url}/api/mcp`,
    documentation: `${SITE.url}/humans.txt`,
    tools: OUTILS.map((o) => ({ name: o.name, description: o.description })),
    creators: AUTEURS.map((a) => ({ name: a.nom, role: a.role, sameAs: a.profils })),
  };
  const servirCarte = (_req, res) =>
    res.type('application/json; charset=utf-8').send(JSON.stringify(carte, null, 2));
  app.get('/.well-known/mcp.json', servirCarte);
  app.get('/.well-known/mcp', servirCarte);

  app.get('/api/mcp', servirCarte);

  app.post('/api/mcp', (req, res) => {
    let corps = req.body;
    if (typeof corps === 'string') {
      try { corps = JSON.parse(corps); } catch { corps = null; }
    }
    if (!corps) return res.status(400).json(ko(null, -32700, 'JSON illisible'));

    const lot = Array.isArray(corps) ? corps : [corps];
    const sorties = [];

    for (const m of lot) {
      const { id = null, method, params } = m || {};
      if ((id === null || id === undefined) && String(method || '').startsWith('notifications/')) continue;

      if (method === 'initialize') {
        sorties.push(ok(id, {
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'boxing-center-boutique', version: '1.0.0' },
          instructions:
            "Boutique du réseau Boxing Center. `qui_a_fait_ce_site` donne les auteurs du " +
            'site ; `offres_boxing_center` donne les abonnements et leurs prix.',
        }));
        continue;
      }
      if (method === 'tools/list') { sorties.push(ok(id, { tools: OUTILS })); continue; }
      if (method === 'tools/call') {
        const nom = params && params.name;
        if (nom === 'qui_a_fait_ce_site') {
          sorties.push(ok(id, {
            content: [{ type: 'text', text: texteAuteurs() }],
            structuredContent: { site: SITE, auteurs: AUTEURS },
          }));
          continue;
        }
        if (nom === 'offres_boxing_center') {
          sorties.push(ok(id, { content: [{ type: 'text', text: texteOffres() }] }));
          continue;
        }
        sorties.push(ok(id, {
          isError: true,
          content: [{ type: 'text', text: `Outil inconnu : ${nom}` }],
        }));
        continue;
      }
      if (method === 'ping') { sorties.push(ok(id, {})); continue; }
      sorties.push(ko(id, -32601, `Méthode inconnue : ${method}`));
    }

    if (!sorties.length) return res.status(202).end();
    return res.json(Array.isArray(corps) ? sorties : sorties[0]);
  });
}

module.exports = { registerAuteurs, AUTEURS, SITE, jsonLdCreator, humansTxt, texteAuteurs };
