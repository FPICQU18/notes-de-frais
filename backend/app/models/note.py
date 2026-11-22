"""Modèle de note de frais : un dossier qui regroupe une ou plusieurs dépenses.

C'est le dossier (et non la dépense) qui porte le statut et le circuit de
validation. Un dossier naît toujours au statut `brouillon` ; cette US ne crée
aucune transition : le statut reste `brouillon` en pratique, mais les cinq
statuts d'AGENTS.md sont acceptés par la contrainte `CHECK` pour que les tests
puissent positionner un statut avancé directement en base.
"""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

STATUTS = ("brouillon", "soumise", "validee", "refusee", "remboursee")

_STATUT_CHECK = "statut IN (" + ", ".join(f"'{statut}'" for statut in STATUTS) + ")"


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (sa.CheckConstraint(_STATUT_CHECK, name="statut_valide"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    statut: Mapped[str] = mapped_column(String(20), nullable=False, server_default="brouillon")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )
