"""Tests du circuit de validation des notes de frais (transitions de statut)."""

from datetime import date

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session as OrmSession

from app.api.note_transitions import _stmt_note_for_update
from app.db import get_db
from app.main import app
from app.models import Depense, Note, NoteTransition, User
from app.security import hash_password

PASSWORD = "mot-de-passe-secret"
PASSWORD_HASH = hash_password(PASSWORD)
DATE_PASSEE = date(2024, 1, 15)

FIELDS_NOTE = {
    "id",
    "libelle",
    "statut",
    "total_centimes",
    "nb_depenses",
    "derniere_depense_le",
    "created_at",
    "updated_at",
}
FIELDS_TRANSITION = {
    "id",
    "acteur",
    "ancien_statut",
    "nouveau_statut",
    "motif",
    "created_at",
}
FIELDS_ACTEUR = {"id", "display_name"}


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
) -> Note:
    note = Note(user_id=user.id, libelle=libelle, statut=statut)
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
) -> Depense:
    depense = Depense(
        user_id=user.id,
        libelle="Repas client",
        date_depense=DATE_PASSEE,
        montant_centimes=montant_centimes,
        categorie="repas",
        note_id=note_id,
    )
    db_session.add(depense)
    db_session.commit()
    db_session.refresh(depense)
    return depense


def _count_transitions(db_session: OrmSession, note_id: int) -> int:
    return db_session.execute(
        sa.select(sa.func.count())
        .select_from(NoteTransition)
        .where(NoteTransition.note_id == note_id)
    ).scalar_one()


@pytest.fixture()
def client(db_session: OrmSession):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --- Auth : 401 sur toutes les routes ---------------------------------------

_ROUTES = [
    ("post", "/api/v1/notes/1/soumettre", None),
    ("post", "/api/v1/notes/1/valider", None),
    ("post", "/api/v1/notes/1/refuser", {"motif": "Justificatif manquant"}),
    ("post", "/api/v1/notes/1/rouvrir", None),
    ("post", "/api/v1/notes/1/rembourser", None),
    ("get", "/api/v1/notes/1/historique", None),
]


@pytest.mark.parametrize("method,path,json_body", _ROUTES)
def test_sans_session_401(client, method, path, json_body):
    response = client.get(path) if method == "get" else client.post(path, json=json_body)
    assert response.status_code == 401


# --- Soumettre ---------------------------------------------------------------


def test_soumettre_200_statut_soumise_et_soumise_at(client, db_session):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user)
    _make_depense(db_session, user, note_id=note.id)
    before = note.updated_at

    response = client.post(f"/api/v1/notes/{note.id}/soumettre")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == FIELDS_NOTE
    assert body["statut"] == "soumise"
    refreshed = db_session.get(Note, note.id)
    assert refreshed.soumise_at is not None
    assert refreshed.soumise_at.tzinfo is not None
    assert refreshed.updated_at > before


def test_soumettre_200_historise(client, db_session):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user)
    _make_depense(db_session, user, note_id=note.id)

    response = client.post(f"/api/v1/notes/{note.id}/soumettre")
    assert response.status_code == 200

    historique = client.get(f"/api/v1/notes/{note.id}/historique").json()
    assert len(historique) == 1
    transition = historique[0]
    assert set(transition) == FIELDS_TRANSITION
    assert transition["ancien_statut"] == "brouillon"
    assert transition["nouveau_statut"] == "soumise"
    assert transition["acteur"] == {"id": user.id, "display_name": "Alice"}
    assert transition["motif"] is None
    assert transition["created_at"] is not None


def test_soumettre_sans_depense_409(client, db_session):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user)

    response = client.post(f"/api/v1/notes/{note.id}/soumettre")

    assert response.status_code == 409
    assert "au moins une dépense" in response.json()["detail"]
    assert db_session.get(Note, note.id).statut == "brouillon"
    assert _count_transitions(db_session, note.id) == 0


@pytest.mark.parametrize("statut", ["soumise", "validee", "refusee", "remboursee"])
def test_soumettre_statut_avance_409_sans_historique(client, db_session, statut):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user, statut=statut)
    _make_depense(db_session, user, note_id=note.id)

    response = client.post(f"/api/v1/notes/{note.id}/soumettre")

    assert response.status_code == 409
    assert _count_transitions(db_session, note.id) == 0


