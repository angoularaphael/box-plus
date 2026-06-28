# KataBump — BOXPLUS bot

## Fichiers à mettre dans `/home/container/`

| Fichier | Rôle |
|---------|------|
| `index.js` | Bootstrap : clone GitHub + lance le bot |
| `.env` | Secrets (copier depuis `.env.example`) |

## Panel KataBump

### Settings → Startup

| Champ | Valeur |
|-------|--------|
| **Startup command** | `node index.js` |

*(Ou `node /home/container/index.js`)*

### Network

Note l’IP:port affiché (ex. `51.75.118.17:20029`) → mettre dans `BOT_HTTP_PORT=20029`

### Vercel

```
BOXPLUS_BOT_URL=http://51.75.118.17:20029
SYNC_SECRET=même valeur que .env
```

Puis redeploy Vercel.

## Premier démarrage

1. Upload `index.js` + `.env` via **Files**
2. **Console** → Start le serveur
3. Attendre 3–5 min (git clone + npm + Playwright)
4. Tester : `http://51.75.118.17:20029/health`

## Erreur ENOSPC (disque plein)

Playwright a besoin d’~100–200 Mo. Si `no space left on device` :

1. **KataBump** → augmenter le quota disque du serveur
2. **Console** — libérer l’espace :
   ```bash
   df -h
   rm -rf ~/.cache/ms-playwright /home/container/.cache/ms-playwright
   rm -rf boxi-deci-bot/node_modules/.cache
   ```
3. Relancer : `node index.js`
4. Le bot utilise `chromium-headless-shell` (plus léger) dans `data/ms-playwright`


```bash
# Vérifier git
git --version

# Relancer manuellement
node index.js

# Voir le bot cloné
ls boxi-deci-bot/
```
