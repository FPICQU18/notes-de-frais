"""Dépendances FastAPI d'authentification et d'autorisation.

`get_current_user` identifie l'utilisateur connecté à partir du cookie de session ;
`require_role` exige un rôle minimal pour accéder à une route.
"""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from app.auth import SESSION_COOKIE_NAME, hash_token
from app.db import get_db
from app.models import Session, User

DbSession = Annotated[OrmSession, Depends(get_db)]

# Hiérarchie des rôles : l'admin a tous les droits du valideur, qui a tous les
# droits d'un simple utilisateur. `require_role("valideur")` autorise donc aussi
# l'admin, et `require_role("utilisateur")` tout compte actif.
_ROLE_LEVELS = {"utilisateur": 0, "valideur": 1, "admin": 2}

_MESSAGE_NON_AUTHENTIFIE = "Authentification requise."


def get_current_user(request: Request, db: DbSession) -> User:
    """Renvoie l'utilisateur connecté, ou lève `HTTPException(401)`.

    Lit le cookie `ndf_session`, hache son jeton (SHA-256), retrouve la session,
    vérifie l'expiration puis l'activation du compte. Toute erreur lève 401 avec
    le même message, sans fuite d'information.
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_MESSAGE_NON_AUTHENTIFIE,
        )

    session = db.execute(
        select(Session).where(Session.token_hash == hash_token(token))
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_MESSAGE_NON_AUTHENTIFIE,
        )

    if session.expires_at <= datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_MESSAGE_NON_AUTHENTIFIE,
        )

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        if user is not None:
            # Compte désactivé : sa session est supprimée en base (AGENTS.md).
            db.delete(session)
            db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_MESSAGE_NON_AUTHENTIFIE,
        )

    return user


def require_role(role: str) -> Callable[..., User]:
    """Renvoie une dépendance exigeant le rôle `role` (ou un rôle supérieur).

    `require_role("valideur")` autorise `valideur` et `admin` ;
    `require_role("admin")` n'autorise que `admin` ;
    `require_role("utilisateur")` autorise tout compte actif.
    """
    required_level = _ROLE_LEVELS[role]

    def _require_role(user: Annotated[User, Depends(get_current_user)]) -> User:
        if _ROLE_LEVELS.get(user.role, -1) < required_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès refusé : rôle insuffisant.",
            )
        return user

    return _require_role
