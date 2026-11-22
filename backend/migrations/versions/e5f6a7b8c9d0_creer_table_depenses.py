"""Création de la table depenses."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: str | Sequence[str] | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CATEGORIE_CHECK = (
    "categorie IN ('transport', 'repas', 'hebergement', 'carburant', "
    "'peage_parking', 'fournitures', 'autre')"
)
_MONTANT_CHECK = "montant_centimes > 0 AND montant_centimes <= 10000000"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "depenses",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("libelle", sa.String(length=200), nullable=False),
        sa.Column("date_depense", sa.Date(), nullable=False),
        sa.Column("montant_centimes", sa.Integer(), nullable=False),
        sa.Column("categorie", sa.String(length=20), nullable=False),
        sa.Column("commentaire", sa.String(length=1000), nullable=True),
        sa.Column("note_id", sa.Integer(), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name="pk_depenses"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_depenses_user_id_users",
            ondelete="CASCADE",
        ),
    )
    op.create_check_constraint("ck_depenses_categorie_valide", "depenses", _CATEGORIE_CHECK)
    op.create_check_constraint("ck_depenses_montant_valide", "depenses", _MONTANT_CHECK)
    op.create_index("ix_depenses_user_id", "depenses", ["user_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_depenses_user_id", table_name="depenses")
    op.drop_constraint("ck_depenses_montant_valide", "depenses", type_="check")
    op.drop_constraint("ck_depenses_categorie_valide", "depenses", type_="check")
    op.drop_table("depenses")
