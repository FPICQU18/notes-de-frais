"""Tests de l'export CSV d'un dossier (`GET /api/v1/notes/{id}/export.csv`)."""

import csv
import io
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession

from app.db import get_db
from app.main import app
from app.models import Depense, Note, User
from app.security import hash_password

PASSWORD = "mot-de-passe-secret"
PASSWORD_HASH = hash_password(PASSWORD)

STATUTS = ("brouillon", "soumise", "validee", "refusee", "remboursee")


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
    libelle: str = "Repas client",
    date_depense: date = date(2024, 1, 15),
    montant_centimes: int = 1250,
    categorie: str = "repas",
) -> Depense:
    depense = Depense(
        user_id=user.id,
        libelle=libelle,
        date_depense=date_depense,
        montant_centimes=montant_centimes,
        categorie=categorie,
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


def _lignes_csv(response) -> list[list[str]]:
    """Décode le corps (BOM retiré) et le relit avec `csv.reader(delimiter=";")`."""
    texte = response.content.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(texte), delimiter=";"))


# --- Authentification ---------------------------------------------------------


def test_sans_session_401(client):
    response = client.get("/api/v1/notes/1/export.csv")
    assert response.status_code == 401


# --- Visibilité ---------------------------------------------------------------


@pytest.mark.parametrize("statut", STATUTS)
def test_proprietaire_200_quel_que_soit_le_statut(client, db_session, statut):
    user = _connect(client, db_session)
    note = _make_note(db_session, user, statut=statut)
    _make_depense(db_session, user, note_id=note.id)
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200


@pytest.mark.parametrize("role", ["valideur", "admin"])
@pytest.mark.parametrize("statut", ["soumise", "validee", "refusee", "remboursee"])
def test_valideur_200_sur_non_brouillon_autre(client, db_session, role, statut):
    proprietaire = _make_user(db_session, email="proprio@example.com")
    note = _make_note(db_session, proprietaire, statut=statut)
    _make_depense(db_session, proprietaire, note_id=note.id)
    _connect(client, db_session, email="valideur@example.com", role=role, display_name="Bob")
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200


@pytest.mark.parametrize("role", ["valideur", "admin"])
def test_valideur_404_sur_brouillon_autre(client, db_session, role):
    proprietaire = _make_user(db_session, email="proprio@example.com")
    note = _make_note(db_session, proprietaire, statut="brouillon")
    _connect(client, db_session, email="valideur@example.com", role=role, display_name="Bob")
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 404
    assert response.json()["detail"] == "Note introuvable."


def test_utilisateur_404_sur_dossier_autre(client, db_session):
    proprietaire = _make_user(db_session, email="proprio@example.com")
    note = _make_note(db_session, proprietaire, statut="soumise")
    _connect(client, db_session, email="autre@example.com", role="utilisateur")
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 404
    assert response.json()["detail"] == "Note introuvable."


def test_id_inconnu_404(client, db_session):
    _connect(client, db_session)
    response = client.get("/api/v1/notes/99999/export.csv")
    assert response.status_code == 404
    assert response.json()["detail"] == "Note introuvable."


# --- En-têtes HTTP ------------------------------------------------------------


def test_entetes_http(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/csv; charset=utf-8"
    assert response.headers["Content-Disposition"] == f'attachment; filename="note-{note.id}.csv"'
    assert response.headers["X-Content-Type-Options"] == "nosniff"


# --- Corps : BOM, en-tête, CRLF, pas de ligne vide finale ---------------------


def test_bom_puis_entete_puis_crlf(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    _make_depense(db_session, user, note_id=note.id, montant_centimes=2450)
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.content.startswith(b"\xef\xbb\xbf")
    texte = response.content.decode("utf-8")
    assert texte.startswith("\ufeff")
    lignes = texte.split("\r\n")
    # BOM + en-tête + une ligne de dépense, et rien d'autre (pas de ligne vide finale).
    assert lignes == [
        "\ufeffDate;Catégorie;Libellé;Montant",
        "2024-01-15;Repas;Repas client;24,50",
    ]
    assert "\n" not in texte.replace("\r\n", "")


def test_dossier_sans_depense_200_entete_seule(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200
    assert response.content == "\ufeffDate;Catégorie;Libellé;Montant\r\n".encode("utf-8")


# --- Lignes de dépense : ordre, formats ---------------------------------------


def test_ordre_date_puis_id_et_formats(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    # Même date pour forcer le départage par id croissant.
    _make_depense(
        db_session,
        user,
        note_id=note.id,
        libelle="Taxi gare",
        date_depense=date(2024, 3, 10),
        montant_centimes=123456,
        categorie="transport",
    )
    _make_depense(
        db_session,
        user,
        note_id=note.id,
        libelle="Essence",
        date_depense=date(2024, 1, 5),
        montant_centimes=6000,
        categorie="carburant",
    )
    _make_depense(
        db_session,
        user,
        note_id=note.id,
        libelle="Déjeuner",
        date_depense=date(2024, 3, 10),
        montant_centimes=1,
        categorie="repas",
    )
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200
    lignes = _lignes_csv(response)
    assert lignes == [
        ["Date", "Catégorie", "Libellé", "Montant"],
        ["2024-01-05", "Carburant", "Essence", "60,00"],
        ["2024-03-10", "Transport", "Taxi gare", "1234,56"],
        ["2024-03-10", "Repas", "Déjeuner", "0,01"],
    ]


def test_libelle_avec_point_virgule_guillemet_saut_de_ligne(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    libelle = 'Facture "TTC"; acompte\nligne 2'
    _make_depense(db_session, user, note_id=note.id, libelle=libelle, categorie="autre")
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200
    texte = response.content.decode("utf-8-sig")
    # Le champ est entouré de guillemets doubles et les guillemets doublés.
    assert '"Facture ""TTC""; acompte\r\nligne 2"' in texte
    # RelISIBLE par csv.reader : un seul champ libellé, valeur intacte.
    lignes = list(csv.reader(io.StringIO(texte), delimiter=";"))
    assert lignes[1] == ["2024-01-15", "Autre", libelle, "12,50"]


def test_toutes_les_categories_ont_leur_libelle_francais(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    categories = [
        ("transport", "Transport"),
        ("repas", "Repas"),
        ("hebergement", "Hébergement"),
        ("carburant", "Carburant"),
        ("peage_parking", "Péage/Parking"),
        ("fournitures", "Fournitures"),
        ("autre", "Autre"),
    ]
    for index, (categorie, _) in enumerate(categories):
        _make_depense(
            db_session,
            user,
            note_id=note.id,
            libelle=f"Dépense {index}",
            date_depense=date(2024, 2, index + 1),
            montant_centimes=100,
            categorie=categorie,
        )
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200
    lignes = _lignes_csv(response)
    assert [ligne[1] for ligne in lignes[1:]] == [libelle for _, libelle in categories]
