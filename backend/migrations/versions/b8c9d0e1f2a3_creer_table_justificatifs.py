"""Création de la table justificatifs."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8c9d0e1f2a3"
down_revision: str | Sequence[str] | None = "a7b8c9d0e1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "justificatifs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("depense_id", sa.Integer(), nullable=False),
        sa.Column("nom_fichier", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("taille_octets", sa.Integer(), nullable=False),
        sa.Column("donnees", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_justificatifs"),
        sa.ForeignKeyConstraint(
            ["depense_id"],
            ["depenses.id"],
            name="fk_justificatifs_depense_id_depenses",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("depense_id", name="uq_justificatifs_depense_id"),
    )
    op.create_index("ix_justificatifs_depense_id", "justificatifs", ["depense_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_justificatifs_depense_id", table_name="justificatifs")
    op.drop_table("justificatifs")
