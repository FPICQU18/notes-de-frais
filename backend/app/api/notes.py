"""Routes de gestion des notes de frais (dossiers).

Un dossier regroupe les dépenses de son propriétaire, porte le statut et n'est
modifiable (libellé, contenu, suppression) qu'au statut `brouillon`. Les routes
sont strictement cloisonnées par propriétaire : un dossier appartenant à un
autre compte renvoie 404, identique à un identifiant inexistant (aucune fuite
d'existence). Les totaux (`total_centimes`, `nb_depenses`) sont calculés par le
serveur en une requête agrégée, jamais par le client.
"""

from datetime import UTC, date, datetime
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from app.auth.dependencies import get_current_user
from app.db import get_db
from app.models import Depense, Note, User
from app.schemas.depense import DepenseRead
from app.schemas.note import NoteCreate, NoteDetail, NoteRead, NoteUpdate

router = APIRouter(prefix="/api/v1/notes", tags=["notes"])

DbSession = Annotated[OrmSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

_NOTE_INTROUVABLE = "Note introuvable."
_DEPENSE_INTROUVABLE = "Dépense introuvable."
_NON_BROUILLON = "Le dossier n'est modifiable qu'au statut brouillon."
_DEPENSE_DEJA_RATTACHEE = "La dépense est déjà rattachée à un dossier."
_DEPENSE_NON_RATTACHEE = "La dépense n'est pas dans ce dossier."


def _get_owned_note(db: OrmSession, user_id: int, note_id: int) -> Note:
    """Renvoie le dossier `note_id` s'il appartient à `user_id`, sinon 404."""
    note = db.execute(
        select(Note).where(Note.id == note_id, Note.user_id == user_id)
    ).scalar_one_or_none()
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOTE_INTROUVABLE)
    return note


def _get_owned_depense(db: OrmSession, user_id: int, depense_id: int) -> Depense:
    """Renvoie la dépense `depense_id` si elle appartient à `user_id`, sinon 404."""
    depense = db.execute(
        select(Depense).where(Depense.id == depense_id, Depense.user_id == user_id)
    ).scalar_one_or_none()
    if depense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DEPENSE_INTROUVABLE)
    return depense


def _ensure_brouillon(note: Note) -> None:
    """Lève 409 si le dossier n'est plus au statut `brouillon`."""
    if note.statut != "brouillon":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NON_BROUILLON)


def _note_read(
    note: Note, total_centimes: int, nb_depenses: int, derniere_depense_le: date | None
) -> NoteRead:
    """Construit un `NoteRead` à partir du dossier et de ses agrégats calculés."""
    return NoteRead(
        id=note.id,
        libelle=note.libelle,
        statut=note.statut,
        total_centimes=total_centimes,
        nb_depenses=nb_depenses,
        derniere_depense_le=derniere_depense_le,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.post("", response_model=NoteRead, status_code=status.HTTP_201_CREATED)
def create_note(payload: NoteCreate, db: DbSession, current_user: CurrentUser) -> NoteRead:
    """Crée un dossier `brouillon` et y rattache d'emblée les dépenses fournies.

    La validation des `depense_ids` est atomique : toute dépense absente, d'un
    autre utilisateur ou déjà rattachée annule la création entière (404/409)
    sans laisser de dossier ni de rattachement partiel.
    """
    depenses: list[Depense] = []
    for depense_id in payload.depense_ids or []:
        depense = _get_owned_depense(db, current_user.id, depense_id)
        if depense.note_id is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=_DEPENSE_DEJA_RATTACHEE
            )
        depenses.append(depense)

    note = Note(user_id=current_user.id, libelle=payload.libelle, statut="brouillon")
    db.add(note)
    db.flush()
    for depense in depenses:
        depense.note_id = note.id
    db.commit()

    total_centimes = sum(depense.montant_centimes for depense in depenses)
    derniere_depense_le = max((depense.date_depense for depense in depenses), default=None)
    return _note_read(note, total_centimes, len(depenses), derniere_depense_le)


