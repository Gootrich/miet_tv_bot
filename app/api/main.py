"""Точка входа FastAPI-приложения.

Запускается отдельной командой uvicorn и не затрагивает запуск
Telegram-бота (app/main.py).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.routes import router as catalog_router
from app.db.session import close_database_connection
from app.services.model_images import MEDIA_DIR, MODELS_DIR


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Корректно закрывает пул соединений при остановке API."""
    try:
        yield
    finally:
        await close_database_connection()


app = FastAPI(
    title="Media Club Booking API",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(catalog_router)

MODELS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/api/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")
