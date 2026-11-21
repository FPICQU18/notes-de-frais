"""Tests de la commande `python -m app.cli create-admin`."""

import builtins
import getpass
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.cli as cli
from app.config import get_settings
from app.models import Base, User
from app.security import verify_password

DATABASE_URL = get_settings().database_url
TEST_DATABASE_URL = DATABASE_URL.rsplit("/", 1)[0] + "/ndf_test"

if TEST_DATABASE_URL.startswith("postgresql"):
    # La CI ne fournit que la base "ndf" : on crée la base de test au besoin.
    import psycopg
    from sqlalchemy.engine import make_url

    admin_url = make_url(TEST_DATABASE_URL).set(database="postgres")
    with psycopg.connect(admin_url.render_as_string(hide_password=False), autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", ("ndf_test",)
        ).fetchone()
        if not exists:
            conn.execute("CREATE DATABASE ndf_test")

engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

VALID_PASSWORD = "mot-de-passe-tres-long"


@pytest.fixture(autouse=True)
def fresh_db():
    """Base vide avant chaque test. Postgres (CI) : schéma public recréé ; sinon tables recréées."""
    if TEST_DATABASE_URL.startswith("postgresql"):
        with engine.begin() as conn:
            conn.execute(sa.text("DROP SCHEMA public CASCADE"))
            conn.execute(sa.text("CREATE SCHEMA public"))
            Base.metadata.create_all(bind=conn)
    else:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture()
def run_cli(monkeypatch, capsys):
    """Lance la commande create-admin avec entrées simulées ; renvoie (code, out, err)."""

    def _run(inputs: list[str], passwords: list[str]) -> tuple[int, str, str]:
        input_iter = iter(inputs)
        password_iter = iter(passwords)
        monkeypatch.setattr(builtins, "input", lambda prompt="": next(input_iter))
        monkeypatch.setattr(getpass, "getpass", lambda prompt="": next(password_iter))
        # La CLI utilise son propre SessionLocal : on le redirige vers la base de test.
        monkeypatch.setattr(cli, "SessionLocal", TestingSessionLocal)
        code = cli.main(["create-admin"])
        captured = capsys.readouterr()
        return code, captured.out, captured.err

    return _run


def count_users() -> int:
    with TestingSessionLocal() as session:
        return session.execute(sa.select(sa.func.count()).select_from(User)).scalar_one()


def test_create_admin_success(run_cli):
    code, out, err = run_cli(
        inputs=["admin@example.com", "Admin Test"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code == 0
    assert "admin@example.com" in out
    assert count_users() == 1

    with TestingSessionLocal() as session:
        user = session.execute(
            sa.select(User).where(User.email == "admin@example.com")
        ).scalar_one()
        assert user.role == "admin"
        assert user.is_active is True
        assert user.display_name == "Admin Test"
        assert user.password_hash.startswith("$argon2")
        assert verify_password(VALID_PASSWORD, user.password_hash)
        assert not verify_password("autre-mot-de-passe", user.password_hash)
        assert user.password_hash != VALID_PASSWORD
        assert user.created_at is not None
        assert user.updated_at is not None
        if user.created_at.tzinfo is not None:  # tzinfo renseigné sur Postgres
            now = datetime.now(UTC)
            assert abs((now - user.created_at).total_seconds()) < 60


def test_create_admin_password_mismatch(run_cli):
    code, out, err = run_cli(
        inputs=["admin@example.com", "Admin Test"],
        passwords=[VALID_PASSWORD, "mot-de-passe-different"],
    )
    assert code != 0
    assert err != ""
    assert count_users() == 0


def test_create_admin_password_too_short(run_cli):
    code, out, err = run_cli(
        inputs=["admin@example.com", "Admin Test"],
        passwords=["court", "court"],
    )
    assert code != 0
    assert "12" in err
    assert count_users() == 0


def test_create_admin_duplicate_email(run_cli):
    code, _, _ = run_cli(
        inputs=["admin@example.com", "Admin Test"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code == 0
    assert count_users() == 1

    code, out, err = run_cli(
        inputs=["admin@example.com", "Autre Nom"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code != 0
    assert "existe déjà" in err
    assert count_users() == 1


def test_create_admin_invalid_email(run_cli):
    code, out, err = run_cli(
        inputs=["pas-un-email", "Admin Test"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code != 0
    assert err != ""
    assert count_users() == 0


def test_cli_usage_error():
    assert cli.main([]) == 2
    assert cli.main(["autre-chose"]) == 2
