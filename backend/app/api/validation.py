"""Routes de la file de validation : vue transversale en lecture seule.

Réservées aux valideurs et admins (`require_role("valideur")`). La liste
regroupe les dossiers soumis et au-delà (`soumise`, `validee`, `refusee`,
`remboursee`) de tous les utilisateurs, jamais un `brouillon`. Le détail
renvoie un dossier non `brouillon` de n'importe quel propriétaire, ou le
`brouillon` de l'appelant lui-même (cohérent avec AGENTS.md). Les totaux sont
calculés par le serveur, en une requête agrégée pour la liste.
"""

from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from app.auth.dependencies import require_role
from app.db import get_db
from app.models import Depense, Note, User
from app.schemas.depense import DepenseRead
from app.schemas.validation import ProprietaireRead, ValidationNoteDetail, ValidationNoteRead

router = APIRouter(prefix="/api/v1/validation", tags=["validation"])

DbSession = Annotated[OrmSession, Depends(get_db)]
Valideur = Annotated[User, Depends(require_role("valideur"))]

_STATUTS_VALIDES = ("soumise", "validee", "refusee", "remboursee")
_NOTE_INTROUVABLE = "Note introuvable."
_STATUT_INVALIDE = (
    "Statut invalide : seuls les statuts soumise, validee, refusee et remboursee "
    "sont consultables ici."
)


def _refuser_statut(statut: str | None) -> None:
    """Lève 422 si `statut` n'est ni `None` ni l'un des statuts consultables."""
    if statut is not None and statut not in _STATUTS_VALIDES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=_STATUT_INVALIDE,
        )


@router.get("/notes", response_model=list[ValidationNoteRead])
def list_validation_notes(
    db: DbSession,
    current_user: Valideur,
    statut: str | None = None,
) -> list[ValidationNoteRead]:
    """Liste les dossiers à traiter, tous propriétaires confondus.

    Seuls les statuts `soumise`, `validee`, `refusee` et `remboursee` sont
    renvoyés (jamais un brouillon, ni le sien ni celui d'un autre). Le tri est
    celui de l'ordre d'arrivée : `soumise_at` croissant puis `id` croissant,
    les `soumise_at` nuls en dernier. Les totaux et compteurs sont obtenus en
    une seule requête agrégée.
    """
    _refuser_statut(statut)

    stmt = (
        select(
            Note,
            sa.func.coalesce(sa.func.sum(Depense.montant_centimes), 0).label("total_centimes"),
            sa.func.count(Depense.id).label("nb_depenses"),
            User.id.label("proprietaire_id"),
            User.display_name.label("proprietaire_display_name"),
        )
        .join(User, User.id == Note.user_id)
        .outerjoin(Depense, Depense.note_id == Note.id)
        .where(Note.statut.in_(_STATUTS_VALIDES))
    )
    if statut is not None:
        stmt = stmt.where(Note.statut == statut)
    stmt = stmt.group_by(Note.id, User.id).order_by(
        Note.soumise_at.asc().nulls_last(), Note.id.asc()
    )

    rows = db.execute(stmt).all()
    return [
        ValidationNoteRead(
            id=note.id,
            libelle=note.libelle,
            statut=note.statut,
            total_centimes=total_centimes,
            nb_depenses=nb_depenses,
            soumise_at=note.soumise_at,
            proprietaire=ProprietaireRead(
                id=proprietaire_id, display_name=proprietaire_display_name
            ),
        )
        for note, total_centimes, nb_depenses, proprietaire_id, proprietaire_display_name in rows
    ]


@router.get("/notes/{note_id}", response_model=ValidationNoteDetail)
def get_validation_note(
    note_id: int,
    db: DbSession,
    current_user: Valideur,
) -> ValidationNoteDetail:
    """Renvoie un dossier à traiter avec ses dépenses triées.

    Tout dossier non `brouillon` est visible de n'importe quel valideur/admin ;
    un `brouillon` n'est visible que de son propriétaire (sinon 404, identique
    à un identifiant inexistant). Les dépenses sont triées par `date_depense`
    croissante puis `id` croissant.
    """
    note = db.get(Note, note_id)
    if note is None or (note.statut == "brouillon" and note.user_id != current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOTE_INTROUVABLE)

    depenses = list(
        db.execute(
            select(Depense)
            .where(Depense.note_id == note.id)
            .order_by(Depense.date_depense.asc(), Depense.id.asc())
        ).scalars()
    )
    proprietaire = db.get(User, note.user_id)
    return ValidationNoteDetail(
        id=note.id,
        libelle=note.libelle,
        statut=note.statut,
        total_centimes=sum(depense.montant_centimes for depense in depenses),
        nb_depenses=len(depenses),
        soumise_at=note.soumise_at,
        proprietaire=ProprietaireRead(id=proprietaire.id, display_name=proprietaire.display_name),
        depenses=[DepenseRead.model_validate(depense) for depense in depenses],
    )
