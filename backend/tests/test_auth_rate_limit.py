"""Tests du rate limiting de POST /api/v1/auth/login (table login_attempts).

Fenêtre glissante de 15 minutes, seuils : 5 échecs par e-mail, 20 par IP.
La vérification des seuils a lieu avant celle du mot de passe ; une tentative
bloquée (429) n'insère aucune ligne.
"""

from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession
from starlette.requests import Request

from app.auth.rate_limit import client_ip
from app.db import get_db
from app.main import app
from app.models import LoginAttempt, User, UserSession
from app.security import hash_password

PASSWORD = "mot-de-passe-secret"
PASSWORD_HASH = hash_password(PASSWORD)

TOO_MANY = "Trop de tentatives. Réessayez dans quelques minutes."
BAD_CREDENTIALS = "E-mail ou mot de passe incorrect."


@pytest.fixture()
def make_client(db_session: OrmSession):
    """Fabrique un TestClient branché sur db_session, avec l'IP source voulue."""

    def _make(host: str = "10.0.0.5") -> TestClient:
        def override_get_db():
            yield db_session

        app.dependency_overrides[get_db] = override_get_db
        return TestClient(app, base_url="https://testserver", client=(host, 50000))

    yield _make
    app.dependency_overrides.clear()


def _login(client: TestClient, email: str, password: str, headers: dict | None = None):
    return client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
        headers=headers or {},
    )


