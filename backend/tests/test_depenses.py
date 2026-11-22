"""Tests des routes de gestion des dépenses (`/api/v1/depenses`)."""

from datetime import UTC, date, datetime, timedelta

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

FIELDS_DEPENSE = {
    "id",
    "libelle",
    "date_depense",
    "montant_centimes",
    "categorie",
    "commentaire",
    "note_id",
    "created_at",
    "updated_at",
}


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
) -> User:
    user = _make_user(db_session, email=email, role=role)
    response = _login(client, email)
    assert response.status_code == 200
    return user


def _make_depense(
    db_session: OrmSession,
    user: User,
    *,
    libelle: str = "Repas client",
    date_depense: date = DATE_PASSEE,
    montant_centimes: int = 1250,
    categorie: str = "repas",
    commentaire: str | None = None,
    note_id: int | None = None,
) -> Depense:
    depense = Depense(
        user_id=user.id,
        libelle=libelle,
        date_depense=date_depense,
        montant_centimes=montant_centimes,
        categorie=categorie,
        commentaire=commentaire,
        note_id=note_id,
    )
    db_session.add(depense)
    db_session.commit()
    db_session.refresh(depense)
    return depense


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


def _count_depenses(db_session: OrmSession) -> int:
    return db_session.execute(sa.select(sa.func.count()).select_from(Depense)).scalar_one()


