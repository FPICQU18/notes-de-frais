"""Tests de la commande `python -m app.cli create-admin`."""

import builtins
import getpass
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

import app.cli as cli
from app.models import User
from app.security import verify_password

VALID_PASSWORD = "mot-de-passe-tres-long"


@pytest.fixture()
def run_cli(monkeypatch, capsys, db_session: Session):
    """Lance la commande create-admin avec entrées simulées ; renvoie (code, out, err)."""

    def _run(inputs: list[str], passwords: list[str]) -> tuple[int, str, str]:
        input_iter = iter(inputs)
        password_iter = iter(passwords)
        monkeypatch.setattr(builtins, "input", lambda prompt="": next(input_iter))
        monkeypatch.setattr(getpass, "getpass", lambda prompt="": next(password_iter))
        # La CLI utilise son propre SessionLocal : on le redirige vers la base de test.
        monkeypatch.setattr(cli, "SessionLocal", lambda: db_session)
        code = cli.main(["create-admin"])
        captured = capsys.readouterr()
        return code, captured.out, captured.err

    return _run


def count_users(db_session: Session) -> int:
    return db_session.execute(sa.select(sa.func.count()).select_from(User)).scalar_one()


def test_create_admin_success(run_cli, db_session):
    code, out, err = run_cli(
        inputs=["admin@example.com", "Admin Test"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code == 0
    assert "admin@example.com" in out
    assert count_users(db_session) == 1

    user = db_session.execute(sa.select(User).where(User.email == "admin@example.com")).scalar_one()
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


def test_create_admin_email_normalise_en_minuscules(run_cli, db_session):
    """Un e-mail saisi avec des majuscules est stocké en minuscules."""
    code, out, _ = run_cli(
        inputs=["Jean@Example.COM", "Jean Dupont"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code == 0
    assert "jean@example.com" in out
    user = db_session.execute(
        sa.select(User).where(sa.func.lower(User.email) == "jean@example.com")
    ).scalar_one()
    assert user.email == "jean@example.com"


def test_create_admin_password_mismatch(run_cli, db_session):
    code, out, err = run_cli(
        inputs=["admin@example.com", "Admin Test"],
        passwords=[VALID_PASSWORD, "mot-de-passe-different"],
    )
    assert code != 0
    assert err != ""
    assert count_users(db_session) == 0


def test_create_admin_password_too_short(run_cli, db_session):
    code, out, err = run_cli(
        inputs=["admin@example.com", "Admin Test"],
        passwords=["court", "court"],
    )
    assert code != 0
    assert "12" in err
    assert count_users(db_session) == 0


def test_create_admin_duplicate_email(run_cli, db_session):
    code, _, _ = run_cli(
        inputs=["admin@example.com", "Admin Test"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code == 0
    assert count_users(db_session) == 1

    code, out, err = run_cli(
        inputs=["admin@example.com", "Autre Nom"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code != 0
    assert "existe déjà" in err
    assert count_users(db_session) == 1


def test_create_admin_duplicate_email_casse_differente(run_cli, db_session):
    """Un doublon d'e-mail différant uniquement par la casse est refusé."""
    code, _, _ = run_cli(
        inputs=["Admin@Example.com", "Admin Test"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code == 0
    assert count_users(db_session) == 1

    code, _, err = run_cli(
        inputs=["admin@example.COM", "Autre Nom"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code != 0
    assert "existe déjà" in err
    assert count_users(db_session) == 1


def test_create_admin_invalid_email(run_cli, db_session):
    code, out, err = run_cli(
        inputs=["pas-un-email", "Admin Test"],
        passwords=[VALID_PASSWORD, VALID_PASSWORD],
    )
    assert code != 0
    assert err != ""
    assert count_users(db_session) == 0


def test_cli_usage_error():
    assert cli.main([]) == 2
    assert cli.main(["autre-chose"]) == 2
