"""Authentification : constantes et helpers partagés entre l'API et les dépendances."""

import hashlib

SESSION_COOKIE_NAME = "ndf_session"


def hash_token(token: str) -> str:
    """Hache un jeton de session en SHA-256 hexadécimal (jamais stocké en clair)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
