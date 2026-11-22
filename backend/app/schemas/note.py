"""Schémas Pydantic des notes de frais (dossiers).

`NoteRead` expose les totaux calculés côté serveur (`total_centimes`,
`nb_depenses`) mais jamais `user_id` : le dossier appartient toujours à
l'appelant. `NoteDetail` ajoute la liste des dépenses rattachées.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.depense import DepenseRead

_MAX_LIBELLE = 200


def _valide_libelle(value: str) -> str:
    if value is None:
        raise ValueError("Le libellé ne peut pas être null.")
    value = value.strip()
    if not value:
        raise ValueError("Le libellé est requis.")
    if len(value) > _MAX_LIBELLE:
        raise ValueError(f"Le libellé est trop long ({_MAX_LIBELLE} caractères maximum).")
    return value


def _valide_depense_ids(value: list[int] | None) -> list[int] | None:
    if value is None:
        return None
    if len(value) != len(set(value)):
        raise ValueError("Les dépenses ne doivent pas être dupliquées.")
    return value


class NoteCreate(BaseModel):
    libelle: str
    depense_ids: list[int] | None = None

    _libelle = field_validator("libelle")(_valide_libelle)
    _depense_ids = field_validator("depense_ids")(_valide_depense_ids)


class NoteUpdate(BaseModel):
    libelle: str

    _libelle = field_validator("libelle")(_valide_libelle)


class NoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    libelle: str
    statut: str
    total_centimes: int
    nb_depenses: int
    created_at: datetime
    updated_at: datetime


class NoteDetail(NoteRead):
    depenses: list[DepenseRead]
