import { useEffect, useMemo, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { OccupancyWeekGrid } from "../components/OccupancyWeekGrid";
import { OccupancyDayGrid, type DayRow } from "../components/OccupancyDayGrid";
import { TopBar } from "../components/TopBar";
import {
  fetchCatalog,
  type BookingOut,
  type CategoryWithModelsOut,
  type EquipmentModelOut,
} from "../api/catalog";
import { fetchBookings } from "../api/bookings";
import {
  addDays,
  formatDayMonth,
  formatWeekRange,
  startOfDay,
  startOfWeekMonday,
  weekdayShort,
} from "../utils/date";

type CatalogState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; categories: CategoryWithModelsOut[] };

type BookingsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; bookings: BookingOut[] };

type View = "week" | "day";
type DayMode = "model" | "category";

const FETCH_LIMIT = 100;
const FETCH_MAX_PAGES = 10;

const LS_CATEGORIES = "miet.occ.categories";
const LS_MODELS = "miet.occ.models";

function readIds(key: string): Set<number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is number => typeof x === "number" && Number.isFinite(x)));
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

export function OccupancyPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [catalog, setCatalog] = useState<CatalogState>({ kind: "loading" });
  const [bookings, setBookings] = useState<BookingsState>({ kind: "idle" });
  const [view, setView] = useState<View>("week");
  const [dayMode, setDayMode] = useState<DayMode>("model");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()));
  const [dayStart, setDayStart] = useState<Date>(() => startOfDay(new Date()));
  const [selectedCategories, setSelectedCategories] = useState<Set<number>>(() =>
    readIds(LS_CATEGORIES),
  );
  const [selectedModels, setSelectedModels] = useState<Set<number>>(() => readIds(LS_MODELS));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchCatalog();
        if (cancelled) return;
        setCatalog({ kind: "ready", categories: data });
      } catch (e) {
        if (cancelled) return;
        setCatalog({
          kind: "error",
          message: e instanceof Error ? e.message : "Ошибка загрузки каталога",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist selection as "favorites"
  useEffect(() => writeIds(LS_CATEGORIES, selectedCategories), [selectedCategories]);
  useEffect(() => writeIds(LS_MODELS, selectedModels), [selectedModels]);

  const range = useMemo(() => {
    const from = view === "week" ? weekStart : dayStart;
    const days = view === "week" ? 7 : 1;
    return { from, to: addDays(from, days) };
  }, [view, weekStart, dayStart]);

  useEffect(() => {
    let cancelled = false;
    setBookings({ kind: "loading" });
    (async () => {
      try {
        const collected: BookingOut[] = [];
        let beforeId: number | undefined;
        for (let page = 0; page < FETCH_MAX_PAGES; page++) {
          const chunk = await fetchBookings({
            scope: "all",
            status: "pending,confirmed",
            fromDt: range.from.toISOString(),
            toDt: range.to.toISOString(),
            limit: FETCH_LIMIT,
            beforeId,
          });
          if (cancelled) return;
          collected.push(...chunk);
          if (chunk.length < FETCH_LIMIT) break;
          const minId = chunk.reduce((m, b) => (b.id < m ? b.id : m), chunk[0].id);
          beforeId = minId;
        }
        setBookings({ kind: "ready", bookings: collected });
      } catch (e) {
        if (cancelled) return;
        setBookings({
          kind: "error",
          message: e instanceof Error ? e.message : "Ошибка загрузки занятости",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const categories = catalog.kind === "ready" ? catalog.categories : [];

  // Cleanup selected categories against loaded catalog
  useEffect(() => {
    if (catalog.kind !== "ready") return;
    const valid = new Set(catalog.categories.map((c) => c.id));
    let changed = false;
    const next = new Set<number>();
    for (const id of selectedCategories) {
      if (valid.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelectedCategories(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const availableModels: EquipmentModelOut[] = useMemo(() => {
    if (catalog.kind !== "ready") return [];
    if (selectedCategories.size === 0) {
      return catalog.categories.flatMap((c) => c.models);
    }
    return catalog.categories
      .filter((c) => selectedCategories.has(c.id))
      .flatMap((c) => c.models);
  }, [catalog, selectedCategories]);

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

  const visibleModels = useMemo(() => {
    if (selectedModels.size === 0) return availableModels;
    return availableModels.filter((m) => selectedModels.has(m.id));
  }, [availableModels, selectedModels]);

  const dayRows: DayRow[] = useMemo(() => {
    if (catalog.kind !== "ready") return [];
    if (dayMode === "model") {
      return visibleModels.map<DayRow>((m) => ({
        id: `model-${m.id}`,
        label: m.name,
        totalQuantity: m.total_quantity,
        modelIds: new Set([m.id]),
      }));
    }
    const rows: DayRow[] = [];
    for (const c of catalog.categories) {
      const inCat = visibleModels.filter((m) => m.category_id === c.id);
      if (inCat.length === 0) continue;
      const total = inCat.reduce((s, m) => s + m.total_quantity, 0);
      rows.push({
        id: `cat-${c.id}`,
        label: c.name,
        totalQuantity: total,
        modelIds: new Set(inCat.map((m) => m.id)),
      });
    }
    return rows;
  }, [catalog, visibleModels, dayMode]);

  const onChangeView = (v: View) => {
    if (v === view) return;
    if (v === "day") setDayStart(new Date(weekStart));
    else setWeekStart(startOfWeekMonday(dayStart));
    setView(v);
  };

  const onPrev = () => {
    if (view === "week") setWeekStart(addDays(weekStart, -7));
    else setDayStart(addDays(dayStart, -1));
  };
  const onNext = () => {
    if (view === "week") setWeekStart(addDays(weekStart, 7));
    else setDayStart(addDays(dayStart, 1));
  };

  const headerLabel =
    view === "week"
      ? formatWeekRange(weekStart, addDays(weekStart, 6))
      : `${weekdayShort(dayStart)}, ${formatDayMonth(dayStart)}`;

  return (
    <div className="page">
      <TopBar title="Занятость" />
      <main className="page__content">
        <div className="segmented" role="tablist" aria-label="Вид занятости">
          <button
            type="button"
            role="tab"
            aria-selected={view === "week"}
            className={`segmented__item${view === "week" ? " is-active" : ""}`}
            onClick={() => onChangeView("week")}
          >
            Неделя
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "day"}
            className={`segmented__item${view === "day" ? " is-active" : ""}`}
            onClick={() => onChangeView("day")}
          >
            День
          </button>
        </div>

        <div className="occ-toolbar">
          <button type="button" className="empty__action" onClick={onPrev}>
            ← Пред
          </button>
          <span className="occ-toolbar__range">{headerLabel}</span>
          <button type="button" className="empty__action" onClick={onNext}>
            След →
          </button>
        </div>

        <div className="occ-filters">
          <MultiSelectDropdown
            label="Категории"
            emptyLabel="Все категории"
            options={categories.map((c) => ({ id: c.id, label: c.name }))}
            selected={selectedCategories}
            onChange={setSelectedCategories}
            disabled={catalog.kind !== "ready"}
          />
          <MultiSelectDropdown
            label="Модели"
            emptyLabel="Все модели"
            searchable
            options={availableModels.map((m) => ({ id: m.id, label: m.name }))}
            selected={selectedModels}
            onChange={setSelectedModels}
            disabled={catalog.kind !== "ready"}
          />
        </div>

        {view === "day" && (
          <div className="occ-day-mode segmented" role="tablist" aria-label="Группировка">
            <button
              type="button"
              role="tab"
              aria-selected={dayMode === "model"}
              className={`segmented__item${dayMode === "model" ? " is-active" : ""}`}
              onClick={() => setDayMode("model")}
            >
              По моделям
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dayMode === "category"}
              className={`segmented__item${dayMode === "category" ? " is-active" : ""}`}
              onClick={() => setDayMode("category")}
            >
              По категориям
            </button>
          </div>
        )}

        {catalog.kind === "error" && (
          <div className="empty">
            <p className="empty__text">Ошибка каталога: {catalog.message}</p>
          </div>
        )}
        {bookings.kind === "error" && (
          <div className="empty">
            <p className="empty__text">Ошибка занятости: {bookings.message}</p>
          </div>
        )}

        {catalog.kind === "ready" && bookings.kind === "ready" && (
          view === "week" ? (
            visibleModels.length === 0 ? (
              <div className="empty">
                <p className="empty__text">Нет моделей для выбранного фильтра</p>
              </div>
            ) : (
              <OccupancyWeekGrid
                weekStart={weekStart}
                models={visibleModels}
                bookings={bookings.bookings}
              />
            )
          ) : dayRows.length === 0 ? (
            <div className="empty">
              <p className="empty__text">Нет данных для выбранного фильтра</p>
            </div>
          ) : (
            <OccupancyDayGrid
              dayStart={dayStart}
              rows={dayRows}
              bookings={bookings.bookings}
            />
          )
        )}
      </main>
      <BottomNav active="occupancy" onSelect={onNavigate} />
    </div>
  );
}
