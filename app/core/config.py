from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Основные настройки приложения."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Telegram
    bot_token: str

    # Database
    database_url: str

    # Опционально
    debug: bool = False


settings = Settings()
