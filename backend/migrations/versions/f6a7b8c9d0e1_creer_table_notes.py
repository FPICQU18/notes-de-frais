"""Création de la table notes et rattachement des dépenses (FK + index)."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: str | Sequence[str] | None = "e5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_STATUT_CHECK = "statut IN ('brouillon', 'soumise', 'validee', 'refusee', 'remboursee')"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "notes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("libelle", sa.String(length=200), nullable=False),
        sa.Column("statut", sa.String(length=20), server_default="brouillon", nullable=False),
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
        sa.PrimaryKeyConstraint("id", name="pk_notes"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_notes_user_id_users",
            ondelete="CASCADE",
        ),
    )
    op.create_check_constraint("ck_notes_statut_valide", "notes", _STATUT_CHECK)
    op.create_index("ix_notes_user_id", "notes", ["user_id"])
    op.create_foreign_key(
        "fk_depenses_note_id_notes",
        "depenses",
        "notes",
        ["note_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_depenses_note_id", "depenses", ["note_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_depenses_note_id", table_name="depenses")
    op.drop_constraint("fk_depenses_note_id_notes", "depenses", type_="foreignkey")
    op.drop_index("ix_notes_user_id", table_name="notes")
    op.drop_constraint("ck_notes_statut_valide", "notes", type_="check")
    op.drop_table("notes")
