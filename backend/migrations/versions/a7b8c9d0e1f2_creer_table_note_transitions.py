"""Création de la table note_transitions et ajout de notes.soumise_at.

La table `note_transitions` est le journal d'audit du circuit de validation :
chaque passage d'un statut à un autre est enregistré (qui, quand, ancien et
nouveau statut, motif). La colonne `notes.soumise_at` porte la date de dernière
soumission (nécessaire pour la file de validation) ; elle est renseignée à
chaque passage `brouillon` → `soumise` et reprise ici pour les dossiers déjà
sortis de `brouillon`.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: str | Sequence[str] | None = "f6a7b8c9d0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ANCIEN_STATUT_CHECK = (
    "ancien_statut IN ('brouillon', 'soumise', 'validee', 'refusee', 'remboursee')"
)
_NOUVEAU_STATUT_CHECK = (
    "nouveau_statut IN ('brouillon', 'soumise', 'validee', 'refusee', 'remboursee')"
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "note_transitions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("acteur_id", sa.Integer(), nullable=False),
        sa.Column("ancien_statut", sa.String(length=20), nullable=False),
        sa.Column("nouveau_statut", sa.String(length=20), nullable=False),
        sa.Column("motif", sa.String(length=1000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_note_transitions"),
        sa.ForeignKeyConstraint(
            ["note_id"],
            ["notes.id"],
            name="fk_note_transitions_note_id_notes",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["acteur_id"],
            ["users.id"],
            name="fk_note_transitions_acteur_id_users",
            ondelete="CASCADE",
        ),
    )
    op.create_check_constraint(
        "ck_note_transitions_ancien_statut_valide", "note_transitions", _ANCIEN_STATUT_CHECK
    )
    op.create_check_constraint(
        "ck_note_transitions_nouveau_statut_valide", "note_transitions", _NOUVEAU_STATUT_CHECK
    )
    op.create_index("ix_note_transitions_note_id", "note_transitions", ["note_id"])
    op.create_index("ix_note_transitions_acteur_id", "note_transitions", ["acteur_id"])

    op.add_column("notes", sa.Column("soumise_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE notes SET soumise_at = updated_at WHERE statut != 'brouillon'")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("notes", "soumise_at")
    op.drop_index("ix_note_transitions_acteur_id", table_name="note_transitions")
    op.drop_index("ix_note_transitions_note_id", table_name="note_transitions")
    op.drop_constraint(
        "ck_note_transitions_nouveau_statut_valide", "note_transitions", type_="check"
    )
    op.drop_constraint(
        "ck_note_transitions_ancien_statut_valide", "note_transitions", type_="check"
    )
    op.drop_table("note_transitions")
