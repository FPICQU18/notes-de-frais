"""Rate limiting de POST /api/v1/auth/login : compteurs par e-mail et par IP.

La fenêtre est glissante (15 minutes calculées depuis `created_at`) : les entrées
trop vieilles sont purgées à chaque appel, dans la même transaction. Une tentative
bloquée (429) n'insère aucune ligne, donc la fenêtre ne glisse pas à cause des
tentatives bloquées : le déblocage intervient 15 minutes après le dernier échec
enregistré.
"""

import ipaddress
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import LoginAttempt

WINDOW = timedelta(minutes=15)
MAX_FAILURES_EMAIL = 5
MAX_FAILURES_IP = 20
TOO_MANY_REQUESTS_DETAIL = "Trop de tentatives. Réessayez dans quelques minutes."

# Réseaux de confiance (proxy / Docker / TestClient) : RFC 1918 + loopback.
_TRUSTED_NETWORKS = tuple(
    ipaddress.ip_network(network)
    for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "::1/128")
)


def client_ip(request: Request) -> str | None:
    """IP à utiliser pour le compteur : premier élément de X-Forwarded-For si la
    source de la requête est un réseau de confiance, sinon l'IP du client.

    Un client public ne peut donc pas se forger une IP via X-Forwarded-For.
    """
    client_host = request.client.host if request.client is not None else None
    if client_host is not None and _is_trusted(client_host):
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            first = forwarded_for.split(",")[0].strip()
            if first:
                return first
    return client_host


def _is_trusted(host: str) -> bool:
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(address in network for network in _TRUSTED_NETWORKS)


def purge_expired_attempts(db: Session, now: datetime) -> None:
    """Supprime les entrées dont `created_at` est vieille de plus de 15 minutes."""
    db.execute(delete(LoginAttempt).where(LoginAttempt.created_at <= now - WINDOW))


def _count(db: Session, column, value: str | None, since: datetime) -> int:
    if value is None:
        return 0
    return db.execute(
        select(func.count())
        .select_from(LoginAttempt)
        .where(column == value, LoginAttempt.created_at > since)
    ).scalar_one()


def is_blocked(db: Session, email: str | None, ip: str | None, now: datetime) -> bool:
    """Seuil atteint pour l'e-mail (5) ou pour l'IP (20) dans la fenêtre glissante."""
    since = now - WINDOW
    email_count = _count(db, LoginAttempt.email, email, since)
    if email_count >= MAX_FAILURES_EMAIL:
        return True
    ip_count = _count(db, LoginAttempt.ip, ip, since)
    return ip_count >= MAX_FAILURES_IP


def record_failure(db: Session, email: str | None, ip: str | None, now: datetime) -> None:
    """Enregistre un échec de connexion (e-mail normalisé, IP, horodatage UTC)."""
    db.add(LoginAttempt(email=email, ip=ip, created_at=now))


def reset_email_attempts(db: Session, email: str | None) -> None:
    """Remise à zéro du compteur de l'e-mail après une connexion réussie."""
    if email is None:
        return
    db.execute(delete(LoginAttempt).where(LoginAttempt.email == email))


def utcnow() -> datetime:
    return datetime.now(UTC)