@router.get("", response_model=list[NoteRead])
def list_notes(db: DbSession, current_user: CurrentUser) -> list[NoteRead]:
    """Liste les dossiers de l'utilisateur, les plus récents d'abord.

    Les totaux sont calculés en une seule requête agrégée (sans requête par
    dossier) via un `outerjoin` sur les dépenses.
    """
    stmt = (
        select(
            Note,
            sa.func.coalesce(sa.func.sum(Depense.montant_centimes), 0).label("total_centimes"),
            sa.func.count(Depense.id).label("nb_depenses"),
            sa.func.max(Depense.date_depense).label("derniere_depense_le"),
        )
        .outerjoin(Depense, Depense.note_id == Note.id)
        .where(Note.user_id == current_user.id)
        .group_by(Note.id)
        .order_by(Note.created_at.desc(), Note.id.desc())
    )
    return [
        _note_read(note, total_centimes, nb_depenses, derniere_depense_le)
        for note, total_centimes, nb_depenses, derniere_depense_le in db.execute(stmt).all()
    ]


@router.get("/{note_id}", response_model=NoteDetail)
def get_note(note_id: int, db: DbSession, current_user: CurrentUser) -> NoteDetail:
    """Renvoie un dossier avec ses dépenses (triées) et son total."""
    note = _get_owned_note(db, current_user.id, note_id)
    depenses = list(
        db.execute(
            select(Depense)
            .where(Depense.note_id == note.id)
            .order_by(Depense.date_depense.asc(), Depense.id.asc())
        ).scalars()
    )
    total_centimes = sum(depense.montant_centimes for depense in depenses)
    derniere_depense_le = max((depense.date_depense for depense in depenses), default=None)
    return NoteDetail(
        id=note.id,
        libelle=note.libelle,
        statut=note.statut,
        total_centimes=total_centimes,
        nb_depenses=len(depenses),
        derniere_depense_le=derniere_depense_le,
        created_at=note.created_at,
        updated_at=note.updated_at,
        depenses=[DepenseRead.model_validate(depense) for depense in depenses],
    )


@router.patch("/{note_id}", response_model=NoteRead)
def update_note(
    note_id: int, payload: NoteUpdate, db: DbSession, current_user: CurrentUser
) -> NoteRead:
    """Renomme un dossier `brouillon` (seul le libellé est modifiable)."""
    note = _get_owned_note(db, current_user.id, note_id)
    _ensure_brouillon(note)
    note.libelle = payload.libelle
    db.commit()
    db.refresh(note)
    total_centimes, nb_depenses, derniere_depense_le = db.execute(
        select(
            sa.func.coalesce(sa.func.sum(Depense.montant_centimes), 0),
            sa.func.count(Depense.id),
            sa.func.max(Depense.date_depense),
        ).where(Depense.note_id == note.id)
    ).one()
    return _note_read(note, total_centimes, nb_depenses, derniere_depense_le)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(note_id: int, db: DbSession, current_user: CurrentUser) -> None:
    """Supprime un dossier `brouillon` ; ses dépenses sont détachées, jamais supprimées."""
    note = _get_owned_note(db, current_user.id, note_id)
    _ensure_brouillon(note)
    db.delete(note)
    db.commit()
    return None


@router.post("/{note_id}/depenses/{depense_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_depense(note_id: int, depense_id: int, db: DbSession, current_user: CurrentUser) -> None:
    """Rattache une dépense de l'appelant à son dossier `brouillon`."""
    note = _get_owned_note(db, current_user.id, note_id)
    depense = _get_owned_depense(db, current_user.id, depense_id)
    _ensure_brouillon(note)
    if depense.note_id is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_DEPENSE_DEJA_RATTACHEE)
    depense.note_id = note.id
    note.updated_at = datetime.now(UTC)
    db.commit()
    return None


@router.delete("/{note_id}/depenses/{depense_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_depense(note_id: int, depense_id: int, db: DbSession, current_user: CurrentUser) -> None:
    """Détache une dépense de son dossier `brouillon` (elle redevient « à classer »)."""
    note = _get_owned_note(db, current_user.id, note_id)
    depense = _get_owned_depense(db, current_user.id, depense_id)
    _ensure_brouillon(note)
    if depense.note_id != note.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_DEPENSE_NON_RATTACHEE)
    depense.note_id = None
    note.updated_at = datetime.now(UTC)
    db.commit()
    return None
