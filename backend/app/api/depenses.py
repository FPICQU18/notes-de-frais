"""Routes de gestion des dépenses (tickets).

Toutes les routes exigent un utilisateur connecté et ne manipulent que les
dépenses dont il est le propriétaire : une dépense appartenant à un autre
compte renvoie 404, identique à un identifiant inexistant (aucune fuite
d'existence). Une dépense rattachée à un dossier qui n'est plus au statut
`brouillon` ne peut plus être modifiée ni supprimée (409).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from app.auth.dependencies import get_current_user
from app.db import get_db
from app.models import Depense, Note, User
from app.schemas.depense import DepenseCreate, DepenseRead, DepenseUpdate

router = APIRouter(prefix="/api/v1/depenses", tags=["depenses"])

DbSession = Annotated[OrmSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

_DEPENSE_INTROUVABLE = "Dépense introuvable."
_DEPENSE_DOSSIER_NON_BROUILLON = (
    "La dépense appartient à un dossier qui n'est pas au statut brouillon."
)


def _get_owned_depense(db: OrmSession, user_id: int, depense_id: int) -> Depense:
    """Renvoie la dépense `depense_id` si elle appartient à `user_id`, sinon 404."""
    depense = db.execute(
        select(Depense).where(Depense.id == depense_id, Depense.user_id == user_id)
    ).scalar_one_or_none()
    if depense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_DEPENSE_INTROUVABLE)
    return depense


def _ensure_depense_modifiable(db: OrmSession, depense: Depense) -> None:
    """Lève 409 si la dépense est rattachée à un dossier non `brouillon`."""
    if depense.note_id is None:
        return
    note = db.get(Note, depense.note_id)
    if note is not None and note.statut != "brouillon":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_DEPENSE_DOSSIER_NON_BROUILLON
        )


@router.post("", response_model=DepenseRead, status_code=status.HTTP_201_CREATED)
def create_depense(payload: DepenseCreate, db: DbSession, current_user: CurrentUser) -> Depense:
    """Crée une dépense appartenant à l'utilisateur connecté (`note_id` reste NULL)."""
    depense = Depense(
        user_id=current_user.id,
        libelle=payload.libelle,
        date_depense=payload.date_depense,
        montant_centimes=payload.montant_centimes,
        categorie=payload.categorie,
        commentaire=payload.commentaire,
        note_id=None,
    )
    db.add(depense)
    db.commit()
    db.refresh(depense)
    return depense


@router.get("", response_model=list[DepenseRead])
def list_depenses(
    db: DbSession,
    current_user: CurrentUser,
    a_classer: bool | None = None,
) -> list[Depense]:
    """Liste les dépenses de l'utilisateur, les plus récentes d'abord.

    `a_classer=true` restreint aux dépenses sans note (`note_id` NULL).
    """
    stmt = select(Depense).where(Depense.user_id == current_user.id)
    if a_classer:
        stmt = stmt.where(Depense.note_id.is_(None))
    stmt = stmt.order_by(Depense.date_depense.desc(), Depense.id.desc())
    return list(db.execute(stmt).scalars())


@router.get("/{depense_id}", response_model=DepenseRead)
def get_depense(depense_id: int, db: DbSession, current_user: CurrentUser) -> Depense:
    """Renvoie une dépense du propriétaire connecté."""
    return _get_owned_depense(db, current_user.id, depense_id)


@router.patch("/{depense_id}", response_model=DepenseRead)
def update_depense(
    depense_id: int,
    payload: DepenseUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> Depense:
    """Modifie partiellement une dépense (seuls les champs fournis sont changés)."""
    depense = _get_owned_depense(db, current_user.id, depense_id)
    _ensure_depense_modifiable(db, depense)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(depense, field, value)
    db.commit()
    db.refresh(depense)
    return depense


@router.delete("/{depense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_depense(depense_id: int, db: DbSession, current_user: CurrentUser) -> None:
    """Supprime une dépense du propriétaire connecté."""
    depense = _get_owned_depense(db, current_user.id, depense_id)
    _ensure_depense_modifiable(db, depense)
    db.delete(depense)
    db.commit()
    return None
