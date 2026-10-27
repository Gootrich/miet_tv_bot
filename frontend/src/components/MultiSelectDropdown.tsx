import { useEffect, useMemo, useRef, useState } from "react";

interface Option {
  id: number;
  label: string;
}

interface Props {
  label: string;
  emptyLabel: string;
  options: Option[];
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}

export function MultiSelectDropdown({
  label,
  emptyLabel,
  options,
  selected,
  onChange,
  disabled,
  searchable = false,
  searchPlaceholder = "Поиск…",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const summary = (): string => {
    if (selected.size === 0) return emptyLabel;
    if (selected.size === 1) {
      const id = [...selected][0];
      const opt = options.find((o) => o.id === id);
      return opt?.label ?? label;
    }
    return `${label} (${selected.size})`;
  };

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="ms-dropdown" ref={ref}>
      <button
        type="button"
        className={`ms-dropdown__trigger${selected.size > 0 ? " is-active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={summary()}
      >
        <span className="ms-dropdown__label">{summary()}</span>
        <span className="ms-dropdown__chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="ms-dropdown__panel" role="listbox" aria-multiselectable="true">
          <div className="ms-dropdown__head">
            <span>{label}</span>
            {selected.size > 0 && (
              <button
                type="button"
                className="ms-dropdown__clear"
                onClick={() => onChange(new Set())}
              >
                Очистить
              </button>
            )}
          </div>
          {searchable && (
            <div className="ms-dropdown__search">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={`Поиск: ${label}`}
                autoFocus
              />
            </div>
          )}
          <div className="ms-dropdown__list">
            {filtered.length === 0 && (
              <div className="ms-dropdown__empty">
                {options.length === 0 ? "Нет опций" : "Ничего не найдено"}
              </div>
            )}
            {filtered.map((o) => {
              const checked = selected.has(o.id);
              return (
                <label key={o.id} className="ms-dropdown__item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o.id)}
                  />
                  <span>{o.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
