"""Préparation commune de la base de données de test (Postgres requis).

Tous les tests qui touchent à la base de données utilisent la fixture `db_session`.

Comportement au démarrage de la session :
- serveur Postgres joignable → la base `ndf_test` est créée si absente, les tests
  s'exécutent ;
- serveur joignable mais identifiants refusés → la session échoue (`pytest.fail`) ;
- serveur injoignable → la session échoue si `CI` est défini (la CI ne doit jamais
  passer avec des tests sautés), sinon elle est sautée avec un message indiquant
  comment fournir `DATABASE_URL`.

Le mot de passe n'apparaît jamais dans les messages : on affiche une URL masquée.
"""

import os
from collections.abc import Iterator

import psycopg
import psycopg.errors
import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.models import Base

TEST_DATABASE_NAME = "ndf_test"
POSTGRES_DATABASE_NAME = "postgres"

# Identifiants refusés par le serveur (classe SQLSTATE 28) : jamais un skip.
_AUTHENTICATION_ERRORS = (
    psycopg.errors.InvalidPassword,
    psycopg.errors.InvalidAuthorizationSpecification,
)


def _database_url(database: str) -> str:
    """URL vers `database`, dérivée de `DATABASE_URL`, avec le vrai mot de passe.

    `str(URL)` masque le mot de passe : on passe par
    `render_as_string(hide_password=False)` pour que la connexion utilise le vrai
    mot de passe.
    """
    url = make_url(get_settings().database_url).set(database=database)
    return url.render_as_string(hide_password=False)


TEST_DATABASE_URL = _database_url(TEST_DATABASE_NAME)


def _masked_database_url() -> str:
    """URL de la base de test, mot de passe masqué, pour les messages."""
    return str(make_url(TEST_DATABASE_URL))


def _admin_connection(**kwargs):
    """Connexion à la base `postgres` (toujours présente), jamais à la base de test."""
    url = make_url(TEST_DATABASE_URL)
    return psycopg.connect(
        host=url.host,
        port=url.port or 5432,
        user=url.username,
        password=url.password,
        dbname=POSTGRES_DATABASE_NAME,
        **kwargs,
    )


def _probe_postgres() -> None:
    """Vérifie la joignabilité du serveur sur la base `postgres`.

    Lève une erreur de la classe `_AUTHENTICATION_ERRORS` si le serveur répond mais
    refuse les identifiants, `psycopg.OperationalError` s'il est injoignable.
    """
    with _admin_connection(connect_timeout=3):
        pass


def _ensure_test_database() -> None:
    """Crée la base `ndf_test` si elle n'existe pas (la CI ne fournit que « ndf »)."""
    url = make_url(TEST_DATABASE_URL)
    if url.get_backend_name() != "postgresql":
        raise RuntimeError(f"base de test non PostgreSQL inattendue : {_masked_database_url()}")
    with _admin_connection(autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DATABASE_NAME,)
        ).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{TEST_DATABASE_NAME}"')


@pytest.fixture(scope="session")
def test_engine():
    """Moteur vers la base de test ; échoue ou saute selon la joignabilité de Postgres."""
    try:
        _probe_postgres()
    except _AUTHENTICATION_ERRORS:
        pytest.fail(
            "Postgres joignable mais identifiants refusés "
            f"({_masked_database_url()}) : vérifier DATABASE_URL."
        )
    except psycopg.OperationalError:
        if os.environ.get("CI"):
            pytest.fail(
                "Postgres injoignable en CI : les tests de base de données ne doivent "
                "jamais être sautés."
            )
        pytest.skip(
            f"Postgres injoignable ({_masked_database_url()}) : les tests de base de "
            "données sont sautés. Définir DATABASE_URL vers un Postgres joignable pour "
            "les exécuter."
        )
    _ensure_test_database()
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    yield engine
    engine.dispose()


@pytest.fixture()
def db_session(test_engine) -> Iterator[Session]:
    """Session sur une base de test vide (schéma public recréé) avant chaque test."""
    with test_engine.begin() as conn:
        conn.execute(sa.text("DROP SCHEMA public CASCADE"))
        conn.execute(sa.text("CREATE SCHEMA public"))
        Base.metadata.create_all(bind=conn)
    TestingSessionLocal = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
    with TestingSessionLocal() as session:
        yield session
