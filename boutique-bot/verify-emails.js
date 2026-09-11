'use strict';
/**
 * Vérifie TOUS les emails candidats sans envoyer de mail.
 * Microsoft GetCredentialType + SMTP RCPT (aucun DATA) + alias Gmail.
 * Garde uniquement les statuts ok.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const dns = require('dns').promises;
const express = require('express');

const MS_DOMAINS = new Set(['hotmail.fr', 'hotmail.com', 'outlook.fr', 'outlook.com', 'live.fr', 'live.com', 'msn.com']);
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const DOMAINS = [
  'gmail.com', 'orange.fr', 'wanadoo.fr', 'hotmail.fr', 'outlook.fr',
  'outlook.com', 'live.fr', 'free.fr', 'sfr.fr', 'yahoo.fr', 'laposte.net', 'icloud.com',
];
const MS_OK = new Set([0, 5, 6]);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const EMAIL_RE = /^[a-z0-9][a-z0-9._+-]{0,62}@[a-z0-9.-]+\.[a-z]{2,}$/;

const mxCache = new Map();
const domainKind = new Map();
const cache = new Map();
let smtpOk = true;
let job = {
  running: false,
  stopping: false,
  i: 0,
  total: 0,
  checked: 0,
  ok: 0,
  invalid: 0,
  unknown: 0,
  error: 0,
  hits: 0,
  startedAt: null,
  message: '',
};

function slugCompact(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function slugPoints(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[\s-]+/g, '.')
    .replace(/[^a-z0-9.]+/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.|\.$/g, '');
}
function unique(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
function canonical(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.indexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '').split('+')[0];
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}
function generateAll(prenom, nom) {
  const p = slugCompact(prenom);
  const n = slugCompact(nom);
  if (!p || !n) return [];
  const pp = slugPoints(prenom);
  const np = slugPoints(nom);
  const firstNom = slugCompact(String(nom).split(/[\s-]+/)[0] || '');
  const out = [];
  for (const domain of DOMAINS) {
    out.push(`${pp}.${np}@${domain}`, `${p}.${n}@${domain}`, `${p}${n}@${domain}`, `${p[0]}.${n}@${domain}`, `${p[0]}${n}@${domain}`);
    if (firstNom && firstNom !== n) out.push(`${p}.${firstNom}@${domain}`, `${p[0]}.${firstNom}@${domain}`);
  }
  return unique(out.map(canonical));
}

async function mxHosts(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  try {
    const recs = await dns.resolveMx(domain);
    recs.sort((a, b) => a.priority - b.priority);
    const hosts = recs.map((r) => String(r.exchange).replace(/\.$/, ''));
    mxCache.set(domain, hosts);
    return hosts;
  } catch {
    mxCache.set(domain, []);
    return [];
  }
}

function smtpRcpt(mx, email, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    let buf = '';
    let step = 0;
    const sock = net.connect({ host: mx, port: 25 });
    const finish = (code, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch { /* ignore */ }
      resolve({ code, detail: String(detail || '').replace(/\s+/g, ' ').slice(0, 160) });
    };
    const timer = setTimeout(() => finish(null, 'TimeoutError'), timeoutMs);
    const send = (line) => {
      try { sock.write(`${line}\r\n`); } catch (err) { finish(null, err.message); }
    };
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (line[3] === '-' || !code) continue;
        if (step === 0) { step = 1; send('EHLO verify.local'); }
        else if (step === 1) { step = 2; send('MAIL FROM:<>'); }
        else if (step === 2) { step = 3; send(`RCPT TO:<${email}>`); }
        else if (step === 3) { send('QUIT'); finish(code, line); }
      }
    });
    sock.on('error', (err) => finish(null, err.message));
    sock.on('close', () => finish(null, 'closed'));
  });
}

async function probeSmtp() {
  const hosts = await mxHosts('gmail.com');
  if (!hosts.length) return false;
  const r = await smtpRcpt(hosts[0], 'zzzxqneexistepas12345@gmail.com', 5000);
  return !(r.code == null && /timeout/i.test(r.detail));
}

