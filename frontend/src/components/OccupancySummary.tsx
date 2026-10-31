import { useMemo, useState } from "react";
import { useCachedData } from "../api/useCachedData";
import { fetchOccupancy } from "../api/occupancy";
import type { BookingOut } from "../api/catalog";

const TTL_MS = 60_000;

function dayBounds(now: Date): { startMs: number; endMs: number } {
  const s = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { startMs: s, endMs: s + 24 * 3600 * 1000 };
}

function shortModelName(b: BookingOut): string {
  const sn = b.model_short_name?.trim();
  if (sn) return sn;
  const mn = b.model_name?.trim();
  if (mn) return mn;
  return b.model_id != null ? `#${b.model_id}` : `#${b.id}`;
}

function hhmmFromMs(ms: number): string {
  return new Date(ms).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Компактная сводка занятости над каталогом.
 * Не вытесняет поиск: одна строка, раскрытие — по тапу.
 * Данные — fetchOccupancy через общий кэш (60 с).
 */
export function OccupancySummary() {
  const [expanded, setExpanded] = useState(false);
  const bounds = useMemo(() => dayBounds(new Date()), []);
  const key = `occupancy:summary:${bounds.startMs}`;

  const { data } = useCachedData<BookingOut[]>(
    key,
    () => fetchOccupancy(bounds.startMs, bounds.endMs, 2),
    TTL_MS,
  );

  const { busyNow, freeingToday, totalFreeQty } = useMemo(() => {
    const now = Date.now();
    const rows = (data ?? []).filter((b) => b.status === "confirmed");
    let busy = 0;
    const freeing: { booking: BookingOut; endMs: number }[] = [];
    for (const b of rows) {
      const s = new Date(b.planned_start).getTime();
      const e = new Date(b.planned_end).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
      const qty = Math.max(0, b.quantity | 0) || 1;
      if (s <= now && now < e) busy += qty;
      if (e > now && e <= bounds.endMs) freeing.push({ booking: b, endMs: e });
    }
    freeing.sort((a, b) => a.endMs - b.endMs);
    const totalQty = freeing.reduce(
      (acc, f) => acc + (Math.max(0, f.booking.quantity | 0) || 1),
      0,
    );
    return { busyNow: busy, freeingToday: freeing, totalFreeQty: totalQty };
  }, [data, bounds.endMs]);

  const hasData = data !== undefined;
  const canExpand = hasData && freeingToday.length > 0;

  return (
    <div
      className={`occupancy-summary${expanded ? " occupancy-summary--open" : ""}`}
    >
      <button
        type="button"
        className="occupancy-summary__head"
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        aria-expanded={canExpand ? expanded : undefined}
      >
        <span className="occupancy-summary__item">
          <span className="occupancy-summary__num">
            {hasData ? busyNow : "—"}
          </span>
          <span className="occupancy-summary__label">занято сейчас</span>
        </span>
        <span className="occupancy-summary__sep" aria-hidden="true">
          ·
        </span>
        <span className="occupancy-summary__item">
          <span className="occupancy-summary__num">
            {hasData ? totalFreeQty : "—"}
          </span>
          <span className="occupancy-summary__label">освободится сегодня</span>
        </span>
        {canExpand && (
          <span className="occupancy-summary__chevron" aria-hidden="true">
            {expanded ? "▴" : "▾"}
          </span>
        )}
      </button>
      {expanded && freeingToday.length > 0 && (
        <ul className="occupancy-summary__list">
          {freeingToday.slice(0, 5).map(({ booking, endMs }) => (
            <li key={booking.id} className="occupancy-summary__row">
              <span className="occupancy-summary__row-name">
                {shortModelName(booking)}
              </span>
              <span className="occupancy-summary__row-time">
                до {hhmmFromMs(endMs)}
              </span>
            </li>
          ))}
          {freeingToday.length > 5 && (
            <li className="occupancy-summary__row occupancy-summary__row--more">
              и ещё {freeingToday.length - 5}…
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