def _create_user(db_session: OrmSession, email: str = "jean@example.com") -> User:
    user = User(
        email=email,
        display_name="Jean Dupont",
        role="utilisateur",
        is_active=True,
        password_hash=PASSWORD_HASH,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _count_attempts(db_session: OrmSession) -> int:
    return db_session.execute(sa.select(sa.func.count()).select_from(LoginAttempt)).scalar_one()


def _attempt_ips(db_session: OrmSession) -> set:
    return set(db_session.execute(sa.select(LoginAttempt.ip)).scalars().all())


def _count_sessions(db_session: OrmSession) -> int:
    return db_session.execute(sa.select(sa.func.count()).select_from(UserSession)).scalar_one()


# --- Seuil e-mail : 5 échecs puis 429 ----------------------------------------


def test_cinq_echecs_email_puis_429_message_exact_sans_session(make_client, db_session):
    _create_user(db_session)
    with make_client() as client:
        for _ in range(5):
            response = _login(client, "jean@example.com", "mauvais-mot-de-passe")
            assert response.status_code == 401
            assert response.json() == {"detail": BAD_CREDENTIALS}
        assert _count_attempts(db_session) == 5

        response = _login(client, "jean@example.com", "mauvais-mot-de-passe")

        assert response.status_code == 429
        assert response.json() == {"detail": TOO_MANY}
        assert _count_sessions(db_session) == 0
        assert "set-cookie" not in response.headers


def test_429_n_ajoute_aucune_ligne_compteur_fige(make_client, db_session):
    _create_user(db_session)
    with make_client() as client:
        for _ in range(5):
            assert _login(client, "jean@example.com", "mauvais").status_code == 401
        assert _count_attempts(db_session) == 5

        for _ in range(3):
            assert _login(client, "jean@example.com", "mauvais").status_code == 429

        # Aucune ligne ajoutée par les tentatives bloquées : la fenêtre ne glisse pas.
        assert _count_attempts(db_session) == 5


def test_seuil_atteint_meme_le_bon_mot_de_passe_recoit_429(make_client, db_session):
    _create_user(db_session)
    with make_client() as client:
        for _ in range(5):
            assert _login(client, "jean@example.com", "mauvais").status_code == 401

        response = _login(client, "jean@example.com", PASSWORD)

        assert response.status_code == 429
        assert response.json() == {"detail": TOO_MANY}
        assert _count_sessions(db_session) == 0
        assert _count_attempts(db_session) == 5


def test_email_normalise_avant_comptage(make_client, db_session):
    _create_user(db_session, email="jean@example.com")
    with make_client() as client:
        for _ in range(5):
            assert _login(client, "  Jean@Example.COM  ", "mauvais").status_code == 401

        response = _login(client, "JEAN@example.com", "mauvais")

        assert response.status_code == 429
        rows = db_session.execute(sa.select(LoginAttempt.email)).scalars().all()
        assert set(rows) == {"jean@example.com"}


# --- Seuil IP : 20 échecs puis 429, quel que soit l'e-mail ---------------------


def test_vingt_echecs_ip_puis_429_meme_email_different(make_client, db_session):
    with make_client("10.0.0.5") as client:
        for i in range(20):
            response = _login(client, f"inconnu{i}@example.com", "mauvais")
            assert response.status_code == 401
        assert _count_attempts(db_session) == 20
        assert _attempt_ips(db_session) == {"10.0.0.5"}

        response = _login(client, "autre@example.com", "mauvais")

        assert response.status_code == 429
        assert response.json() == {"detail": TOO_MANY}
        assert _count_attempts(db_session) == 20


# --- Compteurs e-mail et IP indépendants ---------------------------------------


def test_compteurs_email_et_ip_independants(make_client, db_session):
    _create_user(db_session, email="jean@example.com")
    _create_user(db_session, email="marie@example.com")
    with make_client("10.0.0.5") as client:
        for _ in range(5):
            assert _login(client, "jean@example.com", "mauvais").status_code == 401
        # Jean est bloqué par son e-mail…
        assert _login(client, "jean@example.com", PASSWORD).status_code == 429
        # …mais Marie, depuis la même IP (seulement 5 < 20), se connecte encore.
        response = _login(client, "marie@example.com", PASSWORD)
        assert response.status_code == 200
        assert _count_sessions(db_session) == 1


# --- Remise à zéro du compteur e-mail après succès -----------------------------


def test_succes_sous_seuil_supprime_lignes_email_et_conserve_les_autres(make_client, db_session):
    _create_user(db_session, email="jean@example.com")
    _create_user(db_session, email="marie@example.com")
    with make_client("10.0.0.5") as client:
        assert _login(client, "jean@example.com", "mauvais").status_code == 401
        assert _login(client, "jean@example.com", "mauvais").status_code == 401
        assert _login(client, "marie@example.com", "mauvais").status_code == 401
        assert _count_attempts(db_session) == 3

        response = _login(client, "jean@example.com", PASSWORD)

        assert response.status_code == 200
        assert _count_sessions(db_session) == 1
        # Lignes de Jean supprimées, celle de Marie conservée.
        remaining = db_session.execute(sa.select(LoginAttempt.email)).scalars().all()
        assert remaining == ["marie@example.com"]


# --- Fenêtre glissante : les entrées de plus de 15 minutes ne comptent plus ----


def test_ligne_vieille_de_16_minutes_non_comptee_et_purgee(make_client, db_session):
    _create_user(db_session, email="jean@example.com")
    now = datetime.now(UTC)
    db_session.add_all(
        [
            LoginAttempt(
                email="jean@example.com",
                ip="10.0.0.5",
                created_at=now - timedelta(minutes=16),
            )
            for _ in range(5)
        ]
    )
    db_session.commit()
    assert _count_attempts(db_session) == 5

    with make_client("10.0.0.5") as client:
        # Si les vieilles lignes comptaient, on aurait 5 + 1 >= 5 → 429. On a 401 :
        # elles sont purgées et non comptées.
        response = _login(client, "jean@example.com", "mauvais")

        assert response.status_code == 401
        assert response.json() == {"detail": BAD_CREDENTIALS}
        # Purge des 5 vieilles lignes + insertion de la nouvelle.
        assert _count_attempts(db_session) == 1


# --- X-Forwarded-For : confiance limitée aux réseaux privés --------------------


def test_x_forwarded_for_client_prive_parcours_droite_gauche(make_client, db_session):
    # Source privée (confiance) : on parcourt XFF de droite à gauche. 10.0.0.5
    # est de confiance, 203.0.113.9 est la première non fiable depuis la droite :
    # c'est elle qui compte, pas 1.2.3.4 falsifiable en tête de liste.
    headers = {"X-Forwarded-For": "1.2.3.4, 203.0.113.9, 10.0.0.5"}
    with make_client("10.0.0.5") as client:  # 10.0.0.5 est privé (RFC 1918)
        for i in range(20):
            response = _login(client, f"inconnu{i}@example.com", "mauvais", headers=headers)
            assert response.status_code == 401
        assert _attempt_ips(db_session) == {"203.0.113.9"}

        response = _login(client, "autre@example.com", "mauvais", headers=headers)

        assert response.status_code == 429


def test_x_forwarded_for_client_public_ignore_compteur_sur_ip_client(make_client, db_session):
    headers = {"X-Forwarded-For": "203.0.113.9, 10.0.0.5"}
    with make_client("198.51.100.7") as client:  # IP publique : pas de confiance
        for i in range(20):
            response = _login(client, f"inconnu{i}@example.com", "mauvais", headers=headers)
            assert response.status_code == 401
        # X-Forwarded-For ignoré : le compteur est sur l'IP du client.
        assert _attempt_ips(db_session) == {"198.51.100.7"}

        response = _login(client, "autre@example.com", "mauvais", headers=headers)

        assert response.status_code == 429
        assert response.json() == {"detail": TOO_MANY}


# --- US-039 : X-Forwarded-For parcouru de droite à gauche ---------------------


def _request(host: str, x_forwarded_for: str | None = None):
    """Requête HTTP factice avec la source directe voulue et l'en-tête XFF."""
    headers = []
    if x_forwarded_for is not None:
        headers.append((b"x-forwarded-for", x_forwarded_for.encode()))
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/auth/login",
        "headers": headers,
        "client": (host, 50000),
    }
    return Request(scope)


