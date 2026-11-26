"""Tests de l'export CSV d'un dossier (`GET /api/v1/notes/{id}/export.csv`)."""

import csv
import io
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession

from app.db import get_db
from app.export_csv import depenses_to_csv, neutraliser_formule
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
    # BOM + en-tête + une ligne de dépense, terminée par un unique CRLF final
    # (pas de ligne vide superflue : pas de double CRLF en fin de corps).
    assert lignes == [
        "\ufeffDate;Catégorie;Libellé;Montant",
        "2024-01-15;Repas;Repas client;24,50",
        "",
    ]
    assert texte.endswith("\r\n") and not texte.endswith("\r\n\r\n")
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
    # Le saut de ligne interne reste un LF brut à l'intérieur du champ cité.
    assert '"Facture ""TTC""; acompte\nligne 2"' in texte
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


# --- Neutralisation des formules (US-031) --------------------------------------

# Caractères qui déclenchent une interprétation comme formule dans Excel/LibreOffice.
PREFIXES_FORMULE = ["=", "+", "-", "@", "\t", "\r", "\n"]


def _depense_sans_db(libelle: str, categorie: str = "repas") -> Depense:
    """Objet Depense non persisté, suffisant pour `depenses_to_csv`."""
    return Depense(
        user_id=1,
        libelle=libelle,
        date_depense=date(2024, 1, 15),
        montant_centimes=1250,
        categorie=categorie,
        note_id=None,
    )


@pytest.mark.parametrize("prefixe", PREFIXES_FORMULE)
def test_neutraliser_formule_prefixe_apostrophe(prefixe):
    assert neutraliser_formule(f"{prefixe}1+1") == f"'{prefixe}1+1"


@pytest.mark.parametrize(
    "texte",
    [
        "Repas client",
        "x = y au milieu",
        "x + y au milieu",
        "a\tb",  # tabulation au milieu : pas de préfixe
        "ligne 1\nligne 2",  # saut de ligne au milieu : pas de préfixe
        "",
        "'déjà préfixé",
    ],
)
def test_neutraliser_formule_inchange_si_pas_en_tete(texte):
    assert neutraliser_formule(texte) == texte


@pytest.mark.parametrize("prefixe", PREFIXES_FORMULE)
def test_export_libelle_avec_prefixe_formule(client, db_session, prefixe):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    libelle = f"{prefixe}+100"
    _make_depense(db_session, user, note_id=note.id, libelle=libelle)
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200
    lignes = _lignes_csv(response)
    assert lignes[1][2] == f"'{libelle}"


@pytest.mark.parametrize("prefixe", PREFIXES_FORMULE)
def test_export_categorie_inconnue_avec_prefixe_formule(prefixe):
    """Catégorie inconnue : le repli sur la valeur brute est neutralisé lui aussi.

    Une catégorie invalide ne peut pas être insérée en base (contrainte CHECK),
    donc on teste la sérialisation pure via `depenses_to_csv`.
    """
    categorie = f"{prefixe}cat"
    depense = _depense_sans_db("Dépense test", categorie=categorie)
    texte = depenses_to_csv([depense])
    # Le champ peut être ré-écrit entre guillemets par le writer csv : on relit
    # proprement avec csv.reader pour comparer la valeur du champ.
    lignes = list(csv.reader(io.StringIO(texte.lstrip("\ufeff")), delimiter=";"))
    attendu = f"'{categorie}"
    assert lignes[1][1] == attendu
    # Et dans le texte brut, le préfixe apostrophe est présent tel quel.
    assert attendu in texte


def test_export_libelle_normal_inchange(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    _make_depense(db_session, user, note_id=note.id, libelle="Repas client")
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200
    lignes = _lignes_csv(response)
    assert lignes[1][2] == "Repas client"


def test_export_categorie_avec_tabulation_au_milieu():
    """Tabulation au milieu : échappement CSV standard, PAS de préfixe apostrophe."""
    categorie = "au\ttres"
    depense = _depense_sans_db("Dépense test", categorie=categorie)
    texte = depenses_to_csv([depense])
    assert '"au\ttres"' in texte  # champ cité, tabulation conservée
    assert "'au" not in texte  # pas de préfixe apostrophe
    # Relisible par csv.reader : la valeur du champ est intacte.
    lignes = list(csv.reader(io.StringIO(texte.lstrip("\ufeff")), delimiter=";"))
    assert lignes[1][1] == categorie


def test_export_libelle_avec_saut_de_ligne_au_milieu(client, db_session):
    """Saut de ligne au milieu : champ cité, caractère conservé, pas de préfixe."""
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    libelle = "ligne 1\nligne 2"
    _make_depense(db_session, user, note_id=note.id, libelle=libelle)
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200
    texte = response.content.decode("utf-8-sig")
    assert '"ligne 1\nligne 2"' in texte
    assert "'ligne" not in texte
    lignes = _lignes_csv(response)
    assert lignes[1][2] == libelle


def test_export_plusieurs_depenses_toutes_neutralisees(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    libelles = ["=SUM(A1:A2)", "+100", "-50", "@cmd", "\tTab", "\rCR", "\nLF", "Normal"]
    for index, libelle in enumerate(libelles):
        _make_depense(
            db_session,
            user,
            note_id=note.id,
            libelle=libelle,
            date_depense=date(2024, 1, index + 1),
        )
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200
    lignes = _lignes_csv(response)
    assert len(lignes) == 1 + len(libelles)
    for ligne, libelle in zip(lignes[1:], libelles, strict=True):
        attendu = f"'{libelle}" if libelle.startswith(tuple(PREFIXES_FORMULE)) else libelle
        assert ligne[2] == attendu


def test_export_structure_inchangee_avec_neutralisation(client, db_session):
    """BOM, en-tête, CRLF et en-têtes HTTP restent identiques malgré la neutralisation."""
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    _make_depense(db_session, user, note_id=note.id, libelle="=1+1", montant_centimes=2450)
    response = client.get(f"/api/v1/notes/{note.id}/export.csv")
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/csv; charset=utf-8"
    assert response.headers["Content-Disposition"] == f'attachment; filename="note-{note.id}.csv"'
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.content.startswith(b"\xef\xbb\xbf")
    texte = response.content.decode("utf-8")
    assert texte.split("\r\n")[0] == "\ufeffDate;Catégorie;Libellé;Montant"
    assert texte.split("\r\n")[1] == "2024-01-15;Repas;'=1+1;24,50"
    assert texte.endswith("\r\n") and not texte.endswith("\r\n\r\n")
