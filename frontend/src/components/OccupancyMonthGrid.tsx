// Месячная сетка: 7×6, компактная индикация занятости в каждой ячейке.
// Занятость = computeOccupancy(...totalUtil) на локальный день с учётом only confirmed.

import { useMemo } from "react";
import type { BookingOut, EquipmentModelOut } from "../api/catalog";
import { computeOccupancy, levelFor, percentLabel } from "../utils/occupancy";

interface Props {
  monthStart: Date;
  models: EquipmentModelOut[];
  bookings: BookingOut[];
  selectedDay: Date;
  onSelectDay: (d: Date) => void;
}

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function addDaysLocal(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function OccupancyMonthGrid({
  monthStart,
  models,
  bookings,
  selectedDay,
  onSelectDay,
}: Props) {
  const cells = useMemo(() => {
    const first = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
    const firstWeekday = (first.getDay() + 6) % 7; // Пн=0
    const gridStart = addDaysLocal(first, -firstWeekday);
    const out: Array<{ day: Date; inMonth: boolean }> = [];
    for (let i = 0; i < 42; i++) {
      const d = addDaysLocal(gridStart, i);
      out.push({ day: d, inMonth: d.getMonth() === monthStart.getMonth() });
    }
    return out;
  }, [monthStart]);

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const monthLabel = `${MONTH_NAMES[monthStart.getMonth()]} ${monthStart.getFullYear()}`;

  const occupancyByDay = useMemo(() => {
    const map = new Map<string, { util: number; level: number }>();
    for (const { day, inMonth } of cells) {
      if (!inMonth) continue;
      const occ = computeOccupancy(bookings, models, day);
      map.set(dayKey(day), { util: occ.totalUtil, level: levelFor(occ.totalUtil) });
    }
    return map;
  }, [cells, bookings, models]);

  return (
    <section className="occ-month" aria-label={monthLabel}>
      <div className="occ-month__head" aria-hidden="true">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="occ-month__weekday">
            {w}
          </span>
        ))}
      </div>
      <div className="occ-month__grid">
        {cells.map(({ day, inMonth }) => {
          const info = occupancyByDay.get(dayKey(day)) ?? { util: 0, level: 0 };
          const isToday = sameDay(day, today);
          const isSelected = sameDay(day, selectedDay);
          const cls = [
            "occ-month__cell",
            inMonth ? "" : "is-out",
            `occ-month__cell--l${info.level}`,
            isToday ? "is-today" : "",
            isSelected ? "is-selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={dayKey(day)}
              type="button"
              className={cls}
              onClick={() => onSelectDay(day)}
              aria-label={`${day.getDate()}, занятость ${percentLabel(info.util)}`}
              aria-pressed={isSelected}
            >
              <span className="occ-month__cell-num">{day.getDate()}</span>
              <span className="occ-month__bar" aria-hidden="true">
                <span
                  className={`occ-month__bar-fill occ-month__bar-fill--l${info.level}`}
                  style={{ width: `${Math.min(100, Math.round(info.util * 100))}%` }}
                />
              </span>
              <span className="occ-month__pct">{inMonth ? percentLabel(info.util) : ""}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
