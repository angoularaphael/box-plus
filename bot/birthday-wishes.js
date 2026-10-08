'use strict';

const { getGymConfig } = require('../lib/normalize');
const { BOXING_CENTER_GYM_SLUGS } = require('../lib/gym-slugs');
const { existingSiteConfig } = require('../lib/deciplus-sites');
const { logInfo, logWarn } = require('../lib/logger');
const { login, getAccessToken, gotoDeciplus } = require('./auth');
const { runWithSession } = require('./browser-pool');
const {
  isBirthdayToday,
  isSkipMember,
  shouldRunAt,
  parisNow,
  loadState,
  saveState,
  alreadySent,
  markSent,
  sendBirthdayWish,
  gymSpokenName,
} = require('../storefront/lib/birthday-wishes');

function zoneIds() {
  const seen = new Set();
  for (const slug of BOXING_CENTER_GYM_SLUGS) {
    const gym = getGymConfig(slug);
    const ids = [gym.deciplus_zone_id, existingSiteConfig(gym)?.deciplus_zone_id];
    for (const id of ids) {
      const z = String(id || '').trim();
      if (z && z !== '1') seen.add(z);
    }
  }
  return [...seen];
}

function apiHeaders(token) {
  return {
    'x-access-token': token,
    'Deciplus-Client-Type': 'manager',
    Accept: 'application/json',
  };
}

async function readJson(res) {
  return res.json().catch(() => ({}));
}

function mapRow(row, zone) {
  return {
    member_id: String(row.id || ''),
    first_name: row.name || row.firstName || '',
    last_name: row.surname || row.lastName || '',
    email: row.email || row.mail || '',
    phone: row.mobile || row.phone || row.tel || '',
    birthdate: row.birthdate || row.birthDate || row.birthday || '',
    zone,
    gym_label: gymSpokenName({ zone }),
  };
}

async function listZoneMembers(page, headers, zoneId) {
  const all = [];
  const seen = new Set();
  let expected = null;
  for (let pageNo = 1; pageNo <= 80; pageNo += 1) {
    const res = await page.context().request.get(
      `https://api.deciplus.pro/staff/v1/members?zoneId=${encodeURIComponent(zoneId)}&page=${pageNo}&perPage=100`,
      { headers, timeout: 30000 }
    );
    const body = await readJson(res);
    if (res.status() !== 200) {
      throw new Error(`Liste zone ${zoneId} page ${pageNo} HTTP ${res.status()}`);
    }
    const rows = body.response?.rows || [];
    expected = Number(body.response?.count ?? expected ?? 0);
    if (!rows.length) break;
    let added = 0;
    for (const row of rows) {
      const id = String(row.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push(mapRow(row, zoneId));
      added += 1;
    }
    if (added === 0) break;
    if (expected && all.length >= expected) break;
  }
  return all;
}

async function hydrateMember(page, headers, member) {
  if (member.email && member.birthdate) return member;
  const res = await page.context().request.get(`https://api.deciplus.pro/staff/v1/member/${member.member_id}`, {
    headers,
    timeout: 20000,
  });
  const body = await readJson(res);
  const root = body.response || body;
  return {
    ...member,
    first_name: member.first_name || root.name || root.firstName || '',
    last_name: member.last_name || root.surname || root.lastName || '',
    email: member.email || root.email || root.mail || '',
    phone: member.phone || root.mobile || root.phone || root.tel || '',
    birthdate: member.birthdate || root.birthdate || root.birthDate || '',
  };
}

async function collectBirthdayMembers(page, headers, now) {
  const out = [];
  const seen = new Set();
  let scanned = 0;
  for (const zone of zoneIds()) {
    const rows = await listZoneMembers(page, headers, zone);
    scanned += rows.length;
    for (const row of rows) {
      if (!row.member_id || seen.has(row.member_id)) continue;
      if (!isBirthdayToday(row.birthdate, now)) continue;
      seen.add(row.member_id);
      out.push(row);
    }
  }
  const hydrated = [];
  for (const row of out) {
    if (isSkipMember(row)) continue;
    hydrated.push(await hydrateMember(page, headers, row));
  }
  const members = hydrated.filter((m) => !isSkipMember(m));
  members._scanned = scanned;
  return members;
}

async function runBirthdayWishes({ force = false } = {}) {
  const role = String(process.env.BOT_ROLE || 'all').toLowerCase();
  if (role === 'sales') return { skipped: true, reason: 'sales_bot' };

  const now = new Date();
  const today = parisNow(now);
  const state = loadState();
  if (!force && !shouldRunAt(now, state.last_date)) {
    return { skipped: true, reason: 'not_due', last_date: state.last_date, today: today.dateKey };
  }

  const report = {
    date: today.dateKey,
    scanned: 0,
    due: 0,
    sent: 0,
    results: [],
  };

  await runWithSession('birthday-wishes', async (page) => {
    await gotoDeciplus(page, 'nextgen/home').catch(() => {});
    let token = await getAccessToken(page);
    if (!token) {
      await login(page, { siteLabel: 'Minimes' });
      token = await getAccessToken(page);
    }
    if (!token) throw new Error('Token Deciplus introuvable');
    const headers = apiHeaders(token);
    const members = await collectBirthdayMembers(page, headers, now);
    report.scanned = members._scanned || 0;
    report.due = members.length;
    for (const member of members) {
      if (alreadySent(state, member.member_id, today.dateKey)) {
        report.results.push({ member_id: member.member_id, skipped: 'already_sent' });
        continue;
      }
      const out = await sendBirthdayWish(member, { email: true });
      markSent(state, member.member_id, today.dateKey, {
        email: Boolean(out.email?.sent),
        sms: false,
      });
      if (out.email?.sent) report.sent += 1;
      report.results.push(out);
      await page.waitForTimeout(400);
    }
  });

  state.last_date = today.dateKey;
  saveState(state);
  logInfo('Anniversaires du jour', {
    date: report.date,
    due: report.due,
    sent: report.sent,
  });
  return report;
}

async function maybeRunBirthdayWishes() {
  try {
    const preview = shouldRunAt(new Date(), loadState().last_date);
    if (!preview && String(process.env.BIRTHDAY_RUN_NOW || '') !== '1') return;
    return await runBirthdayWishes();
  } catch (err) {
    logWarn('Anniversaires', { error: err.message });
    return { ok: false, error: err.message };
  }
}

module.exports = {
  zoneIds,
  collectBirthdayMembers,
  runBirthdayWishes,
  maybeRunBirthdayWishes,
};
