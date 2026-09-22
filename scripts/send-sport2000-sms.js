'use strict';

/**
 * Campagne SMS Sport2000 — même offre séance offerte David que le mail Sport2000
 * (débutant / jamais fait de boxe). Lien : ?src=sms uniquement.
 *
 *   node scripts/send-sport2000-sms.js --dry
 *   node scripts/send-sport2000-sms.js --now
 *   node scripts/send-sport2000-sms.js --at=10:00
 *   node scripts/send-sport2000-sms.js --status
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const ROOT = path.join(__dirname, '..');
loadEnvFile(path.join(ROOT, '.env'));

const SMS_API = (process.env.SMS_GATEWAY_URL || 'http://prem-eu2.bot-hosting.net:21724').replace(
  /\/$/,
  ''
);
const SMS_EMAIL = process.env.SMS_GATEWAY_EMAIL || 'angoularaphael05@gmail.com';
const SMS_PASSWORD = process.env.SMS_GATEWAY_PASSWORD || 'Fareno12';
const {
  seanceOfferteSmsLink,
  sport2000SmsTemplate,
} = require('../../boxing-center-bot/lib/sport2000-seance-offerte');

const LINK = seanceOfferteSmsLink();
const CAMPAIGN_NAME = `Sport2000 seance offerte ${parisStamp()}`;
const STATE_FILE = path.join(ROOT, 'data', 'sport2000-sms-campaign.json');
const AUDIENCE_FILE = path.join(ROOT, 'data', 'sport2000-sms-audience.json');
const DEFAULT_XLSX = path.join(ROOT, '..', 'sport2000 France City and dob Filter FIXED.xlsx');

const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');
const STATUS_ONLY = process.argv.includes('--status');
const NOW = process.argv.includes('--now');
const AT = process.argv.find((a) => a.startsWith('--at='))?.slice(5) || (NOW ? '' : '10:00');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) || 0);
const CHUNK = Math.max(20, Number(process.argv.find((a) => a.startsWith('--chunk='))?.slice(8) || 80));
const XLSX_PATH = path.resolve(
  process.argv.find((a) => a.startsWith('--xlsx='))?.slice(7) || DEFAULT_XLSX
);

function parisStamp() {
  return new Date()
    .toLocaleString('sv-SE', { timeZone: 'Europe/Paris' })
    .slice(0, 16)
    .replace('T', ' ')
    .replace(' ', ' ');
}

function parisClock() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(11, 16);
}

function sport2000SmsText() {
  return sport2000SmsTemplate();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeCsv(value) {
  const s = String(value || '').replace(/"/g, '""');
  if (/[",\n\r]/.test(s)) return `"${s}"`;
  return s;
}

function stripPhone(raw) {
  return String(raw || '')
    .replace(/[\s.\-()]/g, '')
    .trim();
}

function normalizeFrenchMobile(raw) {
  let digits = stripPhone(raw);
  if (!digits) return '';
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (/^\+33[67]\d{8}$/.test(digits)) return digits;
  if (/^33[67]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^0[67]\d{8}$/.test(digits)) return `+33${digits.slice(1)}`;
  return '';
}

function waitMsUntilParis(hhmm) {
  if (!hhmm) return 0;
  const now = parisClock();
  if (now >= hhmm) return 0;
  const [th, tm] = hhmm.split(':').map((n) => parseInt(n, 10));
  const [nh, nm] = now.split(':').map((n) => parseInt(n, 10));
  const target = th * 60 + tm;
  const cur = nh * 60 + nm;
  return Math.max(0, (target - cur) * 60 * 1000);
}

async function sms(pathname, { method = 'GET', token, body, form, timeoutMs = 120000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${SMS_API}${pathname}`, {
      method,
      headers,
      body: payload,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    throw new Error(json?.error || json?.message || text.slice(0, 240) || `HTTP ${res.status}`);
  }
  return json;
}

function exportAudience(xlsxPath, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const py = `
import json, re, sys
try:
    import openpyxl
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "openpyxl", "-q"])
    import openpyxl

def strip_phone(raw):
    return re.sub(r"[\\s.\\-()]", "", str(raw or "").strip())

def normalize(raw):
    digits = strip_phone(raw)
    if not digits:
        return ""
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if digits.startswith("+"):
        return digits if re.match(r"^\\+33[67]\\d{8}$", digits) else ""
    if re.match(r"^33[67]\\d{8}$", digits):
        return "+" + digits
    if re.match(r"^0[67]\\d{8}$", digits):
        return "+33" + digits[1:]
    return ""

src, dest = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
rows = 0
empty = 0
skipped = 0
by = {}
for r in ws.iter_rows(values_only=True):
    rows += 1
    prenom = str(r[0] or "").strip()
    nom = str(r[1] or "").strip()
    phone = normalize(r[9] if len(r) > 9 else "")
    if not str(r[9] if len(r) > 9 else "" or "").strip():
        empty += 1
        continue
    if not phone:
        skipped += 1
        continue
    if phone in by:
        continue
    by[phone] = {"prenom": prenom or "Sport2000", "nom": nom or "-", "telephone": phone}
wb.close()
audience = list(by.values())
out = {"rows": rows, "empty": empty, "skipped": skipped, "unique": len(audience), "audience": audience}
with open(dest, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print(json.dumps({"rows": rows, "empty": empty, "skipped": skipped, "unique": len(audience)}))
`;
  const result = spawnSync('python', ['-c', py, xlsxPath, outFile], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'export python failed');
  }
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

function loadAudience() {
  const parsed = JSON.parse(fs.readFileSync(AUDIENCE_FILE, 'utf8'));
  let list = parsed.audience || [];
  if (LIMIT > 0) list = list.slice(0, LIMIT);
  return { meta: { rows: parsed.rows, empty: parsed.empty, skipped: parsed.skipped, unique: parsed.unique }, list };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function csvChunk(rows) {
  const header = 'prenom,nom,telephone';
  const lines = rows.map((c) => `${escapeCsv(c.prenom)},${escapeCsv(c.nom)},${c.telephone}`);
  return [header, ...lines].join('\n');
}

async function importChunk(token, campaignId, rows, index, totalChunks) {
  const csv = csvChunk(rows);
  const form = new FormData();
  const file =
    typeof File === 'function'
      ? new File([csv], `sport2000-${index}.csv`, { type: 'text/csv' })
      : new Blob([csv], { type: 'text/csv' });
  form.append('file', file, `sport2000-${index}.csv`);
  const out = await sms(`/api/campaigns/${campaignId}/import`, {
    method: 'POST',
    token,
    form,
    timeoutMs: 180000,
  });
  console.log(
    JSON.stringify({
      import: index + 1,
      of: totalChunks,
      created: out.created,
      skippedDuplicates: out.skippedDuplicates,
      fileDuplicates: out.fileDuplicates,
      errors: Array.isArray(out.errors) ? out.errors.length : 0,
    })
  );
  return out;
}

async function main() {
  const message = sport2000SmsText();
  if (STATUS_ONLY) {
    const state = loadState();
    if (!state?.campaignId) {
      console.log(JSON.stringify({ ok: false, error: 'pas de campagne enregistree' }));
      return;
    }
    const login = await sms('/api/auth/login', {
      method: 'POST',
      body: { email: SMS_EMAIL, password: SMS_PASSWORD },
    });
    const stats = await sms(`/api/campaigns/${state.campaignId}/stats`, { token: login.token });
    const dash = await sms('/api/dashboard', { token: login.token });
    console.log(JSON.stringify({ ok: true, campaignId: state.campaignId, stats, devices: dash.devices }, null, 2));
    return;
  }

  if (!fs.existsSync(XLSX_PATH)) {
    throw new Error(`Fichier introuvable: ${XLSX_PATH}`);
  }

  console.log(JSON.stringify({ export: XLSX_PATH }));
  const exported = exportAudience(XLSX_PATH, AUDIENCE_FILE);
  const { meta, list } = loadAudience();
  const waitMs = waitMsUntilParis(AT);
  const summary = {
    unique: meta.unique,
    queue: list.length,
    empty: meta.empty,
    skipped: meta.skipped,
    rows: meta.rows,
    sms_chars: message.length,
    campaign: CAMPAIGN_NAME,
    at: AT || 'now',
    waitMs,
    gateway: SMS_API,
    mode: DRY ? 'dry' : 'send',
  };
  console.log(JSON.stringify({ summary }, null, 2));
  console.log(message);

  if (DRY) return;

  if (waitMs > 0) {
    console.log(JSON.stringify({ wait_until: AT, waitMs, paris: parisClock() }));
    await sleep(waitMs);
  }

  const login = await sms('/api/auth/login', {
    method: 'POST',
    body: { email: SMS_EMAIL, password: SMS_PASSWORD },
  });
  const token = login.token;
  const dash = await sms('/api/dashboard', { token });
  const online = Number(dash.devices?.online ?? 0);
  const total = Number(dash.devices?.total ?? 0);
  console.log(JSON.stringify({ devices: dash.devices, contacts: dash.contacts }));
  if (online <= 0) {
    throw new Error(
      `Aucun telephone SMS en ligne (${online}/${total}). Branche les appareils avant --now.`
    );
  }

  const campaign = await sms('/api/campaigns', {
    method: 'POST',
    token,
    body: { name: CAMPAIGN_NAME, message },
  });
  const state = {
    campaignId: campaign.id,
    name: campaign.name,
    startedAt: null,
    imported: 0,
    audience: list.length,
    at: new Date().toISOString(),
  };
  saveState(state);

  const totalChunks = Math.ceil(list.length / CHUNK);
  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK);
    const out = await importChunk(token, campaign.id, slice, Math.floor(i / CHUNK), totalChunks);
    state.imported += Number(out.created || 0);
    saveState(state);
  }

  const started = await sms(`/api/campaigns/${campaign.id}/start`, {
    method: 'POST',
    token,
    body: {},
    timeoutMs: 20 * 60 * 1000,
  });
  state.startedAt = new Date().toISOString();
  state.queued = started.queued;
  saveState(state);

  const stats = await sms(`/api/campaigns/${campaign.id}/stats`, { token }).catch(() => null);
  console.log(
    JSON.stringify(
      {
        ok: true,
        campaignId: campaign.id,
        name: campaign.name,
        queued: started.queued,
        imported: state.imported,
        stats,
        devices: dash.devices,
        stateFile: STATE_FILE,
      },
      null,
      2
    )
  );
}

module.exports = {
  CAMPAIGN_NAME,
  LINK,
  sport2000SmsText,
  normalizeFrenchMobile,
  waitMsUntilParis,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
