import { useMemo, useState } from "react";
import type { BookingOut, EquipmentModelOut } from "../api/catalog";
import { addDays, addHours, setHour, weekdayShort } from "../utils/date";

const HOURS_START = 9;
const HOURS_END = 22;

interface Props {
  weekStart: Date;
  models: EquipmentModelOut[];
  bookings: BookingOut[];
}

interface Range {
  start: number;
  end: number;
  qty: number;
}

interface CellKey {
  dayIdx: number;
  hour: number;
}

interface CellInfo extends CellKey {
  dayLabel: string;
  dayDate: number;
  util: number;
  booked: number;
  capacity: number;
}

function levelFor(util: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (util <= 0) return 0;
  if (util <= 0.25) return 1;
  if (util <= 0.5) return 2;
  if (util <= 0.75) return 3;
  if (util < 1) return 4;
  return 5;
}

function fmtInfo(c: CellInfo): string {
  const hh = String(c.hour).padStart(2, "0");
  const hhNext = String(c.hour + 1).padStart(2, "0");
  const pct = Math.round(c.util * 100);
  return `${c.dayLabel} ${c.dayDate}, ${hh}:00–${hhNext}:00 — занято ${c.booked} из ${c.capacity} (${pct}%)`;
}

export function OccupancyWeekGrid({ weekStart, models, bookings }: Props) {
  const [hovered, setHovered] = useState<CellKey | null>(null);
  const [pinned, setPinned] = useState<CellKey | null>(null);

  const capacity = useMemo(
    () => models.reduce((s, m) => s + m.total_quantity, 0),
    [models],
  );
  const modelIdSet = useMemo(() => new Set(models.map((m) => m.id)), [models]);

  const ranges = useMemo<Range[]>(() => {
    const out: Range[] = [];
    for (const b of bookings) {
      if (b.model_id == null) continue;
      if (!modelIdSet.has(b.model_id)) continue;
      if (b.actual_return != null) continue;
      const s = new Date(b.planned_start).getTime();
      const e = new Date(b.planned_end).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
      out.push({ start: s, end: e, qty: b.quantity });
    }
    return out;
  }, [bookings, modelIdSet]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const hours = useMemo(
    () => Array.from({ length: HOURS_END - HOURS_START }, (_, i) => HOURS_START + i),
    [],
  );

  const compute = (day: Date, hour: number): { util: number; booked: number } => {
    if (capacity <= 0) return { util: 0, booked: 0 };
    const start = setHour(day, hour).getTime();
    const end = addHours(new Date(start), 1).getTime();
    let booked = 0;
    for (const r of ranges) {
      if (r.start < end && r.end > start) booked += r.qty;
    }
    return { util: Math.min(1, booked / capacity), booked };
  };

  const buildInfo = (cell: CellKey): CellInfo => {
    const d = days[cell.dayIdx];
    const { util, booked } = compute(d, cell.hour);
    return {
      ...cell,
      dayLabel: weekdayShort(d),
      dayDate: d.getDate(),
      util,
      booked,
      capacity,
    };
  };

  const activeCell = hovered ?? pinned;
  const info = activeCell ? buildInfo(activeCell) : null;

  return (
    <>
      <div className="occ-hint" aria-live="polite">
        {info
          ? fmtInfo(info)
          : "Нажмите на ячейку, чтобы увидеть детали занятости"}
      </div>
      <div className="occ-grid-wrap">
        <div
          className="occ-grid"
          aria-label="Недельная занятость"
          style={{
            gridTemplateRows: `auto repeat(${hours.length}, minmax(22px, 1fr))`,
          }}
        >
          <div className="occ-grid__corner" aria-hidden="true" />
          {days.map((d) => (
            <div key={`h-${d.getTime()}`} className="occ-grid__day-head">
              <span className="occ-grid__day-wd">{weekdayShort(d)}</span>
              <span className="occ-grid__day-date">{d.getDate()}</span>
            </div>
          ))}
          {hours.flatMap((h) => {
            const timeCell = (
              <div key={`t-${h}`} className="occ-grid__time">
                {String(h).padStart(2, "0")}
              </div>
            );
            const cells = days.map((d, dayIdx) => {
              const { util } = compute(d, h);
              const lv = levelFor(util);
              const label = `${weekdayShort(d)} ${d.getDate()}, ${String(h).padStart(
                2,
                "0",
              )}:00 — занято ${Math.round(util * 100)}%`;
              const isPinned = pinned?.dayIdx === dayIdx && pinned.hour === h;
              return (
                <div
                  key={`c-${d.getTime()}-${h}`}
                  className={`occ-grid__cell occ-grid__cell--l${lv}${isPinned ? " is-pinned" : ""}`}
                  tabIndex={0}
                  role="button"
                  aria-label={label}
                  aria-pressed={isPinned}
                  onMouseEnter={() => setHovered({ dayIdx, hour: h })}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered({ dayIdx, hour: h })}
                  onBlur={() => setHovered(null)}
                  onClick={() => setPinned({ dayIdx, hour: h })}
                />
              );
            });
            return [timeCell, ...cells];
          })}
        </div>
      </div>
    </>
  );
}
