import { useMemo, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { CategoryChips } from "../components/CategoryChips";
import { EquipmentCard } from "../components/EquipmentCard";
import { TopBar } from "../components/TopBar";
import { MOCK_EQUIPMENT, type MockCategory } from "../mocks/equipment";

export function CatalogPage() {
  const [category, setCategory] = useState<MockCategory>("Все");

  const visible = useMemo(
    () =>
      category === "Все"
        ? MOCK_EQUIPMENT
        : MOCK_EQUIPMENT.filter((item) => item.category === category),
    [category],
  );

  return (
    <div className="page">
      <TopBar />
      <main className="page__content">
        <label className="search" aria-label="Поиск оборудования">
          <span className="search__icon" aria-hidden="true">⌕</span>
          <input type="search" placeholder="Найти оборудование" disabled />
        </label>

        <CategoryChips selected={category} onSelect={setCategory} />

        <section className="list" aria-label="Оборудование">
          {visible.length === 0 ? (
            <div className="empty">
              <span className="empty__icon" aria-hidden="true">⌕</span>
              <p className="empty__text">В категории «{category}» пока ничего нет</p>
              <button
                type="button"
                className="empty__action"
                onClick={() => setCategory("Все")}
              >
                Показать всё
              </button>
            </div>
          ) : (
            visible.map((item) => <EquipmentCard key={item.id} item={item} />)
          )}
        </section>

        <p className="mock-note">Демо-данные. Реальный каталог — на следующем этапе.</p>
      </main>
      <BottomNav active="catalog" />
    </div>
  );
}
