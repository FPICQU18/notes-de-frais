"""Routes d'authentification : ouvrir et fermer une session."""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from app.auth import SESSION_COOKIE_NAME, hash_token
from app.auth.dependencies import get_current_user
from app.db import get_db
from app.models import User, UserSession
from app.schemas.auth import LoginRequest, UserRead
from app.security import hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

SESSION_TTL = timedelta(days=7)

# Hash Argon2 factice, vérifié quand l'e-mail est inconnu, afin que le temps de
# réponse reste comparable à celui d'un mot de passe faux (anti-énumération par timing).
_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))

DbSession = Annotated[OrmSession, Depends(get_db)]


def _utcnow() -> datetime:
    return datetime.now(UTC)


@router.post("/login", response_model=UserRead)
def login(
    payload: LoginRequest,
    response: Response,
    db: DbSession,
) -> User:
    email = payload.email.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()

    # Vérifie Argon2 même si l'e-mail est inconnu (hash factice) : les trois refus
    # (inconnu / faux mot de passe / inactif) restent indiscernables en timing.
    password_hash = user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    password_ok = verify_password(payload.password, password_hash)

    if user is None or not password_ok or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="E-mail ou mot de passe incorrect.",
        )

    token = secrets.token_urlsafe(32)
    now = _utcnow()
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            created_at=now,
            expires_at=now + SESSION_TTL,
        )
    )
    db.commit()

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=int(SESSION_TTL.total_seconds()),
        path="/",
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return user


@router.post("/logout")
def logout(request: Request, db: DbSession) -> Response:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        session = db.execute(
            select(UserSession).where(UserSession.token_hash == hash_token(token))
        ).scalar_one_or_none()
        if session is not None:
            db.delete(session)
            db.commit()

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=True,
        httponly=True,
        samesite="strict",
    )
    return response


@router.get("/me", response_model=UserRead)
def me(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """Renvoie l'utilisateur connecté (sans hash ni jeton)."""
    return current_user