@pytest.mark.parametrize("role", ["valideur", "admin"])
def test_soumettre_brouillon_autre_404(client, db_session, role):
    _connect(client, db_session, email="acteur@example.com", role=role, display_name="Acteur")
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire)
    _make_depense(db_session, proprietaire, note_id=note.id)

    response = client.post(f"/api/v1/notes/{note.id}/soumettre")

    assert response.status_code == 404


def test_soumettre_soumise_autre_valideur_403(client, db_session):
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _make_depense(db_session, proprietaire, note_id=note.id)

    response = client.post(f"/api/v1/notes/{note.id}/soumettre")

    assert response.status_code == 403


def test_soumettre_refusee_sans_rouvrir_409(client, db_session):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user, statut="refusee")
    _make_depense(db_session, user, note_id=note.id)

    response = client.post(f"/api/v1/notes/{note.id}/soumettre")

    assert response.status_code == 409


# --- Valider ----------------------------------------------------------------


def test_valider_200_valideur_non_proprietaire(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _make_depense(db_session, proprietaire, note_id=note.id)
    valideur = _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Bob"
    )

    response = client.post(f"/api/v1/notes/{note.id}/valider")

    assert response.status_code == 200
    assert response.json()["statut"] == "validee"
    historique = client.get(f"/api/v1/notes/{note.id}/historique").json()
    assert len(historique) == 1
    assert historique[0]["ancien_statut"] == "soumise"
    assert historique[0]["nouveau_statut"] == "validee"
    assert historique[0]["acteur"] == {"id": valideur.id, "display_name": "Bob"}
    assert historique[0]["motif"] is None


def test_valider_200_admin_non_proprietaire(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _make_depense(db_session, proprietaire, note_id=note.id)
    _connect(client, db_session, email="admin@example.com", role="admin", display_name="Claire")

    response = client.post(f"/api/v1/notes/{note.id}/valider")

    assert response.status_code == 200
    assert response.json()["statut"] == "validee"


@pytest.mark.parametrize("role", ["valideur", "admin"])
def test_valider_proprietaire_403(client, db_session, role):
    proprietaire = _connect(
        client, db_session, email="proprio@example.com", role=role, display_name="Alice"
    )
    note = _make_note(db_session, proprietaire, statut="soumise")
    _make_depense(db_session, proprietaire, note_id=note.id)

    response = client.post(f"/api/v1/notes/{note.id}/valider")

    assert response.status_code == 403
    assert db_session.get(Note, note.id).statut == "soumise"
    assert _count_transitions(db_session, note.id) == 0


def test_valider_utilisateur_403_sur_son_dossier(client, db_session):
    user = _connect(
        client, db_session, email="u@example.com", role="utilisateur", display_name="Alice"
    )
    note = _make_note(db_session, user, statut="soumise")

    response = client.post(f"/api/v1/notes/{note.id}/valider")

    assert response.status_code == 403


def test_valider_utilisateur_403_sur_dossier_autre(client, db_session):
    _connect(client, db_session, email="u@example.com", role="utilisateur", display_name="Alice")
    autre = _make_user(db_session, email="autre@example.com", display_name="Bob")
    note = _make_note(db_session, autre, statut="soumise")

    response = client.post(f"/api/v1/notes/{note.id}/valider")

    assert response.status_code == 403


def test_valider_brouillon_propre_403(client, db_session):
    valideur = _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Bob"
    )
    note = _make_note(db_session, valideur)
    _make_depense(db_session, valideur, note_id=note.id)

    response = client.post(f"/api/v1/notes/{note.id}/valider")

    assert response.status_code == 403


@pytest.mark.parametrize("statut", ["validee", "refusee", "remboursee"])
def test_valider_statut_avance_409(client, db_session, statut):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut=statut)
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")

    response = client.post(f"/api/v1/notes/{note.id}/valider")

    assert response.status_code == 409


def test_valider_brouillon_autre_404(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire)
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")

    response = client.post(f"/api/v1/notes/{note.id}/valider")

    assert response.status_code == 404


# --- Refuser ----------------------------------------------------------------


