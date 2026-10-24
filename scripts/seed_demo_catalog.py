"""Идемпотентный seed демонстрационного каталога MIET TV.

Запуск:
    .venv/bin/python -m scripts.seed_demo_catalog
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import text

from app.db.session import AsyncSessionFactory


CATALOG: dict[str, tuple[str, list[tuple]]] = {
    "cameras": ("Камеры", [
        ("Canon EOS C70",                  "Canon",     1, "videographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("Canon EOS 6D Mark II",           "Canon",     2, "photographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("Canon EOS 6D",                   "Canon",     2, "photographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("Canon EOS 80D",                  "Canon",     1, "photographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("Panasonic Lumix GH5",            "Panasonic", 2, "videographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("Panasonic Lumix GH5 S",          "Panasonic", 1, "videographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("GoPro Action",                   "GoPro",     1, "videographer", "Инвентаризация 2026-10, уточнить на студии"),
    ]),
    "lenses": ("Оптика", [
        ("Canon 70-200mm f/2.8",           "Canon",     2, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Canon 70-200mm f/4",             "Canon",     2, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Canon 24-70mm f/4",              "Canon",     0, "all",          "Неисправны по инвентаризации, уточнить на студии"),
        ("Tamron 24-70mm f/2.8",           "Tamron",    1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Olympus 12-40mm",                "Olympus",   2, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Laowa",                          "Laowa",     1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Samyang Fisheye",                "Samyang",   1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Переходник для объективов",      None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
    ]),
    "stabilizers": ("Стабилизация и крепления", [
        ("DJI RS 3 Pro",                   "DJI",       1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Magic Arm",                      None,        2, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Clamp (зажим)",                  None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Вакуумная присоска (Suction Cup)", None,      1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("SmallRig-обвес",                 "SmallRig",  1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Крепление для телефона",         None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Захлер (Малибу)",                None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
    ]),
    "audio": ("Звук", [
        ("DJI Mic",                        "DJI",       1, "videographer", "Инвентаризация 2026-10, уточнить на студии"),
    ]),
    "lighting": ("Свет", [
        ("Nanlite",                        "Nanlite",   4, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Aputure Amaran 200",             "Aputure",   2, "videographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("Aputure Amaran 500",             "Aputure",   1, "videographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("Spot Light (насадка)",           None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Вспышка (Пыхалка)",              None,        4, "photographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("Софтбокс 90 см",                 None,        2, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Стрипбокс",                      None,        2, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Солнце",                         None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
    ]),
    "stands": ("Стойки и коммутация", [
        ("C-Stand (Avenger)",              "Avenger",   2, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Стойка осветительная",           None,        2, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Сендбэг",                        None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Суфлёр (Телесуфлер)",            None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Видеосендер / Передатчик",       None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Blackmagic ATEM",                "Blackmagic",1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Монитор HDMI",                   None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Кабель HDMI",                    None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
    ]),
    "power": ("Питание и карты памяти", [
        ("Аккумулятор Canon LP-E6",        "Canon",     1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Аккумулятор NP-F",               None,        3, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Зарядная станция",               None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Батарейки для вспышки",          None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Карта памяти SD 128GB",          None,        6, "videographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("Карта памяти microSD 128GB",     None,        1, "videographer", "Инвентаризация 2026-10, уточнить на студии"),
        ("Карта памяти microSD 64GB",      None,        1, "videographer", "Инвентаризация 2026-10, уточнить на студии"),
    ]),
    "studio": ("Студийное и вспомогательное", [
        ("Удлинитель сетевой",             None,       10, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Сумка / кофр для оборудования",  None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Циклорама (белый фон)",          None,        1, "all",          "Инвентаризация 2026-10, уточнить на студии"),
        ("Студия",                         None,        1, "all",          "Помещение студии, инвентаризация 2026-10"),
        ("Монтажка",                       None,        1, "all",          "Помещение монтажа, инвентаризация 2026-10"),
    ]),
}


def _try_backup() -> Path | None:
    if shutil.which("pg_dump") is None:
        print("[backup] pg_dump не найден — пропускаю")
        return None
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("[backup] DATABASE_URL не задан — пропускаю")
        return None
    out = Path(f"/tmp/miet_backup_{datetime.now():%Y%m%d_%H%M%S}.sql")
    try:
        subprocess.run(
            ["pg_dump", db_url, "--data-only",
             "-t", "bookings", "-t", "equipment_items",
             "-t", "equipment_models", "-t", "categories",
             "-f", str(out)],
            check=True, capture_output=True,
        )
        print(f"[backup] сохранён: {out}")
        return out
    except Exception as exc:
        print(f"[backup] не удалось: {exc} — продолжаю")
        return None


async def seed() -> None:
    _try_backup()

    async with AsyncSessionFactory() as session:
        async with session.begin():
            deleted_bookings = (await session.execute(
                text("DELETE FROM bookings")
            )).rowcount
            deleted_items = (await session.execute(
                text("DELETE FROM equipment_items")
            )).rowcount

            await session.execute(text(
                "TRUNCATE equipment_models RESTART IDENTITY CASCADE"
            ))
            await session.execute(text(
                "TRUNCATE categories RESTART IDENTITY CASCADE"
            ))

            cat_ids: dict[str, int] = {}
            for slug, (display, _models) in CATALOG.items():
                cid = (await session.execute(
                    text(
                        "INSERT INTO categories (name, description) "
                        "VALUES (:name, :desc) RETURNING id"
                    ),
                    {"name": slug, "desc": f"[demo] {display}"},
                )).scalar_one()
                cat_ids[slug] = cid

            models_inserted = 0
            for slug, (_display, models) in CATALOG.items():
                cid = cat_ids[slug]
                for (name, manufacturer, qty, policy, note) in models:
                    await session.execute(
                        text(
                            "INSERT INTO equipment_models "
                            "(category_id, name, manufacturer, description, "
                            " access_policy, tracking_type, total_quantity) "
                            "VALUES (:cid, :name, :mfr, :desc, "
                            "        :policy, 'quantity', :qty)"
                        ),
                        {
                            "cid": cid,
                            "name": name,
                            "mfr": manufacturer,
                            "desc": f"[demo] {note}",
                            "policy": policy,
                            "qty": qty,
                        },
                    )
                    models_inserted += 1

    print("=" * 60)
    print("SEED ЗАВЕРШЁН")
    print("=" * 60)
    print(f"Удалено броней:            {deleted_bookings}")
    print(f"Удалено физ. экземпляров:  {deleted_items}")
    print(f"Категорий добавлено:       {len(CATALOG)}")
    print(f"Моделей добавлено:         {models_inserted}")
    print("id категорий (после RESTART IDENTITY):")
    for slug, cid in cat_ids.items():
        print(f"  {cid:>3}  {slug:20s}  {CATALOG[slug][0]}")


def main() -> None:
    try:
        asyncio.run(seed())
    except Exception as exc:
        print(f"ОШИБКА: {exc}", file=sys.stderr)
        print("Транзакция откачена, БД не изменена.", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
