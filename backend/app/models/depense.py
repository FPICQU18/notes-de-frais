"""Modèle de dépense : un ticket saisi par un utilisateur, à regrouper dans une note.

`note_id` référence le dossier (`notes.id`) auquel la dépense est rattachée ;
il reste `NULL` tant qu'elle est « à classer ». Le rattachement est détaché
(`ON DELETE SET NULL`) quand le dossier est supprimé : les dépenses ne sont
jamais supprimées avec leur dossier.
"""

from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy import Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

CATEGORIES = (
    "transport",
    "repas",
    "hebergement",
    "carburant",
    "peage_parking",
    "fournitures",
    "autre",
)

_CATEGORIE_CHECK = "categorie IN (" + ", ".join(f"'{categorie}'" for categorie in CATEGORIES) + ")"
_MONTANT_CHECK = "montant_centimes > 0 AND montant_centimes <= 10000000"


class Depense(Base):
    __tablename__ = "depenses"
    __table_args__ = (
        sa.CheckConstraint(_CATEGORIE_CHECK, name="categorie_valide"),
        sa.CheckConstraint(_MONTANT_CHECK, name="montant_valide"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    libelle: Mapped[str] = mapped_column(String(200), nullable=False)
    date_depense: Mapped[date] = mapped_column(Date, nullable=False)
    montant_centimes: Mapped[int] = mapped_column(Integer, nullable=False)
    categorie: Mapped[str] = mapped_column(String(20), nullable=False)
    commentaire: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    note_id: Mapped[int | None] = mapped_column(
        ForeignKey("notes.id", ondelete="SET NULL"), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )
