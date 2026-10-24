import { MOCK_CATEGORIES, type MockCategory } from "../mocks/equipment";

interface Props {
  selected: MockCategory;
  onSelect: (value: MockCategory) => void;
}

export function CategoryChips({ selected, onSelect }: Props) {
  return (
    <div className="chips" role="tablist" aria-label="Категории">
      {MOCK_CATEGORIES.map((cat) => {
        const active = cat === selected;
        return (
          <button
            key={cat}
            type="button"
            role="tab"
            aria-selected={active}
            className={`chip${active ? " chip--active" : ""}`}
            onClick={() => onSelect(cat)}
          >
            {cat}
          </button>
        );
      })}
    </div>
  );
}
