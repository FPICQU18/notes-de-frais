"""Tests des routes de gestion des notes de frais (`/api/v1/notes`)."""

from datetime import UTC, date, datetime

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession

from app.db import get_db
from app.main import app
from app.models import Depense, Note, User
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


def _make_user(
    db_session: OrmSession,
    *,
    email: str = "jean@example.com",
    role: str = "utilisateur",
) -> User:
    user = User(
        email=email,
        display_name="Jean Dupont",
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
    client: TestClient, db_session: OrmSession, *, email: str = "jean@example.com"
) -> User:
    user = _make_user(db_session, email=email)
    response = _login(client, email)
    assert response.status_code == 200
    return user


def _make_note(
    db_session: OrmSession,
    user: User,
    *,
    libelle: str = "Note de frais",
    statut: str = "brouillon",
    created_at: datetime | None = None,
) -> Note:
    note = Note(user_id=user.id, libelle=libelle, statut=statut)
    if created_at is not None:
        note.created_at = created_at
    db_session.add(note)
    db_session.commit()
    db_session.refresh(note)
    return note


def _make_depense(
    db_session: OrmSession,
    user: User,
    *,
    libelle: str = "Repas client",
    date_depense: date = DATE_PASSEE,
    montant_centimes: int = 1250,
    note_id: int | None = None,
) -> Depense:
    depense = Depense(
        user_id=user.id,
        libelle=libelle,
        date_depense=date_depense,
        montant_centimes=montant_centimes,
        categorie="repas",
        note_id=note_id,
    )
    db_session.add(depense)
    db_session.commit()
    db_session.refresh(depense)
    return depense


def _count_notes(db_session: OrmSession) -> int:
    return db_session.execute(sa.select(sa.func.count()).select_from(Note)).scalar_one()


@pytest.fixture()
def client(db_session: OrmSession):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --- Création ----------------------------------------------------------------


def test_create_note_201_vide(client, db_session):
    user = _connect(client, db_session)

    response = client.post("/api/v1/notes", json={"libelle": "Semaine 47"})

    assert response.status_code == 201
    body = response.json()
    assert set(body) == FIELDS_NOTE
    assert body["libelle"] == "Semaine 47"
    assert body["statut"] == "brouillon"
    assert body["nb_depenses"] == 0
    assert body["total_centimes"] == 0
    assert body["created_at"]
    assert body["updated_at"]
    # `user_id` n'est pas exposé, mais le dossier appartient bien à l'appelant.
    stored = db_session.get(Note, body["id"])
    assert stored.user_id == user.id


