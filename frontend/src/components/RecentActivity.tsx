import { useMemo } from "react";
import { useCachedData } from "../api/useCachedData";
import { fetchBookings } from "../api/bookings";
import type { BookingOut } from "../api/catalog";

const TTL_MS = 60_000;
const RECENT_LIMIT = 10;
const MAX_MODELS = 4;

function modelLabel(b: BookingOut): string {
  const sn = b.model_short_name?.trim();
  if (sn) return sn;
  const mn = b.model_name?.trim();
  if (mn) return mn;
  return b.model_id != null ? `#${b.model_id}` : `#${b.id}`;
}

/**
 * Компактная строка «Недавнее» над каталогом.
 * Показывает до 4 недавно использованных моделей в виде чипов.
 * Клик по метке — переход к списку броней.
 * Клик по чипу — подставляет название в поиск каталога.
 * Скрывается, если пользователь уже ищет или фильтрует избранное
 * (управляется на уровне CatalogPage).
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

  const models = useMemo(() => {
    if (!data || data.length === 0) return [];
    const seen = new Set<number>();
    const out: string[] = [];
    for (const b of data) {
      if (b.model_id == null) continue;
      if (seen.has(b.model_id)) continue;
      seen.add(b.model_id);
      out.push(modelLabel(b));
      if (out.length >= MAX_MODELS) break;
    }
    return out;
  }, [data]);

  if (models.length === 0) return null;

  return (
    <div className="recent-activity">
      <button
        type="button"
        className="recent-activity__label"
        onClick={onOpenBookings}
        title="Перейти к бронированиям"
      >
        Недавнее →
      </button>
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
    </div>
  );
}
