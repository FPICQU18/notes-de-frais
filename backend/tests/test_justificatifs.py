"""Tests des routes du justificatif d'une dépense (envoi et téléchargement)."""

from datetime import date, datetime

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from app.api.justificatifs import _assainir_nom_fichier
from app.db import get_db
from app.main import app
from app.models import Depense, Justificatif, Note, User
from app.security import hash_password

PASSWORD = "mot-de-passe-secret"
PASSWORD_HASH = hash_password(PASSWORD)
DATE_PASSEE = date(2024, 1, 15)

MAX_TAILLE = 10 * 1024 * 1024  # 10 Mo

# Corps excédant la limite de 10 Mo d'exactement 2 octets : sert à prouver que les
# contrôles d'accès (404/409) passent avant la lecture du corps, sans jamais le lire.
CORPS_TROP_GROS = b"XX" + b"0" * MAX_TAILLE  # 10 Mo + 2 octets

# Signatures de fichiers valides (le contenu au-delà de la signature est quelconque).
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPEG = b"\xff\xd8\xff" + b"\x00" * 16
PDF = b"%PDF-1.4\n" + b"\x00" * 16
HEIC = b"\x00\x00\x00\x18" + b"ftyp" + b"heic" + b"\x00" * 8
HEIX = b"\x00\x00\x00\x18" + b"ftyp" + b"heix" + b"\x00" * 8
MIF1 = b"\x00\x00\x00\x18" + b"ftyp" + b"mif1" + b"\x00" * 8

FIELDS_JUSTIFICATIF = {"nom_fichier", "content_type", "taille_octets", "created_at", "updated_at"}


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


def _count_justificatifs(db_session: OrmSession) -> int:
    return db_session.execute(sa.select(sa.func.count()).select_from(Justificatif)).scalar_one()


def _justificatif_de(db_session: OrmSession, depense_id: int) -> Justificatif | None:
    return db_session.execute(
        select(Justificatif).where(Justificatif.depense_id == depense_id)
    ).scalar_one_or_none()


def _upload(
    client: TestClient,
    depense_id: int,
    contenu: bytes,
    *,
    filename: str = "ticket.png",
    content_type: str = "image/png",
):
    return client.put(
        f"/api/v1/depenses/{depense_id}/justificatif",
        files={"fichier": (filename, contenu, content_type)},
    )


@pytest.fixture()
def client(db_session: OrmSession):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --- Assainissement du nom de fichier ----------------------------------------


@pytest.mark.parametrize(
    "nom, attendu",
    [
        ("", "justificatif"),
        ("/", "justificatif"),
        ("photo.png", "photo.png"),
        ("dossier/photo.png", "photo.png"),
        ("dossier\\photo.png", "photo.png"),
        ("a\x00b\x1f.png", "ab.png"),
        ("\x7f", "justificatif"),
        ("a" * 300, "a" * 255),
    ],
)
def test_assainir_nom_fichier(nom, attendu):
    assert _assainir_nom_fichier(nom) == attendu


# --- Autorisation (401) -------------------------------------------------------


def test_put_sans_session_401_sans_ecriture(client, db_session):
    _make_user(db_session)
    client.cookies.clear()

    response = _upload(client, 1, PNG)

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}
    assert _count_justificatifs(db_session) == 0


def test_get_sans_session_401(client, db_session):
    _make_user(db_session)
    client.cookies.clear()

    response = client.get("/api/v1/depenses/1/justificatif")

    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


# --- Envoi : 404 (dépense introuvable ou invisible) ---------------------------


def test_put_depense_inexistante_404_sans_creation(client, db_session):
    _connect(client, db_session)

    response = _upload(client, 999999, PNG)

    assert response.status_code == 404
    assert response.json() == {"detail": "Dépense introuvable."}
    assert _count_justificatifs(db_session) == 0