def test_refuser_200_valideur_non_proprietaire(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _make_depense(db_session, proprietaire, note_id=note.id)
    valideur = _connect(
        client, db_session, email="valideur@example.com", role="valideur", display_name="Bob"
    )

    response = client.post(
        f"/api/v1/notes/{note.id}/refuser", json={"motif": "Justificatif manquant"}
    )

    assert response.status_code == 200
    assert response.json()["statut"] == "refusee"
    historique = client.get(f"/api/v1/notes/{note.id}/historique").json()
    assert len(historique) == 1
    assert historique[0]["ancien_statut"] == "soumise"
    assert historique[0]["nouveau_statut"] == "refusee"
    assert historique[0]["acteur"] == {"id": valideur.id, "display_name": "Bob"}
    assert historique[0]["motif"] == "Justificatif manquant"


@pytest.mark.parametrize(
    "body_absent,payload",
    [
        (True, None),
        (False, {"motif": ""}),
        (False, {"motif": "   "}),
        (False, {"motif": "a" * 1001}),
    ],
)
def test_refuser_motif_invalide_422(client, db_session, body_absent, payload):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")

    if body_absent:
        response = client.post(f"/api/v1/notes/{note.id}/refuser")
    else:
        response = client.post(f"/api/v1/notes/{note.id}/refuser", json=payload)

    assert response.status_code == 422
    assert db_session.get(Note, note.id).statut == "soumise"
    assert _count_transitions(db_session, note.id) == 0


def test_refuser_motif_vide_ou_trop_long_message_francais(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")

    response = client.post(f"/api/v1/notes/{note.id}/refuser", json={"motif": "   "})
    assert response.status_code == 422
    assert response.json()["detail"][0]["msg"] == "Le motif est requis."

    response = client.post(f"/api/v1/notes/{note.id}/refuser", json={"motif": "a" * 1001})
    assert response.status_code == 422
    assert "1000 caractères" in response.json()["detail"][0]["msg"]


def test_refuser_motif_1000_200(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")

    response = client.post(f"/api/v1/notes/{note.id}/refuser", json={"motif": "a" * 1000})

    assert response.status_code == 200
    assert db_session.get(Note, note.id).statut == "refusee"


def test_refuser_motif_strip(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")

    response = client.post(
        f"/api/v1/notes/{note.id}/refuser", json={"motif": "  Justificatif manquant  "}
    )

    assert response.status_code == 200
    historique = client.get(f"/api/v1/notes/{note.id}/historique").json()
    assert historique[0]["motif"] == "Justificatif manquant"


@pytest.mark.parametrize("role", ["valideur", "admin"])
def test_refuser_proprietaire_403(client, db_session, role):
    proprietaire = _connect(
        client, db_session, email="proprio@example.com", role=role, display_name="Alice"
    )
    note = _make_note(db_session, proprietaire, statut="soumise")

    response = client.post(f"/api/v1/notes/{note.id}/refuser", json={"motif": "x"})

    assert response.status_code == 403


def test_refuser_utilisateur_403(client, db_session):
    user = _connect(
        client, db_session, email="u@example.com", role="utilisateur", display_name="Alice"
    )
    note = _make_note(db_session, user, statut="soumise")

    response = client.post(f"/api/v1/notes/{note.id}/refuser", json={"motif": "x"})

    assert response.status_code == 403


def test_refuser_brouillon_autre_admin_404(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire)
    _connect(client, db_session, email="admin@example.com", role="admin", display_name="Claire")

    response = client.post(f"/api/v1/notes/{note.id}/refuser", json={"motif": "x"})

    assert response.status_code == 404


# --- Rouvrir ----------------------------------------------------------------


def test_rouvrir_200_proprietaire(client, db_session):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user, statut="refusee")

    response = client.post(f"/api/v1/notes/{note.id}/rouvrir")

    assert response.status_code == 200
    assert response.json()["statut"] == "brouillon"
    historique = client.get(f"/api/v1/notes/{note.id}/historique").json()
    assert len(historique) == 1
    assert historique[0]["ancien_statut"] == "refusee"
    assert historique[0]["nouveau_statut"] == "brouillon"
    assert historique[0]["acteur"] == {"id": user.id, "display_name": "Alice"}
    assert historique[0]["motif"] is None


def test_rouvrir_puis_modifier_et_resoumettre(client, db_session):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user)
    _make_depense(db_session, user, note_id=note.id)

    assert client.post(f"/api/v1/notes/{note.id}/soumettre").status_code == 200
    premier_soumise_at = db_session.get(Note, note.id).soumise_at

    _make_user(db_session, email="valideur@example.com", role="valideur", display_name="Bob")
    _login(client, "valideur@example.com")
    assert (
        client.post(
            f"/api/v1/notes/{note.id}/refuser", json={"motif": "Justificatif manquant"}
        ).status_code
        == 200
    )

    _login(client, "proprio@example.com")
    assert client.post(f"/api/v1/notes/{note.id}/rouvrir").status_code == 200

    # Rouvrir rend le dossier à nouveau modifiable.
    patch = client.patch(f"/api/v1/notes/{note.id}", json={"libelle": "Note corrigée"})
    assert patch.status_code == 200

    assert client.post(f"/api/v1/notes/{note.id}/soumettre").status_code == 200
    refreshed = db_session.get(Note, note.id)
    assert refreshed.statut == "soumise"
    assert refreshed.soumise_at > premier_soumise_at


@pytest.mark.parametrize("statut", ["soumise", "validee", "remboursee", "brouillon"])
def test_rouvrir_statut_non_refusee_409(client, db_session, statut):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user, statut=statut)

    response = client.post(f"/api/v1/notes/{note.id}/rouvrir")

    assert response.status_code == 409


def test_rouvrir_refusee_autre_valideur_403(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="refusee")
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")

    response = client.post(f"/api/v1/notes/{note.id}/rouvrir")

    assert response.status_code == 403


def test_rouvrir_refusee_autre_utilisateur_404(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="refusee")
    _connect(client, db_session, email="u@example.com", role="utilisateur", display_name="Bob")

    response = client.post(f"/api/v1/notes/{note.id}/rouvrir")

    assert response.status_code == 404


# --- Rembourser -------------------------------------------------------------


def test_rembourser_200_admin(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="validee")
    admin = _connect(
        client, db_session, email="admin@example.com", role="admin", display_name="Claire"
    )

    response = client.post(f"/api/v1/notes/{note.id}/rembourser")

    assert response.status_code == 200
    assert response.json()["statut"] == "remboursee"
    historique = client.get(f"/api/v1/notes/{note.id}/historique").json()
    assert len(historique) == 1
    assert historique[0]["ancien_statut"] == "validee"
    assert historique[0]["nouveau_statut"] == "remboursee"
    assert historique[0]["acteur"] == {"id": admin.id, "display_name": "Claire"}
    assert historique[0]["motif"] is None


def test_rembourser_valideur_403(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="validee")
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")

    response = client.post(f"/api/v1/notes/{note.id}/rembourser")

    assert response.status_code == 403


@pytest.mark.parametrize("statut", ["soumise", "refusee", "remboursee"])
def test_rembourser_statut_invalide_409(client, db_session, statut):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut=statut)
    _connect(client, db_session, email="admin@example.com", role="admin", display_name="Claire")

    response = client.post(f"/api/v1/notes/{note.id}/rembourser")

    assert response.status_code == 409


