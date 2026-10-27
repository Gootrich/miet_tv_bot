"""Простое in-memory ограничение частоты событий по telegram_id.

MVP: для одного процесса бота. При горизонтальном масштабировании
потребуется внешнее хранилище (Redis). Счётчики живут в памяти
и не сохраняются между перезапусками — это осознанное решение.
"""
import time
from collections import deque
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject


_MAX_USERS = 5000  # защита от роста словаря в долгой работе


class SimpleThrottlingMiddleware(BaseMiddleware):
    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._events: dict[int, deque[float]] = {}

    def _prune(self) -> None:
        if len(self._events) <= _MAX_USERS:
            return
        for k in [k for k, v in self._events.items() if not v]:
            del self._events[k]

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = data.get("event_from_user")
        if user is None:
            return await handler(event, data)

        now = time.monotonic()
        bucket = self._events.setdefault(user.id, deque())
        while bucket and now - bucket[0] > self.window:
            bucket.popleft()

        if len(bucket) >= self.limit:
            if isinstance(event, CallbackQuery):
                await event.answer("Слишком часто. Подождите пару секунд.")
            elif isinstance(event, Message):
                await event.answer("Слишком часто. Подождите пару секунд.")
            return None

        bucket.append(now)
        self._prune()
        return await handler(event, data)