async function kindOf(domain) {
  if (domainKind.has(domain)) return domainKind.get(domain);
  const hosts = await mxHosts(domain);
  let kind = 'verify';
  if (MS_DOMAINS.has(domain)) kind = 'microsoft';
  else if (!hosts.length) kind = 'nomx';
  else if (!smtpOk) kind = 'nosmtp';
  else {
    const fake = `zzzxqneexistepas${Math.floor(Math.random() * 1e9)}@${domain}`;
    const r = await smtpRcpt(hosts[0], fake, 8000);
    if (r.code === 250 || r.code === 251) kind = 'catchall';
    else if (r.code == null) kind = 'smtpfail';
    else if (r.code >= 500) kind = 'verify';
    else kind = 'unknown';
  }
  domainKind.set(domain, kind);
  console.log(`[verify] domaine ${domain}: ${kind}`);
  return kind;
}

async function checkMicrosoft(email) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch('https://login.microsoftonline.com/common/GetCredentialType', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ username: email, isOtherIdpSupported: true, checkPhones: false }),
      });
      const data = await res.json();
      const code = data.IfExistsResult;
      if (code === 2 || (data.ThrottleStatus && data.ThrottleStatus !== 0)) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      if (MS_OK.has(code)) return { status: 'ok', method: 'microsoft', detail: `IfExistsResult=${code}` };
      if (code === 1) return { status: 'invalid', method: 'microsoft', detail: `IfExistsResult=${code}` };
      return { status: 'unknown', method: 'microsoft', detail: `IfExistsResult=${code}` };
    } catch (err) {
      if (attempt === 3) return { status: 'error', method: 'microsoft', detail: err.message };
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return { status: 'unknown', method: 'microsoft', detail: 'throttle' };
}

async function checkSmtp(email) {
  const domain = email.split('@')[1];
  const kind = await kindOf(domain);
  if (kind === 'nomx') return { status: 'invalid', method: 'smtp', detail: 'no_mx' };
  if (kind === 'catchall' || kind === 'nosmtp' || kind === 'smtpfail') {
    return { status: 'unknown', method: 'smtp', detail: kind };
  }
  const hosts = await mxHosts(domain);
  let last = 'smtp';
  for (const mx of hosts.slice(0, 2)) {
    const r = await smtpRcpt(mx, email);
    last = `${r.code} ${r.detail}`;
    if (r.code === 250 || r.code === 251 || r.code === 552) return { status: 'ok', method: 'smtp', detail: last };
    if (r.code != null && r.code >= 500) return { status: 'invalid', method: 'smtp', detail: last };
  }
  return { status: 'unknown', method: 'smtp', detail: last };
}

async function verifyOne(email) {
  if (!EMAIL_RE.test(email) || email.includes('..')) return { status: 'invalid', method: 'syntax', detail: '' };
  const domain = email.split('@')[1];
  if (MS_DOMAINS.has(domain)) return checkMicrosoft(email);
  return checkSmtp(email);
}

