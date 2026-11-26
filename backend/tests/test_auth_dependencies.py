"""Tests des dépendances d'autorisation `get_current_user` et `require_role`.

Les routes protégées sont montées dans une application FastAPI locale de test ;
aucune route métier publique n'est ajoutée à l'application.
"""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Annotated

import pytest
import sqlalchemy as sa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession

from app.auth.dependencies import get_current_user, require_role
from app.db import get_db
from app.models import User, UserSession
from app.security import hash_password

PASSWORD = "mot-de-passe-secret"
PASSWORD_HASH = hash_password(PASSWORD)

COOKIE_NAME = "ndf_session"

# Application FastAPI locale : uniquement des routes de test protégées.
app = FastAPI()


@app.get("/qui-suis-je")
def qui_suis_je(user: Annotated[User, Depends(get_current_user)]) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role}


@app.get("/valideur")
def route_valideur(user: Annotated[User, Depends(require_role("valideur"))]) -> dict:
    return {"role": user.role}


@app.get("/admin")
def route_admin(user: Annotated[User, Depends(require_role("admin"))]) -> dict:
    return {"role": user.role}


@app.get("/utilisateur")
def route_utilisateur(user: Annotated[User, Depends(require_role("utilisateur"))]) -> dict:
    return {"role": user.role}


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _create_user(
    db_session: OrmSession,
    *,
    email: str = "jean@example.com",
    role: str = "utilisateur",
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        display_name="Jean Dupont",
        role=role,
        is_active=is_active,
        password_hash=PASSWORD_HASH,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _create_session(
    db_session: OrmSession,
    user: User,
    *,
    token: str = "jeton-secret",
    expires_at: datetime | None = None,
) -> UserSession:
    now = datetime.now(UTC)
    session = UserSession(
        user_id=user.id,
        token_hash=_hash_token(token),
        created_at=now,
        expires_at=expires_at if expires_at is not None else now + timedelta(days=7),
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    return session


def _count_sessions(db_session: OrmSession) -> int:
    return db_session.execute(sa.select(sa.func.count()).select_from(UserSession)).scalar_one()


@pytest.fixture()
def client(db_session: OrmSession):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _get(client: TestClient, path: str, token: str | None = None):
    client.cookies.clear()
    cookies = None if token is None else {COOKIE_NAME: token}
    return client.get(path, cookies=cookies)


# --- get_current_user ---------------------------------------------------------


def test_get_current_user_renvoie_utilisateur(client, db_session):
    user = _create_user(db_session)
    _create_session(db_session, user)

    response = _get(client, "/qui-suis-je", "jeton-secret")

    assert response.status_code == 200
    assert response.json() == {"id": user.id, "email": "jean@example.com", "role": "utilisateur"}


def test_get_current_user_sans_cookie_401(client, db_session):
    _create_user(db_session)

    response = _get(client, "/qui-suis-je")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


def test_get_current_user_jeton_inconnu_401(client, db_session):
    _create_user(db_session)

    response = _get(client, "/qui-suis-je", "jeton-inconnu")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


def test_get_current_user_session_expiree_401(client, db_session):
    user = _create_user(db_session)
    _create_session(db_session, user, expires_at=datetime.now(UTC) - timedelta(days=1))

    response = _get(client, "/qui-suis-je", "jeton-secret")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


def test_get_current_user_compte_desactive_401_et_session_supprimee(client, db_session):
    user = _create_user(db_session)
    _create_session(db_session, user)
    user.is_active = False
    db_session.commit()

    response = _get(client, "/qui-suis-je", "jeton-secret")

    assert response.status_code == 401
    assert _count_sessions(db_session) == 0


# --- require_role("valideur") : admin ⊇ valideur ------------------------------


def test_require_role_valideur_accepte_valideur(client, db_session):
    user = _create_user(db_session, role="valideur")
    _create_session(db_session, user)

    response = _get(client, "/valideur", "jeton-secret")

    assert response.status_code == 200
    assert response.json() == {"role": "valideur"}


def test_require_role_valideur_accepte_admin(client, db_session):
    user = _create_user(db_session, role="admin")
    _create_session(db_session, user)

    response = _get(client, "/valideur", "jeton-secret")

    assert response.status_code == 200
    assert response.json() == {"role": "admin"}


def test_require_role_valideur_refuse_utilisateur_403(client, db_session):
    user = _create_user(db_session, role="utilisateur")
    _create_session(db_session, user)

    response = _get(client, "/valideur", "jeton-secret")

    assert response.status_code == 403
    assert response.json() == {"detail": "Accès refusé : rôle insuffisant."}


def test_require_role_valideur_non_connecte_401(client, db_session):
    _create_user(db_session)

    response = _get(client, "/valideur")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


# --- require_role("admin") ----------------------------------------------------


def test_require_role_admin_refuse_valideur_403(client, db_session):
    user = _create_user(db_session, role="valideur")
    _create_session(db_session, user)

    response = _get(client, "/admin", "jeton-secret")

    assert response.status_code == 403
    assert response.json() == {"detail": "Accès refusé : rôle insuffisant."}


def test_require_role_admin_accepte_admin(client, db_session):
    user = _create_user(db_session, role="admin")
    _create_session(db_session, user)

    response = _get(client, "/admin", "jeton-secret")

    assert response.status_code == 200
    assert response.json() == {"role": "admin"}


# --- require_role("utilisateur") : tout compte actif --------------------------


@pytest.mark.parametrize("role", ["utilisateur", "valideur", "admin"])
def test_require_role_utilisateur_accepte_tout_compte_actif(client, db_session, role):
    user = _create_user(db_session, role=role)
    _create_session(db_session, user)

    response = _get(client, "/utilisateur", "jeton-secret")

    assert response.status_code == 200
    assert response.json() == {"role": role}


# --- Pas de fuite d'information -----------------------------------------------


def test_erreurs_401_403_sans_fuite(client, db_session):
    user = _create_user(db_session, role="utilisateur")
    _create_session(db_session, user)

    forbidden = _get(client, "/valideur", "jeton-secret")
    unauthorized = _get(client, "/qui-suis-je")

    for response in (forbidden, unauthorized):
        text = response.text.lower()
        assert "jeton-secret" not in text
        assert "password" not in text
        assert "sql" not in text
        assert "traceback" not in text
