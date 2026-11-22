"""Hachage des mots de passe (Argon2 via pwdlib)."""

from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

# Longueur minimale du mot de passe, partagée par l'API (schéma) et la CLI.
MIN_PASSWORD_LENGTH = 12

_password_hash = PasswordHash((Argon2Hasher(),))


def hash_password(password: str) -> str:
    """Hache un mot de passe en clair avec Argon2. Ne jamais journaliser le résultat brut."""
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Vérifie un mot de passe en clair contre un hash Argon2 stocké."""
    return _password_hash.verify(password, password_hash)
