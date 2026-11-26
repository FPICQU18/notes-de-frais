"""Routes d'authentification : ouvrir et fermer une session."""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as OrmSession

from app.auth import SESSION_COOKIE_NAME, hash_token, rate_limit
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
    request: Request,
    response: Response,
    db: DbSession,
) -> User:
    email = payload.email.strip().lower()
    ip = rate_limit.client_ip(request)
    now = _utcnow()

    # Purge des entrées hors fenêtre glissante (15 min) dans la même transaction,
    # puis vérification des seuils AVANT le mot de passe : à seuil atteint, même
    # le bon mot de passe reçoit 429 et aucune ligne n'est ajoutée (la fenêtre ne
    # glisse pas à cause des tentatives bloquées).
    rate_limit.purge_expired_attempts(db, now)
    if rate_limit.is_blocked(db, email, ip, now):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=rate_limit.TOO_MANY_REQUESTS_DETAIL,
        )

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()

    # Vérifie Argon2 même si l'e-mail est inconnu (hash factice) : les trois refus
    # (inconnu / faux mot de passe / inactif) restent indiscernables en timing.
    password_hash = user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    password_ok = verify_password(payload.password, password_hash)

    if user is None or not password_ok or not user.is_active:
        rate_limit.record_failure(db, email, ip, now)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="E-mail ou mot de passe incorrect.",
        )

    # Connexion réussie : remise à zéro du compteur de l'e-mail.
    rate_limit.reset_email_attempts(db, email)
    token = secrets.token_urlsafe(32)
    # Purge des sessions expirées (tous utilisateurs) dans la même transaction
    # que la création de la nouvelle session, afin de ne pas accumuler les jetons.
    db.execute(delete(UserSession).where(UserSession.expires_at <= now))
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
