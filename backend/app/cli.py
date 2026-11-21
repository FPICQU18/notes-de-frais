import getpass
import re
import sys
from collections.abc import Sequence

import sqlalchemy as sa

from app.db import SessionLocal
from app.models.user import User
from app.security import hash_password

MIN_PASSWORD_LENGTH = 12

# Validation d'e-mail volontairement simple et stricte : une seule arobase, un domaine
# avec au moins un point, pas d'espace, caractères ASCII uniquement.
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def _is_valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email)) and len(email) <= 320


def _fail(message: str) -> int:
    print(f"Erreur : {message}", file=sys.stderr)
    return 1


def create_admin() -> int:
    """Crée interactivement le premier compte administrateur."""
    email = input("E-mail : ").strip()
    if not _is_valid_email(email):
        return _fail(f"l'e-mail « {email} » est invalide.")

    display_name = input("Nom affiché : ").strip()
    if not display_name:
        return _fail("le nom affiché ne peut pas être vide.")

    password = getpass.getpass("Mot de passe (12 caractères min.) : ")
    if len(password) < MIN_PASSWORD_LENGTH:
        return _fail(f"le mot de passe doit contenir au moins {MIN_PASSWORD_LENGTH} caractères.")
    confirmation = getpass.getpass("Confirmation du mot de passe : ")
    if password != confirmation:
        return _fail("le mot de passe et sa confirmation sont différents.")

    with SessionLocal() as session:
        existing = session.execute(
            sa.select(User.id).where(sa.func.lower(User.email) == email.lower())
        ).scalar_one_or_none()
        if existing is not None:
            return _fail(f"un compte existe déjà avec l'e-mail « {email} ».")

        user = User(
            email=email,
            display_name=display_name,
            role="admin",
            is_active=True,
            password_hash=hash_password(password),
        )
        session.add(user)
        session.commit()
        session.refresh(user)

    print(f"Compte administrateur créé : {user.email} (id={user.id}).")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1 or args[0] != "create-admin":
        print("Usage : python -m app.cli create-admin", file=sys.stderr)
        return 2
    return create_admin()


if __name__ == "__main__":
    sys.exit(main())
