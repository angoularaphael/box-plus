'use strict';

const fs = require('fs');
const path = require('path');

const MINIMES = 'Barrière de Paris - Minimes';
const PORTET = 'Portet-sur-Garonne';
const ST_CYPRIEN = 'Toulouse St-Cyprien';
const RAMONVILLE = 'Ramonville';
const ETATS_UNIS = 'États-Unis';

const G3 = [MINIMES, PORTET, ST_CYPRIEN];
const G_SHELL = [RAMONVILLE, ETATS_UNIS, PORTET];
const G_PACK = [MINIMES, PORTET];
const G_BLADE = [MINIMES, ST_CYPRIEN];

const NOTE_48H =
  'Disponible dans la salle Boxing Center de votre choix sous 48h.';
const NOTE_BLADE =
  'Retrait à Boxing Center Toulouse Minimes ou Saint-Cyprien. Lundi–vendredi 12h–14h et 17h–21h ; samedi 15h–18h. Possibilité de retrait dès le jour même.';
const NOTE_PACK =
  'Retrait uniquement à Minimes ou Portet-sur-Garonne, possibilité de retrait dès le jour même. 12h–14h et 17h–21h15.';

function money(cents) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

function combo({ id, label, attrs, ref, cents, stock, image, images }) {
  return {
    id,
    label,
    attributes: attrs,
    reference: ref,
    price_cents: cents,
    price_label: money(cents),
    stock,
    image,
    ...(images ? { images } : {}),
  };
}

function product(p) {
  const stock = (p.combinations || []).reduce((s, c) => s + (c.stock || 0), 0);
  return {
    ...p,
    display_name: p.display_name || p.name,
    stock,
    price_label: money(p.price_cents),
    price_was_label: p.price_was_cents ? money(p.price_was_cents) : undefined,
    active: true,
    pickup_only: true,
    manual: true,
    source: 'rentree-2026',
    tab: 'materiel',
    requires_iban: false,
    requires_payment: true,
    sale_type: 'materiel',
    default_variant_id: p.default_variant_id || p.combinations[0].id,
  };
}

const IMG = {
  blade: '/img/materiel/rentree/blade/blade-nb-01.jpg',
  pack: '/img/materiel/rentree/pack/pack-enfant.jpg',
  packKeychain: '/img/materiel/rentree/pack/pack-keychain.jpg',
  mitaine: '/img/materiel/rentree/mitaines/mitaine-01.jpg',
  mitaine2: '/img/materiel/rentree/mitaines/mitaine-02.png',
  sparring: '/img/materiel/rentree/sparring/sparring-01.jpg',
  sparring2: '/img/materiel/rentree/sparring/sparring-02.jpg',
  sparring3: '/img/materiel/rentree/sparring/sparring-03.jpg',
  ergo: '/img/materiel/rentree/ergo/ergo-01.jpg',
  ergo2: '/img/materiel/rentree/ergo/ergo-02.jpg',
  shell: '/img/materiel/rentree/shell/shell-officiel.jpg',
  shell2: '/img/materiel/rentree/shell/shell-02.jpg',
  one: '/img/materiel/rentree/one/one-official.jpg',
  oneShot: '/img/materiel/rentree/one/one-jr.png',
  ensemble: '/img/materiel/rentree/ensemble/ensemble-cadre.jpg',
  ensemble2: '/img/materiel/rentree/ensemble/ensemble-02.png',
  ensembleNoir: '/img/materiel/rentree/ensemble/ensemble-noir.jpg',
  ensembleMetal: '/img/materiel/rentree/ensemble/ensemble-metal-01.jpg',
  debardeur: '/img/materiel/rentree/debardeur/debardeur-cadre-01.jpg',
  debardeur2: '/img/materiel/rentree/debardeur/debardeur-cadre-02.jpg',
  bandes4: '/img/materiel/rentree/bandes/bandes-4m-01.jpg',
  bandes42: '/img/materiel/rentree/bandes/bandes-4m-02.png',
  bandes43: '/img/materiel/rentree/bandes/bandes-4m-03.jpg',
  bandes25: '/img/materiel/rentree/bandes/bandes-250-01.jpg',
  dentsAdulte: '/img/materiel/rentree/dents/dents-adulte-01.jpg',
  dentsAdulte2: '/img/materiel/rentree/dents/dents-adulte-02.jpg',
  dentsEnfant: '/img/materiel/rentree/dents/dents-enfant-01.png',
  dentsEnfant2: '/img/materiel/rentree/dents/dents-enfant-02.png',
  tibias: '/img/materiel/rentree/tibias/tibias-blanc-01.jpg',
  tibias2: '/img/materiel/rentree/tibias/tibias-blanc-02.png',
  tibias3: '/img/materiel/rentree/tibias/tibias-blanc-03.jpg',
  tibias4: '/img/materiel/rentree/tibias/tibias-blanc-04.jpg',
};

