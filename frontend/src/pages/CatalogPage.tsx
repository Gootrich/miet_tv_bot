import { useMemo, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { CategoryChips } from "../components/CategoryChips";
import { EquipmentCard } from "../components/EquipmentCard";
import { BatchBookingModal } from "../components/BatchBookingModal";
import { IconAlert, IconSearch } from "../components/Icons";
import {
  categoryNames,
  fetchCatalog,
  fetchModelAvailability,
  toCatalogItems,
  type CatalogItem,
  type ModelAvailability,
} from "../api/catalog";
import { useCachedData } from "../api/useCachedData";
import { invalidate } from "../api/cache";
import { cartClear, cartSetRange, cartToggle, useCart } from "../state/cart";
import type { DTRange } from "../components/DateTimeRangePicker";
import { ModelAliasesModal } from "../components/ModelAliasesModal";
import { OccupancySummary } from "../components/OccupancySummary";
import { fetchFavorites, addFavorite, removeFavorite } from "../api/favorites";
import { RecentActivity } from "../components/RecentActivity";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: CatalogItem[]; categories: string[] };

function matches(item: CatalogItem, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (item.title.toLowerCase().includes(needle)) return true;
  if (item.subtitle.toLowerCase().includes(needle)) return true;
  if (item.category.toLowerCase().includes(needle)) return true;
  if (item.shortName && item.shortName.toLowerCase().includes(needle)) return true;
  for (const a of (item.aliases ?? [])) {
    if (a.toLowerCase().includes(needle)) return true;
  }
  return false;
}

function formatRangeShort(r: DTRange): string {
  if (!r.start || !r.end) return "";
  const s = new Date(r.start);
  const e = new Date(r.end);
  const sameDay = s.toDateString() === e.toDateString();
  const st = s.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const et = e.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) {
    const date = s.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    return `${date}, ${st}\u2013${et}`;
  }
  const sd = s.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const ed = e.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return `${sd} ${st} \u2192 ${ed} ${et}`;
}

