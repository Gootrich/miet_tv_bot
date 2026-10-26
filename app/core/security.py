import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from fastapi import HTTPException, status


def verify_telegram_init_data(
    init_data: str,
    bot_token: str,
    max_age_seconds: int = 3600,
) -> dict:
    """Проверяет Telegram initData по HMAC-SHA-256 и возвращает user dict.

    - проверяет подпись;
    - проверяет свежесть auth_date (не старше max_age_seconds);
    - достаёт пользователя из поля 'user'.
    """
    try:
        parsed_data = dict(parse_qsl(init_data, keep_blank_values=True))
        if "hash" not in parsed_data:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="В initData отсутствует hash.",
            )

        received_hash = parsed_data.pop("hash")
        sorted_items = sorted(parsed_data.items())
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted_items)

        secret_key = hmac.new(
            key=b"WebAppData",
            msg=bot_token.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).digest()

        calculated_hash = hmac.new(
            key=secret_key,
            msg=data_check_string.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(calculated_hash, received_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверная подпись Telegram initData.",
            )

        auth_date_str = parsed_data.get("auth_date")
        if auth_date_str:
            try:
                auth_date = int(auth_date_str)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Некорректный auth_date в initData.",
                )
            if time.time() - auth_date > max_age_seconds:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="initData устарела, откройте приложение заново.",
                )

        user_data_str = parsed_data.get("user")
        if not user_data_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Данные пользователя отсутствуют в initData.",
            )
        return json.loads(user_data_str)

    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — конвертируем в 401
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Ошибка проверки initData: {exc}",
        ) from exc