const products = [
  product({
    id: 'mat-blade-gold',
    slug: 'gants-boxe-blade-noir-blanc',
    name: 'Gants de boxe Blade Noir et Blanc',
    reference: 'MBGAN205',
    price_cents: 1790,
    price_was_cents: 4000,
    category: 'destockage',
    category_label: 'Déstockage',
    category_id: 26,
    sort_order: 1,
    featured_first: true,
    destockage: true,
    default_variant_id: 'blade-noir-blanc-12oz',
    pickup_gyms: G_BLADE,
    pickup_same_day: true,
    pickup_hours: 'Lundi–vendredi 12h–14h et 17h–21h ; samedi 15h–18h.',
    pickup_note: NOTE_BLADE,
    image: IMG.blade,
    images: [IMG.blade, '/img/materiel/rentree/blade/blade-nb-02.jpg'],
    description_short:
      'Gants Blade destockage rentrée 2026 — coloris Noir et Blanc. Tailles 10, 12 et 14oz. 17,90 € au lieu de 40 €. Possibilité de retrait dès le jour même à Minimes ou Saint-Cyprien.',
    description:
      'Gants de boxe Blade (Metal Boxe) en destockage rentrée 2026. Coloris Noir et Blanc. PU haute qualité, mousse EVA, velcro large, aération WindTec. Tailles 10oz, 12oz et 14oz.\n\n' +
      NOTE_BLADE,
    combinations: ['10oz', '12oz', '14oz'].map((size) =>
      combo({
        id: `blade-noir-blanc-${size}`,
        label: size,
        attrs: { Couleur: 'Noir / Blanc', Taille: size, 'Lieu retrait produits': 'Minimes ou Saint-Cyprien' },
        ref: `MBGAN205N${size.replace('oz', '')}`,
        cents: 1790,
        stock: 10,
        image: IMG.blade,
        images: [IMG.blade, '/img/materiel/rentree/blade/blade-nb-02.jpg'],
      })
    ),
  }),
  product({
    id: 'mat-pack-enfants',
    slug: 'pack-enfants-gants-mitaines-porte-cles',
    name: 'Pack enfants',
    reference: 'BC-PACK-ENFANTS',
    price_cents: 2500,
    price_was_cents: 3500,
    category: 'destockage',
    category_label: 'Déstockage',
    category_id: 26,
    sort_order: 2,
    destockage: true,
    pickup_gyms: G_PACK,
    pickup_same_day: true,
    pickup_hours: '12h–14h et 17h–21h15',
    pickup_note: NOTE_PACK,
    image: IMG.pack,
    images: [IMG.pack, IMG.packKeychain, IMG.one, IMG.mitaine],
    description_short:
      'Pack enfants : gants + mitaines + porte-clés sac de frappe Metal. Tailles 4/7 ans ou 8/15 ans. 25 € au lieu de 35 €. Possibilité de retrait dès le jour même à Minimes ou Portet.',
    description:
      'Pack enfants Boxing Center : une paire de gants, des mitaines sous-gants et un porte-clés sac de frappe Metal.\n\nTailles : 4 à 7 ans, ou 8 à 15 ans.\n\n' +
      NOTE_PACK,
    combinations: [
      combo({
        id: 'pack-4-7',
        label: '4 / 7 ans',
        attrs: { Taille: '4 / 7 ans' },
        ref: 'BC-PACK-ENFANTS-47',
        cents: 2500,
        stock: 15,
        image: IMG.pack,
      }),
      combo({
        id: 'pack-8-15',
        label: '8 / 15 ans',
        attrs: { Taille: '8 / 15 ans' },
        ref: 'BC-PACK-ENFANTS-815',
        cents: 2500,
        stock: 15,
        image: IMG.pack,
      }),
    ],
  }),
  product({
    id: 'mat-sparring-16',
    slug: 'gants-sparring-mbgan010n14-16oz',
    name: 'Gants Sparring 16oz',
    reference: 'MBGAN010N14',
    price_cents: 3490,
    price_was_cents: 7000,
    category: 'gants',
    category_label: 'Gants de boxe',
    category_id: 17,
    sort_order: 3,
    pickup_gyms: G3,
    pickup_delay: '48h',
    pickup_note: `Retrait : Minimes, Portet ou St-Cyprien. ${NOTE_48H}`,
    image: IMG.sparring,
    images: [IMG.sparring, IMG.sparring2, IMG.sparring3],
    description_short:
      'Gants de sparring Metal Boxe 16oz (MBGAN010N14). 34,90 € au lieu de 70 €. Retrait Minimes, Portet ou St-Cyprien sous 48h.',
    description:
      'Gants de boxe sparring Metal Boxe, taille 16oz. Mousse injectée Ergo 90, manchette haute, pouce attaché, aération WindTec.\n\nRetrait Minimes, Portet ou St-Cyprien. ' +
      NOTE_48H,
    combinations: [
      combo({
        id: 'sparring-16oz',
        label: '16oz',
        attrs: { Taille: '16oz' },
        ref: 'MBGAN010N14',
        cents: 3490,
        stock: 24,
        image: IMG.sparring,
      }),
    ],
  }),
  product({
    id: 'mat-ergo90-14',
    slug: 'gants-ergo-90-mbg301k14',
    name: 'Gants ERGO 90 14oz',
    reference: 'MBG301K14',
    price_cents: 2490,
    price_was_cents: 5000,
    category: 'gants',
    category_label: 'Gants de boxe',
    category_id: 17,
    sort_order: 4,
    pickup_gyms: G3,
    pickup_delay: '48h',
    pickup_note: `Retrait : Minimes, Portet ou St-Cyprien. ${NOTE_48H}`,
    image: IMG.ergo,
    images: [IMG.ergo, IMG.ergo2],
    description_short:
      'Gants ERGO 90 Metal Boxe 14oz (MBG301K14). 24,90 € au lieu de 50 €. Retrait Minimes, Portet ou St-Cyprien sous 48h.',
    description:
      'Gants ERGO 90 : mousse injectée anatomique à 90°, enveloppe PU, serrage velcro. Taille 14oz, coloris kaki/olive.\n\nRetrait Minimes, Portet ou St-Cyprien. ' +
      NOTE_48H,
    combinations: [
      combo({
        id: 'ergo-14oz',
        label: '14oz',
        attrs: { Taille: '14oz' },
        ref: 'MBG301K14',
        cents: 2490,
        stock: 14,
        image: IMG.ergo,
      }),
    ],
  }),
  product({
    id: 'mat-shell-mma',
    slug: 'gants-mma-the-shell',
    name: 'Gants MMA « The SHELL »',
    reference: 'MMG301N',
    price_cents: 1990,
    price_was_cents: 4000,
    category: 'gants',
    category_label: 'Gants de MMA',
    category_id: 17,
    sort_order: 5,
    pickup_gyms: G_SHELL,
    pickup_delay: '48h',
    pickup_note: `Retrait : Ramonville, États-Unis ou Portet. ${NOTE_48H}`,
    image: IMG.shell,
    images: [IMG.shell, IMG.shell2],
    description_short:
      'Gants MMA sparring The Shell. Tailles S à XL. 19,90 € au lieu de 40 €. Retrait Ramonville, États-Unis ou Portet sous 48h.',
    description:
      'Gants MMA sparring « The Shell » Metal Boxe. Mousse injectée, velcro + élastique, protection du pouce. Tailles S, M, L, XL.\n\nRetrait Ramonville, États-Unis ou Portet. ' +
      NOTE_48H,
    combinations: ['S', 'M', 'L', 'XL'].map((size) =>
      combo({
        id: `shell-${size.toLowerCase()}`,
        label: size,
        attrs: { Taille: size },
        ref: `MMG301N${size}`,
        cents: 1990,
        stock: 5,
        image: IMG.shell,
      })
    ),
  }),
  product({
    id: 'mat-one-enfant',
    slug: 'gants-boxe-enfant-one',
    name: 'Gants de boxe enfant « ONE »',
    reference: 'MBGAN002',
    price_cents: 1990,
    price_was_cents: 3000,
    category: 'gants',
    category_label: 'Gants de boxe',
    category_id: 17,
    sort_order: 6,
    pickup_gyms: G3,
    pickup_delay: '48h',
    pickup_note: `Retrait : Minimes, Portet ou St-Cyprien. ${NOTE_48H}`,
    image: IMG.one,
    images: [IMG.one, IMG.oneShot],
    description_short:
      'Gants de boxe enfant Metal Boxe « ONE » (MBGAN002). 4/7 ans ou 8/15 ans. 19,90 € au lieu de 30 €. Retrait Minimes, Portet ou St-Cyprien sous 48h.',
    description:
      'Gants de boxe enfant modèle ONE (MBGAN002). PU, mousse injectée, velcro large. Tailles 4/7 ans et 8/15 ans.\n\nRetrait Minimes, Portet ou St-Cyprien. ' +
      NOTE_48H,
    combinations: [
      combo({
        id: 'one-4-7',
        label: '4 / 7 ans',
        attrs: { Taille: '4 / 7 ans' },
        ref: 'MBGAN002NE',
        cents: 1990,
        stock: 20,
        image: IMG.one,
      }),
      combo({
        id: 'one-8-15',
        label: '8 / 15 ans',
        attrs: { Taille: '8 / 15 ans' },
        ref: 'MBGAN002NJR',
        cents: 1990,
        stock: 20,
        image: IMG.one,
      }),
    ],
  }),
  product({
    id: 'mat-ensemble-enfants',
    slug: 'ensemble-enfants-short-debardeur',
    name: 'Ensemble enfants short et débardeur',
    reference: 'MB6473',
    price_cents: 2490,
    price_was_cents: 3000,
    category: 'short',
    category_label: 'Short de Boxe',
    category_id: 22,
    sort_order: 7,
    pickup_gyms: G3,
    pickup_delay: '48h',
    pickup_note: `Retrait : Minimes, Portet ou St-Cyprien. ${NOTE_48H}`,
    image: IMG.ensemble,
    images: [IMG.ensemble, IMG.ensemble2, IMG.ensembleNoir, IMG.ensembleMetal],
    description_short:
      'Ensemble enfants short + débardeur Metal Boxe (MB6473). Tailles 6/8, 8/10 et 10/12 ans. 24,90 € au lieu de 30 €. Retrait Minimes, Portet ou St-Cyprien sous 48h.',
    description:
      'Ensemble boxe anglaise enfants Metal Boxe MB6473 : short satin + débardeur. Tailles 6/8 ans, 8/10 ans et 10/12 ans.\n\nRetrait Minimes, Portet ou St-Cyprien. ' +
      NOTE_48H,
    combinations: [
      ['6-8', '6 / 8 ans', 'MB6473-68'],
      ['8-10', '8 / 10 ans', 'MB6473-810'],
      ['10-12', '10 / 12 ans', 'MB6473-1012'],
    ].map(([id, label, ref]) =>
      combo({
        id: `ensemble-${id}`,
        label,
        attrs: { Taille: label },
        ref,
        cents: 2490,
        stock: 5,
        image: IMG.ensemble,
      })
    ),
  }),
  product({
    id: 'mat-debardeur-training',
    slug: 'debardeur-entrainement-metal-boxe-training-tank',
    name: "Débardeur d'entraînement METAL BOXE TRAINING TANK",
    reference: 'MBTANK',
    price_cents: 1890,
    price_was_cents: 3000,
    category: 'debardeur',
    category_label: 'Débardeur',
    category_id: 27,
    sort_order: 8,
    pickup_gyms: G3,
    pickup_delay: '48h',
    pickup_note: `Retrait : Minimes, Portet ou St-Cyprien. ${NOTE_48H}`,
    image: IMG.debardeur,
    images: [IMG.debardeur, IMG.debardeur2],
    description_short:
      "Débardeur d'entraînement Metal Boxe TRAINING TANK. Tailles S à XL. 18,90 € au lieu de 30 €. Retrait Minimes, Portet ou St-Cyprien sous 48h.",
    description:
      "Débardeur d'entraînement Metal Boxe TRAINING TANK. Coupe libre pour le travail aux sacs et à la corde. Tailles S, M, L, XL.\n\nRetrait Minimes, Portet ou St-Cyprien. " +
      NOTE_48H,
    default_variant_id: 'debardeur-m',
    combinations: ['S', 'M', 'L', 'XL'].map((size) =>
      combo({
        id: `debardeur-${size.toLowerCase()}`,
        label: size,
        attrs: { Taille: size },
        ref: `MBTANK-${size}`,
        cents: 1890,
        stock: 5,
        image: IMG.debardeur,
      })
    ),
  }),
  product({
    id: 'mat-bandes-4m',
    slug: 'bandes-4m-mb120bt',
    name: 'Bandes 4m Rouge / Blanc / Bleu',
    reference: 'MB120BT',
    price_cents: 690,
    price_was_cents: 1000,
    category: 'bandes',
    category_label: 'Bandes de boxe',
    category_id: 20,
    sort_order: 8,
    pickup_gyms: G3,
    pickup_delay: '48h',
    pickup_note: `Retrait : Minimes, Portet ou St-Cyprien. ${NOTE_48H}`,
    image: IMG.bandes4,
    images: [IMG.bandes4, IMG.bandes42, IMG.bandes43],
    description_short:
      'Bandes 4m Metal Boxe MB120BT, coloris Rouge / Blanc / Bleu. 6,90 € au lieu de 10 €. Retrait Minimes, Portet ou St-Cyprien sous 48h.',
    description:
      'Bandes de boxe 4 mètres Metal Boxe (MB120BT), coloris tricolore Rouge / Blanc / Bleu. Coton/nylon, passant pouce, velcro. Vendues à la paire.\n\nRetrait Minimes, Portet ou St-Cyprien. ' +
      NOTE_48H,
    combinations: [
      combo({
        id: 'bandes4-rwb',
        label: 'Rouge / Blanc / Bleu',
        attrs: { Couleur: 'Rouge / Blanc / Bleu', Longueur: '4m' },
        ref: 'MB120BT',
        cents: 690,
        stock: 50,
        image: IMG.bandes4,
      }),
    ],
  }),
  product({
    id: 'mat-bandes-250',
    slug: 'bandes-2m50-mb120t',
    name: 'Bandes 2m50 Rouge / Blanc / Bleu',
    reference: 'MB120T',
    price_cents: 590,
    price_was_cents: 800,
    category: 'bandes',
    category_label: 'Bandes de boxe',
    category_id: 20,
    sort_order: 9,
    pickup_gyms: G3,
    pickup_delay: '48h',
    pickup_note: `Retrait : Minimes, Portet ou St-Cyprien. ${NOTE_48H}`,
    image: IMG.bandes25,
    images: [IMG.bandes25, IMG.bandes4, IMG.bandes42],
    description_short:
      'Bandes 2,50m Metal Boxe MB120T, coloris Rouge / Blanc / Bleu. 5,90 € au lieu de 8 €. Retrait Minimes, Portet ou St-Cyprien sous 48h.',
    description:
      'Bandes de boxe 2,50 mètres Metal Boxe (MB120T), coloris tricolore Rouge / Blanc / Bleu. Coton/nylon, passant pouce, velcro. Vendues à la paire.\n\nRetrait Minimes, Portet ou St-Cyprien. ' +
      NOTE_48H,
    combinations: [
      combo({
        id: 'bandes25-rwb',
        label: 'Rouge / Blanc / Bleu',
        attrs: { Couleur: 'Rouge / Blanc / Bleu', Longueur: '2m50' },
        ref: 'MB120T',
        cents: 590,
        stock: 20,
        image: IMG.bandes25,
      }),
    ],
  }),
  product({
    id: 'mat-dents-adulte',
    slug: 'protege-dents-adulte-mbpro458srt',
    name: 'Protège dents adulte',
    reference: 'MBPRO458SRT',
    price_cents: 590,
    category: 'protege-dents',
    category_label: 'Protège dents',
    category_id: 24,
    sort_order: 10,
    pickup_gyms: G3,
    pickup_delay: '48h',
    pickup_note: `Retrait : Minimes, Portet ou St-Cyprien. ${NOTE_48H}`,
    image: IMG.dentsAdulte,
    images: [IMG.dentsAdulte, IMG.dentsAdulte2],
    description_short:
      'Protège dents adulte translucide (MBPRO458SRT). 5,90 €. Retrait Minimes, Portet ou St-Cyprien sous 48h.',
    description:
      'Protège dents adulte simple translucide Metal Boxe MBPRO458SRT. Gel médical, thermoformable, livré avec boîtier.\n\nRetrait Minimes, Portet ou St-Cyprien. ' +
      NOTE_48H,
    combinations: [
      combo({
        id: 'dents-adulte',
        label: 'Adulte',
        attrs: { Taille: 'Adulte' },
        ref: 'MBPRO458SRT',
        cents: 590,
        stock: 50,
        image: IMG.dentsAdulte,
      }),
    ],
  }),
  product({
    id: 'mat-dents-enfant',
    slug: 'protege-dents-enfants-mb459jrw',
    name: 'Protège dents enfants',
    reference: 'MB459JRW',
    price_cents: 1200,
    category: 'protege-dents',
    category_label: 'Protège dents',
    category_id: 24,
    sort_order: 11,
    pickup_gyms: G3,
    pickup_delay: '48h',
    pickup_note: `Retrait : Minimes, Portet ou St-Cyprien. ${NOTE_48H}`,
    image: IMG.dentsEnfant,
    images: [IMG.dentsEnfant, IMG.dentsEnfant2],
    description_short:
      'Protège dents enfants gel (MB459JRW). 12 €. Retrait Minimes, Portet ou St-Cyprien sous 48h.',
    description:
      'Protège dents enfants gel thermoformable Metal Boxe MB459 (JR). Moulage à l’eau chaude.\n\nRetrait Minimes, Portet ou St-Cyprien. ' +
      NOTE_48H,
    combinations: [
      combo({
        id: 'dents-enfant',
        label: 'Enfants',
        attrs: { Taille: 'Enfants' },
        ref: 'MB459JRW',
        cents: 1200,
        stock: 20,
        image: IMG.dentsEnfant,
      }),
    ],
  }),
  product({
    id: 'mat-tibias-coton',
    slug: 'protege-tibias-pieds-coton-mb153wm',
    name: 'Protège tibias + pieds coton',
    reference: 'MB153WM',
    price_cents: 1490,
    price_was_cents: 2000,
    category: 'protege-tibias',
    category_label: 'Protège tibias-pieds',
    category_id: 18,
    sort_order: 12,
    pickup_gyms: G3,
    pickup_delay: '48h',
    pickup_note: `Retrait : Minimes, Portet ou St-Cyprien. ${NOTE_48H}`,
    image: IMG.tibias,
    images: [IMG.tibias, IMG.tibias2, IMG.tibias3, IMG.tibias4],
    description_short:
      'Protège tibias + pieds coton blanc (MB153WM). S à XL. 14,90 € au lieu de 20 €. Retrait Minimes, Portet ou St-Cyprien sous 48h.',
    description:
      'Protège tibias-pieds coton élastique Metal Boxe MB153, coloris blanc. Mousse EVA, velcro de serrage. Tailles S, M, L, XL.\n\nRetrait Minimes, Portet ou St-Cyprien. ' +
      NOTE_48H,
    combinations: ['S', 'M', 'L', 'XL'].map((size) =>
      combo({
        id: `tibias-${size.toLowerCase()}`,
        label: size,
        attrs: { Taille: size },
        ref: 'MB153WM',
        cents: 1490,
        stock: 5,
        image: IMG.tibias,
      })
    ),
  }),
];

const catalog = {
  synced_at: new Date().toISOString(),
  source: 'rentree-2026',
  count: products.length,
  categories: [
    { id: 16, slug: 'materiel', label: 'Matériel de boxe' },
    { id: 26, slug: 'destockage', label: 'Déstockage' },
    { id: 17, slug: 'gants', label: 'Gants de boxe' },
    { id: 22, slug: 'short', label: 'Short de Boxe' },
    { id: 27, slug: 'debardeur', label: 'Débardeur' },
    { id: 20, slug: 'bandes', label: 'Bandes de boxe' },
    { id: 24, slug: 'protege-dents', label: 'Protège dents' },
    { id: 18, slug: 'protege-tibias', label: 'Protège tibias-pieds' },
  ],
  products,
};

const out = path.join(__dirname, '..', 'data', 'storefront', 'materiel-catalog.json');
fs.writeFileSync(out, JSON.stringify(catalog, null, 2), 'utf8');
console.log(`wrote ${products.length} products → ${out}`);
