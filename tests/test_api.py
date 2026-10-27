"""Тесты read-only API каталога.

Используют in-memory SQLite (aiosqlite) с ручным наполнением и
override-зависимость get_session. Реальный Postgres не требуется.

Создаём только таблицы каталога (categories / equipment_models /
equipment_items), потому что CHECK-констрейнты bookings написаны
под PostgreSQL (EXTRACT(... AT TIME ZONE 'UTC')) и SQLite их не
понимает. Каталог-API эти таблицы не использует.
"""

from collections.abc import AsyncIterator
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from fastapi import HTTPException as FastAPIHTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Column, MetaData, Table, select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.api import routes as routes_module
from app.api.deps import get_optional_approved_user
from app.api.main import app
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_session
from app.models import Category, EquipmentItem, EquipmentModel
from app.models.booking import Booking
from app.models.booking_history import BookingHistory
from app.models.user import User
from app.services import booking as booking_service


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
        # roles/user_roles нужны, потому что User.roles настроен на
        # автоподгрузку при session.get(User, ...): без этих таблиц
        # SQLAlchemy падает на `no such table: user_roles`.
        "roles",
        "user_roles",
        "categories",
        "equipment_models",
        "equipment_items",
        "booking_history",
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
                # Сохраняем server_default: created_at в модели имеет
                # server_default=func.now(); без него SQLite не позволит
                # INSERT (NOT NULL без дефолта).
                server_default=col.server_default,
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



# ============================================================
# Этап 3: атомарность групповых операций (H-6, H-8, Q3)
# ============================================================