def test_rembourser_brouillon_propre_409(client, db_session):
    admin = _connect(
        client, db_session, email="admin@example.com", role="admin", display_name="Claire"
    )
    note = _make_note(db_session, admin, statut="brouillon")

    response = client.post(f"/api/v1/notes/{note.id}/rembourser")

    assert response.status_code == 409


def test_rembourser_brouillon_autre_admin_404(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire)
    _connect(client, db_session, email="admin@example.com", role="admin", display_name="Claire")

    response = client.post(f"/api/v1/notes/{note.id}/rembourser")

    assert response.status_code == 404


# --- Historique -------------------------------------------------------------


def test_historique_ordre_chronologique_complet(client, db_session):
    owner = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    valideur = _make_user(
        db_session, email="valideur@example.com", role="valideur", display_name="Bob"
    )
    admin = _make_user(db_session, email="admin@example.com", role="admin", display_name="Claire")
    note = _make_note(db_session, owner)
    _make_depense(db_session, owner, note_id=note.id)

    # 1. propriétaire soumet
    assert client.post(f"/api/v1/notes/{note.id}/soumettre").status_code == 200
    # 2. valideur refuse
    _login(client, "valideur@example.com")
    assert (
        client.post(
            f"/api/v1/notes/{note.id}/refuser", json={"motif": "Justificatif manquant"}
        ).status_code
        == 200
    )
    # 3. propriétaire rouvre
    _login(client, "proprio@example.com")
    assert client.post(f"/api/v1/notes/{note.id}/rouvrir").status_code == 200
    # 4. propriétaire resoumet
    assert client.post(f"/api/v1/notes/{note.id}/soumettre").status_code == 200
    # 5. valideur valide
    _login(client, "valideur@example.com")
    assert client.post(f"/api/v1/notes/{note.id}/valider").status_code == 200
    # 6. admin rembourse
    _login(client, "admin@example.com")
    assert client.post(f"/api/v1/notes/{note.id}/rembourser").status_code == 200

    historique = client.get(f"/api/v1/notes/{note.id}/historique").json()

    assert [t["ancien_statut"] for t in historique] == [
        "brouillon",
        "soumise",
        "refusee",
        "brouillon",
        "soumise",
        "validee",
    ]
    assert [t["nouveau_statut"] for t in historique] == [
        "soumise",
        "refusee",
        "brouillon",
        "soumise",
        "validee",
        "remboursee",
    ]
    assert [t["acteur"]["id"] for t in historique] == [
        owner.id,
        valideur.id,
        owner.id,
        owner.id,
        valideur.id,
        admin.id,
    ]
    assert [t["acteur"]["display_name"] for t in historique] == [
        "Alice",
        "Bob",
        "Alice",
        "Alice",
        "Bob",
        "Claire",
    ]
    assert [t["motif"] for t in historique] == [
        None,
        "Justificatif manquant",
        None,
        None,
        None,
        None,
    ]
    for transition in historique:
        assert set(transition) == FIELDS_TRANSITION
        assert set(transition["acteur"]) == FIELDS_ACTEUR
        assert transition["created_at"] is not None


