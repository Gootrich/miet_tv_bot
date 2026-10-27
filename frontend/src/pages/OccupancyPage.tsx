import { useEffect, useMemo, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { OccupancyWeekGrid } from "../components/OccupancyWeekGrid";
import { OccupancyMonthGrid } from "../components/OccupancyMonthGrid";
import { OccupancyDayDetails } from "../components/OccupancyDayDetails";
import { TopBar } from "../components/TopBar";
import {
  fetchCatalog,
  type CategoryWithModelsOut,
  type EquipmentModelOut,
} from "../api/catalog";
import {
  addDays,
  formatDayMonth,
  formatWeekRange,
  startOfDay,
  startOfWeekMonday,
  weekdayShort,
} from "../utils/date";
import { useOccupancyBookings } from "../hooks/useOccupancyBookings";

type CatalogState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; categories: CategoryWithModelsOut[] };

type View = "month" | "week" | "day";

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

function monthFirst(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function formatMonthYear(d: Date): string {
  const months = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function OccupancyPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [catalog, setCatalog] = useState<CatalogState>({ kind: "loading" });
  const [view, setView] = useState<View>("week");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => startOfDay(new Date()));
  const [monthStart, setMonthStart] = useState<Date>(() => monthFirst(new Date()));
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

  useEffect(() => writeIds(LS_CATEGORIES, selectedCategories), [selectedCategories]);
  useEffect(() => writeIds(LS_MODELS, selectedModels), [selectedModels]);

  const range = useMemo(() => {
    if (view === "month") {
      const from = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
      const to = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 2);
      return { from, to };
    }
    if (view === "week") {
      return { from: weekStart, to: addDays(weekStart, 7) };
    }
    return { from: selectedDay, to: addDays(selectedDay, 1) };
  }, [view, monthStart, weekStart, selectedDay]);

  const maxPages = view === "month" ? 40 : view === "week" ? 15 : 5;
  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();
  const bookings = useOccupancyBookings(fromMs, toMs, maxPages);

  const categories = catalog.kind === "ready" ? catalog.categories : [];

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


  const categoryRefs = useMemo(
    () => categories.map((c) => ({ id: c.id, name: c.name })),
    [categories],
  );

  const categoryCodeByModelId = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of categories) {
      for (const model of c.models) m.set(model.id, c.code);
    }
    return m;
  }, [categories]);

  const onChangeView = (v: View) => {
    if (v === view) return;
    if (v === "month") setMonthStart(monthFirst(selectedDay));
    if (v === "week") setWeekStart(startOfWeekMonday(selectedDay));
    setView(v);
  };

  const onPrev = () => {
    if (view === "month") setMonthStart(addMonths(monthStart, -1));
    else if (view === "week") {
      const next = addDays(weekStart, -7);
      setWeekStart(next);
      setSelectedDay(next);
    } else {
      setSelectedDay(addDays(selectedDay, -1));
    }
  };
  const onNext = () => {
    if (view === "month") setMonthStart(addMonths(monthStart, 1));
    else if (view === "week") {
      const next = addDays(weekStart, 7);
      setWeekStart(next);
      setSelectedDay(next);
    } else {
      setSelectedDay(addDays(selectedDay, 1));
    }
  };
  const onToday = () => {
    const t = startOfDay(new Date());
    setSelectedDay(t);
    setWeekStart(startOfWeekMonday(t));
    setMonthStart(monthFirst(t));
  };

  const headerLabel =
    view === "month"
      ? formatMonthYear(monthStart)
      : view === "week"
        ? formatWeekRange(weekStart, addDays(weekStart, 6))
        : `${weekdayShort(selectedDay)}, ${formatDayMonth(selectedDay)}`;

  return (
    <div className="page">
      <TopBar title="Занятость" />
      <main className="page__content">
        <div className="segmented" role="tablist" aria-label="Вид занятости">
          <button
            type="button"
            role="tab"
            aria-selected={view === "month"}
            className={`segmented__item${view === "month" ? " is-active" : ""}`}
            onClick={() => onChangeView("month")}
          >
            Месяц
          </button>
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
          <button type="button" className="empty__action" onClick={onToday}>
            Сегодня
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

        {bookings.kind === "ready" && bookings.capHit && (
          <div className="occ-capwarn" role="status">
            Показаны не все брони диапазона: достигнут предел загрузки. Сузьте фильтр
            или используйте более короткий режим (неделя/день) для точной статистики.
          </div>
        )}

        {catalog.kind === "ready" && bookings.kind === "ready" && (
          <>
            {view === "month" && (
              <>
                <OccupancyMonthGrid
                  monthStart={monthStart}
                  models={visibleModels}
                  bookings={bookings.bookings}
                  selectedDay={selectedDay}
                  onSelectDay={(d) => {
                    setSelectedDay(d);
                    if (d.getMonth() !== monthStart.getMonth() || d.getFullYear() !== monthStart.getFullYear()) {
                      setMonthStart(monthFirst(d));
                    }
                  }}
                />
                <OccupancyDayDetails
                  day={selectedDay}
                  models={visibleModels}
                  categories={categoryRefs}
                  bookings={bookings.bookings}
                />
              </>
            )}

            {view === "week" && (
              visibleModels.length === 0 ? (
                <div className="empty">
                  <p className="empty__text">Нет моделей для выбранного фильтра</p>
                </div>
              ) : (
                <OccupancyWeekGrid
                  weekStart={weekStart}
                  models={visibleModels}
                  bookings={bookings.bookings}
                  selectedDay={selectedDay}
                  categoryCodeByModelId={categoryCodeByModelId}
                  onSelectDay={(d) => {
                    setSelectedDay(d);
                    const ws = startOfWeekMonday(d);
                    if (ws.getTime() !== weekStart.getTime()) setWeekStart(ws);
                  }}
                />
              )
            )}

            {view === "day" && (
              visibleModels.length === 0 ? (
                <div className="empty">
                  <p className="empty__text">Нет данных для выбранного фильтра</p>
                </div>
              ) : (
                <OccupancyDayDetails
                  day={selectedDay}
                  models={visibleModels}
                  categories={categoryRefs}
                  bookings={bookings.bookings}
                />
              )
            )}
          </>
        )}
      </main>
      <BottomNav active="occupancy" onSelect={onNavigate} />
    </div>
  );
}
