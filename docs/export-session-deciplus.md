# Export & renouvellement session Deciplus (BotHosting)

Deciplus envoie parfois un **code de vérification par email** quand le bot se connecte depuis une **nouvelle IP** (BotHosting). Pour éviter ça à chaque redémarrage, on **exporte une session déjà connectée** depuis ton PC et on l’upload sur le serveur.

---

## Quand exporter ?

- **Première mise en ligne** du bot sur BotHosting
- Après un message `Session sans token — reconnexion` ou échec login
- Après expiration de session (plusieurs jours / semaines sans activité)
- Après changement de mot de passe Deciplus

---

## Étape 1 — Prérequis (PC local)

1. Ouvre le dossier `BOXPLUS`
2. Vérifie le fichier `.env` :
   ```env
   DECIPLUS_URL=https://boxingcenter.deciplus.pro/
   DECIPLUS_USER=BRAD
   DECIPLUS_PASSWORD=...
   DECIPLUS_HEADLESS=false
   ```
3. Installe les dépendances si besoin : `npm install`

---

## Étape 2 — Export de la session

Dans PowerShell :

```powershell
cd BOXPLUS
npm run session:export
```

1. **Chrome s’ouvre** (visible, pas headless)
2. Connecte-toi à Deciplus (login + **code email** si demandé)
3. Si écran **« Choisissez un site »** → sélectionne **Minimes**
4. Attends le **tableau de bord** Deciplus
5. Retourne au terminal → appuie sur **Entrée**

Résultat attendu :

```
Token auth OK
Session exportée → data\session\storage-state.json
```

---

## Étape 3 — Upload sur BotHosting

1. Ouvre le **File Manager** BotHosting (`/home/container/`)
2. Va dans `data/session/` (crée le dossier si absent)
3. Upload le fichier local :
   ```
   BOXPLUS\data\session\storage-state.json
   ```
   → vers :
   ```
   /home/container/data/session/storage-state.json
   ```

---

## Étape 4 — Redémarrer le bot

1. Redémarre le serveur (`node index.js` ou bouton Start)
2. Vérifie les logs :
   ```
   [BOXPLUS] Déjà connecté via session persistée
   [BOXPLUS] Catalogue Deciplus synchronisé
   ```
3. Test : `http://prem-eu1.bot-hosting.net:20311/health`

---

## Renouveler la session (plus tard)

Même procédure :

1. `npm run session:export` sur ton PC
2. Remplace `storage-state.json` sur BotHosting
3. Redémarre le bot

**Astuce :** refais l’export **avant** que l’ancienne session expire, si tu vois des erreurs login dans les logs.

---

## Alternative temporaire : code email

Si tu n’as pas le fichier sous la main :

1. Ajoute dans `.env` BotHosting :
   ```env
   DECIPLUS_EMAIL_CODE=123456
   ```
   (code reçu par email, valide quelques minutes)

2. Redémarre le bot

3. Une fois connecté, le bot sauvegarde la session → **retire** `DECIPLUS_EMAIL_CODE` du `.env`

---

## Fichiers concernés

| Fichier | Rôle |
|---------|------|
| `data/session/storage-state.json` | Cookies + localStorage Deciplus (token auth) |
| `deploy/bothosting/.env` | Config bot (Deciplus, port, secrets) |
| `deploy/bothosting/index.js` | Bootstrap (clone GitHub, Playwright, lancement) |

**Ne partage jamais** `storage-state.json` publiquement — il contient un accès staff Deciplus.
