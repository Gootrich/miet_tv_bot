import { useEffect, useState } from "react";

interface Props {
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
  ariaLabel?: string;
}

/**
 * Количество: [-] [input] [+].
 * - Кнопки "-"/"+" неактивны при достижении границ.
 * - Если max <= min (свободных единиц нет) — компонент не рендерится.
 * - Общий контейнер — «pill», ширина зависит от длины числа.
 */
export function QuantityStepper({ value, min = 1, max, onChange, ariaLabel }: Props) {
  const [text, setText] = useState(String(value));

  // Синхронизация при внешнем изменении value
  useEffect(() => {
    setText(String(value));
  }, [value]);

  // НЕ скрываем при max <= min — показываем «1», но обе кнопки будут
  // задизейблены (значение = max = min).
  if (max < min) {
    // защита от «совсем пустых» входов
    return null;
  }

  const apply = (v: number) => {
    const clamped = Math.max(min, Math.min(max, v));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    setText(raw);
    const n = Number(raw);
    if (raw !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n);
  };

  const onBlur = () => {
    const n = Number(text);
    const clamped = Number.isFinite(n) && text !== "" ? Math.max(min, Math.min(max, n)) : value;
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  const canDec = value > min;
  const canInc = value < max;

  return (
    <div className="qty" role="group" aria-label={ariaLabel ?? "Количество"}>
      <button
        type="button"
        className="qty__btn"
        aria-label="Уменьшить"
        onClick={() => apply(value - 1)}
        disabled={!canDec}
      >−</button>
      <input
        type="text"
        inputMode="numeric"
        className="qty__input"
        value={text}
        onChange={onInput}
        onBlur={onBlur}
        onFocus={(e) => e.currentTarget.select()}
        aria-label={ariaLabel ?? "Количество"}
      />
      <button
        type="button"
        className="qty__btn"
        aria-label="Увеличить"
        onClick={() => apply(value + 1)}
        disabled={!canInc}
      >+</button>
    </div>
  );
}
