# Scénario 01 — Connexion Deciplus

## Objectif
Documenter la connexion : cookies, tokens, CSRF, durée de session.

## Préparation
```bash
cp .env.example .env
# Renseigner DECIPLUS_URL, DECIPLUS_USER, DECIPLUS_PASSWORD
set ANALYZER_SCENARIO=login
npm run analyze:record
```

## Étapes manuelles
1. Ouvrir Deciplus (le script lance le navigateur)
2. Si auto-login échoue, se connecter manuellement
3. `m login-start` avant de saisir les identifiants
4. `m login-success` une fois le tableau de bord visible
5. `s dashboard` — capture écran
6. `q` pour sauvegarder

## À noter
- URL finale après connexion
- Présence 2FA ou captcha
- Durée avant déconnexion automatique
