// Недельный режим этапа 3.3, v3.
//  - брони отображаются по плановому времени (независимо от выдачи/возврата)
//  - cancelled / completed не показываются, pending — отдельным слоем
//  - приоритет сортировки: категории studio/montage выше, затем по времени
//  - клик по левой колонке (label) или по блоку (block) — открывает детали
//  - в плитках дней только цвет и число (без %)
//  - горизонтальный таймлайн без прокрутки, M3-совместимые размеры

import { useEffect, useMemo, useState } from "react";
import type { BookingOut, EquipmentModelOut } from "../api/catalog";
import { addDays, weekdayShort } from "../utils/date";
import {
  WORK_HOURS_START,
  WORK_HOURS_PER_DAY,
  bookingsOnDay,
  computeOccupancy,
  formatTimeRange,
  groupBookings,
  isDisplayable,
  levelFor,
  plannedRange,
} from "../utils/occupancy";

interface Props {
  weekStart: Date;
  models: EquipmentModelOut[];
  bookings: BookingOut[];
  selectedDay: Date;
  onSelectDay: (d: Date) => void;
  /** Карта modelId → category.code для приоритезации строк. */
  categoryCodeByModelId: Map<number, string>;
}

const MAJOR_HOURS = new Set([9, 12, 15, 18, 21]);
const PRIORITY_CODES = new Set(["studio", "montage", "studio_rental", "montage_room"]);
const PRIORITY_NAME_RE = /(студи|монтаж)/i;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function localDayStartMs(day: Date): number {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    WORK_HOURS_START,
    0,
    0,
    0,
  ).getTime();
}
function pctOfTime(ms: number, dayStartMs: number): number {
  return ((ms - dayStartMs) / 3_600_000 / WORK_HOURS_PER_DAY) * 100;
}

function groupUser(g: BookingOut[]): string {
  return g[0].user_name ?? `Пользователь ${g[0].user_id}`;
}

function groupModelsLabel(g: BookingOut[]): string {
  const map = new Map<string, number>();
  for (const b of g) {
    const name = b.model_name ?? (b.model_id ? `Модель ${b.model_id}` : "Позиция");
    map.set(name, (map.get(name) ?? 0) + (b.quantity | 0));
  }
  return [...map.entries()]
    .map(([n, q]) => (q === 1 ? n : `${q}×${n}`))
    .join(", ");
}

function groupPriority(
  g: BookingOut[],
  categoryCodeByModelId: Map<number, string>,
): number {
  for (const b of g) {
    if (b.model_id != null) {
      const code = categoryCodeByModelId.get(b.model_id);
      if (code && PRIORITY_CODES.has(code)) return 0;
    }
    if (b.category_name && PRIORITY_NAME_RE.test(b.category_name)) return 0;
  }
  return 1;
}

interface TimelineRow {
  key: string;
  user: string;
  models: string;
  startMs: number;
  endMs: number;
  bookings: BookingOut[];
  hasPending: boolean;
  priority: number;
}

function buildRows(
  bookings: BookingOut[],
  day: Date,
  categoryCodeByModelId: Map<number, string>,
): TimelineRow[] {
  const dayStart = localDayStartMs(day);
  const dayEnd = dayStart + WORK_HOURS_PER_DAY * 3_600_000;
  const displayable = bookings.filter(isDisplayable);
  const groups = groupBookings(bookingsOnDay(displayable, day));
  const out: TimelineRow[] = [];
  for (const g of groups) {
    let s = Infinity;
    let e = -Infinity;
    for (const b of g) {
      const pr = plannedRange(b);
      if (!pr) continue;
      const cs = Math.max(pr.startMs, dayStart);
      const ce = Math.min(pr.endMs, dayEnd);
      if (ce <= cs) continue;
      if (cs < s) s = cs;
      if (ce > e) e = ce;
    }
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    out.push({
      key: g[0].group_id != null ? `g${g[0].group_id}` : `s${g[0].id}`,
      user: groupUser(g),
      models: groupModelsLabel(g),
      startMs: s,
      endMs: e,
      bookings: g,
      hasPending: g.some((b) => b.status === "pending"),
      priority: groupPriority(g, categoryCodeByModelId),
    });
  }
  out.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.startMs - b.startMs;
  });
  return out;
}

