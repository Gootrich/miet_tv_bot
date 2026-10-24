import hashlib
import hmac
import json
from urllib.parse import parse_qsl
from fastapi import HTTPException, status


def verify_telegram_init_data(init_data: str, bot_token: str) -> dict:
    """Проверяет Telegram initData по алгоритму HMAC-SHA-256."""
    try:
        parsed_data = dict(parse_qsl(init_data, keep_blank_values=True))
        if "hash" not in parsed_data:
            raise ValueError("Hash is missing")

        received_hash = parsed_data.pop("hash")
        
        # Сортируем оставшиеся ключи
        sorted_items = sorted(parsed_data.items())
        data_check_string = "\n".join([f"{k}={v}" for k, v in sorted_items])

        # Секретный ключ генерируется из WebAppData и токена бота
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

        # Парсим пользователя из JSON
        user_data_str = parsed_data.get("user")
        if not user_data_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Данные пользователя отсутствуют в initData.",
            )

        return json.loads(user_data_str)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Ошибка проверки initData: {str(e)}",
        )
