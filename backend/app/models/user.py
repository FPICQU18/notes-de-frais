from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db import Base

ROLES = ("utilisateur", "valideur", "admin")
_ROLE_CHECK = "role IN (" + ", ".join(f"'{role}'" for role in ROLES) + ")"

# Longueur maximale du nom affiché, partagée entre le schéma, la CLI et la colonne
# pour qu'ils ne puissent pas diverger.
MAX_DISPLAY_NAME_LENGTH = 255


class User(Base):
    __tablename__ = "users"
    __table_args__ = (sa.CheckConstraint(_ROLE_CHECK, name="role_valide"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(MAX_DISPLAY_NAME_LENGTH), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, server_default="utilisateur")
    is_active: Mapped[bool] = mapped_column(nullable=False, server_default=sa.true())
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
        onupdate=sa.func.now(),
    )

    @validates("email")
    def _normalize_email(self, key: str, value: str) -> str:
        """Normalise l'e-mail en minuscules à l'enregistrement."""
        return value.strip().lower()