export function OccupancyWeekGrid({
  weekStart,
  models,
  bookings,
  selectedDay,
  onSelectDay,
  categoryCodeByModelId,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const perDayUtil = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of days) {
      const occ = computeOccupancy(bookings, models, d);
      map.set(dayKey(d), occ.totalUtil);
    }
    return map;
  }, [days, bookings, models]);

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const rows = useMemo(
    () => buildRows(bookings, selectedDay, categoryCodeByModelId),
    [bookings, selectedDay, categoryCodeByModelId],
  );
  const dayStartMs = useMemo(() => localDayStartMs(selectedDay), [selectedDay]);
  const dayEndMs = dayStartMs + WORK_HOURS_PER_DAY * 3_600_000;

  const hours = useMemo(
    () => Array.from({ length: WORK_HOURS_PER_DAY }, (_, i) => WORK_HOURS_START + i),
    [],
  );

  const isToday = sameDay(selectedDay, today);
  const nowVisible = isToday && nowMs >= dayStartMs && nowMs <= dayEndMs;
  const nowPct = nowVisible ? pctOfTime(nowMs, dayStartMs) : -1;

  const expandedRow = expandedKey ? rows.find((r) => r.key === expandedKey) : null;

  const toggle = (key: string) => {
    setExpandedKey((cur) => (cur === key ? null : key));
  };

  return (
    <div className="occ-week">
      <div className="occ-week__days" role="tablist" aria-label="Дни недели">
        {days.map((d) => {
          const util = perDayUtil.get(dayKey(d)) ?? 0;
          const lv = levelFor(util);
          const dToday = sameDay(d, today);
          const dSelected = sameDay(d, selectedDay);
          const cls = [
            "occ-week__day",
            `occ-week__day--l${lv}`,
            dToday ? "is-today" : "",
            dSelected ? "is-selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={dayKey(d)}
              type="button"
              role="tab"
              aria-selected={dSelected}
              className={cls}
              onClick={() => onSelectDay(d)}
              aria-label={`${weekdayShort(d)}, ${d.getDate()}`}
            >
              <span className="occ-week__day-wd">{weekdayShort(d)}</span>
              <span className="occ-week__day-num">{d.getDate()}</span>
              <span className="occ-week__day-dot" data-l={lv} style={{ "--l": lv } as React.CSSProperties} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <div className="occ-week__body">
        <div className="occ-week__labels">
          <div className="occ-week__axis-spacer" aria-hidden="true" />
          {rows.map((row) => {
            const isOpen = expandedKey === row.key;
            return (
              <button
                key={row.key}
                type="button"
                className={`occ-week__label${isOpen ? " is-open" : ""}${row.hasPending ? " is-pending" : ""}`}
                onClick={() => toggle(row.key)}
                aria-expanded={isOpen}
                aria-label={`${row.user}, ${formatTimeRange(row.startMs, row.endMs)}`}
              >
                <span className="occ-week__label-user">{row.user}</span>
                <span className="occ-week__label-models" title={row.models}>
                  {formatTimeRange(row.startMs, row.endMs)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="occ-week__timeline">
          <div className="occ-week__axis" aria-hidden="true">
            {hours.map((h) => {
              const pct = ((h - WORK_HOURS_START) / WORK_HOURS_PER_DAY) * 100;
              return (
                <div
                  key={`h-${h}`}
                  className={`occ-week__axis-hour${MAJOR_HOURS.has(h) ? " is-major" : ""}`}
                  style={{ left: `${pct}%` }}
                >
                  <span className="occ-week__axis-label">
                    {String(h).padStart(2, "0")}
                  </span>
                </div>
              );
            })}
          </div>

          {rows.length === 0 && (
            <div className="occ-week__empty">Нет активных броней</div>
          )}

          {rows.map((row) => {
            const isOpen = expandedKey === row.key;
            const left = pctOfTime(row.startMs, dayStartMs);
            const width = pctOfTime(row.endMs, dayStartMs) - left;
            return (
              <div key={row.key} className={`occ-week__lane${isOpen ? " is-open" : ""}`}>
                {hours.map((h) => {
                  const pct = ((h - WORK_HOURS_START) / WORK_HOURS_PER_DAY) * 100;
                  return (
                    <span
                      key={`g-${row.key}-${h}`}
                      className={`occ-week__gridline${MAJOR_HOURS.has(h) ? " is-major" : ""}`}
                      style={{ left: `${pct}%` }}
                      aria-hidden="true"
                    />
                  );
                })}
                <button
                  type="button"
                  className={`occ-week__block${row.hasPending ? " is-pending" : ""}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  onClick={() => toggle(row.key)}
                  aria-expanded={isOpen}
                  aria-label={`${row.user}, ${formatTimeRange(row.startMs, row.endMs)}, ${row.models}`}
                >
                  {width > 22 && (
                    <span className="occ-week__block-time">
                      {formatTimeRange(row.startMs, row.endMs)}
                    </span>
                  )}
                </button>
                {nowVisible && (
                  <div
                    className="occ-week__now"
                    style={{ left: `${nowPct}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {expandedRow && (
        <div className="occ-week__detail">
          <div className="occ-week__detail-head">
            <span className="occ-week__detail-user">{expandedRow.user}</span>
            <span className="occ-week__detail-time">
              {formatTimeRange(expandedRow.startMs, expandedRow.endMs)}
            </span>
            <button
              type="button"
              className="occ-week__detail-close"
              onClick={() => setExpandedKey(null)}
              aria-label="Закрыть подробности"
            >
              ×
            </button>
          </div>
          <ul className="occ-week__detail-list">
            {expandedRow.bookings.map((b) => (
              <li key={b.id} className="occ-week__detail-item">
                <span className="occ-week__detail-model">
                  {b.model_name ?? `Модель ${b.model_id}`}
                </span>
                {b.item_inventory_number && (
                  <span className="occ-week__detail-inv">
                    №{b.item_inventory_number}
                  </span>
                )}
                {b.quantity > 1 && (
                  <span className="occ-week__detail-qty">× {b.quantity}</span>
                )}
                {b.status === "pending" && (
                  <span className="occ-week__detail-pending">ожидает</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
