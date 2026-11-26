"""Schémas Pydantic de la file de validation (vue transversale valideur/admin).

Contrairement aux schémas de `app.schemas.note`, ces schémas exposent le
propriétaire du dossier (`ProprietaireRead`) car la file de validation regroupe
les dossiers de tous les comptes. Le propriétaire n'expose que `id` et
`display_name` : jamais l'e-mail, jamais le rôle.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.depense import DepenseRead


class ProprietaireRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    display_name: str


class ValidationNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    libelle: str
    statut: str
    total_centimes: int
    nb_depenses: int
    soumise_at: datetime | None
    proprietaire: ProprietaireRead


class ValidationNoteDetail(ValidationNoteRead):
    depenses: list[DepenseRead]