def _payload(**overrides) -> dict:
    payload = {
        "libelle": "Repas client",
        "date_depense": DATE_PASSEE.isoformat(),
        "montant_centimes": 1250,
        "categorie": "repas",
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def client(db_session: OrmSession):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --- Création ----------------------------------------------------------------


def test_create_depense_201_complete(client, db_session):
    user = _connect(client, db_session)

    response = client.post("/api/v1/depenses", json=_payload(commentaire="Déjeuner"))

    assert response.status_code == 201
    body = response.json()
    assert set(body) == FIELDS_DEPENSE
    assert body["libelle"] == "Repas client"
    assert body["date_depense"] == DATE_PASSEE.isoformat()
    assert body["montant_centimes"] == 1250
    assert body["categorie"] == "repas"
    assert body["commentaire"] == "Déjeuner"
    assert body["note_id"] is None
    assert body["created_at"]
    assert body["updated_at"]
    # `user_id` n'est pas exposé, mais la dépense appartient bien à l'appelant.
    stored = db_session.get(Depense, body["id"])
    assert stored.user_id == user.id


@pytest.mark.parametrize("montant", [1, 1250, 10_000_000])
def test_create_depense_montant_stocke_en_entier(client, db_session, montant):
    _connect(client, db_session)

    response = client.post("/api/v1/depenses", json=_payload(montant_centimes=montant))

    assert response.status_code == 201
    body = response.json()
    assert body["montant_centimes"] == montant
    assert isinstance(body["montant_centimes"], int)
    stored = db_session.get(Depense, body["id"])
    assert stored.montant_centimes == montant
    assert isinstance(stored.montant_centimes, int)


def test_create_depense_date_du_jour_201(client, db_session):
    _connect(client, db_session)

    response = client.post(
        "/api/v1/depenses",
        json=_payload(date_depense=datetime.now(UTC).date().isoformat()),
    )

    assert response.status_code == 201


def test_create_depense_date_passee_201(client, db_session):
    _connect(client, db_session)

    response = client.post(
        "/api/v1/depenses",
        json=_payload(date_depense=(datetime.now(UTC).date() - timedelta(days=1)).isoformat()),
    )

    assert response.status_code == 201


def test_create_depense_date_future_422_sans_creation(client, db_session):
    _connect(client, db_session)
    future = (datetime.now(UTC).date() + timedelta(days=1)).isoformat()

    response = client.post("/api/v1/depenses", json=_payload(date_depense=future))

    assert response.status_code == 422
    assert any("futur" in error.get("msg", "") for error in response.json()["detail"])
    assert _count_depenses(db_session) == 0


@pytest.mark.parametrize("libelle", ["", "   ", "a" * 201])
def test_create_depense_libelle_invalide_422(client, db_session, libelle):
    _connect(client, db_session)

    response = client.post("/api/v1/depenses", json=_payload(libelle=libelle))

    assert response.status_code == 422
    assert _count_depenses(db_session) == 0


def test_create_depense_libelle_200_caracteres_201(client, db_session):
    _connect(client, db_session)

    response = client.post("/api/v1/depenses", json=_payload(libelle="a" * 200))

    assert response.status_code == 201
    assert response.json()["libelle"] == "a" * 200


@pytest.mark.parametrize("montant", [0, -1, 10_000_001])
def test_create_depense_montant_invalide_422(client, db_session, montant):
    _connect(client, db_session)

    response = client.post("/api/v1/depenses", json=_payload(montant_centimes=montant))

    assert response.status_code == 422
    assert _count_depenses(db_session) == 0


def test_create_depense_montant_non_entier_422(client, db_session):
    _connect(client, db_session)

    response = client.post("/api/v1/depenses", json=_payload(montant_centimes=12.5))

    assert response.status_code == 422
    assert _count_depenses(db_session) == 0


@pytest.mark.parametrize("categorie", ["inconnue", "", "repas "])
def test_create_depense_categorie_invalide_422(client, db_session, categorie):
    _connect(client, db_session)

    response = client.post("/api/v1/depenses", json=_payload(categorie=categorie))

    assert response.status_code == 422
    assert _count_depenses(db_session) == 0


def test_create_depense_commentaire_trop_long_422(client, db_session):
    _connect(client, db_session)

    response = client.post("/api/v1/depenses", json=_payload(commentaire="a" * 1001))

    assert response.status_code == 422
    assert _count_depenses(db_session) == 0


def test_create_depense_commentaire_1000_caracteres_201(client, db_session):
    _connect(client, db_session)

    response = client.post("/api/v1/depenses", json=_payload(commentaire="a" * 1000))

    assert response.status_code == 201
    assert response.json()["commentaire"] == "a" * 1000


@pytest.mark.parametrize("commentaire", [None, "", "   "])
def test_create_depense_commentaire_vide_201_avec_null(client, db_session, commentaire):
    _connect(client, db_session)

    json = _payload()
    if commentaire is not None:
        json["commentaire"] = commentaire

    response = client.post("/api/v1/depenses", json=json)

    assert response.status_code == 201
    assert response.json()["commentaire"] is None


def test_create_depense_ignore_user_id_et_note_id(client, db_session):
    user = _connect(client, db_session)

    response = client.post("/api/v1/depenses", json=_payload(user_id=999, note_id=42))

    assert response.status_code == 201
    body = response.json()
    assert body["note_id"] is None
    stored = db_session.get(Depense, body["id"])
    assert stored.user_id == user.id
    assert stored.note_id is None


# --- Liste -------------------------------------------------------------------


def test_list_depenses_uniquement_ses_depenses_triees(client, db_session):
    user = _connect(client, db_session)
    autre = _make_user(db_session, email="autre@example.com")

    ancienne = _make_depense(db_session, user, libelle="Ancienne", date_depense=date(2024, 1, 1))
    mars_a = _make_depense(db_session, user, libelle="Mars-A", date_depense=date(2024, 3, 1))
    mars_b = _make_depense(db_session, user, libelle="Mars-B", date_depense=date(2024, 3, 1))
    _make_depense(db_session, autre, libelle="Etrangere")

    response = client.get("/api/v1/depenses")

    assert response.status_code == 200
    body = response.json()
    assert [d["libelle"] for d in body] == ["Mars-B", "Mars-A", "Ancienne"]
    assert {d["id"] for d in body} == {ancienne.id, mars_a.id, mars_b.id}


def test_list_depenses_a_classer_true(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    a_classer = _make_depense(db_session, user, libelle="A classer", note_id=None)
    _make_depense(db_session, user, libelle="Rattachee", note_id=note.id)

    response = client.get("/api/v1/depenses?a_classer=true")

    assert response.status_code == 200
    body = response.json()
    assert [d["id"] for d in body] == [a_classer.id]


@pytest.mark.parametrize("query", ["", "?a_classer=false"])
def test_list_depenses_a_classer_false_ou_absent(client, db_session, query):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    a_classer = _make_depense(db_session, user, libelle="A classer", note_id=None)
    rattachee = _make_depense(db_session, user, libelle="Rattachee", note_id=note.id)

    response = client.get(f"/api/v1/depenses{query}")

    assert response.status_code == 200
    assert {d["id"] for d in response.json()} == {a_classer.id, rattachee.id}


def test_list_depenses_a_classer_non_booleen_422(client, db_session):
    _connect(client, db_session)

    response = client.get("/api/v1/depenses?a_classer=peut-etre")

    assert response.status_code == 422


def test_list_depenses_sans_depense_200_vide(client, db_session):
    _connect(client, db_session)

    response = client.get("/api/v1/depenses")

    assert response.status_code == 200
    assert response.json() == []


# --- Détail, modification, suppression ---------------------------------------


def test_get_depense_200_complete(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user, commentaire="Déjeuner")

    response = client.get(f"/api/v1/depenses/{depense.id}")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == FIELDS_DEPENSE
    assert body["id"] == depense.id
    assert body["commentaire"] == "Déjeuner"


def test_acces_depense_autre_utilisateur_404(client, db_session):
    _connect(client, db_session)
    autre = _make_user(db_session, email="autre@example.com")
    depense = _make_depense(db_session, autre)

    get = client.get(f"/api/v1/depenses/{depense.id}")
    patch = client.patch(f"/api/v1/depenses/{depense.id}", json={"libelle": "X"})
    delete = client.delete(f"/api/v1/depenses/{depense.id}")

    assert get.status_code == 404
    assert patch.status_code == 404
    assert delete.status_code == 404
    assert get.json() == {"detail": "Dépense introuvable."}
    assert patch.json() == get.json()
    assert delete.json() == get.json()


def test_depense_inexistante_404(client, db_session):
    _connect(client, db_session)

    get = client.get("/api/v1/depenses/999999")
    patch = client.patch("/api/v1/depenses/999999", json={"libelle": "X"})
    delete = client.delete("/api/v1/depenses/999999")

    assert get.status_code == 404
    assert patch.status_code == 404
    assert delete.status_code == 404
    assert get.json() == {"detail": "Dépense introuvable."}


def test_patch_partiel_200_champs_inchanges_et_updated_at(client, db_session):
    _connect(client, db_session)
    created = client.post("/api/v1/depenses", json=_payload(commentaire="Déjeuner")).json()

    response = client.patch(f"/api/v1/depenses/{created['id']}", json={"montant_centimes": 2500})

    assert response.status_code == 200
    body = response.json()
    assert body["montant_centimes"] == 2500
    assert body["libelle"] == created["libelle"]
    assert body["date_depense"] == created["date_depense"]
    assert body["categorie"] == created["categorie"]
    assert body["commentaire"] == "Déjeuner"
    assert body["updated_at"] != created["updated_at"]


@pytest.mark.parametrize(
    "field, value",
    [
        ("libelle", ""),
        ("libelle", "a" * 201),
        ("montant_centimes", 0),
        ("montant_centimes", 10_000_001),
        ("categorie", "inconnue"),
    ],
)
def test_patch_invalide_422_depense_inchangee(client, db_session, field, value):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = client.patch(f"/api/v1/depenses/{depense.id}", json={field: value})

    assert response.status_code == 422
    stored = db_session.get(Depense, depense.id)
    assert stored.libelle == depense.libelle
    assert stored.date_depense == depense.date_depense
    assert stored.montant_centimes == depense.montant_centimes
    assert stored.categorie == depense.categorie


def test_patch_date_future_422_depense_inchangee(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)
    future = (datetime.now(UTC).date() + timedelta(days=1)).isoformat()

    response = client.patch(f"/api/v1/depenses/{depense.id}", json={"date_depense": future})

    assert response.status_code == 422
    assert any("futur" in error.get("msg", "") for error in response.json()["detail"])
    stored = db_session.get(Depense, depense.id)
    assert stored.date_depense == depense.date_depense


def test_patch_commentaire_null_efface(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user, commentaire="Déjeuner")

    response = client.patch(f"/api/v1/depenses/{depense.id}", json={"commentaire": None})

    assert response.status_code == 200
    assert response.json()["commentaire"] is None
    assert db_session.get(Depense, depense.id).commentaire is None


@pytest.mark.parametrize("field", ["libelle", "date_depense", "montant_centimes", "categorie"])
def test_patch_champ_null_422(client, db_session, field):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = client.patch(f"/api/v1/depenses/{depense.id}", json={field: None})

    assert response.status_code == 422


def test_patch_ignore_note_id_et_user_id(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = client.patch(f"/api/v1/depenses/{depense.id}", json={"note_id": 42, "user_id": 999})

    assert response.status_code == 200
    stored = db_session.get(Depense, depense.id)
    assert stored.note_id is None
    assert stored.user_id == user.id


def test_delete_204_ligne_supprimee(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = client.delete(f"/api/v1/depenses/{depense.id}")

    assert response.status_code == 204
    assert response.content == b""
    assert db_session.get(Depense, depense.id) is None


def test_delete_deja_supprimee_404(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    assert client.delete(f"/api/v1/depenses/{depense.id}").status_code == 204
    response = client.delete(f"/api/v1/depenses/{depense.id}")

    assert response.status_code == 404
    assert response.json() == {"detail": "Dépense introuvable."}


# --- Dépenses rattachées à un dossier non brouillon --------------------------


def test_patch_depense_dossier_non_brouillon_409_inchangee(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user, statut="soumise")
    depense = _make_depense(db_session, user, note_id=note.id)

    response = client.patch(f"/api/v1/depenses/{depense.id}", json={"libelle": "Modifiée"})

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "La dépense appartient à un dossier qui n'est pas au statut brouillon."
    )
    stored = db_session.get(Depense, depense.id)
    assert stored.libelle == depense.libelle


def test_delete_depense_dossier_non_brouillon_409_intacte(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user, statut="soumise")
    depense = _make_depense(db_session, user, note_id=note.id)

    response = client.delete(f"/api/v1/depenses/{depense.id}")

    assert response.status_code == 409
    assert db_session.get(Depense, depense.id) is not None
    assert db_session.get(Note, note.id) is not None


def test_patch_depense_dossier_brouillon_200(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)

    response = client.patch(f"/api/v1/depenses/{depense.id}", json={"libelle": "Modifiée"})

    assert response.status_code == 200
    assert response.json()["libelle"] == "Modifiée"
    assert response.json()["note_id"] == note.id


def test_delete_depense_dossier_brouillon_204(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)

    response = client.delete(f"/api/v1/depenses/{depense.id}")

    assert response.status_code == 204
    assert db_session.get(Depense, depense.id) is None
    assert db_session.get(Note, note.id) is not None


# --- Autorisation ------------------------------------------------------------


@pytest.mark.parametrize(
    "method, path, payload",
    [
        ("POST", "/api/v1/depenses", _payload()),
        ("GET", "/api/v1/depenses", None),
        ("GET", "/api/v1/depenses/1", None),
        ("PATCH", "/api/v1/depenses/1", {"libelle": "X"}),
        ("DELETE", "/api/v1/depenses/1", None),
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
