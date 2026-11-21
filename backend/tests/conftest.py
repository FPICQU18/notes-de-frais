"""Préparation commune de la base de données de test (Postgres requis).

Tous les tests qui touchent à la base de données utilisent la fixture `db_session`.
Si `DATABASE_URL` pointe vers un Postgres injoignable (ex. poste de travail sans
Postgres local), ces tests sont sautés (`pytest.skip`) plutôt qu'en échec : la CI
fournit toujours un Postgres et les y fait tourner.
"""

from collections.abc import Iterator

import psycopg
import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.models import Base

TEST_DATABASE_NAME = "ndf_test"


def _test_database_url() -> str:
    """URL de la base de test, dérivée de DATABASE_URL (…/ndf → …/ndf_test)."""
    url = make_url(get_settings().database_url)
    return str(url.set(database=TEST_DATABASE_NAME))


TEST_DATABASE_URL = _test_database_url()


def _ensure_test_database() -> None:
    """Crée la base ndf_test si elle n'existe pas (la CI ne fournit que « ndf »)."""
    url = make_url(TEST_DATABASE_URL)
    if url.get_backend_name() != "postgresql":
        raise RuntimeError(f"base de test non PostgreSQL inattendue : {TEST_DATABASE_URL}")
    admin_url = url.set(database="postgres")
    with psycopg.connect(
        host=url.host,
        port=url.port or 5432,
        user=url.username,
        password=url.password,
        dbname=admin_url.database,
        autocommit=True,
    ) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DATABASE_NAME,)
        ).fetchone()
        if not exists:
            conn.execute(f"CREATE DATABASE {TEST_DATABASE_NAME}")


def _postgres_reachable() -> bool:
    """True si le serveur Postgres de DATABASE_URL répond."""
    url = make_url(TEST_DATABASE_URL)
    try:
        with psycopg.connect(
            host=url.host,
            port=url.port or 5432,
            user=url.username,
            password=url.password,
            dbname=url.database,
            connect_timeout=3,
        ):
            return True
    except psycopg.Error:
        # OperationalError (serveur absent), AuthenticationError (mauvais mot de
        # passe, ex. masque « *** » de la valeur par défaut) : dans les deux cas
        # aucun test de base de données ne peut tourner localement.
        return False


@pytest.fixture(scope="session")
def test_engine():
    """Moteur vers la base de test ; saute toute la session si Postgres est injoignable."""
    if not _postgres_reachable():
        pytest.skip(
            f"Postgres injoignable ({TEST_DATABASE_URL}) : "
            "les tests de base de données sont sautés (validés par la CI)."
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
