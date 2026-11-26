"""Tests unitaires des helpers de conftest (sans base de données)."""

from types import SimpleNamespace

import psycopg
import psycopg.errors
import pytest

import tests.conftest as conftest

SECRET = "mot-de-passe-secret"
DATABASE_URL = f"postgresql+psycopg://ndf:{SECRET}@localhost:5432/ndf"


def test_database_url_conserve_le_vrai_mot_de_passe(monkeypatch):
    """Le mot de passe réel est conservé, jamais remplacé par « *** »."""
    monkeypatch.setattr(
        conftest, "get_settings", lambda: SimpleNamespace(database_url=DATABASE_URL)
    )
    url = conftest._database_url(conftest.TEST_DATABASE_NAME)
    assert url.endswith(f"/{conftest.TEST_DATABASE_NAME}")
    assert f":{SECRET}@" in url
    assert "***" not in url


def test_database_url_cible_la_base_demandee(monkeypatch):
    """L'URL de test pointe bien vers la base demandée."""
    monkeypatch.setattr(
        conftest, "get_settings", lambda: SimpleNamespace(database_url=DATABASE_URL)
    )
    assert conftest._database_url("postgres").endswith("/postgres")


def test_masked_database_url_ne_fuit_pas_le_mot_de_passe(monkeypatch):
    """L'URL destinée aux messages masque le mot de passe."""
    monkeypatch.setattr(
        conftest,
        "TEST_DATABASE_URL",
        f"postgresql+psycopg://ndf:{SECRET}@localhost:5432/ndf_test",
    )
    masked = conftest._masked_database_url()
    assert "***" in masked
    assert SECRET not in masked


def test_admin_connection_cible_la_base_postgres(monkeypatch):
    """La vérification de joignabilité se connecte à `postgres`, pas à `ndf_test`."""
    captured = {}

    def fake_connect(**kwargs):
        captured.update(kwargs)
        raise psycopg.OperationalError("stoppé après capture")

    monkeypatch.setattr(
        conftest,
        "TEST_DATABASE_URL",
        f"postgresql+psycopg://ndf:{SECRET}@localhost:5432/ndf_test",
    )
    monkeypatch.setattr(conftest.psycopg, "connect", fake_connect)

    with pytest.raises(psycopg.OperationalError):
        conftest._admin_connection(connect_timeout=3)

    assert captured["dbname"] == "postgres"
    assert captured["host"] == "localhost"
    assert captured["port"] == 5432
    assert captured["user"] == "ndf"
    assert captured["password"] == SECRET


def _boom_auth():
    raise psycopg.errors.InvalidPassword("identifiants refusés")


def _boom_unreachable():
    raise psycopg.OperationalError("connexion refusée")


def test_test_engine_echoue_si_identifiants_refuses(monkeypatch):
    """Serveur joignable mais identifiants refusés → échec explicite, jamais skip."""
    monkeypatch.setattr(
        conftest,
        "TEST_DATABASE_URL",
        f"postgresql+psycopg://ndf:{SECRET}@localhost:5432/ndf_test",
    )
    monkeypatch.setattr(conftest, "_probe_postgres", _boom_auth)
    gen = conftest.test_engine.__wrapped__()
    with pytest.raises(pytest.fail.Exception) as excinfo:
        next(gen)
    message = str(excinfo.value)
    assert SECRET not in message
    assert "***" in message


def test_test_engine_saute_si_injoignable_hors_ci(monkeypatch):
    """Serveur injoignable hors CI → skip avec un message indiquant DATABASE_URL."""
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.setattr(
        conftest,
        "TEST_DATABASE_URL",
        f"postgresql+psycopg://ndf:{SECRET}@localhost:5432/ndf_test",
    )
    monkeypatch.setattr(conftest, "_probe_postgres", _boom_unreachable)
    gen = conftest.test_engine.__wrapped__()
    with pytest.raises(pytest.skip.Exception) as excinfo:
        next(gen)
    message = str(excinfo.value)
    assert "DATABASE_URL" in message
    assert SECRET not in message


def test_test_engine_echoue_si_injoignable_en_ci(monkeypatch):
    """Serveur injoignable en CI → échec : la CI ne doit jamais passer avec des tests sautés."""
    monkeypatch.setenv("CI", "true")
    monkeypatch.setattr(
        conftest,
        "TEST_DATABASE_URL",
        f"postgresql+psycopg://ndf:{SECRET}@localhost:5432/ndf_test",
    )
    monkeypatch.setattr(conftest, "_probe_postgres", _boom_unreachable)
    gen = conftest.test_engine.__wrapped__()
    with pytest.raises(pytest.fail.Exception):
        next(gen)
