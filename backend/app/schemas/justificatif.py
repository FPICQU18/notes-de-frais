"""Schémas Pydantic du justificatif d'une dépense.

La réponse ne transporte que des métadonnées (nom, type, taille, horodatages) :
les octets du fichier ne sont jamais sérialisés ici, ils sont servis par la route
de téléchargement dédiée.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JustificatifRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    nom_fichier: str
    content_type: str
    taille_octets: int
    created_at: datetime
    updated_at: datetime