def test_historique_brouillon_sans_transition_200_vide(client, db_session):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user)

    response = client.get(f"/api/v1/notes/{note.id}/historique")

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize("role", ["valideur", "admin"])
def test_historique_non_brouillon_autre_200(client, db_session, role):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _connect(client, db_session, email="acteur@example.com", role=role, display_name="Acteur")

    response = client.get(f"/api/v1/notes/{note.id}/historique")

    assert response.status_code == 200
    assert response.json() == []


def test_historique_brouillon_autre_404(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire)
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")

    response = client.get(f"/api/v1/notes/{note.id}/historique")

    assert response.status_code == 404


def test_historique_inexistant_404(client, db_session):
    _connect(client, db_session, email="proprio@example.com", display_name="Alice")

    response = client.get("/api/v1/notes/999999/historique")

    assert response.status_code == 404


# --- Horodatage updated_at sur rattachement/détachement ---------------------


def test_ajout_depense_avance_updated_at(client, db_session):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user)
    before = note.updated_at

    response = client.post(f"/api/v1/notes/{note.id}/depenses/{depense.id}")

    assert response.status_code == 204
    assert db_session.get(Note, note.id).updated_at > before


def test_retrait_depense_avance_updated_at(client, db_session):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)
    before = db_session.get(Note, note.id).updated_at

    response = client.delete(f"/api/v1/notes/{note.id}/depenses/{depense.id}")

    assert response.status_code == 204
    assert db_session.get(Note, note.id).updated_at > before


def test_ajout_depense_non_brouillon_409(client, db_session):
    user = _connect(client, db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, user, statut="soumise")
    depense = _make_depense(db_session, user)

    response = client.post(f"/api/v1/notes/{note.id}/depenses/{depense.id}")

    assert response.status_code == 409


# --- Verrouillage -----------------------------------------------------------


def test_valider_deux_fois_409_une_seule_ligne(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com", display_name="Alice")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _connect(client, db_session, email="valideur@example.com", role="valideur", display_name="Bob")

    first = client.post(f"/api/v1/notes/{note.id}/valider")
    second = client.post(f"/api/v1/notes/{note.id}/valider")

    assert first.status_code == 200
    assert second.status_code == 409
    assert _count_transitions(db_session, note.id) == 1


def test_verrouillage_for_update_compiled():
    stmt = _stmt_note_for_update(123)
    sql = str(stmt.compile(dialect=postgresql.dialect()))
    assert "FOR UPDATE" in sql
