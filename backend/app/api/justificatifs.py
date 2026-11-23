"""Routes du justificatif d'une dépense (envoi et téléchargement).

Le justificatif est stocké en base dans la table dédiée `justificatifs` (`bytea`),
jamais dans la table des dépenses ni dans une réponse de liste. L'envoi (`PUT`)
crée ou remplace le justificatif unique de la dépense ; le téléchargement (`GET`)
renvoie les octets avec le même contrôle d'accès que la note.

Ordre des contrôles de l'envoi : 401 (session) → 404 (dépense introuvable ou
invisible) → 409 (statut du dossier) → 413 (taille) → 422 (fichier vide ou type
non reconnu). Les contrôles d'accès sont faits avant de lire le corps du fichier :
un 404 ne lit jamais 10 Mo. Le corps est lu en flux borné (10 Mo + 1 octet au
maximum) et aucun fichier trop volumineux n'est chargé en mémoire ni écrit en base.
"""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from app.api.depenses import _ensure_depense_modifiable, _get_owned_depense
from app.auth.dependencies import get_current_user
from app.db import get_db
from app.models import Depense, Justificatif, Note, User
from app.models.justificatif import MAX_NOM_FICHIER, MAX_TAILLE_OCTETS, NOM_FICHIER_PAR_DEFAUT
from app.schemas.justificatif import JustificatifRead

router = APIRouter(prefix="/api/v1/depenses", tags=["justificatifs"])

