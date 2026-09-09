'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SECTIONS,
  PLANNINGS,
  V4_PATH,
  buildKnowledge,
  planningContext,
  fallbackFromKnowledge,
  detectGyms,
} = require('../storefront/lib/bc-knowledge');

test('le fichier V4 est bien embarqué', () => {
  assert.equal(path.basename(V4_PATH), 'Base_connaissances_V4.txt');
  assert.ok(fs.existsSync(V4_PATH));
  const raw = fs.readFileSync(V4_PATH, 'utf8');
  assert.match(raw, /29,99\s*€/);
  assert.match(raw, /BASE DE CONNAISSANCES/);
});

test('toutes les sections V4 utiles sont parsées', () => {
  const keys = [
    'regles',
    'disciplines',
    'salles',
    'coachs',
    'planning-minimes',
    'planning-ramonville',
    'planning-saint-cyprien',
    'planning-portet',
    'planning-etats-unis',
    'tarifs',
    'essai',
    'inscription',
    'resiliation',
    'sante',
    'reglement',
    'faq',
    'scripts',
    'vigilance',
  ];
  for (const key of keys) {
    assert.ok(SECTIONS[key] && SECTIONS[key].length > 200, `section manquante : ${key}`);
  }
  assert.equal(SECTIONS.sources, undefined);
});

test('les réponses se calent sur la V4, pas sur le catalogue boutique', () => {
  const k = buildKnowledge('quels sont les tarifs et offres en cours ?');
  assert.match(k, /29,99/);
  assert.match(k, /base de connaissances V4/i);
  assert.doesNotMatch(k, /29 € et non 29,99/);
  assert.doesNotMatch(k, /DERNIÈRE CARTE/);
  assert.doesNotMatch(k, /64,75/);
});

test('un horaire États-Unis JJB vient du planning V4', () => {
  const planning = planningContext('horaire du Jiu-Jitsu Brésilien lundi à États-Unis');
  assert.match(planning, /JIU-JITSU BR[ÉE]SILIEN/i);
  assert.match(planning, /18h20/);
  assert.match(planning, /Zouhir/i);
  assert.equal(PLANNINGS['etats-unis'].includes('18h20–19h00'), true);
});

/* Visuel « ÉTATS-UNIS — SALLE MMA » saison 2026-2027 transmis le 09/09. */
test('la salle MMA États-Unis suit le visuel : 18h20–19h00 et JJB le mercredi soir', () => {
  const mma = PLANNINGS['etats-unis'].split('8.B.')[1].split('8.C.')[0];
  assert.equal(mma.includes('18h20–19h30'), false, 'le créneau de 18h20 finit à 19h00');
  const mercredi = mma.split('MERCREDI')[1].split('JEUDI')[0];
  assert.match(mercredi, /18h00–19h00 \| MMA ENFANTS \/ ADOS 10–16 ans/);
  assert.match(mercredi, /19h40–21h00 \| JIU-JITSU BR[ÉE]SILIEN/);
  assert.doesNotMatch(mercredi, /GRAPPLING/i, 'pas de Grappling le mercredi en salle MMA');
  const samedi = mma.split('SAMEDI')[1];
  assert.match(samedi, /MMA ENFANTS \/ ADOS 10–16 ans/);
  assert.doesNotMatch(samedi, /ASSO MMA \| |GRAPPLING/i, 'samedi soir = accès libre');
});

test('le planning Minimes V4 garde Boxing Camp le samedi à 11h', () => {
  assert.match(PLANNINGS.minimes, /11h00–12h00/);
  assert.match(PLANNINGS.minimes, /BOXING CAMP/i);
});

test('les garde-fous V4 sont toujours injectés', () => {
  const k = buildKnowledge('bonjour');
  assert.match(k, /PAS chauffées et PAS climatisées/i);
  assert.match(k, /Boxing Lady/);
  assert.match(k, /sans réservation/);
});

test('une question horaire Minimes reste sous le budget du modèle', () => {
  const k = buildKnowledge('Boxing Camp mardi Minimes, c’est à quelle heure et avec qui ?');
  assert.ok(k.length <= 11000, `prompt trop long: ${k.length}`);
  assert.match(k, /18h30–19h30/);
  assert.match(k, /BOXING CAMP/i);
  assert.match(k, /Clément|Clement/);
});

test('un horaire États-Unis JJB reste sous le budget du modèle', () => {
  const k = buildKnowledge('JJB aux États-Unis le lundi, quel horaire ?');
  assert.ok(k.length <= 11000, `prompt trop long: ${k.length}`);
  assert.match(k, /18h20–19h00/);
});

test('Reynerie pointe Saint-Cyprien', () => {
  assert.deepEqual(detectGyms('salle près de la Reynerie'), ['st-cyprien']);
  const k = buildKnowledge('salle près de la Reynerie');
  assert.match(k, /Reynerie \/ Mirail/i);
});

test('un enfant de 2 et 4 ans reçoit Baby Boxe, pas la boxe anglaise adulte', () => {
  const q = 'Je souhaite inscrire mes enfants de 2 ans et 4 ans à la boxe anglaise.';
  const k = buildKnowledge(q);
  assert.match(k, /Baby Boxe/i);
  assert.match(k, /trop jeune/i);
  assert.match(k, /pas la boxe anglaise adulte/i);
  const fallback = fallbackFromKnowledge(q);
  assert.match(fallback, /trop jeune/i);
  assert.match(fallback, /Baby Boxe/i);
  assert.match(fallback, /4 ans/i);
});

test('la clim reste interdite dans les 5 salles', () => {
  const k = buildKnowledge('il y a la clim dans les salles ?');
  assert.match(k, /AUCUNE/i);
  assert.match(k, /PAS climatisées/i);
});
