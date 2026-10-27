"""Unit-тесты бизнес-логики регистрации (без Telegram).

Postgres не нужен: in-memory SQLite + override компилятора JSONB.

Ограничения:
- get_or_create_user не тестируется (pg_insert + xmax — PG-only),
  пользователь создаётся напрямую через ORM.
- RegistrationRequest.id задаётся явно (BigInteger PK не autoincrement
  на SQLite).
- with_for_update() на SQLite диалектом игнорируется: гонка двух админов
  здесь не воспроизводится, только повторный approve/reject.
"""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models.user import RegistrationRequest, Role, User, UserRole
from app.services import registrations as reg
from app.services import users as users_svc


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(element, compiler, **kw):  # noqa: ARG001
    return "JSON"


TABLES = [
    Base.metadata.tables["users"],
    Base.metadata.tables["roles"],
    Base.metadata.tables["user_roles"],
    Base.metadata.tables["registration_requests"],
]


# SQLite не autoincrement-ит BigInteger PK. Аналог Postgres BIGSERIAL
# для тестов: назначаем id на before_flush, если ORM его не задал.
# Session.before_flush как overridable-метод в SQLAlchemy 2 не работает —
# нужен event.listens_for на базовом Session.
@event.listens_for(Session, "before_flush")
def _auto_id_for_registration_requests(session, flush_context, instances):  # noqa: ARG001
    for obj in session.new:
        if isinstance(obj, RegistrationRequest) and obj.id is None:
            _rid_counter["n"] += 1
            obj.id = _rid_counter["n"]


@pytest.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


_rid_counter = {"n": 0}


async def _mk_user(session, tg_id=100, status="pending", full_name="Test User", **kw):
    user = User(
        telegram_id=tg_id,
        full_name=full_name,
        status=status,
        is_active=(status == "active"),
        **kw,
    )
    session.add(user)
    await session.flush()
    return user


async def _mk_role(session, code="photographer", scopes=None):
    role = Role(code=code, name=code, scopes=scopes or [])
    session.add(role)
    await session.flush()
    return role


async def _mk_request(session, user, club="photographer", status="pending"):
    _rid_counter["n"] += 1
    req = RegistrationRequest(
        id=_rid_counter["n"],
        user_id=user.id,
        club_code=club,
        status=status,
    )
    session.add(req)
    await session.flush()
    return req


# ---------------- sync_requests ----------------

async def test_sync_creates_new_requests(db_session):
    user = await _mk_user(db_session)
    created = await reg.sync_requests(db_session, user.id, {"photographer", "videographer"})
    assert {r.club_code for r in created} == {"photographer", "videographer"}
    assert all(r.status == "pending" for r in created)


async def test_sync_idempotent_returns_empty_on_repeat(db_session):
    user = await _mk_user(db_session)
    await reg.sync_requests(db_session, user.id, {"photographer"})
    again = await reg.sync_requests(db_session, user.id, {"photographer"})
    assert again == []
    pending = await reg.list_pending_for_user(db_session, user.id)
    assert len(pending) == 1


async def test_sync_switches_clubs(db_session):
    user = await _mk_user(db_session)
    await reg.sync_requests(db_session, user.id, {"photographer"})
    new = await reg.sync_requests(db_session, user.id, {"videographer"})
    assert {r.club_code for r in new} == {"videographer"}
    all_reqs = await reg.list_all_for_user(db_session, user.id)
    by_club = {r.club_code: r for r in all_reqs}
    assert by_club["photographer"].status == "cancelled"
    assert by_club["videographer"].status == "pending"


async def test_sync_ignores_invalid_clubs(db_session):
    user = await _mk_user(db_session)
    created = await reg.sync_requests(db_session, user.id, {"invalid", "photographer"})
    assert {r.club_code for r in created} == {"photographer"}


# ---------------- recompute_user_status ----------------

async def test_recompute_pending(db_session):
    user = await _mk_user(db_session)
    await _mk_request(db_session, user, status="pending")
    updated = await reg.recompute_user_status(db_session, user.id)
    assert updated.status == "pending"
    assert updated.is_active is False


async def test_recompute_active(db_session):
    user = await _mk_user(db_session)
    await _mk_request(db_session, user, status="approved")
    updated = await reg.recompute_user_status(db_session, user.id)
    assert updated.status == "active"
    assert updated.is_active is True


async def test_recompute_rejected(db_session):
    user = await _mk_user(db_session)
    await _mk_request(db_session, user, status="rejected")
    updated = await reg.recompute_user_status(db_session, user.id)
    assert updated.status == "rejected"
    assert updated.is_active is False


async def test_recompute_no_requests_sets_pending(db_session):
    user = await _mk_user(db_session, status="blocked")
    # blocked приоритетнее — не снимается
    same = await reg.recompute_user_status(db_session, user.id)
    assert same.status == "blocked"

    user2 = await _mk_user(db_session, tg_id=101, status="rejected")
    updated = await reg.recompute_user_status(db_session, user2.id)
    assert updated.status == "pending"


async def test_recompute_blocked_not_cleared_by_approved(db_session):
    user = await _mk_user(db_session, status="blocked", block_reason="test")
    await _mk_request(db_session, user, status="approved")
    updated = await reg.recompute_user_status(db_session, user.id)
    assert updated.status == "blocked"
    assert updated.is_active is False


