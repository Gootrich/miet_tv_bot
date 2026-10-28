"""Хранение изображений моделей оборудования (файловая система).

В БД хранится только имя файла (equipment_models.image_filename).
Имя на диске генерируется сервером, пользовательское имя не используется.
"""
import os
import uuid
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.equipment import EquipmentModel

MAX_IMAGE_BYTES = 2 * 1024 * 1024
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", "data/uploads"))
MODELS_DIR = MEDIA_DIR / "models"


class ImageError(ValueError):
    """Ошибка валидации или хранения изображения."""


def detect_extension(data: bytes) -> str:
    """Определяет формат по сигнатуре содержимого, а не по расширению."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise ImageError("Допустимые форматы: JPEG, PNG, WebP.")


def validate_image(data: bytes) -> str:
    if not data:
        raise ImageError("Файл пустой.")
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageError("Файл больше 2 МБ.")
    return detect_extension(data)


def save_image(data: bytes) -> str:
    """Проверяет и атомарно записывает файл, возвращает серверное имя."""
    ext = validate_image(data)
    filename = f"{uuid.uuid4().hex}.{ext}"
    try:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        tmp = MODELS_DIR / f".{filename}.tmp"
        tmp.write_bytes(data)
        os.replace(tmp, MODELS_DIR / filename)
    except OSError as exc:
        raise ImageError("Не удалось сохранить файл.") from exc
    return filename


async def delete_file_if_unused(
    session: AsyncSession, filename: str | None, exclude_model_id: int,
) -> None:
    """Удаляет файл с диска, только если на него не ссылается другая модель."""
    if not filename or filename != Path(filename).name:
        return
    used = await session.scalar(
        select(func.count())
        .select_from(EquipmentModel)
        .where(
            EquipmentModel.image_filename == filename,
            EquipmentModel.id != exclude_model_id,
        )
    )
    if used:
        return
    try:
        (MODELS_DIR / filename).unlink(missing_ok=True)
    except OSError:
        pass
