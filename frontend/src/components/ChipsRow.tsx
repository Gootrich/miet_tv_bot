import { useEffect, useRef, useState } from "react";

export interface ChipItem {
  code: string;
  label: string;
}

interface Props {
  items: ChipItem[];
  value: string;
  onChange: (code: string) => void;
  ariaLabel?: string;
}

/**
 * Обёртка над .chips-row/.chips-scroll/.chips-arrow — как в каталоге.
 * Полупрозрачные градиенты по краям + стрелки прокрутки при переполнении.
 */
export function ChipsRow({ items, value, onChange, ariaLabel }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const check = () => {
      setOverflowing(el.scrollWidth > el.clientWidth + 1);
      setAtStart(el.scrollLeft <= 1);
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
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
  }, [items.length]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div
      className="chips-row"
      data-overflowing={overflowing ? "true" : "false"}
      data-at-start={atStart ? "true" : "false"}
      data-at-end={atEnd ? "true" : "false"}
    >
      <div className="chips-scroll" ref={scrollRef}>
        <div className="chips" role="tablist" aria-label={ariaLabel ?? "Фильтры"}>
          {items.map((it) => {
            const active = it.code === value;
            return (
              <button
                key={it.code}
                type="button"
                role="tab"
                aria-selected={active}
                className={`chip${active ? " chip--active" : ""}`}
                onClick={() => onChange(it.code)}
              >
                {it.label}
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
          onClick={() => scrollBy(-1)}
        >
          ‹
        </button>
      )}

      {overflowing && !atEnd && (
        <button
          type="button"
          className="chips-arrow chips-arrow--right"
          aria-label="Прокрутить вправо"
          onClick={() => scrollBy(1)}
        >
          ›
        </button>
      )}
    </div>
  );
}