DbSession = Annotated[OrmSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

_DEPASSEMENT_TAILLE = "Le justificatif ne peut pas dépasser 10 Mo."
_FICHIER_VIDE = "Le justificatif est vide."
_FORMAT_NON_PRIS_EN_CHARGE = "Format de justificatif non pris en charge (JPEG, PNG, HEIC ou PDF)."
_FICHIER_REQUIS = "Le fichier est requis."
_JUSTIFICATIF_INTROUVABLE = "Justificatif introuvable."

_ROLES_VALIDEUR = ("valideur", "admin")

_SIGNATURE_JPEG = b"\xff\xd8\xff"
_SIGNATURE_PNG = b"\x89PNG\r\n\x1a\n"
_SIGNATURE_PDF = b"%PDF-"
# Boîte ISO-BMFF : octets 4-7 = `ftyp`, marque majeure en octets 8-11.
_MARQUES_HEIC = (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1")


def _detecter_content_type(donnees: bytes) -> str | None:
    """Déduit le type MIME canonique de la signature des octets, sinon `None`.

    Seule la signature fait foi : l'extension et le `Content-Type` envoyés sont
    ignorés. JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), PDF (`%PDF-`),
    HEIC (boîte ISO-BMFF : octets 4-7 = `ftyp`, marque majeure en 8-11 parmi
    `heic`, `heix`, `hevc`, `hevx`, `mif1`, `msf1`).
    """
    if donnees.startswith(_SIGNATURE_JPEG):
        return "image/jpeg"
    if donnees.startswith(_SIGNATURE_PNG):
        return "image/png"
    if donnees.startswith(_SIGNATURE_PDF):
        return "application/pdf"
    if len(donnees) >= 12 and donnees[4:8] == b"ftyp" and donnees[8:12] in _MARQUES_HEIC:
        return "image/heic"
    return None


def _assainir_nom_fichier(nom: str) -> str:
    """Assainit le nom d'origine : base seule, contrôle retiré, 255 max, défaut si vide."""
    base = nom.replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(
        caractere for caractere in base if ord(caractere) >= 32 and ord(caractere) != 127
    )
    return base[:MAX_NOM_FICHIER] or NOM_FICHIER_PAR_DEFAUT


_TAILLE_BLOC = 1024 * 1024  # 1 Mo


async def _lire_fichier(fichier: UploadFile) -> bytes:
    """Lit le fichier par blocs, en flux borné (10 Mo + 1 octet au maximum).

    On ne fait jamais un `read()` sans borne : les octets sont lus par blocs de 1 Mo
    et accumulés, et on abandonne dès le premier octet au-delà de 10 Mo (413). La
    mémoire ne dépasse donc jamais 10 Mo + 1 octet, quel que soit le fichier reçu.
    """
    morceaux: list[bytes] = []
    total = 0
    while True:
        bloc = await fichier.read(_TAILLE_BLOC)
        if not bloc:
            break
        total += len(bloc)
        if total > MAX_TAILLE_OCTETS:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=_DEPASSEMENT_TAILLE
            )
        morceaux.append(bloc)
    return b"".join(morceaux)


def _header_content_disposition(nom_fichier: str) -> str:
    """Construit `inline; filename="<nom>"`, repli RFC 5987 pour un nom non latin-1.

    Les guillemets et antislashs sont échappés ; un nom non représentable en latin-1
    (le jeu que Starlette accepte dans un en-tête) est transmis via la forme étendue
    `filename*=UTF-8''…` avec un repli ASCII sûr.
    """
    nom_echappe = nom_fichier.replace("\\", "\\\\").replace('"', '\\"')
    try:
        nom_echappe.encode("latin-1")
    except UnicodeEncodeError:
        return "inline; filename=\"justificatif\"; filename*=UTF-8''" + quote(nom_fichier, safe="")
    return f'inline; filename="{nom_echappe}"'


@router.put("/{depense_id}/justificatif", response_model=JustificatifRead)
async def mettre_justificatif(
    depense_id: int,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> Justificatif:
    """Crée ou remplace le justificatif unique de la dépense (propriétaire seul)."""
    depense = _get_owned_depense(db, current_user.id, depense_id)
    _ensure_depense_modifiable(db, depense)

    # Les contrôles d'accès (404/409) sont faits avant de lire le corps. Le
    # parseur multipart spoule les fichiers sur disque (mémoire bornée) et ne
    # borne que les champs sans fichier (`max_part_size`) ; la taille du fichier
    # lui-même est bornée par `_lire_fichier` (10 Mo + 1 octet).
    form = await request.form(max_part_size=MAX_TAILLE_OCTETS + 1)
    fichier = form.get("fichier")
    if not isinstance(fichier, UploadFile):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_FICHIER_REQUIS
        )

    contenu = await _lire_fichier(fichier)
    if not contenu:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_FICHIER_VIDE)
    content_type = _detecter_content_type(contenu)
    if content_type is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_FORMAT_NON_PRIS_EN_CHARGE
        )

    justificatif = db.execute(
        select(Justificatif).where(Justificatif.depense_id == depense.id)
    ).scalar_one_or_none()
    if justificatif is None:
        justificatif = Justificatif(depense_id=depense.id)
        db.add(justificatif)

    justificatif.nom_fichier = _assainir_nom_fichier(fichier.filename or "")
    justificatif.content_type = content_type
    justificatif.taille_octets = len(contenu)
    justificatif.donnees = contenu

    db.commit()
    db.refresh(justificatif)
    return justificatif


@router.get("/{depense_id}/justificatif")
def obtenir_justificatif(
    depense_id: int,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    """Renvoie les octets du justificatif d'une dépense visible, octet pour octet."""
    depense = db.get(Depense, depense_id)
    if depense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_JUSTIFICATIF_INTROUVABLE)
    if depense.user_id != current_user.id:
        if current_user.role not in _ROLES_VALIDEUR or depense.note_id is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=_JUSTIFICATIF_INTROUVABLE
            )
        note = db.get(Note, depense.note_id)
        if note is None or note.statut == "brouillon":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=_JUSTIFICATIF_INTROUVABLE
            )

    justificatif = db.execute(
        select(Justificatif).where(Justificatif.depense_id == depense.id)
    ).scalar_one_or_none()
    if justificatif is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_JUSTIFICATIF_INTROUVABLE)

    return Response(
        content=justificatif.donnees,
        media_type=justificatif.content_type,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
            "Content-Disposition": _header_content_disposition(justificatif.nom_fichier),
        },
    )
