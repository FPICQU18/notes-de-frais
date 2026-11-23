# Backend — Notes de frais

API FastAPI (Python 3.13, uv, SQLAlchemy 2, Alembic, Postgres 17) qui sert les
routes métier sous `/api/v1/...` et le point de santé `/api/health`.

## Mise en service

### Variables d'environnement

Toute la configuration passe par `app/config.py` (via `pydantic-settings`), qui ne
lit que deux variables d'environnement :

| Variable | Rôle | Valeur en production |
|---|---|---|
| `ENVIRONMENT` | `"production"` active le mode production | `production` |
| `DATABASE_URL` | URL de connexion Postgres (pilote **psycopg 3 synchrone**) | `postgresql+psycopg://<utilisateur>:<mot_de_passe>@<hote>:5432/<base>` |

- Le pilote est **psycopg 3 synchrone** (`postgresql+psycopg://`), jamais
  `asyncpg`. C'est le moteur synchrone de SQLAlchemy (`create_engine`) qui est utilisé.
- Ces deux variables sont aussi lues par Alembic (`migrations/env.py`), qui
  réutilise `get_settings().database_url` : définir `DATABASE_URL` suffit pour
  l'application **et** pour les migrations.
- **Aucune autre variable n'est lue** : il n'y a pas de clé de signature ni de
  secret de session à configurer. Les sessions vivent en base (table des
  sessions), pas dans un jeton signé.
- Les valeurs par défaut de `app/config.py` (`environment="dev"` et une URL
  locale) sont **réservées au développement**. `env.example` ne doit **pas** être
  déployé tel quel : il contient des valeurs de développement.

### Migration de la base

La migration doit être appliquée **avant le premier démarrage** puis **à chaque
déploiement** :

```sh
# Dans le conteneur (l'image embarque uv et le venv dans le PATH)
alembic upgrade head

# En local (depuis le dossier backend/)
uv run alembic upgrade head
```

`DATABASE_URL` doit être défini dans l'environnement pour cette commande.

### Premier administrateur

Après la migration (les tables doivent exister), créez le premier compte admin :

```sh
python -m app.cli create-admin
```

La commande est **interactive** : elle demande l'e-mail, le nom affiché, puis un
mot de passe d'au moins 12 caractères saisi deux fois (via `getpass`, sans écho).
Elle doit donc être lancée avec un terminal attaché, par exemple :

```sh
docker run -it --env DATABASE_URL=... <image-backend> python -m app.cli create-admin
```

### HTTPS obligatoire

Le cookie de session est émis avec `Secure` et `SameSite=Strict`. L'application
doit donc être servie en **HTTPS**, faute de quoi le navigateur n'enverra pas le
cookie. Le proxy en amont doit transmettre `X-Forwarded-Proto` (le backend est
lancé avec `--proxy-headers --forwarded-allow-ips "*"`) afin que
`request.url.scheme` reflète le schéma public.

### Vérification de service

```sh
curl -i https://<hote>/api/health
# 200 {"status":"ok"}
```

Le front appelle l'API en **same-origin** (URL relative `/api/...`) : aucun CORS
n'est à configurer.

### DNS interne

Le front est servi par une image web (nginx) qui transmet `/api/` au service
`backend`. Sa configuration utilise `resolver 127.0.0.11`, qui correspond au DNS
embarqué de Docker Compose. Sur un autre orchestrateur, adaptez cette adresse à
votre résolveur de service.
