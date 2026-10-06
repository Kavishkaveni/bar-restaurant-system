from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"  # set to "production" on the live server
    database_url: str = "postgresql+asyncpg://barpos:barpos@localhost:5432/barpos"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 7
    # PIN sessions are for shared counter screens, so they last one shift.
    pin_refresh_token_hours: int = 16

    pin_max_attempts: int = 5
    pin_lock_minutes: int = 5

    # Used once by the seed script when the database has no users yet.
    owner_username: str = "owner"
    owner_password: str = "ChangeMe123!"
    owner_name: str = "Owner"

    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
