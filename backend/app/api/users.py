"""Routes d'administration des comptes utilisateurs.

Toutes les routes exigent le rôle `admin` et appliquent les garde-fous anti
auto-verrouillage : un administrateur ne peut ni se rétrograder ni se
désactiver lui-même.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as OrmSession

from app.auth.dependencies import require_role
from app.db import get_db
from app.models import User, UserSession
from app.schemas.user import RoleUpdate, UserAdmin, UserCreate
from app.security import hash_password

router = APIRouter(prefix="/api/v1/users", tags=["users"])

DbSession = Annotated[OrmSession, Depends(get_db)]
Admin = Annotated[User, Depends(require_role("admin"))]

_EMAIL_DEJA_UTILISE = "Un compte existe déjà avec cet e-mail."
_COMPTE_INTROUVABLE = "Compte introuvable."


@router.post("", response_model=UserAdmin, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: DbSession, _admin: Admin) -> User:
    """Crée un compte (e-mail normalisé, mot de passe haché en Argon2)."""
    existing = db.execute(select(User.id).where(User.email == payload.email)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_EMAIL_DEJA_UTILISE)

    user = User(
        email=payload.email,
        display_name=payload.display_name,
        role=payload.role,
        is_active=True,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("", response_model=list[UserAdmin])
def list_users(db: DbSession, _admin: Admin) -> list[User]:
    """Liste les comptes triés par `id` croissant (désactivés inclus)."""
    return list(db.execute(select(User).order_by(User.id)).scalars())


@router.patch("/{user_id}/role", response_model=UserAdmin)
def change_role(user_id: int, payload: RoleUpdate, db: DbSession, admin: Admin) -> User:
    """Change le rôle d'un compte ; interdit de rétrograder son propre compte admin."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_COMPTE_INTROUVABLE)
    if user.id == admin.id and payload.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Un administrateur ne peut pas modifier le rôle de son propre compte.",
        )

    user.role = payload.role
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/deactivate", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(user_id: int, db: DbSession, admin: Admin) -> None:
    """Désactive un compte et supprime ses sessions dans la même transaction."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_COMPTE_INTROUVABLE)
    if user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Un administrateur ne peut pas désactiver son propre compte.",
        )

    if user.is_active:
        user.is_active = False
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        db.commit()
    # Compte déjà désactivé : idempotent, aucune écriture.
    return None


@router.post("/{user_id}/reactivate", status_code=status.HTTP_204_NO_CONTENT)
def reactivate_user(user_id: int, db: DbSession, _admin: Admin) -> None:
    """Réactive un compte sans recréer de session."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_COMPTE_INTROUVABLE)

    if not user.is_active:
        user.is_active = True
        db.commit()
    # Compte déjà actif : idempotent, aucune écriture.
    return None
