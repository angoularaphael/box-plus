#!/usr/bin/env node
/**
 * Phase 1 — Enregistre les requêtes HTTP et interactions DOM pendant une session Deciplus.
 * Usage: npm run analyze:record
 * Commandes interactives pendant la session:
 *   m + Entrée  → marquer un milestone (ex: "create-member")
 *   s + Entrée  → screenshot
 *   q + Entrée  → quitter et sauvegarder
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');
const {
  ROOT,
  ensureDir,
  timestamp,
  redactHeaders,
  safeParseJson,
  truncate,
} = require('../lib/utils');

const OUTPUT_DIR = path.resolve(
  process.env.ANALYZER_OUTPUT_DIR || path.join(ROOT, 'analyzer', 'output')
);
const SCENARIO = process.env.ANALYZER_SCENARIO || 'manual';
const SESSION_ID = `session-${timestamp()}-${SCENARIO}`;

const INTERESTING_TYPES = new Set(['xhr', 'fetch', 'document', 'script']);
const INTERESTING_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function shouldCaptureRequest(request) {
  const type = request.resourceType();
  const method = request.method();
  if (INTERESTING_METHODS.has(method)) return true;
  return INTERESTING_TYPES.has(type) && method !== 'OPTIONS';
}

function buildSessionState() {
  return {
    id: SESSION_ID,
    scenario: SCENARIO,
    started_at: new Date().toISOString(),
    deciplus_url: process.env.DECIPLUS_URL || '',
    milestones: [],
    network: [],
    dom_events: [],
    screenshots: [],
    pages: [],
  };
}

function attachNetworkListeners(page, state) {
  page.on('request', (request) => {
    if (!shouldCaptureRequest(request)) return;
    const entry = {
      ts: new Date().toISOString(),
      phase: 'request',
      url: request.url(),
      method: request.method(),
      resource_type: request.resourceType(),
      headers: redactHeaders(request.headers()),
      post_data: truncate(request.postData() || ''),
    };
    state.network.push(entry);
  });

  page.on('response', async (response) => {
    const request = response.request();
    if (!shouldCaptureRequest(request)) return;
    let body = '';
    try {
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('json') || ct.includes('text') || ct.includes('javascript')) {
        body = truncate(await response.text(), 8000);
      }
    } catch {
      body = '[unreadable]';
    }
    state.network.push({
      ts: new Date().toISOString(),
      phase: 'response',
      url: response.url(),
      method: request.method(),
      status: response.status(),
      headers: redactHeaders(response.headers()),
      body,
      body_json: safeParseJson(body),
    });
  });
}

function attachDomListeners(page, state) {
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    state.pages.push({ ts: new Date().toISOString(), url: frame.url() });
  });

  page.exposeFunction('__boxplusRecordDom', (payload) => {
    state.dom_events.push({ ts: new Date().toISOString(), ...payload });
  }).catch(() => {});

  page.addInitScript(() => {
    const describeEl = (el) => {
      if (!el || !el.tagName) return null;
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const name = el.getAttribute('name') ? `[name="${el.getAttribute('name')}"]` : '';
      const type = el.getAttribute('type') ? `[type="${el.getAttribute('type')}"]` : '';
      const placeholder = el.getAttribute('placeholder')
        ? `[placeholder="${el.getAttribute('placeholder')}"]`
        : '';
      const aria = el.getAttribute('aria-label')
        ? `[aria-label="${el.getAttribute('aria-label')}"]`
        : '';
      const cls =
        el.classList && el.classList.length
          ? `.${Array.from(el.classList).slice(0, 2).join('.')}`
          : '';
      return `${tag}${id}${name}${type}${placeholder}${aria}${cls}`.slice(0, 200);
    };

    document.addEventListener(
      'click',
      (ev) => {
        const sel = describeEl(ev.target);
        if (sel && window.__boxplusRecordDom) {
          window.__boxplusRecordDom({ event: 'click', selector: sel, text: (ev.target.innerText || '').slice(0, 80) });
        }
      },
      true
    );

    document.addEventListener(
      'change',
      (ev) => {
        const sel = describeEl(ev.target);
        if (sel && window.__boxplusRecordDom) {
          const value = ev.target.value != null ? String(ev.target.value).slice(0, 120) : '';
          window.__boxplusRecordDom({ event: 'change', selector: sel, value });
        }
      },
      true
    );

    document.addEventListener(
      'submit',
      (ev) => {
        const sel = describeEl(ev.target);
        if (sel && window.__boxplusRecordDom) {
          window.__boxplusRecordDom({ event: 'submit', selector: sel });
        }
      },
      true
    );
  });
}

async function takeScreenshot(page, state, label) {
  ensureDir(OUTPUT_DIR);
  const safe = label.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60);
  const file = path.join(OUTPUT_DIR, `${SESSION_ID}-${safe}.png`);
  await page.screenshot({ path: file, fullPage: true });
  state.screenshots.push({ ts: new Date().toISOString(), label, file });
  console.log(`📸 Screenshot: ${file}`);
}

function saveSession(state) {
  ensureDir(OUTPUT_DIR);
  state.ended_at = new Date().toISOString();
  const outFile = path.join(OUTPUT_DIR, `${SESSION_ID}.har.json`);
  fs.writeFileSync(outFile, JSON.stringify(state, null, 2), 'utf8');
  console.log(`\n✅ Session sauvegardée: ${outFile}`);
  console.log(`   Requêtes capturées: ${state.network.length}`);
  console.log(`   Événements DOM: ${state.dom_events.length}`);
  console.log(`   Lancez: npm run analyze:report -- ${path.basename(outFile)}`);
  return outFile;
}

function setupInteractiveControls(page, state, onQuit) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n--- Commandes ---');
  console.log('  m <nom>  → milestone (ex: m create-member)');
  console.log('  s <nom>  → screenshot');
  console.log('  q        → quitter\n');

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const [cmd, ...rest] = trimmed.split(/\s+/);
    const arg = rest.join(' ') || 'step';

    if (cmd === 'q') {
      rl.close();
      await onQuit();
      return;
    }
    if (cmd === 'm') {
      const milestone = { ts: new Date().toISOString(), name: arg, url: page.url() };
      state.milestones.push(milestone);
      console.log(`🏁 Milestone: ${arg}`);
      return;
    }
    if (cmd === 's') {
      await takeScreenshot(page, state, arg);
    }
  });

  return rl;
}

async function tryAutoLogin(page) {
  const user = process.env.DECIPLUS_USER;
  const pass = process.env.DECIPLUS_PASSWORD;
  if (!user || !pass) {
    console.log('ℹ️  Pas de DECIPLUS_USER/PASSWORD — connexion manuelle.');
    return false;
  }

  const selectors = {
    user: [
      'input[name="username"]',
      'input[name="login"]',
      'input[name="user"]',
      'input[type="text"]',
      'input[name="email"]',
      'input[type="email"]',
      '#username',
      '#login',
    ],
    pass: ['input[name="password"]', 'input[type="password"]', '#password'],
    submit: [
      'button:has-text("Connexion")',
      'button:has-text("Se connecter")',
      'button[type="submit"]',
      'input[type="submit"]',
    ],
  };

  async function fillFirst(selectorsList, value) {
    for (const sel of selectorsList) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
        await el.fill(value);
        return true;
      }
    }
    return false;
  }

  await fillFirst(selectors.user, user);
  await fillFirst(selectors.pass, pass);
  for (const sel of selectors.submit) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      await btn.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      console.log('🔐 Tentative de connexion automatique effectuée.');
      return true;
    }
  }
  return false;
}

async function main() {
  const url = process.env.DECIPLUS_URL;
  if (!url) {
    console.error('DECIPLUS_URL manquant — copiez .env.example vers .env');
    process.exit(1);
  }

  ensureDir(OUTPUT_DIR);
  const state = buildSessionState();
  const headless = String(process.env.DECIPLUS_HEADLESS || 'false').toLowerCase() === 'true';
  const slowMo = Number(process.env.DECIPLUS_SLOW_MO || 0);

  const browser = await chromium.launch({ headless, slowMo });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-FR',
  });
  const page = await context.newPage();

  attachNetworkListeners(page, state);
  attachDomListeners(page, state);

  console.log(`\n🔍 BOXPLUS Analyzer — scénario: ${SCENARIO}`);
  console.log(`   URL: ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  state.milestones.push({ ts: new Date().toISOString(), name: 'page-loaded', url: page.url() });
  await takeScreenshot(page, state, '01-initial');

  await tryAutoLogin(page);

  const rl = setupInteractiveControls(page, state, async () => {
    saveSession(state);
    await browser.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    rl.close();
    saveSession(state);
    await browser.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
