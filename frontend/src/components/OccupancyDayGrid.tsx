import { Fragment, useMemo, useState } from "react";
import type { BookingOut } from "../api/catalog";
import { addHours, setHour } from "../utils/date";

const HOURS_START = 9;
const HOURS_END = 22;

export interface DayRow {
  id: string;
  label: string;
  totalQuantity: number;
  modelIds: Set<number>;
}

interface Props {
  dayStart: Date;
  rows: DayRow[];
  bookings: BookingOut[];
}

interface Range {
  start: number;
  end: number;
  qty: number;
  modelId: number;
}

interface CellKey {
  rowId: string;
  hour: number;
}

function levelFor(util: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (util <= 0) return 0;
  if (util <= 0.25) return 1;
  if (util <= 0.5) return 2;
  if (util <= 0.75) return 3;
  if (util < 1) return 4;
  return 5;
}

export function OccupancyDayGrid({ dayStart, rows, bookings }: Props) {
  const [hovered, setHovered] = useState<CellKey | null>(null);
  const [pinned, setPinned] = useState<CellKey | null>(null);

  const allModelIds = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) for (const id of r.modelIds) s.add(id);
    return s;
  }, [rows]);

  const ranges = useMemo<Range[]>(() => {
    const out: Range[] = [];
    for (const b of bookings) {
      if (b.model_id == null || !allModelIds.has(b.model_id)) continue;
      if (b.actual_return != null) continue;
      const s = new Date(b.planned_start).getTime();
      const e = new Date(b.planned_end).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
      out.push({ start: s, end: e, qty: b.quantity, modelId: b.model_id });
    }
    return out;
  }, [bookings, allModelIds]);

  const hours = useMemo(
    () => Array.from({ length: HOURS_END - HOURS_START }, (_, i) => HOURS_START + i),
    [],
  );

  const compute = (row: DayRow, hour: number) => {
    if (row.totalQuantity <= 0) return { booked: 0, util: 0 };
    const start = setHour(dayStart, hour).getTime();
    const end = addHours(new Date(start), 1).getTime();
    let booked = 0;
    for (const r of ranges) {
      if (!row.modelIds.has(r.modelId)) continue;
      if (r.start < end && r.end > start) booked += r.qty;
    }
    return { booked, util: Math.min(1, booked / row.totalQuantity) };
  };

  const active = hovered ?? pinned;
  const activeRow = active ? rows.find((r) => r.id === active.rowId) : undefined;
  const activeInfo =
    active && activeRow
      ? (() => {
          const { booked, util } = compute(activeRow, active.hour);
          const hh = String(active.hour).padStart(2, "0");
          const hhNext = String(active.hour + 1).padStart(2, "0");
          return `${activeRow.label} · ${hh}:00–${hhNext}:00 — занято ${booked} из ${activeRow.totalQuantity} (${Math.round(
            util * 100,
          )}%)`;
        })()
      : null;

  return (
    <>
      <div className="occ-hint" aria-live="polite">
        {activeInfo ?? "Нажмите на ячейку, чтобы увидеть детали занятости"}
      </div>
      <div className="occ-day-grid-wrap">
        <div
          className="occ-day-grid"
          style={{
            gridTemplateColumns: `minmax(96px, 140px) repeat(${hours.length}, minmax(18px, 1fr))`,
          }}
        >
          <div className="occ-day-grid__corner" aria-hidden="true" />
          {hours.map((h) => (
            <div key={`h-${h}`} className="occ-day-grid__hour-head">
              {String(h).padStart(2, "0")}
            </div>
          ))}
          {rows.map((row) => (
            <Fragment key={row.id}>
              <div className="occ-day-grid__model-name" title={row.label}>
                {row.label}
              </div>
              {hours.map((h) => {
                const { util } = compute(row, h);
                const lv = levelFor(util);
                const isPinned = pinned?.rowId === row.id && pinned.hour === h;
                const label = `${row.label}, ${String(h).padStart(
                  2,
                  "0",
                )}:00 — занято ${Math.round(util * 100)}%`;
                return (
                  <div
                    key={`c-${row.id}-${h}`}
                    className={`occ-grid__cell occ-grid__cell--l${lv}${isPinned ? " is-pinned" : ""}`}
                    tabIndex={0}
                    role="button"
                    aria-label={label}
                    aria-pressed={isPinned}
                    onMouseEnter={() => setHovered({ rowId: row.id, hour: h })}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered({ rowId: row.id, hour: h })}
                    onBlur={() => setHovered(null)}
                    onClick={() => setPinned({ rowId: row.id, hour: h })}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </>
  );
}
