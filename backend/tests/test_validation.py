"""Tests de la file de validation (liste et détail, vue valideur/admin)."""

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession

from app.db import get_db
from app.main import app
from app.models import Depense, Note, User
from app.security import hash_password

PASSWORD = "mot-de-passe-secret"
PASSWORD_HASH = hash_password(PASSWORD)
DATE_PASSEE = date(2024, 1, 15)

FIELDS_PROPRIETAIRE = {"id", "display_name"}
FIELDS_NOTE_VALIDATION = {
    "id",
    "libelle",
    "statut",
    "total_centimes",
    "nb_depenses",
    "soumise_at",
    "proprietaire",
}
FIELDS_NOTE_DETAIL = FIELDS_NOTE_VALIDATION | {"depenses"}


def _make_user(
    db_session: OrmSession,
    *,
    email: str = "jean@example.com",
    role: str = "utilisateur",
    display_name: str = "Jean Dupont",
) -> User:
    user = User(
        email=email,
        display_name=display_name,
        role=role,
        is_active=True,
        password_hash=PASSWORD_HASH,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _login(client: TestClient, email: str, password: str = PASSWORD):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def _connect(
    client: TestClient,
    db_session: OrmSession,
    *,
    email: str = "jean@example.com",
    role: str = "utilisateur",
    display_name: str = "Jean Dupont",
) -> User:
    user = _make_user(db_session, email=email, role=role, display_name=display_name)
    response = _login(client, email)
    assert response.status_code == 200
    return user


def _make_note(
    db_session: OrmSession,
    user: User,
    *,
    libelle: str = "Note de frais",
    statut: str = "brouillon",
    soumise_at: datetime | None = None,
) -> Note:
    note = Note(user_id=user.id, libelle=libelle, statut=statut, soumise_at=soumise_at)
    db_session.add(note)
    db_session.commit()
    db_session.refresh(note)
    return note


def _make_depense(
    db_session: OrmSession,
    user: User,
    *,
    note_id: int | None = None,
    montant_centimes: int = 1250,
    date_depense: date = DATE_PASSEE,
) -> Depense:
    depense = Depense(
        user_id=user.id,
        libelle="Repas client",
        date_depense=date_depense,
        montant_centimes=montant_centimes,
        categorie="repas",
        note_id=note_id,
    )
    db_session.add(depense)
    db_session.commit()
    db_session.refresh(depense)
    return depense


@pytest.fixture()
def client(db_session: OrmSession):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --- Auth : 401 sans session ------------------------------------------------


def test_liste_sans_session_401(client):
    response = client.get("/api/v1/validation/notes")
    assert response.status_code == 401
    assert response.json()["detail"] == "Authentification requise."


def test_detail_sans_session_401(client):
    response = client.get("/api/v1/validation/notes/1")
    assert response.status_code == 401
    assert response.json()["detail"] == "Authentification requise."


# --- Rôle : 403 pour un utilisateur -----------------------------------------


def test_liste_utilisateur_403(client, db_session):
    _connect(client, db_session, email="u@example.com", role="utilisateur", display_name="Alice")

    response = client.get("/api/v1/validation/notes")

    assert response.status_code == 403


def test_detail_utilisateur_403_sur_son_dossier(client, db_session):
    user = _connect(
        client, db_session, email="u@example.com", role="utilisateur", display_name="Alice"
    )
    note = _make_note(db_session, user, statut="soumise")

    response = client.get(f"/api/v1/validation/notes/{note.id}")

    assert response.status_code == 403


def test_detail_utilisateur_403_avant_visibilite(client, db_session):
    # Le contrôle de rôle (403) précède le contrôle de visibilité (404) : un
    # utilisateur reçoit 403 même pour un brouillon d'autrui qu'il ne verrait pas.
    _connect(client, db_session, email="u@example.com", role="utilisateur", display_name="Alice")
    autre = _make_user(db_session, email="autre@example.com", display_name="Bob")
    note = _make_note(db_session, autre, statut="brouillon")

    response = client.get(f"/api/v1/validation/notes/{note.id}")

    assert response.status_code == 403


# --- Liste : périmètre -------------------------------------------------------


def test_liste_perimetre_multi_proprietaires_sans_brouillon(client, db_session):
    me = _connect(
        client,
        db_session,
        email="valideur1@example.com",
        role="valideur",
        display_name="Valideur 1",
    )
    valideur2 = _make_user(
        db_session, email="valideur2@example.com", role="valideur", display_name="Valideur 2"
    )
    admin = _make_user(db_session, email="admin@example.com", role="admin", display_name="Admin")
    user1 = _make_user(
        db_session, email="u1@example.com", role="utilisateur", display_name="User 1"
    )
    user2 = _make_user(
        db_session, email="u2@example.com", role="utilisateur", display_name="User 2"
    )

    _make_note(db_session, valideur2, statut="soumise", libelle="soumise-v2")
    _make_note(db_session, admin, statut="validee", libelle="validee-admin")
    _make_note(db_session, user1, statut="refusee", libelle="refusee-u1")
    _make_note(db_session, user2, statut="remboursee", libelle="remboursee-u2")
    # Brouillons : ni ceux des autres, ni le sien.
    _make_note(db_session, user1, statut="brouillon", libelle="brouillon-u1")
    _make_note(db_session, valideur2, statut="brouillon", libelle="brouillon-v2")
    _make_note(db_session, me, statut="brouillon", libelle="brouillon-moi")

    response = client.get("/api/v1/validation/notes")

    assert response.status_code == 200
    libelles = {item["libelle"] for item in response.json()}
    assert libelles == {"soumise-v2", "validee-admin", "refusee-u1", "remboursee-u2"}


def test_liste_admin_200_meme_perimetre(client, db_session):
    _connect(client, db_session, email="admin@example.com", role="admin", display_name="Admin")
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    _make_note(db_session, owner, statut="soumise", libelle="soumise")
    _make_note(db_session, owner, statut="brouillon", libelle="brouillon")

    response = client.get("/api/v1/validation/notes")

    assert response.status_code == 200
    assert [item["libelle"] for item in response.json()] == ["soumise"]


def test_liste_refusee_rouverte_absente(client, db_session):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    # Un dossier refusé puis rouvert : redevenu brouillon, soumise_at encore renseigné.
    _make_note(
        db_session,
        owner,
        statut="brouillon",
        libelle="rouverte",
        soumise_at=datetime(2024, 1, 1, tzinfo=UTC),
    )
    _make_note(db_session, owner, statut="soumise", libelle="en-attente")

    response = client.get("/api/v1/validation/notes")

    assert response.status_code == 200
    assert [item["libelle"] for item in response.json()] == ["en-attente"]


# --- Liste : champs exposés et totaux ---------------------------------------


def test_liste_champs_sans_email_ni_role(client, db_session):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    _make_note(db_session, owner, statut="soumise")

    response = client.get("/api/v1/validation/notes")

    assert response.status_code == 200
    item = response.json()[0]
    assert set(item) == FIELDS_NOTE_VALIDATION
    assert set(item["proprietaire"]) == FIELDS_PROPRIETAIRE
    assert item["proprietaire"] == {"id": owner.id, "display_name": "Propriétaire"}
    assert "email" not in item
    assert "role" not in item
    assert "email" not in item["proprietaire"]
    assert "role" not in item["proprietaire"]


def test_liste_totaux_exacts(client, db_session):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    note = _make_note(db_session, owner, statut="soumise")
    _make_depense(db_session, owner, note_id=note.id, montant_centimes=5000)
    _make_depense(db_session, owner, note_id=note.id, montant_centimes=5000)
    _make_depense(db_session, owner, note_id=note.id, montant_centimes=2500)

    response = client.get("/api/v1/validation/notes")

    item = response.json()[0]
    assert item["total_centimes"] == 12500
    assert item["nb_depenses"] == 3


def test_liste_zero_depense_soumise(client, db_session):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    _make_note(db_session, owner, statut="soumise")

    response = client.get("/api/v1/validation/notes")

    item = response.json()[0]
    assert item["total_centimes"] == 0
    assert item["nb_depenses"] == 0


# --- Liste : tri ------------------------------------------------------------


def test_liste_tri_soumise_at_croissant(client, db_session):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    base = datetime(2024, 1, 1, tzinfo=UTC)
    ancien = _make_note(db_session, owner, statut="soumise", libelle="ancien", soumise_at=base)
    moyen = _make_note(
        db_session, owner, statut="soumise", libelle="moyen", soumise_at=base + timedelta(days=1)
    )
    recent = _make_note(
        db_session, owner, statut="soumise", libelle="recent", soumise_at=base + timedelta(days=2)
    )

    response = client.get("/api/v1/validation/notes")

    assert [item["id"] for item in response.json()] == [ancien.id, moyen.id, recent.id]


def test_liste_tri_soumise_at_egal_id_croissant(client, db_session):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    meme_instant = datetime(2024, 1, 1, tzinfo=UTC)
    premier = _make_note(db_session, owner, statut="soumise", libelle="a", soumise_at=meme_instant)
    second = _make_note(db_session, owner, statut="soumise", libelle="b", soumise_at=meme_instant)
    troisieme = _make_note(
        db_session, owner, statut="soumise", libelle="c", soumise_at=meme_instant
    )

    response = client.get("/api/v1/validation/notes")

    assert [item["id"] for item in response.json()] == [premier.id, second.id, troisieme.id]


def test_liste_soumise_at_nul_en_dernier(client, db_session):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    _make_note(
        db_session,
        owner,
        statut="soumise",
        libelle="avec-date",
        soumise_at=datetime(2024, 1, 1, tzinfo=UTC),
    )
    _make_note(db_session, owner, statut="soumise", libelle="sans-date", soumise_at=None)

    response = client.get("/api/v1/validation/notes")

    assert [item["libelle"] for item in response.json()] == ["avec-date", "sans-date"]


# --- Liste : filtre ?statut= -------------------------------------------------


@pytest.mark.parametrize("statut", ["soumise", "validee", "refusee", "remboursee"])
def test_liste_filtre_statut_valide(client, db_session, statut):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    for candidat in ["soumise", "validee", "refusee", "remboursee"]:
        _make_note(db_session, owner, statut=candidat, libelle=candidat)

    response = client.get("/api/v1/validation/notes", params={"statut": statut})

    assert response.status_code == 200
    assert [item["statut"] for item in response.json()] == [statut]
    assert len(response.json()) == 1


@pytest.mark.parametrize("statut", ["brouillon", "inconnu", ""])
def test_liste_statut_invalide_422_message_francais(client, db_session, statut):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    _make_note(db_session, owner, statut="soumise")

    response = client.get("/api/v1/validation/notes", params={"statut": statut})

    assert response.status_code == 422
    assert "consultables" in response.json()["detail"]


# --- Détail -----------------------------------------------------------------


def test_detail_soumise_200_depenses_triees(client, db_session):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    note = _make_note(db_session, owner, statut="soumise")
    tardive = _make_depense(
        db_session, owner, note_id=note.id, montant_centimes=1000, date_depense=date(2024, 3, 1)
    )
    premiere = _make_depense(
        db_session, owner, note_id=note.id, montant_centimes=2000, date_depense=date(2024, 1, 1)
    )
    deuxieme = _make_depense(
        db_session, owner, note_id=note.id, montant_centimes=3000, date_depense=date(2024, 1, 1)
    )

    response = client.get(f"/api/v1/validation/notes/{note.id}")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == FIELDS_NOTE_DETAIL
    assert body["id"] == note.id
    assert body["proprietaire"] == {"id": owner.id, "display_name": "Propriétaire"}
    assert body["total_centimes"] == 6000
    assert body["nb_depenses"] == 3
    # Tri par date croissante puis id croissant : même date → id croissant.
    assert [depense["id"] for depense in body["depenses"]] == [premiere.id, deuxieme.id, tardive.id]
    assert "email" not in body
    assert "role" not in body
    assert "email" not in body["proprietaire"]
    assert "role" not in body["proprietaire"]


@pytest.mark.parametrize("role", ["valideur", "admin"])
@pytest.mark.parametrize("statut", ["refusee", "remboursee"])
def test_detail_refusee_remboursee_200(client, db_session, role, statut):
    _connect(client, db_session, email="acteur@example.com", role=role, display_name="Acteur")
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    note = _make_note(db_session, owner, statut=statut)

    response = client.get(f"/api/v1/validation/notes/{note.id}")

    assert response.status_code == 200
    assert response.json()["id"] == note.id


@pytest.mark.parametrize("role", ["valideur", "admin"])
def test_detail_brouillon_autrui_404(client, db_session, role):
    _connect(client, db_session, email="acteur@example.com", role=role, display_name="Acteur")
    owner = _make_user(db_session, email="owner@example.com", display_name="Propriétaire")
    note = _make_note(db_session, owner, statut="brouillon")

    response = client.get(f"/api/v1/validation/notes/{note.id}")

    assert response.status_code == 404
    assert response.json()["detail"] == "Note introuvable."


def test_detail_inexistant_404(client, db_session):
    _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )

    response = client.get("/api/v1/validation/notes/999999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Note introuvable."


def test_detail_propre_brouillon_200_mais_absent_de_la_liste(client, db_session):
    me = _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Valideur"
    )
    note = _make_note(db_session, me, statut="brouillon")

    response = client.get(f"/api/v1/validation/notes/{note.id}")

    assert response.status_code == 200
    assert response.json()["id"] == note.id
    assert response.json()["statut"] == "brouillon"

    listing = client.get("/api/v1/validation/notes")
    assert listing.status_code == 200
    assert listing.json() == []
