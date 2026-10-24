import { useEffect, useMemo, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { CategoryChips } from "../components/CategoryChips";
import { EquipmentCard } from "../components/EquipmentCard";
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

export function CatalogPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [category, setCategory] = useState<string>("Все");

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
          message:
            error instanceof Error ? error.message : "Неизвестная ошибка",
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = state.kind === "ready" ? state.categories : ["Все"];

  const visible = useMemo(() => {
    if (state.kind !== "ready") return [];
    return category === "Все"
      ? state.items
      : state.items.filter((item) => item.category === category);
  }, [state, category]);

  return (
    <div className="page">
      <TopBar />
      <main className="page__content">
        <label className="search" aria-label="Поиск оборудования">
          <span className="search__icon" aria-hidden="true">⌕</span>
          <input type="search" placeholder="Найти оборудование" disabled />
        </label>

        <CategoryChips
          categories={categories}
          selected={category}
          onSelect={setCategory}
        />

        {/* Ключ category гарантирует перерисовку и сброс форм при смене вкладки */}
        <section key={category} className="list" aria-label="Оборудование">
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
                В категории «{category}» пока ничего нет
              </p>
              <button
                type="button"
                className="empty__action"
                onClick={() => setCategory("Все")}
              >
                Показать всё
              </button>
            </div>
          )}

          {state.kind === "ready" &&
            visible.map((item) => <EquipmentCard key={item.id} item={item} />)}
        </section>

        <p className="mock-note">
          Источник: API каталога.
        </p>
      </main>
      <BottomNav active="catalog" onSelect={onNavigate} />
    </div>
  );
}
