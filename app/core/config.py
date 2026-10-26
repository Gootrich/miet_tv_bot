from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Основные настройки приложения."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    bot_token: str
    database_url: str
    debug: bool = False

    # Разрешает dev-mode (заголовок dev-mode: true, фиктивный пользователь).
    # В prod обязательно False.
    allow_dev_mode: bool = False

    # Comma-separated Telegram ID суперадминов (получают admin-роль на /start,
    # видят все заявки по всем клубам).
    # Пример: ADMIN_TELEGRAM_IDS=123456789,987654321
    admin_telegram_ids: str = ""

    # Главы клубов. Получают уведомления только по своему клубу,
    # НЕ получают admin-роль автоматически (если их нет в admin_telegram_ids).
    #
    # КЛУБЫ:
    #   videographer = МИЭТ-ТВ (видеографы)
    #   photographer = InFocus  (фотографы)
    admin_videographer_telegram_ids: str = ""  # глава МИЭТ-ТВ
    admin_photographer_telegram_ids: str = ""  # глава InFocus

    # Срок жизни initData; старше — отклоняем.
    init_data_max_age_seconds: int = 3600

    # URL Mini App для кнопки «Открыть приложение» в боте.
    # На сервере: https://31.77.160.59:9443/ (после настройки).
    # Пусто = кнопка не показывается (dev).
    webapp_url: str = ""

    @staticmethod
    def _parse_ids(raw: str) -> set[int]:
        return {
            int(x)
            for x in raw.split(",")
            if x.strip().lstrip("-").isdigit()
        }

    @property
    def admin_ids(self) -> set[int]:
        return self._parse_ids(self.admin_telegram_ids)

    @property
    def videographer_admin_ids(self) -> set[int]:
        """Главы МИЭТ-ТВ (видеографы)."""
        return self._parse_ids(self.admin_videographer_telegram_ids)

    @property
    def photographer_admin_ids(self) -> set[int]:
        """Главы InFocus (фотографы)."""
        return self._parse_ids(self.admin_photographer_telegram_ids)

    def admin_ids_for_club(self, club_code: str) -> set[int]:
        """ID, которым надо уведомить заявку по клубу: глава клуба + суперадмины."""
        base = set(self.admin_ids)
        if club_code == "videographer":
            base |= self.videographer_admin_ids
        elif club_code == "photographer":
            base |= self.photographer_admin_ids
        return base


settings = Settings()
