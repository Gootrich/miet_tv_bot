import { useEffect, useRef, useState } from "react";

interface Props {
  categories: string[];
  selected: string;
  onSelect: (value: string) => void;
}

export function CategoryChips({ categories, selected, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [atStart, setAtStart] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const check = () => {
      setOverflowing(el.scrollWidth > el.clientWidth + 1);
      setAtStart(el.scrollLeft <= 1);
    };

    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);

    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [categories.length]);

  const scrollRight = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  const scrollLeft = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: -Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div
      className="chips-row"
      data-overflowing={overflowing ? "true" : "false"}
      data-at-start={atStart ? "true" : "false"}
    >
      <div className="chips-scroll" ref={scrollRef}>
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
      </div>

      {overflowing && !atStart && (
        <button
          type="button"
          className="chips-arrow chips-arrow--left"
          aria-label="Прокрутить влево"
          onClick={scrollLeft}
        >
          ‹
        </button>
      )}

      {overflowing && (
        <button
          type="button"
          className="chips-arrow chips-arrow--right"
          aria-label="Прокрутить вправо"
          onClick={scrollRight}
        >
          ›
        </button>
      )}
    </div>
  );
}
