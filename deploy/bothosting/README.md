# BotHosting — index.js + .env (comme KataBump)

**URL :** `http://prem-eu2.bot-hosting.net:21587`

## Étape 1 — Upload (AVANT de lancer)

Dans **Files** (`/home/container/`), upload **uniquement** :

| Fichier PC | Sur le serveur |
|------------|----------------|
| `deploy/bothosting/index.js` | `/home/container/index.js` |
| `deploy/bothosting/.env` | `/home/container/.env` |

Le dossier doit rester **vide** sauf ces 2 fichiers.  
Pas de repo, pas de `node_modules` — `index.js` s’en charge au lancement.

## Étape 2 — Startup (Settings)

| Champ | Valeur |
|-------|--------|
| **Startup command** | `node index.js` |

## Étape 3 — Lancer

Console → **Start**

Au 1er lancement, `index.js` va :

1. Lire `.env`
2. `git clone` → dossier `boxi-deci-bot/`
3. `npm install`
4. Installer Playwright (headless-shell)
5. Démarrer le bot Deciplus

**Attendre 3–5 min** au premier start.

## Étape 4 — Vercel

```
BOXPLUS_BOT_URL=http://prem-eu2.bot-hosting.net:21587
SYNC_SECRET=boxplus-bc-2026-test
```

Redeploy Vercel.

## Étape 5 — Test

```
http://prem-eu2.bot-hosting.net:21587/health
```

## Logs OK

```
[BOXPLUS bootstrap] .env OK
[BOXPLUS bootstrap] Clone https://github.com/...
[BOXPLUS bootstrap] Installation Playwright: chromium-headless-shell
[BOXPLUS] Bot HTTP ingest → :21587
[BOXPLUS] Bot Deciplus démarré
```

## Redémarrages suivants

`index.js` met à jour le repo (`git pull`) et skip Playwright si déjà installé.
