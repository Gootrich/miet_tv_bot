// Чистые расчёты занятости (этап 3.3, v2).
//
// Ключевые правила:
//  - Занятость и блоки считаются по ПЛАНОВОМУ времени (planned_start/planned_end),
//    независимо от фактической выдачи/возврата: слот резервируется планом.
//  - В % занятости идут только confirmed. pending показывается отдельно.
//  - cancelled / completed — не отображаются и не считаются.
//  - Рабочие часы: 09:00–22:00 локальные, 13 слотов на день.
//  - Перекрытия одной модели капятся по total_quantity.

import type { BookingOut, EquipmentModelOut } from "../api/catalog";

export const WORK_HOURS_START = 9;
export const WORK_HOURS_END = 22;
export const WORK_HOURS_PER_DAY = WORK_HOURS_END - WORK_HOURS_START;

export type OccupancyLevel = 0 | 1 | 2 | 3 | 4 | 5;

export function levelFor(util: number): OccupancyLevel {
  if (!Number.isFinite(util) || util <= 0) return 0;
  if (util <= 0.25) return 1;
  if (util <= 0.5) return 2;
  if (util <= 0.75) return 3;
  if (util < 1) return 4;
  return 5;
}

export function percentLabel(util: number): string {
  if (!Number.isFinite(util) || util <= 0) return "0%";
  const pct = util * 100;
  if (pct >= 100) return "100%";
  return `${Math.round(pct)}%`;
}

export interface PlannedRange {
  startMs: number;
  endMs: number;
}

/** Плановый интервал брони. Без учёта фактической выдачи/возврата. */
export function plannedRange(b: BookingOut): PlannedRange | null {
  const s = new Date(b.planned_start).getTime();
  const e = new Date(b.planned_end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return { startMs: s, endMs: e };
}

/**
 * Учётный интервал с учётом фактической выдачи и возврата.
 * НЕ используется на текущем этапе (этап 3.3 — плановая занятость),
 * оставлен для будущих сценариев «фактическая загрузка».
 */
export function effectiveRange(b: BookingOut): PlannedRange | null {
  const base = plannedRange(b);
  if (!base) return null;
  let s = base.startMs;
  let e = base.endMs;
  if (b.actual_checkout) {
    const c = new Date(b.actual_checkout).getTime();
    if (Number.isFinite(c) && c > s && c < e) s = c;
  }
  if (b.actual_return) {
    const r = new Date(b.actual_return).getTime();
    if (Number.isFinite(r) && r > s && r < e) e = r;
  }
  if (e <= s) return null;
  return { startMs: s, endMs: e };
}

export function isConfirmed(b: BookingOut): boolean {
  return b.status === "confirmed";
}

export function isPending(b: BookingOut): boolean {
  return b.status === "pending";
}

/** Статусы, которые вообще отображаются в интерфейсе занятости. */
export function isDisplayable(b: BookingOut): boolean {
  return b.status === "confirmed" || b.status === "pending";
}

function localHourStart(d: Date, hour: number): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0).getTime();
}

export interface HourSlot {
  startMs: number;
  endMs: number;
}

export function dayHourSlots(day: Date): HourSlot[] {
  const out: HourSlot[] = [];
  for (let h = WORK_HOURS_START; h < WORK_HOURS_END; h++) {
    out.push({ startMs: localHourStart(day, h), endMs: localHourStart(day, h + 1) });
  }
  return out;
}

export interface ModelOccupancy {
  bookedHours: number;
  capacityHours: number;
  peakBooked: number;
  util: number;
}

export interface OccupancyResult {
  slots: number;
  perModel: Map<number, ModelOccupancy>;
  totalBookedHours: number;
  totalCapacityHours: number;
  totalUtil: number;
  totalPeakBooked: number;
  totalUnits: number;
}

/**
 * Занятость набора моделей за один локальный день, по плановому времени.
 * util = Σ_min(occupied_h(m), total_quantity_m) / Σ(total_quantity_m × 13).
 * В числителе и знаменателе — только confirmed.
 */