@pytest.mark.parametrize("role", ["utilisateur", "valideur", "admin"])
def test_put_depense_autre_utilisateur_404(client, db_session, role):
    proprietaire = _connect(client, db_session)
    depense = _make_depense(db_session, proprietaire)
    _connect(client, db_session, email=f"{role}@example.com", role=role)

    response = _upload(client, depense.id, PNG)

    assert response.status_code == 404
    assert response.json() == {"detail": "Dépense introuvable."}
    assert _count_justificatifs(db_session) == 0


# Un 404 doit être rendu sans jamais lire le corps : même un fichier de 10 Mo + 2
# octets renvoie 404 (et non 413) quand la dépense est introuvable ou invisible.


def test_put_corps_volumineux_depense_inexistante_404(client, db_session):
    _connect(client, db_session)

    response = _upload(client, 999999, CORPS_TROP_GROS)

    assert response.status_code == 404
    assert response.json() == {"detail": "Dépense introuvable."}
    assert _count_justificatifs(db_session) == 0


def test_put_corps_volumineux_depense_autre_utilisateur_404(client, db_session):
    proprietaire = _connect(client, db_session)
    depense = _make_depense(db_session, proprietaire)
    _connect(client, db_session, email="autre@example.com", role="utilisateur")

    response = _upload(client, depense.id, CORPS_TROP_GROS)

    assert response.status_code == 404
    assert response.json() == {"detail": "Dépense introuvable."}
    assert _count_justificatifs(db_session) == 0


# --- Envoi : 409 (statut du dossier) ------------------------------------------


def test_put_dossier_non_brouillon_409_justificatif_intact(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)

    assert _upload(client, depense.id, PNG).status_code == 200
    avant = _justificatif_de(db_session, depense.id)
    assert avant is not None
    note.statut = "soumise"
    db_session.commit()

    response = _upload(client, depense.id, PDF, filename="recu.pdf", content_type="application/pdf")

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "La dépense appartient à un dossier qui n'est pas au statut brouillon."
    )
    apres = _justificatif_de(db_session, depense.id)
    assert apres is not None
    assert apres.donnees == avant.donnees == PNG
    assert apres.content_type == "image/png"
    assert _count_justificatifs(db_session) == 1


def test_put_corps_volumineux_dossier_soumise_409_justificatif_intact(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)
    assert _upload(client, depense.id, PNG).status_code == 200
    avant = _justificatif_de(db_session, depense.id)
    assert avant is not None
    note.statut = "soumise"
    db_session.commit()

    # Le 409 prime sur le 413 : le statut du dossier est contrôlé avant la lecture
    # du corps, donc même un fichier de 10 Mo + 2 octets renvoie 409.
    response = _upload(client, depense.id, CORPS_TROP_GROS)

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "La dépense appartient à un dossier qui n'est pas au statut brouillon."
    )
    apres = _justificatif_de(db_session, depense.id)
    assert apres is not None
    assert apres.donnees == avant.donnees == PNG
    assert apres.content_type == "image/png"
    assert _count_justificatifs(db_session) == 1


# --- Envoi : 413 (taille) -----------------------------------------------------


def test_put_fichier_trop_gros_413_sans_creation(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)
    # Signature inconnue ET taille excessive : 413 prime sur le 422 de type.
    response = _upload(client, depense.id, CORPS_TROP_GROS)

    assert response.status_code == 413
    assert response.json() == {"detail": "Le justificatif ne peut pas dépasser 10 Mo."}
    assert _count_justificatifs(db_session) == 0


def test_put_fichier_exactement_10_mo_200(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)
    a_la_limite = b"\xff\xd8\xff" + b"0" * (MAX_TAILLE - 3)  # exactement 10 Mo

    response = _upload(client, depense.id, a_la_limite)

    assert response.status_code == 200
    assert response.json()["taille_octets"] == MAX_TAILLE


# --- Envoi : 422 (fichier vide ou type non reconnu) ---------------------------


