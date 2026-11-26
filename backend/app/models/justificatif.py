"""Modèle de justificatif : le fichier (photo ou PDF) joint à une dépense.

Les octets sont stockés en base dans une table dédiée (`bytea`), jamais dans la
table des dépenses ni dans les réponses de liste. Une dépense porte au plus un
justificatif : `depense_id` est unique (contrainte `uq_justificatifs_depense_id`)
et la ligne est supprimée en cascade avec sa dépense. Le type MIME est déduit de
la signature du fichier, jamais de l'extension ni du `Content-Type` envoyé.
"""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

MAX_TAILLE_OCTETS = 10 * 1024 * 1024  # 10 Mo
MAX_NOM_FICHIER = 255
MAX_CONTENT_TYPE = 100

# Nom de substitution quand le nom d'origine assaini est vide.
NOM_FICHIER_PAR_DEFAUT = "justificatif"


class Justificatif(Base):
    __tablename__ = "justificatifs"
    __table_args__ = (
        sa.UniqueConstraint("depense_id", name="uq_justificatifs_depense_id"),
        sa.Index("ix_justificatifs_depense_id", "depense_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    depense_id: Mapped[int] = mapped_column(
        ForeignKey("depenses.id", ondelete="CASCADE"), nullable=False
    )
    nom_fichier: Mapped[str] = mapped_column(String(MAX_NOM_FICHIER), nullable=False)
    content_type: Mapped[str] = mapped_column(String(MAX_CONTENT_TYPE), nullable=False)
    taille_octets: Mapped[int] = mapped_column(Integer, nullable=False)
    donnees: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )
