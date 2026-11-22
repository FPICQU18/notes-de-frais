"""Schémas Pydantic des dépenses (tickets).

Les règles de validation sont les mêmes à la création et à la modification :
libellé non vide (200 caractères max.), date non future (UTC), montant entier
strictement positif (100 000 € max.), catégorie parmi `CATEGORIES`, commentaire
facultatif (1 000 caractères max.). `user_id` et `note_id` ne sont jamais
acceptés : la dépense appartient toujours à l'appelant et reste à classer.
"""

from datetime import UTC, date, datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.depense import CATEGORIES

_MAX_LIBELLE = 200
_MAX_COMMENTAIRE = 1000
_MONTANT_MAX_CENTIMES = 10_000_000


def _valide_libelle(value: str) -> str:
    if value is None:
        raise ValueError("Le libellé ne peut pas être null.")
    value = value.strip()
    if not value:
        raise ValueError("Le libellé est requis.")
    if len(value) > _MAX_LIBELLE:
        raise ValueError(f"Le libellé est trop long ({_MAX_LIBELLE} caractères maximum).")
    return value


def _valide_date_depense(value: date) -> date:
    if value is None:
        raise ValueError("La date de dépense ne peut pas être null.")
    if value > datetime.now(UTC).date():
        raise ValueError("La date de dépense ne peut pas être dans le futur.")
    return value


def _valide_montant_centimes(value: int) -> int:
    if value is None:
        raise ValueError("Le montant ne peut pas être null.")
    if value <= 0:
        raise ValueError("Le montant doit être strictement positif.")
    if value > _MONTANT_MAX_CENTIMES:
        raise ValueError("Le montant ne peut pas dépasser 100 000 €.")
    return value


def _valide_categorie(value: str) -> str:
    if value is None:
        raise ValueError("La catégorie ne peut pas être null.")
    if value not in CATEGORIES:
        raise ValueError("La catégorie est invalide.")
    return value


def _valide_commentaire(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) > _MAX_COMMENTAIRE:
        raise ValueError(f"Le commentaire est trop long ({_MAX_COMMENTAIRE} caractères maximum).")
    return value


class DepenseCreate(BaseModel):
    libelle: str
    date_depense: date
    montant_centimes: int
    categorie: str
    commentaire: str | None = None

    _libelle = field_validator("libelle")(_valide_libelle)
    _date_depense = field_validator("date_depense")(_valide_date_depense)
    _montant_centimes = field_validator("montant_centimes")(_valide_montant_centimes)
    _categorie = field_validator("categorie")(_valide_categorie)
    _commentaire = field_validator("commentaire")(_valide_commentaire)


class DepenseUpdate(BaseModel):
    libelle: str | None = None
    date_depense: date | None = None
    montant_centimes: int | None = None
    categorie: str | None = None
    commentaire: str | None = None

    _libelle = field_validator("libelle")(_valide_libelle)
    _date_depense = field_validator("date_depense")(_valide_date_depense)
    _montant_centimes = field_validator("montant_centimes")(_valide_montant_centimes)
    _categorie = field_validator("categorie")(_valide_categorie)
    _commentaire = field_validator("commentaire")(_valide_commentaire)


class DepenseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    libelle: str
    date_depense: date
    montant_centimes: int
    categorie: str
    commentaire: str | None
    note_id: int | None
    created_at: datetime
    updated_at: datetime
