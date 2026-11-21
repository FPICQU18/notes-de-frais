"""Contrainte CHECK sur users.role."""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ROLE_CHECK = "role IN ('utilisateur', 'valideur', 'admin')"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_check_constraint("ck_users_role_valide", "users", _ROLE_CHECK)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("ck_users_role_valide", "users", type_="check")