def test_put_fichier_vide_422_sans_creation(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = _upload(client, depense.id, b"", filename="vide.png")

    assert response.status_code == 422
    assert response.json() == {"detail": "Le justificatif est vide."}
    assert _count_justificatifs(db_session) == 0


def test_put_format_non_reconnu_422_sans_creation(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = _upload(client, depense.id, b"ceci n'est pas une image", filename="fichier.bin")

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Format de justificatif non pris en charge (JPEG, PNG, HEIC ou PDF)."
    }
    assert _count_justificatifs(db_session) == 0


# --- Envoi : la signature fait foi, extension et Content-Type ignorés ---------


def test_put_texte_renomme_jpg_422(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = _upload(
        client, depense.id, b"bonjour", filename="photo.jpg", content_type="image/jpeg"
    )

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Format de justificatif non pris en charge (JPEG, PNG, HEIC ou PDF)."
    }
    assert _count_justificatifs(db_session) == 0


def test_put_html_deguise_422_sans_creation(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)
    html = b"<html><script>alert('xss')</script></html>"

    response = _upload(client, depense.id, html, filename="page.html", content_type="text/html")

    assert response.status_code == 422
    assert response.json() == {
        "detail": "Format de justificatif non pris en charge (JPEG, PNG, HEIC ou PDF)."
    }
    assert _count_justificatifs(db_session) == 0


def test_put_png_content_type_text_plain_accepte(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = _upload(client, depense.id, PNG, filename="photo.xyz", content_type="text/plain")

    assert response.status_code == 200
    assert response.json()["content_type"] == "image/png"


@pytest.mark.parametrize(
    "contenu, content_type",
    [
        (JPEG, "image/jpeg"),
        (PNG, "image/png"),
        (HEIC, "image/heic"),
        (HEIX, "image/heic"),
        (MIF1, "image/heic"),
        (PDF, "application/pdf"),
    ],
)
def test_put_type_deduit_de_la_signature(client, db_session, contenu, content_type):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = _upload(
        client, depense.id, contenu, filename="fichier.dat", content_type="text/plain"
    )

    assert response.status_code == 200
    assert response.json()["content_type"] == content_type


# --- Envoi : succès, métadonnées, remplacement --------------------------------


def test_put_200_metadonnees_et_une_seule_ligne(client, db_session):
    user = _connect(client, db_session)
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)

    response = _upload(client, depense.id, PNG)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == FIELDS_JUSTIFICATIF
    assert body["nom_fichier"] == "ticket.png"
    assert body["content_type"] == "image/png"
    assert body["taille_octets"] == len(PNG)
    assert body["created_at"]
    assert body["updated_at"]
    assert _count_justificatifs(db_session) == 1


def test_put_depense_a_classer_200(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)  # note_id NULL

    response = _upload(client, depense.id, PNG)

    assert response.status_code == 200
    assert _count_justificatifs(db_session) == 1


def test_put_remplace_200_une_seule_ligne(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    first = _upload(client, depense.id, PNG)
    assert first.status_code == 200
    first_updated = datetime.fromisoformat(first.json()["updated_at"])

    second = _upload(client, depense.id, PDF, filename="recu.pdf", content_type="application/pdf")

    assert second.status_code == 200
    body = second.json()
    assert body["content_type"] == "application/pdf"
    assert body["taille_octets"] == len(PDF)
    assert body["nom_fichier"] == "recu.pdf"
    assert datetime.fromisoformat(body["updated_at"]) > first_updated

    assert _count_justificatifs(db_session) == 1
    stored = _justificatif_de(db_session, depense.id)
    assert stored is not None
    assert stored.donnees == PDF


# --- Envoi : nom de fichier assaini ------------------------------------------


@pytest.mark.parametrize(
    "filename, attendu",
    [
        ("../../etc/passwd", "passwd"),
        ("/", "justificatif"),
    ],
)
def test_put_nom_fichier_assaini(client, db_session, filename, attendu):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = _upload(client, depense.id, PNG, filename=filename)

    assert response.status_code == 200
    assert response.json()["nom_fichier"] == attendu


def test_put_nom_fichier_tronque_255(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)
    nom_long = "a" * 300 + ".png"

    response = _upload(client, depense.id, PNG, filename=nom_long)

    assert response.status_code == 200
    assert response.json()["nom_fichier"] == nom_long[:255]
    assert len(response.json()["nom_fichier"]) == 255


# --- Téléchargement (GET) -----------------------------------------------------


@pytest.mark.parametrize(
    "statut", ["brouillon", "soumise", "validee", "refusee", "remboursee", None]
)
def test_get_proprietaire_200_octets_identiques(client, db_session, statut):
    user = _connect(client, db_session)
    note = _make_note(db_session, user) if statut is not None else None
    depense = _make_depense(db_session, user, note_id=note.id if note else None)

    assert _upload(client, depense.id, PNG).status_code == 200

    if note is not None:
        note.statut = statut
        db_session.commit()

    response = client.get(f"/api/v1/depenses/{depense.id}/justificatif")

    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_get_entetes_200(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)
    assert _upload(client, depense.id, PNG, filename="ticket.png").status_code == 200

    response = client.get(f"/api/v1/depenses/{depense.id}/justificatif")

    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["content-disposition"] == 'inline; filename="ticket.png"'
    assert response.headers["content-length"] == str(len(PNG))


@pytest.mark.parametrize("role", ["valideur", "admin"])
@pytest.mark.parametrize("statut", ["soumise", "validee", "refusee", "remboursee"])
def test_get_valideur_ou_admin_non_proprietaire_non_brouillon_200(client, db_session, role, statut):
    proprietaire = _connect(client, db_session)
    note = _make_note(db_session, proprietaire)
    depense = _make_depense(db_session, proprietaire, note_id=note.id)
    assert _upload(client, depense.id, PNG).status_code == 200
    note.statut = statut
    db_session.commit()

    _connect(client, db_session, email=f"{role}@example.com", role=role)
    response = client.get(f"/api/v1/depenses/{depense.id}/justificatif")

    assert response.status_code == 200
    assert response.content == PNG


def test_get_valideur_non_proprietaire_brouillon_404(client, db_session):
    proprietaire = _connect(client, db_session)
    note = _make_note(db_session, proprietaire)
    depense = _make_depense(db_session, proprietaire, note_id=note.id)
    assert _upload(client, depense.id, PNG).status_code == 200

    _connect(client, db_session, email="valideur@example.com", role="valideur")
    response = client.get(f"/api/v1/depenses/{depense.id}/justificatif")

    assert response.status_code == 404
    assert response.json() == {"detail": "Justificatif introuvable."}


def test_get_valideur_non_proprietaire_a_classer_404(client, db_session):
    proprietaire = _connect(client, db_session)
    depense = _make_depense(db_session, proprietaire)  # note_id NULL
    assert _upload(client, depense.id, PNG).status_code == 200

    _connect(client, db_session, email="valideur@example.com", role="valideur")
    response = client.get(f"/api/v1/depenses/{depense.id}/justificatif")

    assert response.status_code == 404
    assert response.json() == {"detail": "Justificatif introuvable."}


def test_get_utilisateur_autre_404(client, db_session):
    proprietaire = _connect(client, db_session)
    note = _make_note(db_session, proprietaire)
    depense = _make_depense(db_session, proprietaire, note_id=note.id)
    assert _upload(client, depense.id, PNG).status_code == 200
    note.statut = "soumise"
    db_session.commit()

    _connect(client, db_session, email="autre@example.com")
    response = client.get(f"/api/v1/depenses/{depense.id}/justificatif")

    assert response.status_code == 404
    assert response.json() == {"detail": "Justificatif introuvable."}


def test_get_sans_justificatif_404(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)

    response = client.get(f"/api/v1/depenses/{depense.id}/justificatif")

    assert response.status_code == 404
    assert response.json() == {"detail": "Justificatif introuvable."}


def test_get_depense_inexistante_404(client, db_session):
    _connect(client, db_session)

    response = client.get("/api/v1/depenses/999999/justificatif")

    assert response.status_code == 404
    assert response.json() == {"detail": "Justificatif introuvable."}


# --- Cascade à la suppression de la dépense -----------------------------------


def test_delete_depense_cascade_justificatif(client, db_session):
    user = _connect(client, db_session)
    depense = _make_depense(db_session, user)
    assert _upload(client, depense.id, PNG).status_code == 200
    assert _count_justificatifs(db_session) == 1

    response = client.delete(f"/api/v1/depenses/{depense.id}")

    assert response.status_code == 204
    assert db_session.get(Depense, depense.id) is None
    assert _count_justificatifs(db_session) == 0


# --- Absence de fuite des octets dans les listes et détails -------------------


def _aucune_cle(donnees, cles: set[str]) -> bool:
    if isinstance(donnees, dict):
        for cle, valeur in donnees.items():
            if cle in cles or not _aucune_cle(valeur, cles):
                return False
    elif isinstance(donnees, list):
        for element in donnees:
            if not _aucune_cle(element, cles):
                return False
    return True


def _sans_updated_at(donnees):
    """Retire récursivement les champs `updated_at` (volatils) d'un JSON.

    Sert à comparer les réponses de liste/détail avant et après un remplacement
    du justificatif : seul `updated_at` de la note varie (le dossier est repassé
    en brouillon puis re-soumis pour permettre l'envoi), sans aucun lien avec la
    taille du fichier. `created_at` reste stable, on le conserve.
    """
    if isinstance(donnees, dict):
        return {
            cle: _sans_updated_at(valeur) for cle, valeur in donnees.items() if cle != "updated_at"
        }
    if isinstance(donnees, list):
        return [_sans_updated_at(element) for element in donnees]
    return donnees


def test_pas_de_fuite_octets_dans_listes_et_details(client, db_session):
    user = _connect(client, db_session)  # propriétaire : jean@example.com
    _make_user(db_session, email="valideur@example.com", role="valideur")
    note = _make_note(db_session, user)
    depense = _make_depense(db_session, user, note_id=note.id)
    assert _upload(client, depense.id, PNG).status_code == 200

    routes_owner = (
        "/api/v1/depenses",
        f"/api/v1/depenses/{depense.id}",
        f"/api/v1/notes/{note.id}",
    )
    route_validation = f"/api/v1/validation/notes/{note.id}"

    def lire_toutes_les_routes() -> dict[str, tuple[dict, bytes]]:
        """Lit les 4 routes (3 propriétaire + 1 valideur), renvoie (json, contenu)."""
        resultats = {}
        for url in routes_owner:
            response = client.get(url)
            assert response.status_code == 200
            resultats[url] = (response.json(), response.content)
        _login(client, "valideur@example.com")
        response = client.get(route_validation)
        assert response.status_code == 200
        resultats[route_validation] = (response.json(), response.content)
        _login(client, "jean@example.com")  # repasser propriétaire
        return resultats

    # Lecture de référence : dossier soumis, justificatif de petite taille.
    note.statut = "soumise"
    db_session.commit()
    petit = lire_toutes_les_routes()

    # Remplacement par un justificatif proche de 10 Mo : l'envoi exige un dossier
    # au statut brouillon, donc on repasse brouillon le temps de l'envoi puis on
    # re-soumet pour relire la file de validation dans les mêmes conditions.
    note.statut = "brouillon"
    db_session.commit()
    gros = b"\x89PNG\r\n\x1a\n" + b"0" * (MAX_TAILLE - len(b"\x89PNG\r\n\x1a\n"))
    assert len(gros) == MAX_TAILLE
    assert _upload(client, depense.id, gros).status_code == 200
    note.statut = "soumise"
    db_session.commit()
    grand = lire_toutes_les_routes()

    for url in (*routes_owner, route_validation):
        json_petit, contenu_petit = petit[url]
        json_grand, contenu_grand = grand[url]
        # Même JSON, aux seuls champs `updated_at` près (volatils par nature) : la
        # taille du justificatif ne change rien aux listes et aux détails.
        assert _sans_updated_at(json_grand) == _sans_updated_at(json_petit)
        # La taille de la réponse ne dépend pas de celle du fichier.
        assert len(contenu_grand) == len(contenu_petit)
        # Aucune clé `donnees`/`justificatif`, aucun octet ne transite.
        assert _aucune_cle(json_grand, {"donnees", "justificatif"})
        assert PNG not in contenu_grand
        assert gros not in contenu_grand
