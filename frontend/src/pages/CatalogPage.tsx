import { useEffect, useMemo, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { CategoryChips } from "../components/CategoryChips";
import { EquipmentCard } from "../components/EquipmentCard";
import { BatchBookingModal } from "../components/BatchBookingModal";
import { TopBar } from "../components/TopBar";
import {
  categoryNames,
  fetchCatalog,
  toCatalogItems,
  type CatalogItem,
} from "../api/catalog";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: CatalogItem[]; categories: string[] };

function matches(item: CatalogItem, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    item.title.toLowerCase().includes(needle) ||
    item.subtitle.toLowerCase().includes(needle) ||
    item.category.toLowerCase().includes(needle)
  );
}

export function CatalogPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [category, setCategory] = useState<string>("Все");
  const [query, setQuery] = useState<string>("");

  // Мультивыбор: Map<model_id, quantity>
  const [selected, setSelected] = useState<Map<number, number>>(() => new Map());
  const [batchOpen, setBatchOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await fetchCatalog();
        if (cancelled) return;
        setState({
          kind: "ready",
          items: toCatalogItems(data),
          categories: categoryNames(data),
        });
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Неизвестная ошибка",
        });
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

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

  // --- выбор ---
  const toggleSelect = (item: CatalogItem) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.modelId)) next.delete(item.modelId);
      else next.set(item.modelId, 1);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Map());

  const selectedItems: Array<{ item: CatalogItem; quantity: number }> = useMemo(() => {
    if (state.kind !== "ready") return [];
    const byId = new Map(state.items.map((i) => [i.modelId, i]));
    const out: Array<{ item: CatalogItem; quantity: number }> = [];
    for (const [mid, q] of selected.entries()) {
      const it = byId.get(mid);
      if (it) out.push({ item: it, quantity: q });
    }
    return out;
  }, [state, selected]);

  const onBatchSuccess = () => {
    setBatchOpen(false);
    setSelected(new Map());
    onNavigate("bookings");
  };

  return (
    <div className="page">
      <TopBar />
      <main className={`page__content${selected.size > 0 ? " page__content--with-fab" : ""}`}>
        <label className="search" aria-label="Поиск оборудования">
          <span className="search__icon" aria-hidden="true">⌕</span>
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

        <CategoryChips
          categories={categories}
          selected={category}
          onSelect={setCategory}
        />

        <section className="list" aria-label="Оборудование">
          {state.kind === "loading" && (
            <div className="empty">
              <p className="empty__text">Загрузка каталога…</p>
            </div>
          )}

          {state.kind === "error" && (
            <div className="empty">
              <span className="empty__icon" aria-hidden="true">!</span>
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

          {state.kind === "ready" && visible.length === 0 && (
            <div className="empty">
              <span className="empty__icon" aria-hidden="true">⌕</span>
              <p className="empty__text">
                {isSearching
                  ? `Ничего не найдено по запросу «${query.trim()}»`
                  : `В категории «${category}» пока ничего нет`}
              </p>
              <button
                type="button"
                className="empty__action"
                onClick={() => {
                  if (isSearching) setQuery("");
                  else setCategory("Все");
                }}
              >
                {isSearching ? "Очистить поиск" : "Показать всё"}
              </button>
            </div>
          )}

          {state.kind === "ready" &&
            visible.map((item) => (
              <EquipmentCard
                key={item.id}
                item={item}
                showCategory={category === "Все"}
                selected={selected.has(item.modelId)}
                onToggleSelect={toggleSelect}
              />
            ))}
        </section>

        <p className="mock-note">
          {state.kind === "ready"
            ? `Найдено: ${visible.length} из ${totalCount}`
            : "Источник: API каталога."}
        </p>

      </main>

      {/* Плавающая панель «N выбрано» */}
      {selected.size > 0 && (
        <div className="fab-bar" role="region" aria-label="Выбранные для пакетной брони">
          <div className="fab-bar__info">
            <span className="fab-bar__count">{selected.size}</span>
            <span className="fab-bar__label">выбрано</span>
          </div>
          <button
            type="button"
            className="fab-bar__clear"
            onClick={clearSelection}
          >
            Очистить
          </button>
          <button
            type="button"
            className="fab-bar__cta"
            onClick={() => setBatchOpen(true)}
          >
            Забронировать выбранное
          </button>
        </div>
      )}

      <BatchBookingModal
        open={batchOpen}
        items={selectedItems}
        onClose={() => setBatchOpen(false)}
        onSuccess={onBatchSuccess}
      />

      <BottomNav active="catalog" onSelect={onNavigate} />
    </div>
  );
}
