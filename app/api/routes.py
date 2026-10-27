"""HTTP-маршруты API: каталог, брони, пользователи, админка."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_user,
    get_optional_approved_user,
    require_admin,
    require_any_registration_manager,
    require_users_admin,
)
from app.api.schemas import (
    ApproveUserRequest,
    BlockUserRequest,
    BookingGroupOut,
    BookingHistoryOut,
    BookingItemIn,
    BookingMoveRequest,
    BookingOut,
    BookingRequest,
    BookingReturnPartialRequest,
    CategoryAdminOut,
    CategoryCreateRequest,
    CategoryUpdateRequest,
    CategoryWithModelsOut,
    ItemAdminOut,
    ItemCreateRequest,
    ItemUpdateRequest,
    ModelAdminOut,
    ModelCreateRequest,
    ModelUpdateRequest,
    AssignRoleRequest,
    RoleOut,
    EquipmentModelDetailOut,
    EquipmentModelDetailPublicOut,
    HealthOut,
    RegistrationRequestOut,
    RejectRequestPayload,
    RejectUserRequest,
    UserOut,
)
from app.db.session import check_database_connection, get_session
from app.models.user import User
from app.services import booking as booking_service
from app.services import catalog as catalog_service
from app.services import admin_equipment as admin_eq
from app.services import registrations as registrations_service
from app.services import users as users_service


router = APIRouter(prefix="/api", tags=["api"])


# --- Health ---

@router.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    try:
        db_ok = await check_database_connection()
    except Exception:  # noqa: BLE001
        db_ok = False
    if not db_ok:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="database unavailable",
        )
    return HealthOut(status="ok", database="ok")


# --- Catalog (public) ---

@router.get("/catalog", response_model=list[CategoryWithModelsOut])
async def get_catalog(session: AsyncSession = Depends(get_session)):
    return await catalog_service.list_categories_with_models(session)


@router.get(
    "/catalog/models/{model_id}",
    response_model=Annotated[
        EquipmentModelDetailPublicOut | EquipmentModelDetailOut,
        Field(discriminator="view"),
    ],
)
async def get_model(
    model_id: int,
    optional_user: User | None = Depends(get_optional_approved_user),
    session: AsyncSession = Depends(get_session),
):
    model = await catalog_service.get_model_with_items(session, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="model not found")
    if optional_user is not None:
        return EquipmentModelDetailOut.model_validate(model)
    return EquipmentModelDetailPublicOut.model_validate(model)


# --- Me ---

@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.from_orm_user(current_user)


# --- Bookings ---

@router.post("/bookings", response_model=list[BookingOut])
async def create_booking_endpoint(
    payload: BookingRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Создаёт бронь: либо одиночную (model_id/item_id), либо пакетную (items[]).

    Всегда возвращает список BookingOut — унификация (одиночная = группа из 1).
    """
    if payload.items:
        created = await booking_service.create_bookings_batch(
            session=session,
            user=current_user,
            items=[(it.model_id, it.quantity) for it in payload.items],
            planned_start=payload.planned_start,
            planned_end=payload.planned_end,
            comment=payload.comment,
        )
    else:
        single = await booking_service.create_booking(
            session=session,
            user=current_user,
            planned_start=payload.planned_start,
            planned_end=payload.planned_end,
            item_id=payload.item_id,
            model_id=payload.model_id,
            quantity=payload.quantity,
            comment=payload.comment,
        )
        created = [single]

    # Перечитываем через get_bookings для selectinload relationships
    ids = {b.id for b in created}
    detailed = await booking_service.get_bookings(
        session=session,
        user_id=current_user.id,
        is_admin=True,
        include_cancelled=True,
        limit=100,
    )
    by_id = {b.id: b for b in detailed if b.id in ids}
    return [
        BookingOut.from_orm_booking(by_id.get(b.id, b))
        for b in sorted(created, key=lambda x: x.id)
    ]


