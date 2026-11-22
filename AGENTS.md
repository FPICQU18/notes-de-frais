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
- Une **dépense** est un ticket (libellé, date de dépense, montant en centimes,
  catégorie, commentaire, propriétaire) ; elle est saisie par l'API au fil de l'eau.
- Une **note de frais** est un **dossier** qui regroupe une ou plusieurs dépenses ;
  c'est le dossier qui porte le statut et le circuit de validation.
- Une dépense appartient à **au plus un** dossier. Le contenu d'un dossier n'est
  modifiable qu'au statut `brouillon`.
- Statuts du dossier : `brouillon` → `soumise` → `validee` ou `refusee` → `remboursee`.
- Transitions autorisées :
  - `brouillon` → `soumise` : le propriétaire ;
  - `soumise` → `validee` / `refusee` : un valideur **autre que le propriétaire** (motif obligatoire pour un refus) ;
  - `refusee` → `brouillon` : le propriétaire, pour corriger ;
  - `validee` → `remboursee` : un admin.
- Un dossier n'est modifiable ou supprimable qu'au statut `brouillon`.
- Chaque transition est historisée (qui, quand, ancien et nouveau statut, motif).
- Visibilité : un utilisateur ne voit que ses dossiers et ses dépenses ; un valideur
  voit en plus les dossiers soumis et au-delà ; un admin voit tout.

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

## Design de l'interface (direction « Doux & arrondi »)

Maquettes de référence : `docs/design/direction-b/` (accueil, saisie d'un ticket, dossier).
Elles font foi pour le style : **ne pas inventer d'autre direction visuelle**.

### Bases techniques
- Tailwind CSS v4 + **shadcn/ui** (composants copiés dans `web/src/components/ui/`, à styler
  avec les variables ci-dessous) + icônes **lucide-react** (trait 2 px).
- Police **Plus Jakarta Sans** via `@fontsource/plus-jakarta-sans` (400 à 800), auto-hébergée :
  aucun appel à un CDN de polices (PWA utilisable sans Google).
- Montants formatés avec `Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" })`,
  toujours en chiffres tabulaires (`tabular-nums`).

### Couleurs
| Rôle | Valeur |
|---|---|
| Fond de page | `#F3F4FF` |
| Cartes, surfaces | `#FFFFFF` |
| Champs, boutons secondaires (sur fond blanc) | `#F3F4FF` |
| Texte principal | `#1A1A2E` |
| Texte secondaire | `#565A73` |
| Primaire (boutons, bandeau, onglet actif) | `#5B3DF5`, texte blanc |
| Primaire foncé (liens, texte d'accent) | `#4A2FD6` |
| Primaire pâle (pastilles) | fond `#EDE9FF`, texte `#3A22B0` |
| Erreur | fond `#FFE4E6`, texte `#9F1239` |

Catégories (fond de la bulle / icône) : transport `#E4E7FF`/`#3A22B0` · repas `#FFE8D6`/`#9A3F0B` ·
hébergement `#EFEAFF`/`#4A2FD6` · péage/parking `#DDF6E8`/`#146C3C` · carburant `#FFF1D6`/`#7A4A00` ·
fournitures `#E0F2FE`/`#075985` · autre `#F1F2F6`/`#565A73`.

Statuts de dossier (pastille fond/texte) : brouillon `#FFF1D6`/`#7A4A00` · soumise `#E4E7FF`/`#3A22B0` ·
validée `#DDF6E8`/`#146C3C` · refusée `#FFE4E6`/`#9F1239` · remboursée `#E0F2FE`/`#075985`.

### Formes et typographie
- Rayons : cartes 22–28 px, boutons et champs 18–20 px, bulles d'icône 16 px, pastilles 999 px.
- Ombre des cartes : `0 6px 18px rgba(40,30,120,0.06)` ; bouton flottant : `0 10px 24px rgba(91,61,245,0.35)`.
  Pas de bordure sur les cartes.
- Titres en graisse 800 (h1 24–28 px), montant mis en avant 38–44 px graisse 800, texte courant
  15–16 px, libellés secondaires 13 px.
- Marges de page 20 px ; espacements entre blocs 10 à 22 px.

### Composants et écrans
- **Navigation** : barre blanche flottante en bas (marges 16 px, rayon 26 px, hauteur 68 px),
  5 emplacements : Accueil, Dépenses, **bouton central « + »** (ajouter une dépense), Dossiers,
  Validation. L'onglet Validation n'apparaît que pour les rôles valideur et admin ; sinon, Profil.
- **Champs** : sans bordure, fond `#F3F4FF`, hauteur 52 px, libellé au-dessus (13 px, graisse 700).
- **Bouton principal** : hauteur 56 px, pleine largeur ou presque, collé en bas de l'écran pour
  l'action finale (enregistrer, envoyer pour validation).
- **Catégories** : grille de tuiles 64 px (icône + libellé), la tuile choisie en couleur primaire.
- **Listes** : une carte blanche par élément (bulle d'icône de catégorie, libellé, date, montant
  à droite), 10 px entre les cartes.
- **Accueil** : bandeau primaire avec le total du mois, pastilles « à classer » et « brouillon »,
  bouton blanc « Scanner un ticket », puis les dépenses récentes.

### Interdits
Pas d'emoji, pas de dégradés de couleur, pas de bordure colorée sur le côté des cartes, pas de
nouvelle couleur hors de ce tableau. Contraste du texte ≥ 4,5:1, zones cliquables ≥ 44 px,
champs toujours associés à un `<label>`.
