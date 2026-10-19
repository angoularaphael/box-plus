'use strict';

function seanceOfferteSmsLink() {
  return 'https://seance-offerte.boxingcenter.fr/s';
}

function sport2000SmsTemplate() {
  return `Salut {prenom}, c'est David du Boxing Center ! Jamais fait de boxe ? On t'invite a une seance offerte dans n'importe quelle salle du club, debutant OK : ${seanceOfferteSmsLink()} STOP: reponds STOP`;
}

module.exports = { seanceOfferteSmsLink, sport2000SmsTemplate };
