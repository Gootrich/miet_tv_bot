interface Props {
  categories: string[];
  selected: string;
  onSelect: (value: string) => void;
}

export function CategoryChips({ categories, selected, onSelect }: Props) {
  return (
    <div className="chips" role="tablist" aria-label="Категории">
      {categories.map((cat) => {
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