def test_client_ip_xff_parcours_droite_gauche_premiere_non_fiable():
    # 172.18.0.5 est de confiance : on remonte jusqu'à 203.0.113.7 (1.2.3.4
    # n'est jamais atteint, même s'il est en tête de liste).
    request = _request("172.18.0.2", "1.2.3.4, 203.0.113.7, 172.18.0.5")
    assert client_ip(request) == "203.0.113.7"


def test_client_ip_xff_un_seul_element_public():
    request = _request("172.18.0.2", "203.0.113.7")
    assert client_ip(request) == "203.0.113.7"


def test_client_ip_xff_toutes_valeurs_de_confiance_retourne_ip_directe():
    request = _request("172.18.0.2", "10.0.0.9, 172.18.0.5")
    assert client_ip(request) == "172.18.0.2"


def test_client_ip_sans_x_forwarded_for_retourne_ip_directe():
    request = _request("172.18.0.2")
    assert client_ip(request) == "172.18.0.2"


def test_client_ip_xff_valeur_invalide_ignoree():
    # "pas-une-ip" n'est pas parsable : ignorée, on continue vers la gauche.
    request = _request("172.18.0.2", "pas-une-ip, 203.0.113.7, 10.0.0.5")
    assert client_ip(request) == "203.0.113.7"


def test_client_ip_source_publique_ignore_x_forwarded_for():
    request = _request("198.51.100.7", "1.2.3.4, 203.0.113.7")
    assert client_ip(request) == "198.51.100.7"


def test_client_ip_xff_espaces_autour_des_virgules_ignores():
    request = _request("172.18.0.2", "  1.2.3.4 , 203.0.113.7 ")
    assert client_ip(request) == "203.0.113.7"


def test_xff_tournant_en_tete_vingt_echecs_puis_429_sur_ip_reelle(make_client, db_session):
    """Un attaquant qui change le premier élément de XFF à chaque essai est quand
    même compté sur son IP réelle (première non fiable depuis la droite)."""
    with make_client("172.18.0.2") as client:  # proxy Docker de confiance
        for i in range(20):
            headers = {"X-Forwarded-For": f"198.18.{i}.1, 203.0.113.7, 172.18.0.5"}
            response = _login(client, f"inconnu{i}@example.com", "mauvais", headers=headers)
            assert response.status_code == 401
        # Toutes les tentatives ont été comptées sur l'IP réelle, pas sur les
        # valeurs tournantes en tête de X-Forwarded-For.
        assert _attempt_ips(db_session) == {"203.0.113.7"}
        assert _count_attempts(db_session) == 20

        headers = {"X-Forwarded-For": "198.18.99.99, 203.0.113.7, 172.18.0.5"}
        response = _login(client, "autre@example.com", "mauvais", headers=headers)

        assert response.status_code == 429
        assert response.json() == {"detail": TOO_MANY}
        assert _count_attempts(db_session) == 20
