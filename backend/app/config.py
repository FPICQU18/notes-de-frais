from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    environment: str = "dev"
    database_url: str = "postgresql+psycopg://ndf:ndf@localhost:5432/ndf"


@lru_cache
def get_settings() -> Settings:
    return Settings()
