'use strict';

/**
 * Régressions relevées lors de l'audit des conseillers face à la base V4.
 * Chaque cas correspond à une réponse réellement servie en production par
 * Nassim ou Chloé et jugée fausse, incomplète ou hors sujet.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { matchWelcomeFaq } = require('../storefront/lib/welcome-faq');
const { resolvePersona } = require('../storefront/lib/counselor-personas');

const chloe = resolvePersona('chloe');
const nassim = resolvePersona('nassim');
const fabien = resolvePersona('fabien');

const demande = (texte, { persona = chloe, lastBot = '', messages = [] } = {}) =>
  matchWelcomeFaq(texte, { persona, lastBot, messages });

test('une réclamation est reconnue au lieu de tomber sur la fiche vestiaires', () => {
  const r = demande("Je suis très mécontent, la douche était froide et personne ne m'a répondu.");
  assert.ok(r, 'aucune branche ne traite la réclamation');
  assert.match(r.reply, /d[ée]sol[ée]/i);
  assert.doesNotMatch(r.reply, /douches individuelles/i);
  assert.match(r.reply, /accueil|[ée]quipe/i);
});

test('la réclamation vouvoie Fabien', () => {
  const r = demande("C'est inadmissible, j'attends une réponse depuis 3 jours.", { persona: fabien });
  assert.match(r.reply, /vous|votre/i);
  assert.doesNotMatch(r.reply, /\bton\b|\btu\b/i);
});

test('une vraie question sur les douches reste informative', () => {
  const r = demande('Il y a des douches dans la salle ?');
  assert.match(r.reply, /douches individuelles/i);
});

test('les frais annexes annoncent le badge à 34,99 €', () => {
  for (const q of ["Il y a des frais en plus à l'inscription ?", 'Y a-t-il des coûts cachés ?']) {
    const r = demande(q);
    assert.ok(r, q);
    assert.match(r.reply, /34,99/);
    assert.match(r.reply, /badge/i);
  }
});

test('la liste des disciplines cite le MMA, le Grappling et le JJB', () => {
  const r = demande('Vous proposez quoi comme disciplines ?', { persona: nassim });
  assert.ok(r);
  assert.match(r.reply, /MMA/);
  assert.match(r.reply, /Grappling/i);
  assert.match(r.reply, /JJB/i);
  assert.match(r.reply, /Boxe Anglaise/i);
  assert.doesNotMatch(r.reply, /pugilat/i);
});

test('« la différence entre les cours » n’est pas avalée par la liste des disciplines', () => {
  const r = demande("C'est quoi la différence entre les cours ?");
  assert.match(r.reply, /Baby Boxe/i);
  assert.match(r.reply, /loisir|tous niveaux/i);
});

test('« vous ouvrez à quelle heure le samedi ? » donne les horaires du club', () => {
  for (const q of ['Vous ouvrez à quelle heure le samedi ?', 'La salle ferme à quelle heure ?']) {
    const r = demande(q);
    assert.ok(r, q);
    assert.match(r.reply, /10h|10h00/);
    assert.match(r.reply, /21h30/);
  }
});

test('le rappel « on ne dit pas 29 € par mois » ne sort que si le visiteur parle de mensualité', () => {
  const froid = demande("C'est combien l'abonnement ?");
  assert.doesNotMatch(froid.reply, /On ne dit pas/i);
  assert.match(froid.reply, /29,99/);
  assert.match(froid.reply, /259/);

  const mensuel = demande('Donc ça fait 29,99 € par mois c’est ça ?');
  assert.match(mensuel.reply, /4 semaines/i);
  assert.match(mensuel.reply, /pas (une fois par mois|mensuel)/i);
});

test('un adulte de 45 ans n’est pas renvoyé vers la Boxe Éducative 7–11 ans', () => {
  const r = demande("j'ai 45 ans et je n'ai rien fait depuis 10 ans", {
    lastBot: 'Oui — un enfant : **250 €** la saison (Baby Boxe) et **295 €** (éducative).',
    messages: [{ role: 'user', content: 'je cherche un cours pour ma fille de 5 ans' }],
  });
  if (r) assert.doesNotMatch(r.reply, /7–11|7-11/);
});

test('« et moi aussi, c’est combien ? » bascule sur les tarifs adultes', () => {
  const r = demande("et si moi aussi je veux m'y mettre, c'est combien ?", {
    lastBot: 'Pour elle : **250 €** la saison en Baby Boxe.',
    messages: [{ role: 'user', content: 'un cours pour ma fille de 5 ans' }],
  });
  assert.match(r.reply, /29,99/);
});

test('« éducative » prononcé par le bot n’impose pas les tarifs enfants', () => {
  const histoire = [
    { role: 'user', content: 'je veux me remettre au sport' },
    {
      role: 'assistant',
      content: 'On a le même style de cours, y compris le Boxing Camp et la boxe éducative.',
    },
  ];
  const r = demande("ok et le prix c'est le même partout ?", {
    persona: nassim,
    lastBot: histoire[1].content,
    messages: histoire,
  });
  assert.match(r.reply, /29,99/);
  assert.doesNotMatch(r.reply, /250|295/);
});

test('un contexte enfant réellement ouvert par le bot conserve les tarifs enfants', () => {
  const histoire = [
    { role: 'user', content: 'Minimes' },
    { role: 'assistant', content: 'Le planning **Baby Boxe / éducative** de **Minimes**.' },
  ];
  const r = demande('Ok et les prix ?', { lastBot: histoire[1].content, messages: histoire });
  assert.match(r.reply, /250/);
  assert.match(r.reply, /295/);
});
