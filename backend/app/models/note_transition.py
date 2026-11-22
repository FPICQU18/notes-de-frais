"""Modèle de transition de statut d'une note de frais.

Chaque transition du circuit de validation est historisée dans cette table
immutable : qui (`acteur_id`), quand (`created_at`), de quel statut à quel
statut, et le motif (renseigné uniquement pour un refus). Une ligne n'est
jamais modifiée ni supprimée : l'historique est un journal d'audit.
"""

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.note import STATUTS

_ANCIEN_STATUT_CHECK = "ancien_statut IN (" + ", ".join(f"'{statut}'" for statut in STATUTS) + ")"
_NOUVEAU_STATUT_CHECK = "nouveau_statut IN (" + ", ".join(f"'{statut}'" for statut in STATUTS) + ")"


class NoteTransition(Base):
    __tablename__ = "note_transitions"
    __table_args__ = (
        sa.CheckConstraint(_ANCIEN_STATUT_CHECK, name="ancien_statut_valide"),
        sa.CheckConstraint(_NOUVEAU_STATUT_CHECK, name="nouveau_statut_valide"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    note_id: Mapped[int] = mapped_column(
        ForeignKey("notes.id", ondelete="CASCADE"), index=True, nullable=False
    )
    acteur_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ancien_statut: Mapped[str] = mapped_column(String(20), nullable=False)
    nouveau_statut: Mapped[str] = mapped_column(String(20), nullable=False)
    motif: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