def test_create_note_avec_depenses_201(client, db_session):
    user = _connect(client, db_session)
    a = _make_depense(db_session, user, montant_centimes=1000)
    b = _make_depense(db_session, user, montant_centimes=2500)

    response = client.post(
        "/api/v1/notes",
        json={"libelle": "Semaine 47", "depense_ids": [a.id, b.id]},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["nb_depenses"] == 2
    assert body["total_centimes"] == 3500
    assert db_session.get(Depense, a.id).note_id == body["id"]
    assert db_session.get(Depense, b.id).note_id == body["id"]


def test_create_note_depense_autre_utilisateur_404_sans_creation(client, db_session):
    _connect(client, db_session)
    autre = _make_user(db_session, email="autre@example.com")
    depense_autre = _make_depense(db_session, autre)

    response = client.post(
        "/api/v1/notes", json={"libelle": "X", "depense_ids": [depense_autre.id]}
    )

    assert response.status_code == 404
    assert _count_notes(db_session) == 0
    assert db_session.get(Depense, depense_autre.id).note_id is None


def test_create_note_depense_inexistante_404_sans_creation(client, db_session):
    _connect(client, db_session)

    response = client.post("/api/v1/notes", json={"libelle": "X", "depense_ids": [999999]})

    assert response.status_code == 404
    assert _count_notes(db_session) == 0


def test_create_note_depense_deja_rattachee_409_sans_creation(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)

    response = client.post("/api/v1/notes", json={"libelle": "X", "depense_ids": [depense.id]})

    assert response.status_code == 409
    assert _count_notes(db_session) == 1
    assert db_session.get(Depense, depense.id).note_id == note.id


def test_create_note_depense_ids_dupliques_422_sans_creation(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = client.post(
        "/api/v1/notes", json={"libelle": "X", "depense_ids": [depense.id, depense.id]}
    )

    assert response.status_code == 422
    assert _count_notes(db_session) == 0


@pytest.mark.parametrize("payload", [{}, {"depense_ids": []}])
def test_create_note_depense_ids_vide_ou_absent_201(client, db_session, payload):
    _connect(client, db_session)

    response = client.post("/api/v1/notes", json={**payload, "libelle": "Semaine 47"})

    assert response.status_code == 201
    body = response.json()
    assert body["nb_depenses"] == 0
    assert body["total_centimes"] == 0


@pytest.mark.parametrize("libelle", ["", "   ", "a" * 201])
def test_create_note_libelle_invalide_422_sans_creation(client, db_session, libelle):
    _connect(client, db_session)

    response = client.post("/api/v1/notes", json={"libelle": libelle})

    assert response.status_code == 422
    assert _count_notes(db_session) == 0


def test_create_note_libelle_200_caracteres_201(client, db_session):
    _connect(client, db_session)

    response = client.post("/api/v1/notes", json={"libelle": "a" * 200})

    assert response.status_code == 201
    assert response.json()["libelle"] == "a" * 200


# --- Liste -------------------------------------------------------------------


def test_list_notes_uniquement_ses_notes_triees_et_totaux(client, db_session):
    user = _connect(client, db_session)
    autre = _make_user(db_session, email="autre@example.com")

    vieille = _make_note(
        db_session, user, libelle="Vieille", created_at=datetime(2024, 1, 1, tzinfo=UTC)
    )
    moyenne = _make_note(
        db_session, user, libelle="Moyenne", created_at=datetime(2024, 2, 1, tzinfo=UTC)
    )
    recente = _make_note(
        db_session, user, libelle="Recente", created_at=datetime(2024, 3, 1, tzinfo=UTC)
    )

    _make_depense(db_session, user, note_id=moyenne.id, montant_centimes=1250)
    _make_depense(db_session, user, note_id=recente.id, montant_centimes=1000)
    _make_depense(db_session, user, note_id=recente.id, montant_centimes=1000)
    _make_note(db_session, autre, libelle="Etrangere", created_at=datetime(2024, 4, 1, tzinfo=UTC))

    response = client.get("/api/v1/notes")

    assert response.status_code == 200
    body = response.json()
    assert [n["libelle"] for n in body] == ["Recente", "Moyenne", "Vieille"]
    by_id = {n["id"]: n for n in body}
    assert by_id[vieille.id]["nb_depenses"] == 0
    assert by_id[vieille.id]["total_centimes"] == 0
    assert by_id[moyenne.id]["nb_depenses"] == 1
    assert by_id[moyenne.id]["total_centimes"] == 1250
    assert by_id[recente.id]["nb_depenses"] == 2
    assert by_id[recente.id]["total_centimes"] == 2000


def test_list_notes_created_at_egal_trie_par_id_desc(client, db_session):
    user = _connect(client, db_session)
    meme_moment = datetime(2024, 2, 1, tzinfo=UTC)
    premiere = _make_note(db_session, user, libelle="Premiere", created_at=meme_moment)
    seconde = _make_note(db_session, user, libelle="Seconde", created_at=meme_moment)

    response = client.get("/api/v1/notes")

    assert response.status_code == 200
    assert [n["id"] for n in response.json()] == [seconde.id, premiere.id]


def test_list_notes_sans_note_200_vide(client, db_session):
    _connect(client, db_session)

    response = client.get("/api/v1/notes")

    assert response.status_code == 200
    assert response.json() == []


def test_list_notes_derniere_depense_le_max_et_ordre(client, db_session):
    user = _connect(client, db_session)
    vieille = _make_note(
        db_session, user, libelle="Vieille", created_at=datetime(2024, 1, 1, tzinfo=UTC)
    )
    sans_depense = _make_note(
        db_session, user, libelle="Sans depense", created_at=datetime(2024, 3, 1, tzinfo=UTC)
    )
    _make_depense(
        db_session, user, note_id=vieille.id, date_depense=date(2024, 1, 5), montant_centimes=1000
    )
    _make_depense(
        db_session, user, note_id=vieille.id, date_depense=date(2024, 2, 20), montant_centimes=2000
    )

    response = client.get("/api/v1/notes")

    assert response.status_code == 200
    body = response.json()
    # Ordre `created_at DESC` préservé : le dossier sans dépense (mars) reste
    # avant le dossier plus ancien (janvier), sans influence de la date max.
    assert [n["libelle"] for n in body] == ["Sans depense", "Vieille"]
    by_id = {n["id"]: n for n in body}
    assert by_id[vieille.id]["derniere_depense_le"] == "2024-02-20"
    assert by_id[sans_depense.id]["derniere_depense_le"] is None


# --- Détail ------------------------------------------------------------------


def test_get_note_200_avec_depenses_triees_et_total(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    mars_a = _make_depense(
        db_session, user, note_id=note.id, date_depense=date(2024, 3, 10), montant_centimes=500
    )
    janvier = _make_depense(
        db_session, user, note_id=note.id, date_depense=date(2024, 1, 15), montant_centimes=2000
    )
    mars_b = _make_depense(
        db_session, user, note_id=note.id, date_depense=date(2024, 3, 10), montant_centimes=100
    )

    response = client.get(f"/api/v1/notes/{note.id}")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == FIELDS_NOTE | {"depenses"}
    assert body["nb_depenses"] == 3
    assert body["total_centimes"] == 2600
    assert [d["id"] for d in body["depenses"]] == [janvier.id, mars_a.id, mars_b.id]


def test_get_note_200_derniere_depense_le(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    _make_depense(db_session, user, note_id=note.id, date_depense=date(2024, 1, 15))
    _make_depense(db_session, user, note_id=note.id, date_depense=date(2024, 3, 10))

    response = client.get(f"/api/v1/notes/{note.id}")

    assert response.status_code == 200
    assert response.json()["derniere_depense_le"] == "2024-03-10"


def test_get_note_200_derniere_depense_le_nulle_sans_depense(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)

    response = client.get(f"/api/v1/notes/{note.id}")

    assert response.status_code == 200
    assert response.json()["derniere_depense_le"] is None


def test_acces_note_autre_utilisateur_404(client, db_session):
    _connect(client, db_session)
    autre = _make_user(db_session, email="autre@example.com")
    note = _make_note(db_session, autre)

    get = client.get(f"/api/v1/notes/{note.id}")
    patch = client.patch(f"/api/v1/notes/{note.id}", json={"libelle": "X"})
    delete = client.delete(f"/api/v1/notes/{note.id}")

    assert get.status_code == 404
    assert patch.status_code == 404
    assert delete.status_code == 404
    assert get.json() == {"detail": "Note introuvable."}
    assert patch.json() == get.json()
    assert delete.json() == get.json()


def test_note_inexistante_404(client, db_session):
    _connect(client, db_session)

    get = client.get("/api/v1/notes/999999")
    patch = client.patch("/api/v1/notes/999999", json={"libelle": "X"})
    delete = client.delete("/api/v1/notes/999999")

    assert get.status_code == 404
    assert patch.status_code == 404
    assert delete.status_code == 404
    assert get.json() == {"detail": "Note introuvable."}


# --- Renommage ---------------------------------------------------------------


def test_patch_note_200_libelle_et_updated_at(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user, libelle="Semaine 47")
    before = note.updated_at

    response = client.patch(f"/api/v1/notes/{note.id}", json={"libelle": "Déplacement Lyon"})

    assert response.status_code == 200
    body = response.json()
    assert body["libelle"] == "Déplacement Lyon"
    assert db_session.get(Note, note.id).updated_at > before


@pytest.mark.parametrize("libelle", ["", "   ", "a" * 201])
def test_patch_note_libelle_invalide_422_inchange(client, db_session, libelle):
    user = _connect(client, db_session)
    note = _make_note(db_session, user, libelle="Semaine 47")

    response = client.patch(f"/api/v1/notes/{note.id}", json={"libelle": libelle})

    assert response.status_code == 422
    assert db_session.get(Note, note.id).libelle == "Semaine 47"


def test_patch_note_non_brouillon_409_inchange(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user, statut="soumise", libelle="Semaine 47")

    response = client.patch(f"/api/v1/notes/{note.id}", json={"libelle": "Renommée"})

    assert response.status_code == 409
    assert response.json()["detail"] == "Le dossier n'est modifiable qu'au statut brouillon."
    assert db_session.get(Note, note.id).libelle == "Semaine 47"


# --- Suppression -------------------------------------------------------------


def test_delete_note_204_depenses_detachees_pas_supprimees(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)

    response = client.delete(f"/api/v1/notes/{note.id}")

    assert response.status_code == 204
    assert response.content == b""
    assert db_session.get(Note, note.id) is None
    # La dépense existe toujours mais n'est plus rattachée (ON DELETE SET NULL).
    assert db_session.get(Depense, depense.id) is not None
    note_id = db_session.execute(
        sa.select(Depense.note_id).where(Depense.id == depense.id)
    ).scalar_one()
    assert note_id is None


def test_delete_note_non_brouillon_409_intact(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user, statut="soumise")
    depense = _make_depense(db_session, user, note_id=note.id)

    response = client.delete(f"/api/v1/notes/{note.id}")

    assert response.status_code == 409
    assert db_session.get(Note, note.id) is not None
    assert db_session.get(Depense, depense.id).note_id == note.id


# --- Ajout d'une dépense -----------------------------------------------------


def test_ajout_depense_204(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user)

    response = client.post(f"/api/v1/notes/{note.id}/depenses/{depense.id}")

    assert response.status_code == 204
    assert response.content == b""
    assert db_session.get(Depense, depense.id).note_id == note.id


def test_ajout_depense_deja_dans_autre_note_409(client, db_session):
    user = _connect(client, db_session)
    note_origine = _make_note(db_session, user)
    note_cible = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note_origine.id)

    response = client.post(f"/api/v1/notes/{note_cible.id}/depenses/{depense.id}")

    assert response.status_code == 409
    assert db_session.get(Depense, depense.id).note_id == note_origine.id


def test_ajout_depense_deja_dans_ce_note_409(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)

    response = client.post(f"/api/v1/notes/{note.id}/depenses/{depense.id}")

    assert response.status_code == 409
    assert "déjà" in response.json()["detail"]
    assert db_session.get(Depense, depense.id).note_id == note.id


@pytest.mark.parametrize(
    "method, scenario, expected_detail",
    [
        ("POST", "note_autre", "Note introuvable."),
        ("POST", "depense_autre", "Dépense introuvable."),
        ("POST", "note_inexistante", "Note introuvable."),
        ("POST", "depense_inexistante", "Dépense introuvable."),
        ("DELETE", "note_autre", "Note introuvable."),
        ("DELETE", "depense_autre", "Dépense introuvable."),
        ("DELETE", "note_inexistante", "Note introuvable."),
        ("DELETE", "depense_inexistante", "Dépense introuvable."),
    ],
)
def test_ajout_retrait_404(client, db_session, method, scenario, expected_detail):
    user = _connect(client, db_session)
    autre = _make_user(db_session, email="autre@example.com")
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user)

    if scenario == "note_autre":
        note_id = _make_note(db_session, autre).id
        depense_id = depense.id
    elif scenario == "depense_autre":
        note_id = note.id
        depense_id = _make_depense(db_session, autre).id
    elif scenario == "note_inexistante":
        note_id = 999999
        depense_id = depense.id
    else:  # depense_inexistante
        note_id = note.id
        depense_id = 999999

    response = client.request(method, f"/api/v1/notes/{note_id}/depenses/{depense_id}")

    assert response.status_code == 404
    assert response.json() == {"detail": expected_detail}


def test_ajout_note_non_brouillon_409(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user, statut="soumise")
    depense = _make_depense(db_session, user)

    response = client.post(f"/api/v1/notes/{note.id}/depenses/{depense.id}")

    assert response.status_code == 409
    assert db_session.get(Depense, depense.id).note_id is None


# --- Retrait d'une dépense ---------------------------------------------------


def test_retrait_depense_204(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)

    response = client.delete(f"/api/v1/notes/{note.id}/depenses/{depense.id}")

    assert response.status_code == 204
    stored = db_session.get(Depense, depense.id)
    assert stored is not None
    assert stored.note_id is None


def test_retrait_depense_non_rattachee_409(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user)

    response = client.delete(f"/api/v1/notes/{note.id}/depenses/{depense.id}")

    assert response.status_code == 409
    assert db_session.get(Depense, depense.id).note_id is None


def test_retrait_depense_dans_autre_note_409(client, db_session):
    user = _connect(client, db_session)
    note_origine = _make_note(db_session, user)
    note_cible = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note_origine.id)

    response = client.delete(f"/api/v1/notes/{note_cible.id}/depenses/{depense.id}")

    assert response.status_code == 409
    assert response.json()["detail"] == "La dépense n'est pas dans ce dossier."
    assert db_session.get(Depense, depense.id) is not None
    assert db_session.get(Depense, depense.id).note_id == note_origine.id
    assert db_session.get(Note, note_origine.id) is not None
    assert db_session.get(Note, note_cible.id) is not None


def test_retrait_note_non_brouillon_409(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user, statut="soumise")
    depense = _make_depense(db_session, user, note_id=note.id)

    response = client.delete(f"/api/v1/notes/{note.id}/depenses/{depense.id}")

    assert response.status_code == 409
    assert db_session.get(Depense, depense.id).note_id == note.id


# --- Autorisation ------------------------------------------------------------


@pytest.mark.parametrize(
    "method, path, payload",
    [
        ("POST", "/api/v1/notes", {"libelle": "X"}),
        ("GET", "/api/v1/notes", None),
        ("GET", "/api/v1/notes/1", None),
        ("PATCH", "/api/v1/notes/1", {"libelle": "X"}),
        ("DELETE", "/api/v1/notes/1", None),
        ("POST", "/api/v1/notes/1/depenses/1", None),
        ("DELETE", "/api/v1/notes/1/depenses/1", None),
    ],
)
def test_toutes_routes_sans_cookie_401(client, db_session, method, path, payload):
    _make_user(db_session)
    client.cookies.clear()

    response = (
        client.request(method, path, json=payload)
        if payload is not None
        else client.request(method, path)
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}
