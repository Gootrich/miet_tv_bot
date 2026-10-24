"""Тесты read-only API каталога.

Используют in-memory SQLite (aiosqlite) с ручным наполнением и
override-зависимость get_session. Реальный Postgres не требуется.

Создаём только таблицы каталога (categories / equipment_models /
equipment_items), потому что CHECK-констрейнты bookings написаны
под PostgreSQL (EXTRACT(... AT TIME ZONE 'UTC')) и SQLite их не
понимает. Каталог-API эти таблицы не использует.
"""

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.api import routes as routes_module
from app.api.main import app
from app.db.base import Base
from app.db.session import get_session
from app.models import Category, EquipmentItem, EquipmentModel


CATALOG_TABLES = [
    Base.metadata.tables["categories"],
    Base.metadata.tables["equipment_models"],
    Base.metadata.tables["equipment_items"],
]


@pytest_asyncio.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """In-memory SQLite со схемой каталога и тестовыми данными."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        future=True,
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: Base.metadata.create_all(
                sync_conn, tables=CATALOG_TABLES
            )
        )

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as session:
        cat_cameras = Category(name="Камеры", description="Камеры и объективы")
        cat_light = Category(name="Свет", description="Освещение")
        session.add_all([cat_cameras, cat_light])
        await session.flush()

        sony = EquipmentModel(
            category_id=cat_cameras.id,
            name="Sony A7 III",
            manufacturer="Sony",
            description="Full-frame беззеркальная камера",
            access_policy="all",
        )
        canon = EquipmentModel(
            category_id=cat_cameras.id,
            name="Canon EOS R6",
            manufacturer="Canon",
            access_policy="photographer",
        )
        godox = EquipmentModel(
            category_id=cat_light.id,
            name="Godox SL-60W",
            manufacturer="Godox",
            access_policy="all",
        )
        session.add_all([sony, canon, godox])
        await session.flush()

        session.add_all(
            [
                EquipmentItem(
                    model_id=sony.id,
                    inventory_number="SONY-001",
                    status="active",
                ),
                EquipmentItem(
                    model_id=sony.id,
                    inventory_number="SONY-002",
                    status="maintenance",
                ),
                EquipmentItem(
                    model_id=godox.id,
                    inventory_number="GODOX-001",
                    status="active",
                ),
            ]
        )
        await session.commit()

    try:
        yield factory
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def client(
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[AsyncClient]:
    """HTTP-клиент с подменённой сессией и стабильным health."""

    async def override_get_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    async def fake_check_database() -> bool:
        return True

    app.dependency_overrides[get_session] = override_get_session
    monkeypatch.setattr(
        routes_module, "check_database_connection", fake_check_database
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


async def test_health_ok(client: AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


async def test_health_db_down(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_check_database() -> bool:
        return False

    monkeypatch.setattr(
        routes_module, "check_database_connection", fake_check_database
    )

    response = await client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["detail"] == "database unavailable"


async def test_catalog_returns_categories_with_models(
    client: AsyncClient,
) -> None:
    response = await client.get("/api/catalog")
    assert response.status_code == 200
    data = response.json()

    names = [c["name"] for c in data]
    assert names == ["Камеры", "Свет"]

    cameras = next(c for c in data if c["name"] == "Камеры")
    model_names = [m["name"] for m in cameras["models"]]
    assert model_names == ["Canon EOS R6", "Sony A7 III"]

    sony = next(m for m in cameras["models"] if m["name"] == "Sony A7 III")
    assert sony["access_policy"] == "all"
    assert "items" not in sony


async def test_model_detail_includes_items(client: AsyncClient) -> None:
    catalog_resp = await client.get("/api/catalog")
    sony_id = next(
        m["id"]
        for c in catalog_resp.json()
        for m in c["models"]
        if m["name"] == "Sony A7 III"
    )

    response = await client.get(f"/api/catalog/models/{sony_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Sony A7 III"
    assert data["access_policy"] == "all"
    inventory = sorted(i["inventory_number"] for i in data["items"])
    assert inventory == ["SONY-001", "SONY-002"]


async def test_model_detail_404(client: AsyncClient) -> None:
    response = await client.get("/api/catalog/models/999999")
    assert response.status_code == 404
    assert response.json()["detail"] == "model not found"
