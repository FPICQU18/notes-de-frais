"""Doc API (Swagger / OpenAPI) désactivée quand ENVIRONMENT=production."""

import importlib
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession

from app.config import get_settings
from app.db import get_db
from app.models import User
from app.security import hash_password

PASSWORD = "mot-de-passe-secret"
PASSWORD_HASH = hash_password(PASSWORD)


@pytest.fixture()
def app_env(monkeypatch) -> Iterator:
    """Recharge app.main avec ENVIRONMENT forcé, puis restaure l'état initial."""

    def _with_env(environment: str):
        monkeypatch.setenv("ENVIRONMENT", environment)
        get_settings.cache_clear()
        import app.main as main_module

        importlib.reload(main_module)
        return main_module.app

    yield _with_env
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    get_settings.cache_clear()
    import app.main as main_module

    importlib.reload(main_module)


def test_docs_ouverts_par_defaut_en_dev(app_env):
    client = TestClient(app_env("dev"))
    assert client.get("/api/docs").status_code == 200
    assert client.get("/api/openapi.json").status_code == 200
    assert client.get("/api/health").status_code == 200


def test_docs_fermes_en_production(app_env, db_session: OrmSession):
    app_production = app_env("production")

    def override_get_db():
        yield db_session

    app_production.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app_production, client=("10.0.0.5", 50000)) as client:
            assert client.get("/api/docs").status_code == 404
            assert client.get("/api/openapi.json").status_code == 404
            # Les routes métier restent accessibles.
            assert client.get("/api/health").status_code == 200

            db_session.add(
                User(
                    email="jean@example.com",
                    display_name="Jean Dupont",
                    role="utilisateur",
                    is_active=True,
                    password_hash=PASSWORD_HASH,
                )
            )
            db_session.commit()
            response = client.post(
                "/api/v1/auth/login",
                json={"email": "jean@example.com", "password": PASSWORD},
            )
            assert response.status_code == 200
            assert response.json()["email"] == "jean@example.com"
    finally:
        app_production.dependency_overrides.clear()
