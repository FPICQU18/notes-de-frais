"""Tests de l'API d'authentification : ouverture et fermeture de session."""

import hashlib
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession

from app.api import auth
from app.db import get_db
from app.main import app
from app.models import Session, User
from app.security import hash_password

PASSWORD = "mot-de-passe-secret"
PASSWORD_HASH = hash_password(PASSWORD)

COOKIE_NAME = "ndf_session"


def _cookie_value(response, name: str = COOKIE_NAME) -> str | None:
    """Renvoie la valeur du cookie `name` depuis l'en-tête `set-cookie`, ou None."""
    raw = response.headers.get("set-cookie")
    if raw is None:
        return None
    jar = SimpleCookie()
    jar.load(raw)
    morsel = jar.get(name)
    return None if morsel is None else morsel.value


def _login(client: TestClient, email: str, password: str):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _create_user(
    db_session: OrmSession,
    *,
    email: str = "jean@example.com",
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        display_name="Jean Dupont",
        role="utilisateur",
        is_active=is_active,
        password_hash=PASSWORD_HASH,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _count_sessions(db_session: OrmSession) -> int:
    return db_session.execute(sa.select(sa.func.count()).select_from(Session)).scalar_one()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@pytest.fixture()
def client(db_session: OrmSession):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --- Ouverture de session : cas nominal ---------------------------------------


def test_login_succes_renvoie_utilisateur_sans_hash_ni_jeton(client, db_session):
    _create_user(db_session)

    response = _login(client, "jean@example.com", PASSWORD)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"id", "email", "display_name", "role"}
    assert body["email"] == "jean@example.com"
    assert body["display_name"] == "Jean Dupont"
    assert body["role"] == "utilisateur"
    assert "password_hash" not in body

    token = _cookie_value(response)
    assert token is not None
    assert token not in body.values()


def test_login_succes_pose_cookie_ndf_session_secure(client, db_session):
    _create_user(db_session)

    response = _login(client, "jean@example.com", PASSWORD)

    assert response.status_code == 200
    raw = response.headers["set-cookie"]
    assert raw.startswith("ndf_session=")
    assert "HttpOnly" in raw
    assert "Secure" in raw
    assert "SameSite=strict" in raw
    assert "Path=/" in raw
    assert "Max-Age=604800" in raw

    token = _cookie_value(response)
    assert token is not None
    # secrets.token_urlsafe(32) → 43 caractères (32 octets d'entropie).
    assert len(token) == 43


def test_login_succes_cree_une_seule_session_hachee(client, db_session):
    _create_user(db_session)

    response = _login(client, "jean@example.com", PASSWORD)

    assert response.status_code == 200
    token = _cookie_value(response)
    assert token is not None

    rows = db_session.execute(sa.select(Session)).scalars().all()
    assert len(rows) == 1
    session = rows[0]
    assert session.token_hash == _hash_token(token)
    assert session.token_hash != token
    assert session.expires_at - session.created_at == timedelta(days=7)
    assert session.created_at.tzinfo is not None
    assert session.expires_at.tzinfo is not None
    assert session.created_at.utcoffset() == timedelta(0)
    assert session.expires_at.utcoffset() == timedelta(0)


# --- Refus de connexion : indiscernables --------------------------------------


def test_login_email_inconnu_401_sans_session_ni_cookie(client, db_session):
    response = _login(client, "inconnu@example.com", PASSWORD)

    assert response.status_code == 401
    assert response.json() == {"detail": "E-mail ou mot de passe incorrect."}
    assert _count_sessions(db_session) == 0
    assert _cookie_value(response) is None


def test_login_mauvais_mot_de_passe_401_sans_session_ni_cookie(client, db_session):
    _create_user(db_session)

    response = _login(client, "jean@example.com", "mauvais-mot-de-passe")

    assert response.status_code == 401
    assert response.json() == {"detail": "E-mail ou mot de passe incorrect."}
    assert _count_sessions(db_session) == 0
    assert _cookie_value(response) is None


def test_login_compte_inactif_401_sans_session_ni_cookie(client, db_session):
    _create_user(db_session, is_active=False)

    response = _login(client, "jean@example.com", PASSWORD)

    assert response.status_code == 401
    assert response.json() == {"detail": "E-mail ou mot de passe incorrect."}
    assert _count_sessions(db_session) == 0
    assert _cookie_value(response) is None


def test_login_email_inconnu_verifie_hash_argon2_factice(client, db_session, monkeypatch):
    appels: list[str] = []

    def fake_verify(password: str, password_hash: str) -> bool:
        appels.append(password_hash)
        return False

    monkeypatch.setattr(auth, "verify_password", fake_verify)

    response = _login(client, "inconnu@example.com", PASSWORD)

    assert response.status_code == 401
    assert len(appels) == 1
    assert appels[0] == auth._DUMMY_PASSWORD_HASH
    assert appels[0].startswith("$argon2")


