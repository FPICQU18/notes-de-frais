# AGENTS.md — Notes de frais

Application web (PWA) de saisie et de validation de notes de frais.
**Ce dépôt est public** : aucun secret, aucune donnée réelle (noms, montants,
justificatifs), uniquement des données de test inventées.

## Structure

- `backend/` — API FastAPI (Python 3.13, uv, SQLAlchemy 2, Alembic, Postgres 17)
- `web/` — frontend Vite + React + TypeScript, PWA (vite-plugin-pwa)
- `.github/workflows/ci.yml` — CI (lint, tests, build, images ghcr)

## Commandes

Backend (dans `backend/`) :
- `uv sync` — installer
- `uv run ruff format .` puis `uv run ruff check .` — format et lint
- `uv run pytest` — tests
- `uv run alembic revision --autogenerate -m "<message>"` — créer une migration
- `uv run fastapi dev app/main.py` — lancer en local

Frontend (dans `web/`) :
- `npm ci` — installer
- `npm run lint`, `npm test`, `npm run build`
- `npm run dev` — lancer en local (proxy `/api` → `127.0.0.1:8000`)

Les tests qui ont besoin de Postgres lisent `DATABASE_URL`. La CI en fournit un :
si tu ne peux pas lancer Postgres localement, pousse et lis le résultat de la CI.

## Règles Git (non négociables)

- Toujours partir de `dev` à jour. Une carte = une branche `agent/<id-carte>` = une PR.
- Ne jamais pousser sur `dev` ni `main`. Ne jamais merger une PR.
- PR vers `dev`, en remplissant le modèle de PR.
- Commits au format Conventional Commits : `feat(backend): …`, `fix(web): …`, `test: …`, `chore: …`.
- Petites PR : si une carte dépasse ~400 lignes modifiées (hors lockfiles et migrations), la signaler pour découpage.

## Définition de « terminé »

- Format, lint, tests et build verts dans la CI, sur le dernier commit de la branche.
- Tests ajoutés pour chaque comportement nouveau, **y compris les cas refusés** (403, 404, 422).
- Toute modification de modèle est accompagnée de sa migration Alembic (`alembic check` doit passer).
- Nouvelle dépendance : seulement si nécessaire, justifiée dans la PR, lockfile commité.

## Décisions d'architecture

### Utilisateurs et rôles
- Comptes propres à l'application : e-mail + mot de passe. **Pas d'inscription libre** :
  seul un admin crée les comptes. Le premier admin est créé en ligne de commande
  (`python -m app.cli create-admin`).
- Rôles : `utilisateur`, `valideur`, `admin`. L'admin a tous les droits du valideur.
- Mots de passe : 12 caractères minimum, hachés avec Argon2 (`pwdlib[argon2]`).
  Jamais journalisés, jamais renvoyés par l'API.

### Sessions
- Session en base : jeton aléatoire (`secrets.token_urlsafe(32)`), stocké **haché (SHA-256)**,
  expiration 7 jours, supprimé à la déconnexion et à la désactivation du compte.
- Transmis dans un cookie `HttpOnly`, `Secure`, `SameSite=Strict`. Jamais de jeton
  dans `localStorage` ni dans une URL.
- Message d'erreur de connexion identique que l'e-mail existe ou non.

### Notes de frais
- Statuts : `brouillon` → `soumise` → `validee` ou `refusee` → `remboursee`.
- Transitions autorisées :
  - `brouillon` → `soumise` : le propriétaire ;
  - `soumise` → `validee` / `refusee` : un valideur **autre que le propriétaire** (motif obligatoire pour un refus) ;
  - `refusee` → `brouillon` : le propriétaire, pour corriger ;
  - `validee` → `remboursee` : un admin.
- Une note n'est modifiable ou supprimable qu'au statut `brouillon`.
- Chaque transition est historisée (qui, quand, ancien et nouveau statut, motif).
- Visibilité : un utilisateur ne voit que ses notes ; un valideur voit en plus les notes
  soumises et au-delà ; un admin voit tout.
- **Tout contrôle d'accès se fait côté serveur**, le frontend ne fait qu'adapter l'affichage.

### Montants et dates
- Montants en **centimes, entiers** (`int`), devise EUR. Jamais de `float`.
- Date de dépense : type `date`. Horodatages : `datetime` avec fuseau, en UTC.

### Justificatifs
- Stockés en base, dans une table dédiée (`bytea`), jamais dans la table des notes.
- 10 Mo maximum. Formats autorisés : JPEG, PNG, HEIC, PDF, **vérifiés par la signature
  du fichier** (magic bytes), pas par l'extension ni par le `Content-Type` envoyé.
- Jamais inclus dans les listes : téléchargement par une route dédiée, avec le même contrôle
  d'accès que la note, et l'en-tête `X-Content-Type-Options: nosniff`.

### API
- Routes métier sous `/api/v1/...` ; `/api/health` reste à part.
- Schémas Pydantic séparés des modèles SQLAlchemy. Messages d'erreur en français.
- Configuration uniquement par variables d'environnement (`app/config.py`).

## Conventions frontend

- TypeScript strict, avec `erasableSyntaxOnly` : **pas d'`enum`** (utiliser des unions de
  chaînes), pas de propriétés dans les paramètres de constructeur, pas de `namespace`.
- Tous les appels réseau passent par `src/api/client.ts`.
- Interface en français, mobile d'abord, champs de formulaire avec un `<label>`.
- Le service worker ne met jamais en cache les réponses de l'API.