function formatTimeOnly(r: DTRange): string {
  if (!r.start || !r.end) return "";
  const s = new Date(r.start);
  const e = new Date(r.end);
  const st = s.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const et = e.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${st}\u2013${et}`;
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * Баннер над карточкой модели, которая занята на выбранный период.
 * Позволяет одним действием найти ближайший подходящий слот
 * (через backend /catalog/models/{id}/availability) и применить его.
 */
function PeriodBusyBanner({
  item,
  onApplyNearest,
}: {
  item: CatalogItem;
  onApplyNearest: (start: string, end: string) => void;
}) {
  const cart = useCart();
  const [nearest, setNearest] = useState<ModelAvailability | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const range = cart.range;
  const qty = cart.items.get(item.modelId) ?? 1;

  const handleSearch = async () => {
    if (!range.start || !range.end) return;
    setLoading(true);
    try {
      const r = await fetchModelAvailability(
        item.modelId,
        range.start,
        range.end,
        qty,
      );
      setNearest(r);
    } catch {
      setNearest(null);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  const fmt = (() => {
    if (!nearest?.next_available_start || !nearest?.next_available_end) return null;
    const s = new Date(nearest.next_available_start);
    const e = new Date(nearest.next_available_end);
    const sd = s.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    const st = s.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const et = e.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const sameDay = s.toDateString() === e.toDateString();
    return {
      text: sameDay ? `${sd}, ${st}\u2013${et}` : `${sd} ${st} \u2192 ${et}`,
      start: nearest.next_available_start,
      end: nearest.next_available_end,
    };
  })();

  return (
    <div className="period-avail period-avail--busy" role="status">
      <span className="period-avail__label">Занято на выбранный период</span>
      {!searched && (
        <button
          type="button"
          className="period-avail__action"
          onClick={handleSearch}
          disabled={loading}
        >
          {loading ? "Поиск…" : "Найти ближайшее"}
        </button>
      )}
      {searched && fmt && (
        <button
          type="button"
          className="period-avail__action period-avail__action--suggest"
          onClick={() => onApplyNearest(fmt.start, fmt.end)}
        >
          Ближайшее: {fmt.text} →
        </button>
      )}
      {searched && !fmt && !loading && (
        <span className="period-avail__hint">Нет свободного слота</span>
      )}
    </div>
  );
}

export function CatalogPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const cart = useCart();

  const rangeActive = !!(cart.range.start && cart.range.end);
  // При пустом range используем ключ "catalog" — он же в App.tsx preload,
  // поэтому данные попадают из кэша без повторного запроса.
  const cacheKey = rangeActive
    ? `catalog:${cart.range.start}|${cart.range.end}`
    : "catalog";

  const cat = useCachedData(
    cacheKey,
    () => fetchCatalog(cart.range.start, cart.range.end),
    { keepPrevious: true },
  );

  const state: LoadState = useMemo<LoadState>(() => {
    if (cat.error && !cat.data) return { kind: "error", message: cat.error.message };
    if (!cat.data) return { kind: "loading" };
    return {
      kind: "ready",
      items: toCatalogItems(cat.data),
      categories: categoryNames(cat.data),
    };
  }, [cat.data, cat.error]);

  const [category, setCategory] = useState<string>("Все");
  const [query, setQuery] = useState<string>("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [tagsTarget, setTagsTarget] = useState<CatalogItem | null>(null);

  const selectedCount = cart.items.size;
  const categories = state.kind === "ready" ? state.categories : ["Все"];

  const visible = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.items.filter((item) => {
      if (category !== "Все" && item.category !== category) return false;
      return matches(item, query.trim());
    });
  }, [state, category, query]);

  const totalCount = state.kind === "ready" ? state.items.length : 0;
  const isSearching = query.trim().length > 0;

  const toggleSelect = (item: CatalogItem) => {
    cartToggle(item.modelId);
  };

  const selectedItems: Array<{ item: CatalogItem; quantity: number }> = useMemo(() => {
    if (state.kind !== "ready") return [];
    const byId = new Map(state.items.map((i) => [i.modelId, i]));
    const out: Array<{ item: CatalogItem; quantity: number }> = [];
    for (const [mid, q] of cart.items.entries()) {
      const it = byId.get(mid);
      if (it) out.push({ item: it, quantity: q });
    }
    return out;
  }, [state, cart.items]);

  const onBatchSuccess = () => {
    setBatchOpen(false);
    cartClear();
    invalidate("catalog");
    invalidate("occupancy");
    onNavigate("bookings");
  };


  const { data: favoriteIds = [] } = useCachedData<number[]>(
    "favorites:mine",
    fetchFavorites,
    60_000,
  );
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const [showFavorites, setShowFavorites] = useState(false);
  const toggleFavorite = async (modelId: number) => {
    try {
      if (favoriteSet.has(modelId)) await removeFavorite(modelId);
      else await addFavorite(modelId);
      invalidate("favorites:mine");
    } catch {
      /* silent */
    }
  };

  return (
    <div className="page">
      <main className={`page__content${selectedCount > 0 ? " page__content--with-fab" : ""}`}>

        <label className="search" aria-label="Поиск оборудования">
          <span className="search__icon" aria-hidden="true"><IconSearch size={18} /></span>
          <input
            type="search"
            placeholder="Найти оборудование"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isSearching && (
            <button
              type="button"
              className="search__clear"
              aria-label="Очистить поиск"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          )}
        </label>

        <div className="quick-row">
          {rangeActive ? (
            <button
              type="button"
              className="period-pill"
              onClick={() => onNavigate("occupancy")}
              title="Изменить период"
            >
              <span className="period-pill__icon" aria-hidden="true"><ClockIcon /></span>
              <span className="period-pill__text">{formatRangeShort(cart.range)}</span>
              <span
                role="button"
                tabIndex={0}
                className="period-pill__clear"
                aria-label="Сбросить период"
                onClick={(e) => {
                  e.stopPropagation();
                  cartSetRange({ start: null, end: null });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    cartSetRange({ start: null, end: null });
                  }
                }}
              >×</span>
            </button>
          ) : (
            <button
              type="button"
              className="period-pill period-pill--empty"
              onClick={() => onNavigate("occupancy")}
            >
              <span className="period-pill__icon" aria-hidden="true"><ClockIcon /></span>
              <span className="period-pill__text">Выбрать время</span>
            </button>
          )}
          <button
            type="button"
            className={`fav-pill${showFavorites ? " is-active" : ""}`}
            onClick={() => setShowFavorites((v) => !v)}
            aria-pressed={showFavorites}
            title="Избранное"
          >
            <span className="fav-pill__star" aria-hidden="true">
              {showFavorites ? "\u2605" : "\u2606"}
            </span>
            {favoriteSet.size > 0 && (
              <span className="fav-pill__count">{favoriteSet.size}</span>
            )}
          </button>
        </div>

        <OccupancySummary />

        {!isSearching && !showFavorites && (
          <RecentActivity
            onOpenBookings={() => onNavigate("bookings")}
            onPickModel={(name) => { setQuery(name); setCategory("Все"); }}
          />
        )}

        <CategoryChips
          categories={categories}
          selected={category}
          onSelect={setCategory}
        />

        <section className="list list--catalog" aria-label="Оборудование">
          {state.kind === "loading" && (
            <div className="empty">
              <span className="spinner" aria-hidden="true" />
              <p className="empty__text">Загрузка каталога…</p>
            </div>
          )}

          {state.kind === "error" && (
            <div className="empty">
              <span className="empty__icon" aria-hidden="true"><IconAlert size={22} /></span>
              <p className="empty__text">
                Не удалось загрузить каталог: {state.message}
              </p>
              <button
                type="button"
                className="empty__action"
                onClick={() => window.location.reload()}
              >
                Повторить
              </button>
            </div>
          )}

          {state.kind === "ready" && (showFavorites ? visible.filter((i) => favoriteSet.has(i.modelId)) : visible).length === 0 && (
            <div className="empty">
              <span className="empty__icon" aria-hidden="true"><IconSearch size={22} /></span>
              <p className="empty__text">
                {isSearching
                  ? `Ничего не найдено по запросу «${query.trim()}»`
                  : showFavorites
                    ? "В избранном пока пусто"
                    : `В категории «${category}» пока ничего нет`}
              </p>
              <button
                type="button"
                className="empty__action"
                onClick={() => {
                  if (isSearching) setQuery("");
                  else if (showFavorites) setShowFavorites(false);
                  else setCategory("Все");
                }}
              >
                {isSearching ? "Очистить поиск" : "Показать всё"}
              </button>
            </div>
          )}

          {state.kind === "ready" &&
            (showFavorites ? visible.filter((i) => favoriteSet.has(i.modelId)) : visible).map((item) => {
              const busyInPeriod =
                rangeActive &&
                item.availableInPeriod !== undefined &&
                item.availableInPeriod !== null &&
                item.availableInPeriod <= 0;
              return (
                <div key={item.id} className="catalog-item-wrapper">
                  {busyInPeriod && (
                    <PeriodBusyBanner
                      item={item}
                      onApplyNearest={(s, e) =>
                        cartSetRange({ start: s, end: e })
                      }
                    />
                  )}
                  <EquipmentCard
                    item={item}
                    showCategory={category === "Все"}
                    selected={cart.items.has(item.modelId)}
                    onToggleSelect={toggleSelect}
                    favorite={favoriteSet.has(item.modelId)}
                    onToggleFavorite={() => toggleFavorite(item.modelId)}
                    onOpenAliases={() => setTagsTarget(item)}
                  />
                </div>
              );
            })}
        </section>

        <p className="mock-note">
          {state.kind === "ready"
            ? `Найдено: ${visible.length} из ${totalCount}`
            : "Источник: API каталога."}
        </p>
      </main>

      {selectedCount > 0 && (
        <div className="fab-bar" role="region" aria-label="Выбранные для брони">
          <div className="fab-bar__info">
            <span className="fab-bar__count">{selectedCount}</span>
            {rangeActive && (
              <span className="fab-bar__label">{formatTimeOnly(cart.range)}</span>
            )}
          </div>
          <button
            type="button"
            className="fab-bar__clear"
            onClick={() => cartClear()}
          >
            Очистить
          </button>
          <button
            type="button"
            className="fab-bar__cta"
            onClick={() => setBatchOpen(true)}
          >
            Забронировать
          </button>
        </div>
      )}

      <BatchBookingModal
        open={batchOpen}
        items={selectedItems}
        onClose={() => setBatchOpen(false)}
        onSuccess={onBatchSuccess}
      />

      {tagsTarget && (
        <ModelAliasesModal
          open={!!tagsTarget}
          modelId={tagsTarget.modelId}
          modelTitle={tagsTarget.shortName ?? tagsTarget.title}
          onClose={() => setTagsTarget(null)}
        />
      )}

      <BottomNav active="catalog" onSelect={onNavigate} />
    </div>
  );
}
