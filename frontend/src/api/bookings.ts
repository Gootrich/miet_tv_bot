// Клиент к /api/bookings: список (все), отмена, перенос, история.
// Переиспользует fetchJsonWithAuth из catalog.ts (прокидывает
// x-telegram-init-data и работает с dev-режимом через существующую
// инфраструктуру auth-helper).

import {
  fetchJsonWithAuth,
  type BookingHistoryOut,
  type BookingOut,
} from "./catalog";

export interface FetchBookingsParams {
  status?: string;                       // csv: "pending,confirmed"
  includeCancelled?: boolean;
  filterUserId?: number;
  modelId?: number;
  fromDt?: string;                       // ISO
  toDt?: string;                         // ISO
  scope?: "all" | "mine";
  club?: "photographer" | "videographer";
  beforeId?: number;                     // курсор: id < beforeId
  limit?: number;                        // дефолт бэкенда — 20
}

export function fetchBookings(
  params: FetchBookingsParams = {},
): Promise<BookingOut[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status_filter", params.status);
  if (params.includeCancelled) qs.set("include_cancelled", "true");
  if (params.filterUserId != null) qs.set("filter_user_id", String(params.filterUserId));
  if (params.modelId != null) qs.set("model_id", String(params.modelId));
  if (params.fromDt) qs.set("from_dt", params.fromDt);
  if (params.toDt) qs.set("to_dt", params.toDt);
  if (params.scope && params.scope !== "all") qs.set("scope", params.scope);
  if (params.club) qs.set("club", params.club);
  if (params.beforeId != null) qs.set("before_id", String(params.beforeId));
  if (params.limit != null) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return fetchJsonWithAuth<BookingOut[]>(`/bookings${q ? `?${q}` : ""}`);
}

export function cancelBooking(id: number): Promise<BookingOut> {
  return fetchJsonWithAuth<BookingOut>(`/bookings/${id}/cancel`, {
    method: "POST",
  });
}

export function moveBooking(
  id: number,
  plannedStart: string,
  plannedEnd: string,
): Promise<BookingOut> {
  return fetchJsonWithAuth<BookingOut>(`/bookings/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ planned_start: plannedStart, planned_end: plannedEnd }),
  });
}

export function fetchBookingHistory(id: number): Promise<BookingHistoryOut[]> {
  return fetchJsonWithAuth<BookingHistoryOut[]>(`/bookings/${id}/history`);
}

export interface FetchAllHistoryParams {
  eventType?: string;           // csv: "created,moved"
  scope?: "all" | "mine";
  club?: "photographer" | "videographer";
  beforeId?: number;            // курсор: id < beforeId
  limit?: number;               // дефолт бэкенда — 20
}

export function fetchAllHistory(
  params: FetchAllHistoryParams = {},
): Promise<BookingHistoryOut[]> {
  const qs = new URLSearchParams();
  if (params.eventType) qs.set("event_type", params.eventType);
  if (params.scope && params.scope !== "all") qs.set("scope", params.scope);
  if (params.club) qs.set("club", params.club);
  if (params.beforeId != null) qs.set("before_id", String(params.beforeId));
  if (params.limit != null) qs.set("limit", String(params.limit));
  const q = qs.toString();
  return fetchJsonWithAuth<BookingHistoryOut[]>(
    `/bookings/history/all${q ? `?${q}` : ""}`,
  );
}

// ============================================================
// Этап 2+ (D): пакетная модель
// ============================================================

export interface BookingBatchItem {
  model_id: number;
  quantity: number;
}

export interface CreateBatchBookingPayload {
  items: BookingBatchItem[];
  planned_start: string; // ISO
  planned_end: string;   // ISO
  comment?: string | null;
}

/**
 * Создать пакетную бронь. Возвращает список созданных BookingOut
 * (все с одним group_id). Одиночная = список из 1 — сервер
 * унифицирует, но для одиночной удобнее createBooking (он делает
 * то же самое: POST /bookings с model_id).
 */
export function createBatchBooking(
  payload: CreateBatchBookingPayload,
): Promise<BookingOut[]> {
  return fetchJsonWithAuth<BookingOut[]>("/bookings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Добавить модель к существующей брони (в тот же group_id).
 * Только владелец, только pending/confirmed, без actual_checkout.
 */
export function addToBooking(
  bookingId: number,
  item: BookingBatchItem,
): Promise<BookingOut> {
  return fetchJsonWithAuth<BookingOut>(`/bookings/${bookingId}/add`, {
    method: "POST",
    body: JSON.stringify(item),
  });
}

/** «Вернуть всё»: возвращает все выданные (confirmed) брони группы. */
export function returnAllInGroup(groupId: number): Promise<BookingOut[]> {
  return fetchJsonWithAuth<BookingOut[]>(
    `/bookings/group/${groupId}/return-all`,
    { method: "POST" },
  );
}

/** «Вернуть частично»: возвращает только указанные брони группы. */
export function returnPartialInGroup(
  groupId: number,
  bookingIds: number[],
): Promise<BookingOut[]> {
  return fetchJsonWithAuth<BookingOut[]>(
    `/bookings/group/${groupId}/return-partial`,
    {
      method: "POST",
      body: JSON.stringify({ booking_ids: bookingIds }),
    },
  );
}
