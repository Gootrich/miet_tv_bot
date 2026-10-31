import { useMemo } from "react";
import { useCachedData } from "../api/useCachedData";
import { fetchBookings } from "../api/bookings";
import type { BookingOut } from "../api/catalog";

const TTL_MS = 60_000;
const RECENT_LIMIT = 10;
const MAX_MODELS = 4;

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function modelLabel(b: BookingOut): string {
  const sn = b.model_short_name?.trim();
  if (sn) return sn;
  const mn = b.model_name?.trim();
  if (mn) return mn;
  return b.model_id != null ? `#${b.model_id}` : `#${b.id}`;
}

/**
 * Компактная строка «недавние» над каталогом.
 * Показывает последнюю бронь и до 4 недавно использованных моделей.
 * Данные — fetchBookings scope="mine" (backend резолвит на текущего юзера).
 * Если броней нет — блок не рендерится.
 */
export function RecentActivity({
  onOpenBookings,
  onPickModel,
}: {
  onOpenBookings: () => void;
  onPickModel: (name: string) => void;
}) {
  const { data } = useCachedData<BookingOut[]>(
    "bookings:recent:mine",
    () =>
      fetchBookings({
        scope: "mine",
        status: "confirmed,completed",
        limit: RECENT_LIMIT,
      }),
    TTL_MS,
  );

  const { latest, models } = useMemo(() => {
    if (!data || data.length === 0) return { latest: null, models: [] };
    const latest = data[0];
    const seen = new Set<number>();
    const out: string[] = [];
    for (const b of data) {
      if (b.model_id == null) continue;
      if (seen.has(b.model_id)) continue;
      seen.add(b.model_id);
      out.push(modelLabel(b));
      if (out.length >= MAX_MODELS) break;
    }
    return { latest, models: out };
  }, [data]);

  if (!latest) return null;

  return (
    <div className="recent-activity">
      <button
        type="button"
        className="recent-activity__chip recent-activity__chip--latest"
        onClick={onOpenBookings}
      >
        <span className="recent-activity__chip-label">Последняя</span>
        <span className="recent-activity__chip-value">
          {modelLabel(latest)} · {formatShortDate(latest.planned_start)}
        </span>
      </button>
      {models.length > 0 && (
        <div
          className="recent-activity__chips"
          role="group"
          aria-label="Недавно использованная техника"
        >
          {models.map((m) => (
            <button
              key={m}
              type="button"
              className="recent-activity__chip"
              onClick={() => onPickModel(m)}
              title={`Искать: ${m}`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