@pytest_asyncio.fixture
async def booking_session_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[dict]:
    """Изолированная SQLite StaticPool с User + группой из 3 confirmed броней.

    Подменяет app.services.booking.AsyncSessionFactory на эту фабрику:
    сервис возврата/отмены открывает свою транзакцию, и должна попадать
    в тот же in-memory engine.
    """
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    md = _build_test_metadata()
    async with engine.begin() as conn:
        await conn.run_sync(md.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as session:
        user = User(
            telegram_id=900001,
            full_name="Test User",
            username="test_user",
            status="active",
            is_active=True,
        )
        session.add(user)
        await session.flush()

        cat = Category(code="test", name="Test", description=None)
        session.add(cat)
        await session.flush()

        model = EquipmentModel(
            category_id=cat.id,
            name="Test Model",
            access_policy="all",
            tracking_type="quantity",
            total_quantity=10,
        )
        session.add(model)
        await session.flush()

        start = datetime(2030, 1, 1, 0, 0, tzinfo=timezone.utc)
        end = datetime(2030, 1, 2, 0, 0, tzinfo=timezone.utc)
        created = []
        for _ in range(3):
            b = Booking(
                user_id=user.id,
                model_id=model.id,
                quantity=1,
                planned_start=start,
                planned_end=end,
                status="confirmed",
                actual_checkout=datetime.now(timezone.utc),
            )
            session.add(b)
            created.append(b)
        await session.flush()
        group_id = created[0].id
        for b in created:
            b.group_id = group_id
        await session.commit()

        user_id = user.id
        booking_ids = [b.id for b in created]

    # booking.py импортирует AsyncSessionFactory внутри функции
    # (`from app.db.session import AsyncSessionFactory`), поэтому
    # подменять надо источник — app.db.session, а не app.services.booking.
    monkeypatch.setattr(
        "app.db.session.AsyncSessionFactory", factory,
    )

    try:
        yield {
            "factory": factory,
            "user_id": user_id,
            "group_id": group_id,
            "booking_ids": booking_ids,
        }
    finally:
        await engine.dispose()


async def test_return_all_in_group_returns_all(
    booking_session_factory: dict,
) -> None:
    ctx = booking_session_factory
    factory = ctx["factory"]

    async with factory() as session:
        user = await session.get(User, ctx["user_id"])
        returned = await booking_service.return_all_in_group(
            session, ctx["group_id"], user,
        )
        assert len(returned) == 3
        assert {b.id for b in returned} == set(ctx["booking_ids"])

    async with factory() as check:
        for bid in ctx["booking_ids"]:
            b = await check.get(Booking, bid)
            assert b.status == "completed"
            assert b.actual_return is not None
        events = (
            await check.execute(
                select(BookingHistory).where(
                    BookingHistory.event_type == "return",
                    BookingHistory.booking_id.in_(ctx["booking_ids"]),
                )
            )
        ).scalars().all()
        assert len(events) == 3


async def test_return_all_in_group_atomic_on_error(
    booking_session_factory: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """H-6: сбой record_event на середине откатывает всю группу."""
    ctx = booking_session_factory
    factory = ctx["factory"]

    call_count = {"n": 0}
    original = booking_service.record_event

    async def failing_record(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("simulated mid-batch failure")
        return await original(*args, **kwargs)

    monkeypatch.setattr(booking_service, "record_event", failing_record)

    async with factory() as session:
        user = await session.get(User, ctx["user_id"])
        with pytest.raises(RuntimeError):
            await booking_service.return_all_in_group(
                session, ctx["group_id"], user,
            )

    async with factory() as check:
        for bid in ctx["booking_ids"]:
            b = await check.get(Booking, bid)
            assert b.status == "confirmed"
            assert b.actual_return is None
        events = (
            await check.execute(
                select(BookingHistory).where(
                    BookingHistory.event_type == "return",
                )
            )
        ).scalars().all()
        assert events == []


async def test_return_partial_in_group_idempotent(
    booking_session_factory: dict,
) -> None:
    """Q1-c2: уже completed пропускается без ошибки."""
    ctx = booking_session_factory
    factory = ctx["factory"]

    async with factory() as session:
        b = await session.get(Booking, ctx["booking_ids"][0])
        b.status = "completed"
        b.actual_return = datetime.now(timezone.utc)
        await session.commit()

    async with factory() as session:
        user = await session.get(User, ctx["user_id"])
        returned = await booking_service.return_partial_in_group(
            session, ctx["group_id"], user, ctx["booking_ids"],
        )
        assert len(returned) == 2
        assert ctx["booking_ids"][0] not in {b.id for b in returned}

    async with factory() as check:
        for bid in ctx["booking_ids"]:
            b = await check.get(Booking, bid)
            assert b.status == "completed"


async def test_return_partial_in_group_invalid_400(
    booking_session_factory: dict,
) -> None:
    """Q1-c2: pending в запросе → 400, откат всей группы."""
    ctx = booking_session_factory
    factory = ctx["factory"]

    async with factory() as session:
        b = await session.get(Booking, ctx["booking_ids"][0])
        b.status = "pending"
        b.actual_checkout = None
        await session.commit()

    async with factory() as session:
        user = await session.get(User, ctx["user_id"])
        with pytest.raises(FastAPIHTTPException) as exc_info:
            await booking_service.return_partial_in_group(
                session, ctx["group_id"], user, ctx["booking_ids"],
            )
        assert exc_info.value.status_code == 400

    async with factory() as check:
        for bid in ctx["booking_ids"][1:]:
            b = await check.get(Booking, bid)
            assert b.status == "confirmed"
            assert b.actual_return is None


async def test_cancel_group_returns_all(
    booking_session_factory: dict,
) -> None:
    """Q3: cancel_group атомарно отменяет все pending/confirmed.

    Выданную бронь владелец отменить не может (только админ), поэтому
    фикстуру с checkout обнуляем: сценарий — брони подтверждены, но
    ещё не выданы, пользователь отменяет всю группу.
    """
    ctx = booking_session_factory
    factory = ctx["factory"]

    async with factory() as session:
        for bid in ctx["booking_ids"]:
            b = await session.get(Booking, bid)
            b.actual_checkout = None
            b.status = "confirmed"
        await session.commit()

    async with factory() as session:
        user = await session.get(User, ctx["user_id"])
        cancelled = await booking_service.cancel_group(
            session, ctx["group_id"], user,
        )
        assert len(cancelled) == 3

    async with factory() as check:
        for bid in ctx["booking_ids"]:
            b = await check.get(Booking, bid)
            assert b.status == "cancelled"
        events = (
            await check.execute(
                select(BookingHistory).where(
                    BookingHistory.event_type == "cancelled",
                    BookingHistory.booking_id.in_(ctx["booking_ids"]),
                )
            )
        ).scalars().all()
        assert len(events) == 3


async def test_cancel_group_empty_noop(
    booking_session_factory: dict,
) -> None:
    """Q2-c: cancel на уже завершённой группе → []."""
    ctx = booking_session_factory
    factory = ctx["factory"]

    async with factory() as session:
        for bid in ctx["booking_ids"]:
            b = await session.get(Booking, bid)
            b.status = "completed"
            b.actual_return = datetime.now(timezone.utc)
        await session.commit()

    async with factory() as session:
        user = await session.get(User, ctx["user_id"])
        cancelled = await booking_service.cancel_group(
            session, ctx["group_id"], user,
        )
        assert cancelled == []


async def test_mutation_returns_full_detail_for_old_booking(
    booking_session_factory: dict,
) -> None:
    """M-4/M-9: cancel старой брони возвращает model_name/user_name.

    Регрессия: раньше ответ строился из get_bookings(limit=20/100),
    старая бронь не попадала в выборку → model_name=None, user_name=None.
    Здесь создаём 200 шумовых броней, мутируем самую старую по id.
    """
    ctx = booking_session_factory
    factory = ctx["factory"]

    async with factory() as session:
        for bid in ctx["booking_ids"]:
            b = await session.get(Booking, bid)
            b.actual_checkout = None
        await session.commit()

    async with factory() as session:
        for _ in range(200):
            session.add(Booking(
                user_id=ctx["user_id"], model_id=1, quantity=1,
                planned_start=datetime(2030, 6, 1, tzinfo=timezone.utc),
                planned_end=datetime(2030, 6, 2, tzinfo=timezone.utc),
                status="pending",
            ))
        await session.commit()

    oldest_id = min(ctx["booking_ids"])
    async with factory() as session:
        user = await session.get(User, ctx["user_id"])
        cancelled = await booking_service.cancel_booking(
            session, oldest_id, user, is_admin=False,
        )
        detailed = await booking_service.get_booking_by_id(
            session, cancelled.id,
        )
        assert detailed is not None
        assert detailed.user is not None
        assert detailed.user.full_name == "Test User"
        assert detailed.model is not None
        assert detailed.model.name == "Test Model"


async def test_cancel_group_not_owner(
    booking_session_factory: dict,
) -> None:
    """Q3: чужой пользователь получает 404/403."""
    ctx = booking_session_factory
    factory = ctx["factory"]

    async with factory() as session:
        other = User(
            telegram_id=900002,
            full_name="Other",
            username="other",
            status="active",
            is_active=True,
        )
        session.add(other)
        await session.commit()
        other_id = other.id

    async with factory() as session:
        other = await session.get(User, other_id)
        with pytest.raises(FastAPIHTTPException) as exc_info:
            await booking_service.cancel_group(
                session, ctx["group_id"], other,
            )
        assert exc_info.value.status_code in (403, 404)


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
