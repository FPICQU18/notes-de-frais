"""Schémas Pydantic de l'authentification."""

from pydantic import BaseModel, ConfigDict, field_validator


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email_non_vide(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("L'e-mail est requis.")
        return value

    @field_validator("password")
    @classmethod
    def _password_non_vide(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Le mot de passe est requis.")
        return value


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str
    role: str
