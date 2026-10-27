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
from sqlalchemy import Column, MetaData, Table
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.api import routes as routes_module
from app.api.deps import get_optional_approved_user
from app.api.main import app
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.models import Category, EquipmentItem, EquipmentModel


def _build_test_metadata() -> MetaData:
    """Схема для SQLite.

    Обычные таблицы копируются через to_metadata. Для bookings строим
    таблицу из тех же колонок, но без констрейнтов: CHECK
    planned_time_step_15min использует Postgres-only
    EXTRACT(... AT TIME ZONE 'UTC'), который SQLite не понимает.
    Остальные CHECK/UNIQUE/FK для read-only запросов каталога не нужны,
    но колонки полностью совпадают с ORM-маппингом Booking.
    """
    md = MetaData()
    for name in (
        "users",
        "categories",
        "equipment_models",
        "equipment_items",
    ):
        Base.metadata.tables[name].to_metadata(md)

    src = Base.metadata.tables["bookings"]
    Table(
        "bookings",
        md,
        *[
            Column(
                col.name,
                col.type,
                nullable=col.nullable,
                primary_key=col.primary_key,
            )
            for col in src.columns
        ],
    )
    return md


@pytest_asyncio.fixture
async def session_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """In-memory SQLite со схемой каталога и тестовыми данными."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        future=True,
    )
    md = _build_test_metadata()
    async with engine.begin() as conn:
        await conn.run_sync(md.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as session:
        cat_cameras = Category(
            code="cameras", name="Камеры", description="Камеры и объективы",
        )
        cat_light = Category(
            code="light", name="Свет", description="Освещение",
        )
        session.add_all([cat_cameras, cat_light])
        await session.flush()

        sony = EquipmentModel(
            category_id=cat_cameras.id,
            name="Sony A7 III",
            manufacturer="Sony",
            description="Full-frame беззеркальная камера",
            access_policy="all",
            total_quantity=2,
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
            total_quantity=1,
        )
        ghost = EquipmentModel(
            category_id=cat_light.id,
            name="Ghost Light",
            manufacturer="Ghost",
            access_policy="all",
            total_quantity=1,
        )
        session.add_all([sony, canon, godox, ghost])
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
                EquipmentItem(
                    model_id=ghost.id,
                    inventory_number="GHOST-001",
                    status="retired",
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

    # Публичные эндпоинты не должны автоматически логинить анонима
    # через dev-mode: иначе анонимный доступ невозможно проверить.
    monkeypatch.setattr(settings, "allow_dev_mode", False)

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


async def test_model_detail_anonymous_public_view(client: AsyncClient) -> None:
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
    assert data["view"] == "public"
    assert len(data["items"]) == 2
    for item in data["items"]:
        assert "inventory_number" not in item
        assert "serial_number" not in item
        assert "notes" not in item
        assert "id" in item
        assert item["status"] in ("active", "maintenance", "retired")


async def test_model_detail_404(client: AsyncClient) -> None:
    response = await client.get("/api/catalog/models/999999")
    assert response.status_code == 404
    assert response.json()["detail"] == "model not found"


async def test_model_detail_approved_user_admin_view(
    client: AsyncClient,
) -> None:
    """Одобренный участник получает полный набор полей экземпляра."""

    async def override_optional_user():
        # Роут проверяет только "не None"; значения полей не важны.
        return object()

    app.dependency_overrides[get_optional_approved_user] = override_optional_user
    try:
        catalog_resp = await client.get("/api/catalog")
        sony_id = next(
            m["id"]
            for c in catalog_resp.json()
            for m in c["models"]
            if m["name"] == "Sony A7 III"
        )
        response = await client.get(f"/api/catalog/models/{sony_id}")
    finally:
        app.dependency_overrides.pop(get_optional_approved_user, None)

    assert response.status_code == 200
    data = response.json()
    assert data["view"] == "admin"
    inventory = sorted(i["inventory_number"] for i in data["items"])
    assert inventory == ["SONY-001", "SONY-002"]


async def test_optional_user_dependency_returns_none_for_anonymous(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        result = await get_optional_approved_user(
            x_telegram_init_data=None,
            x_dev_user=None,
            session=session,
        )
    assert result is None


async def test_create_booking_anonymous_401(client: AsyncClient) -> None:
    response = await client.post(
        "/api/bookings",
        json={
            "model_id": 1,
            "quantity": 1,
            "planned_start": "2030-01-01T00:00:00Z",
            "planned_end": "2030-01-02T00:00:00Z",
        },
    )
    assert response.status_code == 401


async def test_catalog_availability_excludes_maintenance(
    client: AsyncClient,
) -> None:
    """H-4: SONY-001 active, SONY-002 maintenance — только 1 доступен."""
    resp = await client.get("/api/catalog")
    data = resp.json()
    sony = next(
        m for c in data for m in c["models"] if m["name"] == "Sony A7 III"
    )
    assert sony["available_now"] == 1
    assert sony["total_quantity"] == 2


async def test_catalog_availability_all_retired(client: AsyncClient) -> None:
    """H-4: Ghost Light — единственный экземпляр retired, 0 доступно."""
    resp = await client.get("/api/catalog")
    data = resp.json()
    ghost = next(
        m for c in data for m in c["models"] if m["name"] == "Ghost Light"
    )
    assert ghost["available_now"] == 0