@router.post("/bookings/{booking_id}/add", response_model=BookingOut)
async def add_to_booking_endpoint(
    booking_id: int,
    payload: BookingItemIn,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    b = await booking_service.add_to_booking(
        session=session,
        booking_id=booking_id,
        user=current_user,
        model_id=payload.model_id,
        quantity=payload.quantity,
    )
    detailed = await booking_service.get_bookings(
        session=session,
        user_id=current_user.id,
        is_admin=True,
        include_cancelled=True,
        limit=100,
    )
    found = next((x for x in detailed if x.id == b.id), None)
    return BookingOut.from_orm_booking(found or b)


@router.post(
    "/bookings/group/{group_id}/return-all",
    response_model=list[BookingOut],
)
async def return_all_in_group_endpoint(
    group_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    returned = await booking_service.return_all_in_group(
        session=session,
        group_id=group_id,
        user=current_user,
    )
    if not returned:
        return []
    ids = {b.id for b in returned}
    detailed = await booking_service.get_bookings(
        session=session,
        user_id=current_user.id,
        is_admin=True,
        include_cancelled=True,
        limit=100,
    )
    by_id = {b.id: b for b in detailed if b.id in ids}
    return [BookingOut.from_orm_booking(by_id.get(b.id, b)) for b in returned]


@router.post(
    "/bookings/group/{group_id}/return-partial",
    response_model=list[BookingOut],
)
async def return_partial_in_group_endpoint(
    group_id: int,
    payload: BookingReturnPartialRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    returned = await booking_service.return_partial_in_group(
        session=session,
        group_id=group_id,
        user=current_user,
        booking_ids=payload.booking_ids,
    )
    if not returned:
        return []
    ids = {b.id for b in returned}
    detailed = await booking_service.get_bookings(
        session=session,
        user_id=current_user.id,
        is_admin=True,
        include_cancelled=True,
        limit=100,
    )
    by_id = {b.id: b for b in detailed if b.id in ids}
    return [BookingOut.from_orm_booking(by_id.get(b.id, b)) for b in returned]


@router.get("/bookings", response_model=list[BookingOut])
async def get_bookings_endpoint(
    status_filter: str | None = None,
    include_cancelled: bool = False,
    filter_user_id: int | None = None,
    model_id: int | None = None,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
    scope: str = "all",
    club: str | None = None,
    before_id: int | None = None,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Все брони всех пользователей (Этап 2: «все видят все»).

    Фильтры: status_filter, include_cancelled, filter_user_id, model_id,
    from_dt/to_dt, scope (all|mine), club (photographer|videographer),
    before_id/limit (пагинация по id DESC, дефолт 20).
    """
    bookings = await booking_service.get_bookings(
        session=session,
        user_id=current_user.id,
        is_admin=current_user.is_admin,
        status_filter=status_filter,
        include_cancelled=include_cancelled,
        filter_user_id=filter_user_id,
        model_id=model_id,
        from_dt=from_dt,
        to_dt=to_dt,
        scope=scope,
        club=club,
        before_id=before_id,
        limit=limit,
    )
    return [BookingOut.from_orm_booking(b) for b in bookings]


@router.post("/bookings/{booking_id}/checkout", response_model=BookingOut)
async def checkout_booking_endpoint(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    booking = await booking_service.checkout_booking(
        session=session,
        booking_id=booking_id,
        user_id=current_user.id,
        is_admin=current_user.is_admin,
    )
    # Перечитываем через get_bookings, чтобы подгрузить relationships
    # для from_orm_booking (user/model/category/item).
    detailed = await booking_service.get_bookings(
        session=session,
        user_id=current_user.id,
        is_admin=True,          # внутренний read без фильтров
        include_cancelled=True,
    )
    found = next((b for b in detailed if b.id == booking.id), None)
    return BookingOut.from_orm_booking(found or booking)


@router.post("/bookings/{booking_id}/return", response_model=BookingOut)
async def return_booking_endpoint(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    booking = await booking_service.return_booking(
        session=session,
        booking_id=booking_id,
        user_id=current_user.id,
        is_admin=current_user.is_admin,
    )
    detailed = await booking_service.get_bookings(
        session=session,
        user_id=current_user.id,
        is_admin=True,
        include_cancelled=True,
    )
    found = next((b for b in detailed if b.id == booking.id), None)
    return BookingOut.from_orm_booking(found or booking)


@router.post("/bookings/{booking_id}/cancel", response_model=BookingOut)
async def cancel_booking_endpoint(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    booking = await booking_service.cancel_booking(
        session=session,
        booking_id=booking_id,
        user=current_user,
        is_admin=current_user.is_admin,
    )
    detailed = await booking_service.get_bookings(
        session=session,
        user_id=current_user.id,
        is_admin=True,
        include_cancelled=True,
    )
    found = next((b for b in detailed if b.id == booking.id), None)
    return BookingOut.from_orm_booking(found or booking)


@router.patch("/bookings/{booking_id}", response_model=BookingOut)
async def move_booking_endpoint(
    booking_id: int,
    payload: BookingMoveRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    booking = await booking_service.move_booking(
        session=session,
        booking_id=booking_id,
        user=current_user,
        new_start=payload.planned_start,
        new_end=payload.planned_end,
    )
    detailed = await booking_service.get_bookings(
        session=session,
        user_id=current_user.id,
        is_admin=True,
        include_cancelled=True,
    )
    found = next((b for b in detailed if b.id == booking.id), None)
    return BookingOut.from_orm_booking(found or booking)


@router.get(
    "/bookings/history/all",
    response_model=list[BookingHistoryOut],
)
async def get_all_booking_history_endpoint(
    event_type: str | None = None,
    scope: str = "all",
    club: str | None = None,
    before_id: int | None = None,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """Лента событий по всем броням (таб «История»).

    scope: all|mine (mine — по моим броням, как владелец).
    club: photographer|videographer.
    before_id/limit: пагинация по id DESC (дефолт 20).
    """
    from app.services.booking_history import list_all_history

    try:
        events = await list_all_history(
            session,
            event_type=event_type,
            scope=scope,
            club=club,
            user_id=current_user.id,
            before_id=before_id,
            limit=limit,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return [BookingHistoryOut.model_validate(e) for e in events]


@router.get(
    "/bookings/{booking_id}/history",
    response_model=list[BookingHistoryOut],
)
async def get_booking_history_endpoint(
    booking_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    from app.services.booking_history import list_history

    # Права: владелец или админ.
    booking = await session.get(
        booking_service.Booking, booking_id
    )
    if booking is None:
        raise HTTPException(404, "Бронирование не найдено.")
    if not current_user.is_admin and booking.user_id != current_user.id:
        raise HTTPException(403, "Нет доступа к истории этой брони.")

    events = await list_history(session, booking_id=booking_id)
    return [BookingHistoryOut.model_validate(e) for e in events]


# --- Admin: users ---

@router.get("/admin/users", response_model=list[UserOut])
async def admin_list_users(
    admin: User = Depends(require_users_admin),
    session: AsyncSession = Depends(get_session),
):
    users = await users_service.list_all_users(session)
    return [UserOut.from_orm_user(u) for u in users]


@router.get("/admin/users/pending", response_model=list[UserOut])
async def admin_list_pending(
    admin: User = Depends(require_users_admin),
    session: AsyncSession = Depends(get_session),
):
    users = await users_service.list_pending_users(session)
    return [UserOut.from_orm_user(u) for u in users]


@router.post("/admin/users/{user_id}/approve", response_model=UserOut)
async def admin_approve(
    user_id: int,
    payload: ApproveUserRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    """Legacy-эндпоинт: одобряет ВСЕ pending-заявки пользователя по указанным клубам.

    Для нового клиента используйте /admin/registration-requests/{id}/approve.
    """
    try:
        # Если role_codes пуст — одобряем все pending-заявки пользователя.
        pending = await registrations_service.list_pending_for_user(session, user_id)
        targets: list[int] = []
        if payload.role_codes:
            wanted = {r for r in payload.role_codes if r in registrations_service.VALID_CLUBS}
            targets = [r.id for r in pending if r.club_code in wanted]
        else:
            targets = [r.id for r in pending]

        for rid in targets:
            await registrations_service.approve_request(
                session, request_id=rid, approver_id=admin.id,
            )

        # Fallback: если pending-заявок не было, но роли в payload — назначим напрямую.
        if not targets and payload.role_codes:
            await users_service.approve_user(
                session,
                user_id=user_id,
                role_codes=payload.role_codes,
                approver_id=admin.id,
            )

        user = await users_service.reload_with_roles(session, user_id)
        if user is None:
            raise ValueError("Пользователь не найден.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return UserOut.from_orm_user(user)


@router.post("/admin/users/{user_id}/reject", response_model=UserOut)
async def admin_reject(
    user_id: int,
    payload: RejectUserRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        user = await users_service.reject_user(
            session,
            user_id=user_id,
            reason=payload.reason,
            approver_id=admin.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await session.commit()
    return UserOut.from_orm_user(user)


@router.post("/admin/users/{user_id}/block", response_model=UserOut)
async def admin_block(
    user_id: int,
    payload: BlockUserRequest,
    admin: User = Depends(require_users_admin),
    session: AsyncSession = Depends(get_session),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Нельзя заблокировать себя.")
    try:
        user = await users_service.block_user(
            session,
            user_id=user_id,
            hours=payload.hours,
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await session.commit()
    return UserOut.from_orm_user(user)


@router.post("/admin/users/{user_id}/unblock", response_model=UserOut)
async def admin_unblock(
    user_id: int,
    admin: User = Depends(require_users_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        user = await users_service.unblock_user(session, user_id=user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await session.commit()
    return UserOut.from_orm_user(user)


# --- Admin: registration requests ---

def _allowed_registration_clubs(user: User) -> set[str]:
    """Клубы, заявки которых пользователь имеет право видеть/модерировать."""
    if user.has_scope("admin:super"):
        return {"photographer", "videographer"}
    allowed: set[str] = set()
    if user.has_scope("admin:registrations:photographer"):
        allowed.add("photographer")
    if user.has_scope("admin:registrations:videographer"):
        allowed.add("videographer")
    return allowed


def _ensure_can_manage_club(user: User, club_code: str) -> None:
    if user.has_scope("admin:super"):
        return
    if not user.has_scope(f"admin:registrations:{club_code}"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Нет прав на заявки клуба {club_code}.",
        )


@router.get("/admin/registration-requests", response_model=list[RegistrationRequestOut])
async def admin_list_requests(
    club: str | None = None,
    status: str | None = None,
    admin: User = Depends(require_any_registration_manager),
    session: AsyncSession = Depends(get_session),
):
    """Список заявок, доступных текущему модератору.

    Если у пользователя scope только на один клуб, автоматически
    фильтруем. Параметр club может дополнительно сузить выборку.
    """
    from sqlalchemy import select as _select
    from app.models.user import RegistrationRequest

    allowed = _allowed_registration_clubs(admin)
    if not allowed:
        raise HTTPException(status_code=403, detail="Нет прав на заявки.")

    if club:
        if club not in allowed:
            raise HTTPException(status_code=403, detail=f"Нет прав на заявки клуба {club}.")
        clubs = {club}
    else:
        clubs = allowed

    stmt = (
        _select(RegistrationRequest)
        .where(RegistrationRequest.club_code.in_(clubs))
        .order_by(RegistrationRequest.created_at.desc())
    )
    if status:
        stmt = stmt.where(RegistrationRequest.status == status)
    result = await session.execute(stmt)
    return list(result.scalars().all())


@router.post(
    "/admin/registration-requests/{request_id}/approve",
    response_model=RegistrationRequestOut,
)
async def admin_approve_request(
    request_id: int,
    admin: User = Depends(require_any_registration_manager),
    session: AsyncSession = Depends(get_session),
):
    from app.models.user import RegistrationRequest
    req = await session.get(RegistrationRequest, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена.")
    _ensure_can_manage_club(admin, req.club_code)
    try:
        req = await registrations_service.approve_request(
            session, request_id=request_id, approver_id=admin.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return req


@router.post(
    "/admin/registration-requests/{request_id}/reject",
    response_model=RegistrationRequestOut,
)
async def admin_reject_request(
    request_id: int,
    payload: RejectRequestPayload,
    admin: User = Depends(require_any_registration_manager),
    session: AsyncSession = Depends(get_session),
):
    from app.models.user import RegistrationRequest
    req = await session.get(RegistrationRequest, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена.")
    _ensure_can_manage_club(admin, req.club_code)
    try:
        req = await registrations_service.reject_request(
            session, request_id=request_id,
            approver_id=admin.id, reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return req


# ============================================================
# Admin: roles (assign/remove)
# ============================================================

@router.get("/admin/roles", response_model=list[RoleOut])
async def admin_list_roles(
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    roles = await admin_eq.list_roles(session)
    return [RoleOut.model_validate(r) for r in roles]


@router.post("/admin/users/{user_id}/roles", response_model=UserOut)
async def admin_assign_role(
    user_id: int,
    payload: AssignRoleRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        await admin_eq.assign_role_to_user(session, user_id, payload.role_code)
        user = await users_service.reload_with_roles(session, user_id)
        if user is None:
            raise ValueError("Пользователь не найден.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return UserOut.from_orm_user(user)


@router.delete("/admin/users/{user_id}/roles/{role_code}", response_model=UserOut)
async def admin_remove_role(
    user_id: int,
    role_code: str,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        await admin_eq.remove_role_from_user(
            session, user_id, role_code, actor_id=admin.id,
        )
        user = await users_service.reload_with_roles(session, user_id)
        if user is None:
            raise ValueError("Пользователь не найден.")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return UserOut.from_orm_user(user)


# ============================================================
# Admin: categories
# ============================================================

@router.get("/admin/equipment/categories", response_model=list[CategoryAdminOut])
async def admin_list_categories(
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    cats = await admin_eq.list_categories(session)
    return cats


@router.post("/admin/equipment/categories", response_model=CategoryAdminOut)
async def admin_create_category(
    payload: CategoryCreateRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        cat = await admin_eq.create_category(
            session, code=payload.code, name=payload.name,
            description=payload.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return cat


@router.patch("/admin/equipment/categories/{cat_id}", response_model=CategoryAdminOut)
async def admin_update_category(
    cat_id: int,
    payload: CategoryUpdateRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        cat = await admin_eq.update_category(
            session, cat_id, name=payload.name, description=payload.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return cat


@router.delete("/admin/equipment/categories/{cat_id}")
async def admin_delete_category(
    cat_id: int,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        await admin_eq.delete_category(session, cat_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return {"status": "deleted", "id": cat_id}


# ============================================================
# Admin: models
# ============================================================

@router.get("/admin/equipment/models", response_model=list[ModelAdminOut])
async def admin_list_models(
    category_id: int | None = None,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    return await admin_eq.list_models(session, category_id=category_id)


@router.post("/admin/equipment/models", response_model=ModelAdminOut)
async def admin_create_model(
    payload: ModelCreateRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        m = await admin_eq.create_model(
            session,
            category_id=payload.category_id, name=payload.name,
            manufacturer=payload.manufacturer, description=payload.description,
            access_policy=payload.access_policy,
            tracking_type=payload.tracking_type,
            total_quantity=payload.total_quantity,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return m


@router.patch("/admin/equipment/models/{model_id}", response_model=ModelAdminOut)
async def admin_update_model(
    model_id: int,
    payload: ModelUpdateRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        m = await admin_eq.update_model(
            session, model_id,
            **{k: v for k, v in payload.model_dump().items() if v is not None},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return m


@router.delete("/admin/equipment/models/{model_id}")
async def admin_delete_model(
    model_id: int,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        await admin_eq.delete_model(session, model_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return {"status": "deleted", "id": model_id}


# ============================================================
# Admin: items
# ============================================================

@router.get("/admin/equipment/items", response_model=list[ItemAdminOut])
async def admin_list_items(
    model_id: int | None = None,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    return await admin_eq.list_items(session, model_id=model_id)


@router.post("/admin/equipment/items", response_model=ItemAdminOut)
async def admin_create_item(
    payload: ItemCreateRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        it = await admin_eq.create_item(
            session,
            model_id=payload.model_id,
            inventory_number=payload.inventory_number,
            serial_number=payload.serial_number,
            status_=payload.status,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return it


@router.patch("/admin/equipment/items/{item_id}", response_model=ItemAdminOut)
async def admin_update_item(
    item_id: int,
    payload: ItemUpdateRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        it = await admin_eq.update_item(
            session, item_id,
            **{k: v for k, v in payload.model_dump().items() if v is not None},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return it


@router.delete("/admin/equipment/items/{item_id}")
async def admin_delete_item(
    item_id: int,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    try:
        await admin_eq.delete_item(session, item_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await session.commit()
    return {"status": "deleted", "id": item_id}
