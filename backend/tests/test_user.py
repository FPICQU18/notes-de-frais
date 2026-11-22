"""Tests du modèle User : normalisation de l'e-mail et contrainte CHECK sur le rôle."""

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User

VALID_PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$hash$hash"


def _make_user(email: str, role: str = "utilisateur") -> User:
    return User(
        email=email,
        display_name="Jean Dupont",
        role=role,
        is_active=True,
        password_hash=VALID_PASSWORD_HASH,
    )


def test_email_normalise_en_minuscules(db_session: Session):
    """Un e-mail saisi avec des majuscules est stocké en minuscules."""
    user = _make_user("Jean@Example.COM")
    assert user.email == "jean@example.com"
    db_session.add(user)
    db_session.commit()

    stored = db_session.execute(
        sa.select(User).where(sa.func.lower(User.email) == "jean@example.com")
    ).scalar_one()
    assert stored.email == "jean@example.com"


@pytest.mark.parametrize("role", ["utilisateur", "valideur", "admin"])
def test_role_autorise_accepte(db_session: Session, role: str):
    db_session.add(_make_user("jean@example.com", role=role))
    db_session.commit()
    stored = db_session.execute(
        sa.select(User).where(User.email == "jean@example.com")
    ).scalar_one()
    assert stored.role == role


def test_role_inconnu_refuse_a_la_creation(db_session: Session):
    """La contrainte CHECK en base refuse un rôle hors {utilisateur, valideur, admin}."""
    db_session.add(_make_user("jean@example.com", role="superadmin"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_role_inconnu_refuse_a_la_mise_a_jour(db_session: Session):
    """La contrainte CHECK en base refuse aussi la mise à jour vers un rôle inconnu."""
    user = _make_user("jean@example.com", role="utilisateur")
    db_session.add(user)
    db_session.commit()

    user.role = "inconnu"
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    stored = db_session.execute(
        sa.select(User).where(User.email == "jean@example.com")
    ).scalar_one()
    assert stored.role == "utilisateur"


def test_email_doublon_casse_differente_refuse(db_session: Session):
    """Un e-mail déjà présent, saisi avec une casse différente, est refusé (unicité)."""
    db_session.add(_make_user("jean@example.com"))
    db_session.commit()

    db_session.add(_make_user("Jean@Example.COM"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    assert db_session.execute(sa.select(sa.func.count()).select_from(User)).scalar_one() == 1


def test_comparaison_email_insensible_a_la_casse(db_session: Session):
    """La comparaison par e-mail est insensible à la casse."""
    db_session.add(_make_user("Jean@Example.COM"))
    db_session.commit()

    trouve = db_session.execute(
        sa.select(User).where(sa.func.lower(User.email) == "JEAN@EXAMPLE.COM".lower())
    ).scalar_one_or_none()
    assert trouve is not None
    assert trouve.email == "jean@example.com"
