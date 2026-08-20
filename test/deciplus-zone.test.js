const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  zonePickerUrls,
  isForbiddenZoneUrl,
  isHomeWithoutPicker,
  isOnWorkingNextgen,
  deciplusOrigin,
} = require('../bot/deciplus-zone');

test('picker zone — choose-zone d’abord, jamais l’accueil', () => {
  const urls = zonePickerUrls('https://boxingcenter.deciplus.pro');
  assert.equal(urls.length, 3);
  assert.ok(urls.every((u) => /choose-zone/i.test(u)));
  assert.ok(urls.every((u) => !/forced=true/i.test(u)));
  assert.equal(urls[0], 'https://boxingcenter.deciplus.pro/nextgen/choose-zone?nextUrl=/home');
  assert.equal(deciplusOrigin('https://boxingcenter.deciplus.pro/nextgen/'), 'https://boxingcenter.deciplus.pro');
});

test('accueil nextgen n’est pas le picker', () => {
  assert.equal(isHomeWithoutPicker('https://boxingcenter.deciplus.pro/nextgen/home'), true);
  assert.equal(isHomeWithoutPicker('https://boxingcenter.deciplus.pro/nextgen/'), true);
  assert.equal(
    isHomeWithoutPicker('https://boxingcenter.deciplus.pro/nextgen/choose-zone?nextUrl=/home'),
    false
  );
  assert.equal(isForbiddenZoneUrl('https://boxingcenter.deciplus.pro/nextgen/legacy?path=acces_interdit.php'), true);
  assert.equal(isForbiddenZoneUrl('https://boxingcenter.deciplus.pro/nextgen/home'), false);
  assert.equal(isOnWorkingNextgen('https://boxingcenter.deciplus.pro/nextgen/home'), true);
  assert.equal(isOnWorkingNextgen('https://boxingcenter.deciplus.pro/nextgen/'), true);
  assert.equal(
    isOnWorkingNextgen('https://boxingcenter.deciplus.pro/nextgen/choose-zone?nextUrl=/home'),
    false
  );
  assert.equal(
    isOnWorkingNextgen('https://boxingcenter.deciplus.pro/nextgen/legacy?path=acces_interdit.php'),
    false
  );
});

test('switchDeciplusSite n’accepte plus /home comme entrée picker', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'deciplus-zone.js'), 'utf8');
  assert.match(src, /openChooseZonePicker/);
  assert.match(src, /zonePickerUrls/);
  assert.doesNotMatch(
    src,
    /const entries = \[\s*'nextgen\/home'/
  );
});

test('ne pas fermer la modale picker choose-zone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bot', 'ui.js'), 'utf8');
  assert.match(src, /choose-zone/i);
  assert.match(src, /Choisissez un site/);
});
