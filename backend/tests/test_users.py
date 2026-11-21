"""Tests des routes d'administration des comptes (`/api/v1/users`)."""

import hashlib
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession

from app.db import get_db
from app.main import app
from app.models import User, UserSession
from app.security import hash_password, verify_password

PASSWORD = "mot-de-passe-secret"
PASSWORD_HASH = hash_password(PASSWORD)

COOKIE_NAME = "ndf_session"
ADMIN_EMAIL = "admin@example.com"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _make_user(
    db_session: OrmSession,
    *,
    email: str = "jean@example.com",
    role: str = "utilisateur",
    is_active: bool = True,
    display_name: str = "Jean Dupont",
) -> User:
    user = User(
        email=email,
        display_name=display_name,
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


def _login(client: TestClient, email: str, password: str = PASSWORD):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _connect_as_admin(client: TestClient, db_session: OrmSession) -> User:
    """Crée un admin et le connecte via l'API (cookie de session posé dans le jar)."""
    admin = _make_user(db_session, email=ADMIN_EMAIL, role="admin", display_name="Admin")
    response = _login(client, ADMIN_EMAIL)
    assert response.status_code == 200
    return admin


def _count_users(db_session: OrmSession) -> int:
    return db_session.execute(sa.select(sa.func.count()).select_from(User)).scalar_one()


def _count_sessions(db_session: OrmSession, user_id: int | None = None) -> int:
    stmt = sa.select(sa.func.count()).select_from(UserSession)
    if user_id is not None:
        stmt = stmt.where(UserSession.user_id == user_id)
    return db_session.execute(stmt).scalar_one()


def _get_user(db_session: OrmSession, user_id: int) -> User:
    return db_session.get(User, user_id)


@pytest.fixture()
def client(db_session: OrmSession):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --- Création ----------------------------------------------------------------


def test_create_user_201_sans_mot_de_passe_ni_hash(client, db_session):
    _connect_as_admin(client, db_session)

    response = client.post(
        "/api/v1/users",
        json={
            "email": "marie@example.com",
            "display_name": "Marie Curie",
            "role": "utilisateur",
            "password": PASSWORD,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"id", "email", "display_name", "role", "is_active", "created_at"}
    assert body["email"] == "marie@example.com"
    assert body["display_name"] == "Marie Curie"
    assert body["role"] == "utilisateur"
    assert body["is_active"] is True
    assert body["created_at"]

    text = response.text.lower()
    assert "password" not in text
    assert "argon2" not in text

    stored = db_session.execute(
        sa.select(User).where(User.email == "marie@example.com")
    ).scalar_one()
    assert stored.password_hash.startswith("$argon2")
    assert stored.password_hash != PASSWORD
    assert verify_password(PASSWORD, stored.password_hash) is True


def test_create_user_email_majuscules_et_espaces_normalise(client, db_session):
    _connect_as_admin(client, db_session)

    response = client.post(
        "/api/v1/users",
        json={
            "email": "  Marie.Curie@Example.COM  ",
            "display_name": "Marie Curie",
            "role": "utilisateur",
            "password": PASSWORD,
        },
    )

    assert response.status_code == 201
    assert response.json()["email"] == "marie.curie@example.com"

    stored = db_session.execute(sa.select(User)).scalars().all()
    assert [u.email for u in stored if u.email != ADMIN_EMAIL] == ["marie.curie@example.com"]


def test_create_user_email_doublon_casse_differente_409(client, db_session):
    _connect_as_admin(client, db_session)
    _make_user(db_session, email="jean@example.com")

    response = client.post(
        "/api/v1/users",
        json={
            "email": "JEAN@Example.COM",
            "display_name": "Autre Jean",
            "role": "utilisateur",
            "password": PASSWORD,
        },
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "Un compte existe déjà avec cet e-mail."}
    # L'admin + Jean : aucun nouveau compte créé.
    assert _count_users(db_session) == 2


@pytest.mark.parametrize(
    "email",
    [
        "",
        "   ",
        "sans-arobase",
        "a" * 311 + "@example.com",  # > 320 caractères
    ],
)
def test_create_user_email_invalide_422(client, db_session, email):
    _connect_as_admin(client, db_session)

    response = client.post(
        "/api/v1/users",
        json={"email": email, "display_name": "X", "role": "utilisateur", "password": PASSWORD},
    )

    assert response.status_code == 422
    assert _count_users(db_session) == 1  # seul l'admin


def test_create_user_mot_de_passe_court_422(client, db_session):
    _connect_as_admin(client, db_session)

    response = client.post(
        "/api/v1/users",
        json={
            "email": "marie@example.com",
            "display_name": "Marie Curie",
            "role": "utilisateur",
            "password": "court",
        },
    )

    assert response.status_code == 422
    assert _count_users(db_session) == 1


@pytest.mark.parametrize("role", ["superadmin", "valideur-x", ""])
def test_create_user_role_invalide_422(client, db_session, role):
    _connect_as_admin(client, db_session)

    response = client.post(
        "/api/v1/users",
        json={
            "email": "marie@example.com",
            "display_name": "Marie Curie",
            "role": role,
            "password": PASSWORD,
        },
    )

    assert response.status_code == 422
    assert _count_users(db_session) == 1


@pytest.mark.parametrize("display_name", ["", "   ", "\t"])
def test_create_user_display_name_vide_422(client, db_session, display_name):
    _connect_as_admin(client, db_session)

    response = client.post(
        "/api/v1/users",
        json={
            "email": "marie@example.com",
            "display_name": display_name,
            "role": "utilisateur",
            "password": PASSWORD,
        },
    )

    assert response.status_code == 422
    assert _count_users(db_session) == 1


def test_create_user_role_admin_201(client, db_session):
    _connect_as_admin(client, db_session)

    response = client.post(
        "/api/v1/users",
        json={
            "email": "boss@example.com",
            "display_name": "Boss",
            "role": "admin",
            "password": PASSWORD,
        },
    )

    assert response.status_code == 201
    assert response.json()["role"] == "admin"


# --- Liste -------------------------------------------------------------------


def test_list_users_200_triee_par_id_sans_secret(client, db_session):
    _connect_as_admin(client, db_session)
    alice = _make_user(db_session, email="alice@example.com", display_name="Alice")
    bob = _make_user(db_session, email="bob@example.com", display_name="Bob")

    response = client.get("/api/v1/users")

    assert response.status_code == 200
    body = response.json()
    ids = [u["id"] for u in body]
    assert ids == sorted(ids)
    assert len(body) == 3  # admin, alice, bob

    for item in body:
        assert set(item) == {"id", "email", "display_name", "role", "is_active", "created_at"}
        assert item["created_at"]

    text = response.text.lower()
    assert "password_hash" not in text
    assert "argon2" not in text
    assert "token" not in text

    emails = {u["email"] for u in body}
    assert emails == {ADMIN_EMAIL, alice.email, bob.email}


def test_list_users_compte_desactive_apparait_is_active_false(client, db_session):
    _connect_as_admin(client, db_session)
    inactif = _make_user(db_session, email="inactif@example.com", is_active=False)

    response = client.get("/api/v1/users")

    assert response.status_code == 200
    body = {u["email"]: u for u in response.json()}
    assert body["inactif@example.com"]["is_active"] is False
    assert body["inactif@example.com"]["id"] == inactif.id


# --- Changement de rôle ------------------------------------------------------


def test_change_role_200_role_persiste(client, db_session):
    _connect_as_admin(client, db_session)
    cible = _make_user(db_session, email="cible@example.com", role="utilisateur")

    response = client.patch(f"/api/v1/users/{cible.id}/role", json={"role": "valideur"})

    assert response.status_code == 200
    assert response.json()["role"] == "valideur"
    assert _get_user(db_session, cible.id).role == "valideur"


def test_change_role_self_admin_noop_200(client, db_session):
    admin = _connect_as_admin(client, db_session)

    response = client.patch(f"/api/v1/users/{admin.id}/role", json={"role": "admin"})

    assert response.status_code == 200
    assert response.json()["role"] == "admin"
    assert _get_user(db_session, admin.id).role == "admin"


@pytest.mark.parametrize("role", ["utilisateur", "valideur"])
def test_change_role_self_non_admin_403(client, db_session, role):
    admin = _connect_as_admin(client, db_session)

    response = client.patch(f"/api/v1/users/{admin.id}/role", json={"role": role})

    assert response.status_code == 403
    assert "administrateur" in response.json()["detail"].lower()
    assert _get_user(db_session, admin.id).role == "admin"


def test_change_role_inconnu_422_role_inchange(client, db_session):
    _connect_as_admin(client, db_session)
    cible = _make_user(db_session, email="cible@example.com", role="utilisateur")

    response = client.patch(f"/api/v1/users/{cible.id}/role", json={"role": "inconnu"})

    assert response.status_code == 422
    assert _get_user(db_session, cible.id).role == "utilisateur"


def test_change_role_id_inconnu_404(client, db_session):
    _connect_as_admin(client, db_session)

    response = client.patch("/api/v1/users/999999/role", json={"role": "valideur"})

    assert response.status_code == 404
    assert response.json() == {"detail": "Compte introuvable."}


# --- Désactivation -----------------------------------------------------------


def test_deactivate_204_is_active_false_sessions_supprimees(client, db_session):
    _connect_as_admin(client, db_session)
    cible = _make_user(db_session, email="cible@example.com")
    _create_session(db_session, cible, token="jeton-cible-1")
    _create_session(db_session, cible, token="jeton-cible-2")
    assert _count_sessions(db_session, cible.id) == 2

    response = client.post(f"/api/v1/users/{cible.id}/deactivate")

    assert response.status_code == 204
    assert response.content == b""
    assert _get_user(db_session, cible.id).is_active is False
    assert _count_sessions(db_session, cible.id) == 0


def test_deactivate_ancien_cookie_401_et_login_401(client, db_session):
    _connect_as_admin(client, db_session)
    cible = _make_user(db_session, email="cible@example.com")
    _create_session(db_session, cible, token="jeton-cible")

    assert client.post(f"/api/v1/users/{cible.id}/deactivate").status_code == 204

    # Ancien cookie : 401 sur /auth/me.
    client.cookies.clear()
    me = client.get("/api/v1/auth/me", cookies={COOKIE_NAME: "jeton-cible"})
    assert me.status_code == 401
    assert me.json() == {"detail": "Authentification requise."}

    # Login avec le bon mot de passe : 401 avec le message générique inchangé.
    login = client.post(
        "/api/v1/auth/login", json={"email": "cible@example.com", "password": PASSWORD}
    )
    assert login.status_code == 401
    assert login.json() == {"detail": "E-mail ou mot de passe incorrect."}


def test_deactivate_self_403_compte_actif_sessions_intactes(client, db_session):
    admin = _connect_as_admin(client, db_session)
    assert _count_sessions(db_session, admin.id) == 1

    response = client.post(f"/api/v1/users/{admin.id}/deactivate")

    assert response.status_code == 403
    assert "administrateur" in response.json()["detail"].lower()
    assert _get_user(db_session, admin.id).is_active is True
    assert _count_sessions(db_session, admin.id) == 1

    # L'admin reste connecté.
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200


def test_deactivate_deja_desactive_204_idempotent(client, db_session):
    _connect_as_admin(client, db_session)
    cible = _make_user(db_session, email="cible@example.com", is_active=False)

    response = client.post(f"/api/v1/users/{cible.id}/deactivate")

    assert response.status_code == 204
    assert _get_user(db_session, cible.id).is_active is False


def test_deactivate_id_inconnu_404(client, db_session):
    _connect_as_admin(client, db_session)

    response = client.post("/api/v1/users/999999/deactivate")

    assert response.status_code == 404
    assert response.json() == {"detail": "Compte introuvable."}


# --- Réactivation ------------------------------------------------------------


def test_reactivate_204_peut_se_reconnecter_sans_session_recree(client, db_session):
    _connect_as_admin(client, db_session)
    cible = _make_user(db_session, email="cible@example.com", is_active=False)
    assert _count_sessions(db_session, cible.id) == 0

    response = client.post(f"/api/v1/users/{cible.id}/reactivate")

    assert response.status_code == 204
    assert _get_user(db_session, cible.id).is_active is True
    # Aucune session recréée automatiquement.
    assert _count_sessions(db_session, cible.id) == 0

    # Le compte peut se connecter avec son mot de passe inchangé.
    client.cookies.clear()
    login = client.post(
        "/api/v1/auth/login", json={"email": "cible@example.com", "password": PASSWORD}
    )
    assert login.status_code == 200


def test_reactivate_deja_actif_204_idempotent(client, db_session):
    _connect_as_admin(client, db_session)
    cible = _make_user(db_session, email="cible@example.com", is_active=True)

    response = client.post(f"/api/v1/users/{cible.id}/reactivate")

    assert response.status_code == 204
    assert _get_user(db_session, cible.id).is_active is True


def test_reactivate_id_inconnu_404(client, db_session):
    _connect_as_admin(client, db_session)

    response = client.post("/api/v1/users/999999/reactivate")

    assert response.status_code == 404
    assert response.json() == {"detail": "Compte introuvable."}


# --- Autorisation et transversal ---------------------------------------------


@pytest.mark.parametrize(
    "method, path",
    [
        ("POST", "/api/v1/users"),
        ("GET", "/api/v1/users"),
        ("PATCH", "/api/v1/users/1/role"),
        ("POST", "/api/v1/users/1/deactivate"),
        ("POST", "/api/v1/users/1/reactivate"),
    ],
)
def test_toutes_routes_sans_cookie_401(client, db_session, method, path):
    _make_user(db_session, email="cible@example.com", role="admin")
    client.cookies.clear()

    kwargs = {"json": {"role": "valideur"}} if method == "PATCH" else {}
    if method == "POST" and path == "/api/v1/users":
        kwargs = {
            "json": {
                "email": "x@example.com",
                "display_name": "X",
                "role": "utilisateur",
                "password": PASSWORD,
            }
        }

    response = client.request(method, path, **kwargs)

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


@pytest.mark.parametrize("role", ["utilisateur", "valideur"])
def test_toutes_routes_non_admin_403_sans_modification(client, db_session, role):
    _connect_as_admin(client, db_session)
    cible = _make_user(db_session, email="cible@example.com", role="utilisateur")
    # L'utilisateur non-admin se connecte (remplace le cookie admin).
    _make_user(db_session, email=f"{role}@example.com", role=role)
    client.cookies.clear()
    assert _login(client, f"{role}@example.com").status_code == 200

    routes = [
        (
            "POST",
            "/api/v1/users",
            {
                "email": "nouveau@example.com",
                "display_name": "N",
                "role": "utilisateur",
                "password": PASSWORD,
            },
        ),
        ("GET", "/api/v1/users", None),
        ("PATCH", f"/api/v1/users/{cible.id}/role", {"role": "valideur"}),
        ("POST", f"/api/v1/users/{cible.id}/deactivate", None),
        ("POST", f"/api/v1/users/{cible.id}/reactivate", None),
    ]
    for method, path, payload in routes:
        response = (
            client.request(method, path, json=payload)
            if payload is not None
            else client.request(method, path)
        )
        assert response.status_code == 403, (method, path, response.status_code)
        assert response.json() == {"detail": "Accès refusé : rôle insuffisant."}

    # Aucune modification en base : cible inchangée, aucun compte créé.
    assert _get_user(db_session, cible.id).role == "utilisateur"
    assert _get_user(db_session, cible.id).is_active is True
    assert _count_users(db_session) == 3  # admin + cible + non-admin


def test_erreurs_en_francais_sans_secret(client, db_session):
    _connect_as_admin(client, db_session)

    responses = [
        client.post(
            "/api/v1/users",
            json={"email": "x", "display_name": "", "role": "x", "password": "court"},
        ),
        client.patch("/api/v1/users/999999/role", json={"role": "valideur"}),
        client.post("/api/v1/users/999999/deactivate"),
        client.post("/api/v1/users/999999/reactivate"),
    ]

    for response in responses:
        text = response.text.lower()
        assert "password_hash" not in text
        assert "token" not in text
        assert "sql" not in text
        assert "traceback" not in text