export function computeOccupancy(
  bookings: BookingOut[],
  models: EquipmentModelOut[],
  day: Date,
): OccupancyResult {
  const slots = dayHourSlots(day);
  const perModelHours = new Map<number, number[]>();
  const capByModel = new Map<number, number>();
  let totalUnits = 0;
  for (const m of models) {
    const cap = Math.max(0, m.total_quantity);
    capByModel.set(m.id, cap);
    totalUnits += cap;
    perModelHours.set(m.id, new Array(slots.length).fill(0));
  }

  for (const b of bookings) {
    if (!isConfirmed(b)) continue;
    if (b.model_id == null) continue;
    const arr = perModelHours.get(b.model_id);
    if (!arr) continue;
    const pr = plannedRange(b);
    if (!pr) continue;
    const qty = Math.max(0, b.quantity | 0);
    if (qty === 0) continue;
    for (let i = 0; i < slots.length; i++) {
      const { startMs, endMs } = slots[i];
      if (pr.startMs < endMs && pr.endMs > startMs) arr[i] += qty;
    }
  }

  const perModel = new Map<number, ModelOccupancy>();
  const totalHourly = new Array(slots.length).fill(0);
  let totalBookedHours = 0;
  let totalCapacityHours = 0;

  for (const m of models) {
    const arr = perModelHours.get(m.id);
    const cap = capByModel.get(m.id) ?? 0;
    if (!arr) continue;
    let booked = 0;
    let peak = 0;
    for (let i = 0; i < arr.length; i++) {
      const c = Math.min(arr[i], cap);
      booked += c;
      if (c > peak) peak = c;
      totalHourly[i] += c;
    }
    const capacity = cap * slots.length;
    const util = capacity > 0 ? booked / capacity : 0;
    perModel.set(m.id, { bookedHours: booked, capacityHours: capacity, peakBooked: peak, util });
    totalBookedHours += booked;
    totalCapacityHours += capacity;
  }

  let totalPeakBooked = 0;
  for (const v of totalHourly) if (v > totalPeakBooked) totalPeakBooked = v;

  const totalUtil = totalCapacityHours > 0 ? totalBookedHours / totalCapacityHours : 0;
  return {
    slots: slots.length,
    perModel,
    totalBookedHours,
    totalCapacityHours,
    totalUtil,
    totalPeakBooked,
    totalUnits,
  };
}

/** Брони, влияющие на выбранный день (planned-интервал пересекает рабочие часы). */
export function bookingsOnDay(bookings: BookingOut[], day: Date): BookingOut[] {
  const slots = dayHourSlots(day);
  if (slots.length === 0) return [];
  const dayStart = slots[0].startMs;
  const dayEnd = slots[slots.length - 1].endMs;
  const out: BookingOut[] = [];
  for (const b of bookings) {
    if (!isDisplayable(b)) continue;
    const pr = plannedRange(b);
    if (!pr) continue;
    if (pr.startMs < dayEnd && pr.endMs > dayStart) out.push(b);
  }
  out.sort((a, b) => {
    const pa = plannedRange(a);
    const pb = plannedRange(b);
    if (!pa || !pb) return 0;
    return pa.startMs - pb.startMs;
  });
  return out;
}

/** Слияние интервалов одной модели за день, по плановому времени, только confirmed. */
export function modelIntervalsOnDay(
  bookings: BookingOut[],
  modelId: number,
  day: Date,
): Array<{ startMs: number; endMs: number; qty: number; bookings: BookingOut[] }> {
  const slots = dayHourSlots(day);
  if (slots.length === 0) return [];
  const dayStart = slots[0].startMs;
  const dayEnd = slots[slots.length - 1].endMs;

  const items: Array<{ startMs: number; endMs: number; booking: BookingOut }> = [];
  for (const b of bookings) {
    if (!isConfirmed(b)) continue;
    if (b.model_id !== modelId) continue;
    const pr = plannedRange(b);
    if (!pr) continue;
    const s = Math.max(pr.startMs, dayStart);
    const e = Math.min(pr.endMs, dayEnd);
    if (e <= s) continue;
    items.push({ startMs: s, endMs: e, booking: b });
  }
  if (items.length === 0) return [];
  items.sort((a, b) => a.startMs - b.startMs);

  const out: Array<{ startMs: number; endMs: number; qty: number; bookings: BookingOut[] }> = [];
  let cur: { startMs: number; endMs: number; qty: number; bookings: BookingOut[] } | null = null;
  for (const it of items) {
    if (!cur || it.startMs > cur.endMs) {
      if (cur) out.push(cur);
      cur = {
        startMs: it.startMs,
        endMs: it.endMs,
        qty: Math.max(0, it.booking.quantity | 0),
        bookings: [it.booking],
      };
    } else {
      cur.endMs = Math.max(cur.endMs, it.endMs);
      cur.qty += Math.max(0, it.booking.quantity | 0);
      cur.bookings.push(it.booking);
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function formatTimeRange(startMs: number, endMs: number): string {
  const s = new Date(startMs);
  const e = new Date(endMs);
  const hh = (d: Date) => String(d.getHours()).padStart(2, "0");
  const mm = (d: Date) => String(d.getMinutes()).padStart(2, "0");
  return `${hh(s)}:${mm(s)}–${hh(e)}:${mm(e)}`;
}

/** Группировка по group_id; одиночные — как группы из одного элемента. */
export function groupBookings(bookings: BookingOut[]): BookingOut[][] {
  const map = new Map<number, BookingOut[]>();
  const singles: BookingOut[] = [];
  for (const b of bookings) {
    if (b.group_id != null) {
      const arr = map.get(b.group_id) ?? [];
      arr.push(b);
      map.set(b.group_id, arr);
    } else {
      singles.push(b);
    }
  }
  const groups: BookingOut[][] = [...map.values()];
  for (const s of singles) groups.push([s]);
  groups.sort((a, b) => {
    const pa = plannedRange(a[0]);
    const pb = plannedRange(b[0]);
    if (!pa || !pb) return 0;
    return pa.startMs - pb.startMs;
  });
  return groups;
}