def test_login_email_majuscules_et_espaces_normalise(client, db_session):
    _create_user(db_session, email="jean@example.com")

    response = _login(client, "  Jean@Example.COM  ", PASSWORD)

    assert response.status_code == 200
    assert response.json()["email"] == "jean@example.com"
    assert _count_sessions(db_session) == 1


# --- Corps invalide -----------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"email": "jean@example.com"},
        {"password": PASSWORD},
        {"email": "", "password": PASSWORD},
        {"email": "   ", "password": PASSWORD},
        {"email": "jean@example.com", "password": ""},
        {"email": "jean@example.com", "password": "   "},
    ],
)
def test_login_corps_invalide_422(client, db_session, payload):
    _create_user(db_session)

    response = client.post("/api/v1/auth/login", json=payload)

    assert response.status_code == 422
    assert _count_sessions(db_session) == 0
    assert _cookie_value(response) is None


def test_login_json_malforme_422(client, db_session):
    response = client.post(
        "/api/v1/auth/login",
        content=b'{"email": "jean@example.com", ',
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422
    assert _count_sessions(db_session) == 0
    assert _cookie_value(response) is None


# --- Fermeture de session -----------------------------------------------------


def test_logout_supprime_session_et_efface_cookie(client, db_session):
    _create_user(db_session)
    assert _login(client, "jean@example.com", PASSWORD).status_code == 200
    assert _count_sessions(db_session) == 1

    response = client.post("/api/v1/auth/logout")

    assert response.status_code == 204
    assert _count_sessions(db_session) == 0

    raw = response.headers["set-cookie"]
    assert "Max-Age=0" in raw
    assert "HttpOnly" in raw
    assert "Secure" in raw
    assert "SameSite=strict" in raw
    assert "Path=/" in raw
    assert _cookie_value(response) == ""


def test_logout_sans_cookie_204_idempotent(client, db_session):
    _create_user(db_session)
    assert _login(client, "jean@example.com", PASSWORD).status_code == 200
    assert _count_sessions(db_session) == 1

    # On retire le cookie du jar pour simuler une requête réellement sans cookie
    # (sinon le jar envoie le cookie de session issu du login ci-dessus).
    client.cookies.clear()
    response = client.post("/api/v1/auth/logout")

    assert response.status_code == 204
    assert _cookie_value(response) == ""
    assert _count_sessions(db_session) == 1


def test_logout_cookie_inconnu_204_sans_erreur(client, db_session):
    _create_user(db_session)
    assert _login(client, "jean@example.com", PASSWORD).status_code == 200
    assert _count_sessions(db_session) == 1

    client.cookies.clear()
    response = client.post("/api/v1/auth/logout", cookies={COOKIE_NAME: "jeton-inconnu"})

    assert response.status_code == 204
    assert _cookie_value(response) == ""
    # La session existante n'est pas touchée.
    assert _count_sessions(db_session) == 1


def test_logout_session_expiree_204_sans_toucher_aux_autres(client, db_session):
    user = _create_user(db_session)
    now = datetime.now(UTC)
    token_expire = "jeton-expire"
    token_valide = "jeton-valide"
    db_session.add_all(
        [
            Session(
                user_id=user.id,
                token_hash=_hash_token(token_expire),
                created_at=now - timedelta(days=8),
                expires_at=now - timedelta(days=1),
            ),
            Session(
                user_id=user.id,
                token_hash=_hash_token(token_valide),
                created_at=now,
                expires_at=now + timedelta(days=7),
            ),
        ]
    )
    db_session.commit()
    assert _count_sessions(db_session) == 2

    response = client.post("/api/v1/auth/logout", cookies={COOKIE_NAME: token_expire})

    assert response.status_code == 204
    assert _cookie_value(response) == ""
    # Seule la session ciblée est supprimée ; l'autre reste valide.
    remaining = db_session.execute(sa.select(Session)).scalars().all()
    assert len(remaining) == 1
    assert remaining[0].token_hash == _hash_token(token_valide)


def test_logout_une_session_l_autre_reste_valide(client, db_session):
    _create_user(db_session)
    first = _login(client, "jean@example.com", PASSWORD)
    token1 = _cookie_value(first)
    second = _login(client, "jean@example.com", PASSWORD)
    token2 = _cookie_value(second)
    assert token1 is not None and token2 is not None
    assert token1 != token2
    assert _count_sessions(db_session) == 2

    client.cookies.clear()
    response = client.post("/api/v1/auth/logout", cookies={COOKIE_NAME: token1})

    assert response.status_code == 204
    assert _count_sessions(db_session) == 1
    remaining = db_session.execute(sa.select(Session)).scalar_one()
    assert remaining.token_hash == _hash_token(token2)
