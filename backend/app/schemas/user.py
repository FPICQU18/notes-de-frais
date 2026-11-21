"""Schémas Pydantic de gestion des comptes (administration).

Distincts des schémas d'authentification : `UserAdmin` ajoute `is_active` et
`created_at` à l'exposition de `UserRead`, sans jamais exposer le hash du mot de
passe.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.cli import MIN_PASSWORD_LENGTH
from app.models.user import ROLES


class UserCreate(BaseModel):
    email: str
    display_name: str
    role: str
    password: str

    @field_validator("email")
    @classmethod
    def _normalise_et_valide_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not value:
            raise ValueError("L'e-mail est requis.")
        if "@" not in value:
            raise ValueError("L'e-mail est invalide.")
        if len(value) > 320:
            raise ValueError("L'e-mail est trop long (320 caractères maximum).")
        return value

    @field_validator("display_name")
    @classmethod
    def _valide_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Le nom affiché est requis.")
        return value

    @field_validator("role")
    @classmethod
    def _valide_role(cls, value: str) -> str:
        if value not in ROLES:
            raise ValueError("Le rôle est invalide.")
        return value

    @field_validator("password")
    @classmethod
    def _valide_mot_de_passe(cls, value: str) -> str:
        if len(value) < MIN_PASSWORD_LENGTH:
            raise ValueError(
                f"Le mot de passe doit contenir au moins {MIN_PASSWORD_LENGTH} caractères."
            )
        return value


class RoleUpdate(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def _valide_role(cls, value: str) -> str:
        if value not in ROLES:
            raise ValueError("Le rôle est invalide.")
        return value


class UserAdmin(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str
    role: str
    is_active: bool
    created_at: datetime
