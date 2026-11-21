"""Tests de la route `GET /api/v1/auth/me`."""

import hashlib
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession

from app.db import get_db
from app.main import app
from app.models import Session, User
from app.security import hash_password

PASSWORD = "mot-de-passe-secret"
PASSWORD_HASH = hash_password(PASSWORD)

COOKIE_NAME = "ndf_session"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cookie_value(response, name: str = COOKIE_NAME) -> str | None:
    """Renvoie la valeur du cookie `name` depuis l'en-tête `set-cookie`, ou None."""
    raw = response.headers.get("set-cookie")
    if raw is None:
        return None
    jar = SimpleCookie()
    jar.load(raw)
    morsel = jar.get(name)
    return None if morsel is None else morsel.value


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
    token: str,
    expires_at: datetime | None = None,
) -> Session:
    now = datetime.now(UTC)
    session = Session(
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
    return db_session.execute(sa.select(sa.func.count()).select_from(Session)).scalar_one()


def _login(client: TestClient, email: str, password: str):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


@pytest.fixture()
def client(db_session: OrmSession):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --- Session valide -----------------------------------------------------------


def test_me_session_valide_renvoie_utilisateur_sans_hash_ni_jeton(client, db_session):
    _create_user(db_session)
    assert _login(client, "jean@example.com", PASSWORD).status_code == 200

    response = client.get("/api/v1/auth/me")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"id", "email", "display_name", "role"}
    assert body["email"] == "jean@example.com"
    assert body["display_name"] == "Jean Dupont"
    assert body["role"] == "utilisateur"
    assert "password_hash" not in body


# --- Non authentifié ----------------------------------------------------------


def test_me_sans_cookie_401_francais(client, db_session):
    _create_user(db_session)
    client.cookies.clear()

    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


def test_me_jeton_inconnu_401(client, db_session):
    _create_user(db_session)

    response = client.get("/api/v1/auth/me", cookies={COOKIE_NAME: "jeton-inconnu"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


def test_me_session_expiree_401(client, db_session):
    user = _create_user(db_session)
    _create_session(
        db_session, user, token="jeton-expire", expires_at=datetime.now(UTC) - timedelta(days=1)
    )

    response = client.get("/api/v1/auth/me", cookies={COOKIE_NAME: "jeton-expire"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


def test_me_compte_desactive_401_et_session_supprimee(client, db_session):
    user = _create_user(db_session)
    _create_session(db_session, user, token="jeton-secret")
    assert _count_sessions(db_session) == 1

    # Compte désactivé après la connexion.
    user.is_active = False
    db_session.commit()

    response = client.get("/api/v1/auth/me", cookies={COOKIE_NAME: "jeton-secret"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}
    assert _count_sessions(db_session) == 0


def test_me_une_seule_session_utilisee_les_autres_restent(client, db_session):
    user = _create_user(db_session)
    _create_session(db_session, user, token="jeton-un")
    _create_session(db_session, user, token="jeton-deux")
    assert _count_sessions(db_session) == 2

    client.cookies.clear()
    first = client.get("/api/v1/auth/me", cookies={COOKIE_NAME: "jeton-un"})

    assert first.status_code == 200
    assert first.json()["id"] == user.id

    # L'autre session reste valide.
    client.cookies.clear()
    second = client.get("/api/v1/auth/me", cookies={COOKIE_NAME: "jeton-deux"})

    assert second.status_code == 200
    assert second.json()["id"] == user.id
    assert _count_sessions(db_session) == 2