# ---------------- approve_request ----------------

async def test_approve_pending_assigns_role_and_activates(db_session):
    user = await _mk_user(db_session)
    req = await _mk_request(db_session, user, club="photographer")
    approved = await reg.approve_request(db_session, req.id, approver_id=None)
    assert approved.status == "approved"
    assert approved.decided_at is not None
    fresh = await users_svc.reload_with_roles(db_session, user.id)
    assert fresh.status == "active"
    assert fresh.has_role("photographer")


async def test_approve_twice_raises(db_session):
    user = await _mk_user(db_session)
    req = await _mk_request(db_session, user)
    await reg.approve_request(db_session, req.id, approver_id=None)
    with pytest.raises(ValueError, match="уже в статусе"):
        await reg.approve_request(db_session, req.id, approver_id=None)


async def test_approve_missing_request_raises(db_session):
    with pytest.raises(ValueError, match="не найдена"):
        await reg.approve_request(db_session, 999999, approver_id=None)


async def test_approve_blocked_user_stays_blocked(db_session):
    user = await _mk_user(db_session, status="blocked", block_reason="test")
    req = await _mk_request(db_session, user)
    approved = await reg.approve_request(db_session, req.id, approver_id=None)
    assert approved.status == "approved"
    fresh = await users_svc.reload_with_roles(db_session, user.id)
    assert fresh.status == "blocked"


# ---------------- reject_request ----------------

async def test_reject_pending_sets_reason_and_status(db_session):
    user = await _mk_user(db_session)
    req = await _mk_request(db_session, user)
    rejected = await reg.reject_request(
        db_session, req.id, approver_id=None, reason="не подходит",
    )
    assert rejected.status == "rejected"
    assert rejected.decision_reason == "не подходит"
    fresh = await users_svc.reload_with_roles(db_session, user.id)
    assert fresh.status == "rejected"


async def test_reject_twice_raises(db_session):
    user = await _mk_user(db_session)
    req = await _mk_request(db_session, user)
    await reg.reject_request(db_session, req.id, approver_id=None)
    with pytest.raises(ValueError, match="уже в статусе"):
        await reg.reject_request(db_session, req.id, approver_id=None)


# ---------------- block / unblock ----------------

async def test_block_indefinite(db_session):
    user = await _mk_user(db_session, status="active")
    blocked = await users_svc.block_user(db_session, user.id, hours=None, reason="r")
    assert blocked.status == "blocked"
    assert blocked.blocked_until is None
    assert blocked.block_reason == "r"


async def test_block_temporary_sets_deadline(db_session):
    user = await _mk_user(db_session, status="active")
    before = datetime.now(timezone.utc)
    blocked = await users_svc.block_user(db_session, user.id, hours=24, reason="r")
    assert blocked.status == "blocked"
    assert blocked.blocked_until is not None
    delta = blocked.blocked_until - before
    assert timedelta(hours=23) < delta < timedelta(hours=25)


async def test_unblock_with_approved_request(db_session):
    user = await _mk_user(db_session, status="blocked")
    await _mk_request(db_session, user, status="approved")
    unblocked = await users_svc.unblock_user(db_session, user.id)
    assert unblocked.status == "active"
    assert unblocked.block_reason is None
    assert unblocked.blocked_until is None


async def test_unblock_with_pending_request(db_session):
    user = await _mk_user(db_session, status="blocked")
    await _mk_request(db_session, user, status="pending")
    unblocked = await users_svc.unblock_user(db_session, user.id)
    assert unblocked.status == "pending"
    assert unblocked.is_active is False


async def test_unblock_without_requests(db_session):
    user = await _mk_user(db_session, status="blocked")
    unblocked = await users_svc.unblock_user(db_session, user.id)
    assert unblocked.status == "pending"
    assert unblocked.is_active is False


# ---------------- ensure_admin_bootstrap ----------------

async def test_ensure_admin_bootstrap_blocked_stays_blocked(db_session, monkeypatch):
    user = await _mk_user(db_session, tg_id=42, status="blocked")

    class FakeSettings:
        admin_ids = {42}

    monkeypatch.setattr("app.core.config.settings", FakeSettings())
    result = await users_svc.ensure_admin_bootstrap(db_session, user)
    assert result.status == "blocked"


async def test_ensure_admin_bootstrap_non_admin_noop(db_session, monkeypatch):
    user = await _mk_user(db_session, tg_id=100, status="pending")

    class FakeSettings:
        admin_ids = {42}

    monkeypatch.setattr("app.core.config.settings", FakeSettings())
    result = await users_svc.ensure_admin_bootstrap(db_session, user)
    assert result.status == "pending"


async def test_ensure_admin_bootstrap_promotes(db_session, monkeypatch):
    user = await _mk_user(db_session, tg_id=42, status="pending")

    class FakeSettings:
        admin_ids = {42}

    monkeypatch.setattr("app.core.config.settings", FakeSettings())
    result = await users_svc.ensure_admin_bootstrap(db_session, user)
    assert result.status == "active"
    assert result.has_role("admin")