async function poolMap(items, workers, fn) {
  const ret = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx]);
    }
  }
  const n = Math.min(workers, items.length) || 1;
  await Promise.all(Array.from({ length: n }, worker));
  return ret;
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(';').map((h) => h.trim().toLowerCase());
  const rows = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(';');
    const row = {};
    headers.forEach((h, idx) => { row[h] = parts[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

function csvEscape(v) {
  return String(v || '').replace(/;/g, ',');
}

async function runJob(opts) {
  if (job.running) return;
  const dataDir = opts.dataDir;
  const sourcePath = opts.sourcePath;
  const outPath = path.join(dataDir, 'emails_delivrables.csv');
  const cachePath = path.join(dataDir, 'email-verify-cache.jsonl');
  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(cachePath)) {
    for (const line of fs.readFileSync(cachePath, 'utf8').split(/\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.email && row.status) cache.set(row.email, row.status);
      } catch { /* ignore */ }
    }
  }
  const raw = fs.readFileSync(sourcePath, 'utf8');
  const contacts = parseCsv(raw);
  job = {
    running: true,
    stopping: false,
    i: 0,
    total: contacts.length,
    checked: 0,
    ok: 0,
    invalid: 0,
    unknown: 0,
    error: 0,
    hits: 0,
    startedAt: new Date().toISOString(),
    message: 'start',
  };
  console.log(`[verify] ${contacts.length} contacts, cache ${cache.size}, smtp probe…`);
  smtpOk = await probeSmtp();
  console.log(`[verify] SMTP ${smtpOk ? 'ok' : 'bloque'}`);
  for (const d of DOMAINS) await kindOf(d);

  const cacheFd = fs.openSync(cachePath, 'a');
  const outFd = fs.openSync(outPath, 'w');
  fs.writeSync(outFd, 'nom;prenom;telephone;adresse;code_postal;ville;email_prioritaire;emails_candidats\n');
  const workers = Math.max(4, parseInt(process.env.EMAIL_VERIFY_WORKERS || '16', 10) || 16);

  const pending = [];
  const flush = async () => {
    const missing = unique(pending.flatMap((p) => p.emails)).filter((e) => !cache.has(e));
    if (missing.length) {
      const results = await poolMap(missing, workers, verifyOne);
      for (let i = 0; i < missing.length; i++) {
        const email = missing[i];
        const r = results[i] || { status: 'error', method: 'none', detail: '' };
        cache.set(email, r.status);
        job[r.status] = (job[r.status] || 0) + 1;
        job.checked += 1;
        fs.writeSync(cacheFd, JSON.stringify({ email, ...r }) + '\n');
      }
    }
    for (const p of pending) {
      const oks = p.emails.filter((e) => cache.get(e) === 'ok');
      if (!oks.length) continue;
      job.hits += 1;
      const line = [p.row.nom, p.row.prenom, p.row.telephone, p.row.adresse, p.row.code_postal, p.row.ville, oks[0], oks.join(' | ')]
        .map(csvEscape)
        .join(';');
      fs.writeSync(outFd, line + '\n');
    }
    pending.length = 0;
  };

  let batchEmails = 0;
  for (let i = 0; i < contacts.length; i++) {
    if (job.stopping) break;
    const row = contacts[i];
    const emails = generateAll(row.prenom, row.nom);
    pending.push({ row, emails });
    batchEmails += emails.length;
    job.i = i + 1;
    if (batchEmails >= 2500) {
      await flush();
      batchEmails = 0;
      job.message = `${job.i}/${job.total} hits=${job.hits} ok=${job.ok}`;
      if (job.i % 200 === 0) console.log('[verify]', job.message);
    }
  }
  await flush();
  fs.closeSync(cacheFd);
  fs.closeSync(outFd);
  job.running = false;
  job.message = `done hits=${job.hits}`;
  console.log('[verify] terminé', job);
}

function requireSecret(secret) {
  return (req, res, next) => {
    const got = String(req.headers['x-api-secret'] || req.query.secret || '').trim();
    if (secret && got !== secret) return res.status(401).json({ error: 'unauthorized' });
    next();
  };
}

function attachEmailVerify(app, opts) {
  const secret = opts.secret || '';
  const dataDir = opts.dataDir;
  const auth = requireSecret(secret);
  fs.mkdirSync(dataDir, { recursive: true });

  app.get('/api/verify/status', (_req, res) => {
    res.json({ ok: true, smtpOk, domains: Object.fromEntries(domainKind), job, cache: cache.size });
  });

  app.post('/api/verify/upload', express.raw({ type: '*/*', limit: '60mb' }), auth, (req, res) => {
    const dest = path.join(dataDir, 'contacts.csv');
    fs.writeFileSync(dest, req.body || Buffer.from(''));
    res.json({ ok: true, bytes: (req.body || []).length, path: dest });
  });

  app.post('/api/verify/start', auth, async (req, res) => {
    const sourcePath = path.join(dataDir, 'contacts.csv');
    if (!fs.existsSync(sourcePath)) return res.status(400).json({ error: 'upload contacts.csv first' });
    if (job.running) return res.json({ ok: true, already: true, job });
    res.json({ ok: true, started: true });
    runJob({ dataDir, sourcePath }).catch((err) => {
      job.running = false;
      job.message = err.message;
      console.error('[verify]', err);
    });
  });

  app.get('/api/verify/download', auth, (req, res) => {
    const p = path.join(dataDir, 'emails_delivrables.csv');
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'pas encore pret' });
    res.download(p, 'emails_delivrables.csv');
  });

  if (String(process.env.EMAIL_VERIFY || '1') !== '0') {
    const auto = path.join(dataDir, 'contacts.csv');
    if (fs.existsSync(auto)) {
      setTimeout(() => {
        runJob({ dataDir, sourcePath: auto }).catch((err) => console.error('[verify] auto', err));
      }, 4000);
    } else {
      console.log('[verify] en attente de POST /api/verify/upload (tous les candidats)');
    }
  }
}

module.exports = { attachEmailVerify, generateAll };
