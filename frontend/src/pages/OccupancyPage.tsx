import { useEffect, useMemo, useRef, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { OccupancyTimeline } from "../components/OccupancyTimeline";
import {
  fetchCatalog,
  type BookingOut,
  type CategoryWithModelsOut,
} from "../api/catalog";
import { fetchOccupancy } from "../api/occupancy";
import { useCachedData } from "../api/useCachedData";
import { load } from "../api/cache";
import {
  addDays,
  formatDayMonth,
  startOfDay,
  weekdayShort,
} from "../utils/date";
import { cartSetRange } from "../state/cart";
import { HOUR_START, HOUR_END } from "../utils/occupancyTime";
import { Modal } from "../components/Modal";
import { DateTimeRangePicker, type DTRange } from "../components/DateTimeRangePicker";

const OCC_TTL = 45_000;
const LS_CATEGORIES = "miet.occ.categories";
const LS_MODELS = "miet.occ.models";
const LS_VIEW = "miet.occ.viewMode";
type ViewMode = "ribbon" | "chrono";
const DEFAULT_VIEW: ViewMode =
  typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches
    ? "chrono"
    : "ribbon";

function readView(): ViewMode {
  try {
    const raw = localStorage.getItem(LS_VIEW);
    if (raw === "ribbon" || raw === "chrono") return raw;
  } catch { /* ignore */ }
  return DEFAULT_VIEW;
}
function writeView(v: ViewMode): void {
  try { localStorage.setItem(LS_VIEW, v); } catch { /* ignore */ }
}

function readIds(key: string): Set<number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(
      arr.filter((x): x is number => typeof x === "number" && Number.isFinite(x)),
    );
  } catch {
    return new Set();
  }
}
function writeIds(key: string, set: Set<number>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export function OccupancyPage({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  const [anchorDay, setAnchorDay] = useState<Date>(() => startOfDay(new Date()));
  const [selectedCategories, setSelectedCategories] = useState<Set<number>>(
    () => readIds(LS_CATEGORIES),
  );
  const [selectedModels, setSelectedModels] = useState<Set<number>>(
    () => readIds(LS_MODELS),
  );
  const [viewMode, setViewMode] = useState<ViewMode>(() => readView());
  useEffect(() => writeView(viewMode), [viewMode]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddRange, setQuickAddRange] = useState<DTRange>({ start: null, end: null });

  useEffect(() => writeIds(LS_CATEGORIES, selectedCategories), [selectedCategories]);
  useEffect(() => writeIds(LS_MODELS, selectedModels), [selectedModels]);

  const day1 = anchorDay;
  const day2 = useMemo(() => addDays(anchorDay, 1), [anchorDay]);
  const fromMs = day1.getTime();
  const toMs = new Date(
    day2.getFullYear(),
    day2.getMonth(),
    day2.getDate() + 1,
  ).getTime();

  const cacheKey = `occupancy:${fromMs}:${toMs}`;
  const occ = useCachedData(
    cacheKey,
    () => fetchOccupancy(fromMs, toMs),
    { ttlMs: OCC_TTL, keepPrevious: true },
  );

  // Prefetch соседних окон [D-1, D+1] и [D+1, D+3] — с отменой при быстрой смене дня.
  // Заполняет кэш заранее, чтобы нажатие «След/Пред» рендерилось мгновенно.
  // load() дедуплицирует по ключу и не идёт в сеть, если запись свежая (ttl).
  useEffect(() => {
    const t = window.setTimeout(() => {
      const prevFrom = startOfDay(addDays(anchorDay, -1)).getTime();
      const prevTo = startOfDay(addDays(anchorDay, 1)).getTime();
      const nextFrom = startOfDay(addDays(anchorDay, 1)).getTime();
      const nextTo = startOfDay(addDays(anchorDay, 3)).getTime();
      load(
        `occupancy:${prevFrom}:${prevTo}`,
        () => fetchOccupancy(prevFrom, prevTo),
        OCC_TTL,
      ).catch(() => { /* ignore prefetch errors */ });
      load(
        `occupancy:${nextFrom}:${nextTo}`,
        () => fetchOccupancy(nextFrom, nextTo),
        OCC_TTL,
      ).catch(() => { /* ignore prefetch errors */ });
    }, 200);
    return () => window.clearTimeout(t);
  }, [anchorDay]);

  const cat = useCachedData("catalog", fetchCatalog);
  const categories: CategoryWithModelsOut[] = cat.data ?? [];

  useEffect(() => {
    if (!cat.data) return;
    const valid = new Set(cat.data.map((c) => c.id));
    let changed = false;
    const next = new Set<number>();
    for (const id of selectedCategories) {
      if (valid.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelectedCategories(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat.data]);

  const availableModels = useMemo(() => {
    if (selectedCategories.size === 0) return categories.flatMap((c) => c.models);
    return categories
      .filter((c) => selectedCategories.has(c.id))
      .flatMap((c) => c.models);
  }, [categories, selectedCategories]);

  useEffect(() => {
    if (selectedModels.size === 0) return;
    const availIds = new Set(availableModels.map((m) => m.id));
    let changed = false;
    const next = new Set<number>();
    for (const id of selectedModels) {
      if (availIds.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelectedModels(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableModels]);

  const visibleModelIds = useMemo(() => {
    if (selectedModels.size === 0) return new Set(availableModels.map((m) => m.id));
    return new Set(
      availableModels.filter((m) => selectedModels.has(m.id)).map((m) => m.id),
    );
  }, [availableModels, selectedModels]);

  const categoryCodeByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.name, c.code);
    return m;
  }, [categories]);

  const shortNameByModelId = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of categories) {
      for (const m of c.models) {
        if (m.short_name && m.short_name.trim()) {
          map.set(m.id, m.short_name.trim());
        }
      }
    }
    return map;
  }, [categories]);

  const filteredBookings = useMemo(() => {
    const list = occ.data ?? [];
    return list.filter(
      (b) => b.model_id == null || visibleModelIds.has(b.model_id),
    );
  }, [occ.data, visibleModelIds]);

  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const slideTimer = useRef<number | null>(null);
  const triggerSlide = (dir: "left" | "right") => {
    if (slideTimer.current != null) window.clearTimeout(slideTimer.current);
    setSlideDir(dir);
    slideTimer.current = window.setTimeout(() => setSlideDir(null), 220);
  };
  useEffect(() => () => {
    if (slideTimer.current != null) window.clearTimeout(slideTimer.current);
  }, []);

  const onPrev = () => { triggerSlide("left"); setAnchorDay(addDays(anchorDay, -1)); };
  const onNext = () => { triggerSlide("right"); setAnchorDay(addDays(anchorDay, 1)); };
  const onToday = () => { setSlideDir(null); setAnchorDay(startOfDay(new Date())); };

  const onSelectEmpty = (day: Date, hour: number) => {
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    cartSetRange({ start: start.toISOString(), end: end.toISOString() });
    onNavigate("catalog");
  };

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      occ.refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [occ]);

  const handleQuickAddOpen = () => {
    const s = new Date();
    s.setSeconds(0, 0);
    const total = s.getHours() * 60 + s.getMinutes();
    const up = Math.ceil((total + 1) / 15) * 15;
    s.setHours(0, 0, 0, 0);
    s.setMinutes(up);
    const e = new Date(s.getTime() + 60 * 60 * 1000);
    setQuickAddRange({ start: s.toISOString(), end: e.toISOString() });
    setQuickAddOpen(true);
  };

  const handleQuickAddSubmit = () => {
    if (!quickAddRange.start || !quickAddRange.end) return;
    cartSetRange(quickAddRange);
    setQuickAddOpen(false);
    onNavigate("catalog");
  };

  return (
    <div className="page">
      <main className="page__content">
        <div className="occ-tl-toolbar">
          <button type="button" className="empty__action" onClick={onPrev}>
            ← Пред
          </button>
          <span className="occ-toolbar__range">
            {weekdayShort(day1)}, {formatDayMonth(day1)} —{" "}
            {weekdayShort(day2)}, {formatDayMonth(day2)}
          </span>
          <button type="button" className="empty__action" onClick={onNext}>
            След →
          </button>
          <button type="button" className="empty__action" onClick={onToday}>
            Сегодня
          </button>
          <button
            type="button"
            className="card__cta"
            style={{ marginLeft: "auto" }}
            onClick={handleQuickAddOpen}
          >
            + Бронь
          </button>
          <div className="occ-view-toggle" role="group" aria-label="Вид таймлайна">
            <button
              type="button"
              className={`occ-view-toggle__btn${viewMode === "ribbon" ? " is-active" : ""}`}
              onClick={() => setViewMode("ribbon")}
              aria-pressed={viewMode === "ribbon"}
              title="Лента"
              aria-label="Лента"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <line x1="3" y1="6" x2="17" y2="6" />
                <line x1="3" y1="10" x2="13" y2="10" />
                <line x1="3" y1="14" x2="15" y2="14" />
              </svg>
            </button>
            <button
              type="button"
              className={`occ-view-toggle__btn${viewMode === "chrono" ? " is-active" : ""}`}
              onClick={() => setViewMode("chrono")}
              aria-pressed={viewMode === "chrono"}
              title="Список"
              aria-label="Список"
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <circle cx="5" cy="6" r="1" fill="currentColor" stroke="none" />
                <line x1="9" y1="6" x2="17" y2="6" />
                <circle cx="5" cy="10" r="1" fill="currentColor" stroke="none" />
                <line x1="9" y1="10" x2="17" y2="10" />
                <circle cx="5" cy="14" r="1" fill="currentColor" stroke="none" />
                <line x1="9" y1="14" x2="17" y2="14" />
              </svg>
            </button>
          </div>
        </div>

        <div className="occ-filters">
          <MultiSelectDropdown
            label="Категории"
            emptyLabel="Все категории"
            options={categories.map((c) => ({ id: c.id, label: c.name }))}
            selected={selectedCategories}
            onChange={setSelectedCategories}
            disabled={!cat.data}
          />
          <MultiSelectDropdown
            label="Модели"
            emptyLabel="Все модели"
            searchable
            options={availableModels.map((m) => ({ id: m.id, label: m.name }))}
            selected={selectedModels}
            onChange={setSelectedModels}
            disabled={!cat.data}
          />
        </div>

        {cat.error && (
          <div className="empty">
            <p className="empty__text">Ошибка каталога: {cat.error.message}</p>
          </div>
        )}
        {occ.error && (
          <div className="empty">
            <p className="empty__text">Ошибка занятости: {occ.error.message}</p>
          </div>
        )}

        {!occ.error && (
          <div
            className="occ-slide-wrap"
            data-dir={slideDir ?? "none"}
            key={anchorDay.getTime()}
          >
            {occ.data === undefined ? (
              <OccSkeleton />
            ) : (
              <OccupancyTimeline
                day1={day1}
                day2={day2}
                bookings={filteredBookings}
                categoryCodeByName={categoryCodeByName}
                shortNameByModelId={shortNameByModelId}
                viewMode={viewMode}
                onSelectEmpty={onSelectEmpty}
                onNavigate={onNavigate}
              />
            )}
          </div>
        )}

        <OccupancyStats bookings={filteredBookings} />
      </main>
      {quickAddOpen && (
        <Modal
          open={quickAddOpen}
          title="Создать бронь"
          onClose={() => setQuickAddOpen(false)}
          width={520}
          footer={
            <>
              <button
                type="button"
                className="card__cta card__cta--secondary"
                onClick={() => setQuickAddOpen(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="card__cta"
                disabled={!quickAddRange.start || !quickAddRange.end}
                onClick={handleQuickAddSubmit}
              >
                К каталогу
              </button>
            </>
          }
        >
          <DateTimeRangePicker
            variant="modal"
            value={quickAddRange}
            onChange={(next: DTRange) => setQuickAddRange(next)}
          />
        </Modal>
      )}

      <BottomNav active="occupancy" onSelect={onNavigate} />
    </div>
  );
}

function OccSkeleton() {
  return (
    <div className="occ-skeleton" aria-busy="true" aria-label="Загрузка занятости">
      <div className="occ-skeleton__head" />
      <div className="occ-skeleton__row" />
      <div className="occ-skeleton__row" />
      <div className="occ-skeleton__row" />
    </div>
  );
}

function OccupancyStats({ bookings }: { bookings: BookingOut[] }) {
  const stats = useMemo(() => {
    if (bookings.length === 0) return null;
    const users = new Set(bookings.map((b) => b.user_id));
    const hourCounts = new Map<number, number>();
    for (const b of bookings) {
      const s = new Date(b.planned_start);
      const e = new Date(b.planned_end);
      const startH = Math.max(HOUR_START, s.getHours());
      const endH = Math.min(
        HOUR_END - 1,
        e.getTime() > s.getTime() ? e.getHours() : startH,
      );
      for (let h = startH; h <= endH; h++) {
        hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
      }
    }
    let busiestHour = 0;
    let busiestCount = 0;
    for (const [h, c] of hourCounts) {
      if (c > busiestCount) {
        busiestCount = c;
        busiestHour = h;
      }
    }
    return {
      total: bookings.length,
      users: users.size,
      busiestHour,
      busiestCount,
    };
  }, [bookings]);

  if (!stats) return null;
  return (
    <div className="occ-tl-stats">
      <div className="occ-tl-stats__item">
        <div className="occ-tl-stats__value">{stats.total}</div>
        <div className="occ-tl-stats__label">броней</div>
      </div>
      <div className="occ-tl-stats__item">
        <div className="occ-tl-stats__value">{stats.users}</div>
        <div className="occ-tl-stats__label">пользователей</div>
      </div>
      <div className="occ-tl-stats__item">
        <div className="occ-tl-stats__value">
          {String(stats.busiestHour).padStart(2, "0")}:00
        </div>
        <div className="occ-tl-stats__label">пик</div>
      </div>
    </div>
  );
}
