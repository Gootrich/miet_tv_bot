import { useEffect, useMemo, useRef, useState } from "react";

export interface DTRange {
  start: string | null;
  end: string | null;
}

type Mode = "wheel" | "keyboard";
type Tab = "start" | "end";

interface Props {
  value: DTRange;
  onChange: (next: DTRange) => void;
  variant?: "inline" | "modal";
  stepMinutes?: 15;
  minDate?: Date;
  initialMode?: Mode;
  onModeChange?: (mode: Mode) => void;
}

const MODE_KEY = "miet.dtp.mode";

function readLocalMode(): Mode {
  if (typeof localStorage === "undefined") return "wheel";
  return localStorage.getItem(MODE_KEY) === "keyboard" ? "keyboard" : "wheel";
}
function writeLocalMode(m: Mode): void {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function toIso(d: Date): string { return d.toISOString(); }
function parseIso(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function nextQuarter(now = new Date()): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  const total = d.getMinutes();
  const up = Math.ceil((total + 1) / 15) * 15;
  d.setMinutes(0, 0, 0);
  d.setMinutes(up);
  return d;
}
function defaultStart(): Date { return nextQuarter(); }
function defaultEnd(start: Date): Date {
  return new Date(start.getTime() + 60 * 60 * 1000);
}
function isQuarter(d: Date): boolean {
  return d.getMinutes() % 15 === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
}
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

const MONTHS_FULL = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const WEEKDAYS_SHORT = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];

function formatHuman(d: Date | null): string {
  if (!d) return "—";
  const wd = WEEKDAYS_SHORT[d.getDay()];
  const date = d.toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${wd} ${date}, ${time}`;
}

export function DateTimeRangePicker({
  value,
  onChange,
  variant = "modal",
  stepMinutes = 15,
  minDate,
  initialMode,
  onModeChange,
}: Props) {
  const [mode, setMode] = useState<Mode>(() => initialMode ?? readLocalMode());
  const [tab, setTab] = useState<Tab>("start");

  const startDate = useMemo(() => parseIso(value.start), [value.start]);
  const endDate = useMemo(() => parseIso(value.end), [value.end]);
  const activeDate = tab === "start" ? startDate : endDate;

  const setActiveDate = (d: Date) => {
    if (tab === "start") {
      const needAuto = !endDate || endDate <= d;
      const nextEnd = needAuto ? defaultEnd(d) : endDate!;
      onChange({ start: toIso(d), end: toIso(nextEnd) });
    } else {
      onChange({ start: value.start, end: toIso(d) });
    }
  };

  const validation = useMemo(() => {
    if (!startDate || !endDate) return { ok: false, error: "Укажите начало и конец" };
    if (!isQuarter(startDate) || !isQuarter(endDate)) {
      return { ok: false, error: "Время должно быть кратно 15 минутам" };
    }
    if (startDate >= endDate) return { ok: false, error: "Начало должно быть раньше окончания" };
    if (minDate && startDate < minDate) return { ok: false, error: "Начало раньше минимальной даты" };
    return { ok: true, error: "" };
  }, [startDate, endDate, minDate]);

  const toggleMode = () => {
    const next: Mode = mode === "wheel" ? "keyboard" : "wheel";
    setMode(next);
    writeLocalMode(next);
    onModeChange?.(next);
  };

  const activeValue =
    activeDate ??
    (tab === "start" ? defaultStart() : defaultEnd(startDate ?? defaultStart()));

  return (
    <div className={`dtr dtr--${variant}`}>
      <div className="dtr__head">
        <div className="dtr__tabs segmented" role="tablist" aria-label="Часть интервала">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "start"}
            className={`segmented__item${tab === "start" ? " is-active" : ""}`}
            onClick={() => setTab("start")}
          >
            Начало
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "end"}
            className={`segmented__item${tab === "end" ? " is-active" : ""}`}
            onClick={() => setTab("end")}
          >
            Конец
          </button>
        </div>
        <button
          type="button"
          className="dtr__mode"
          onClick={toggleMode}
          aria-label={mode === "wheel" ? "Клавиатура" : "Крутилки"}
        >
          {mode === "wheel" ? "Клавиатура" : "Крутилки"}
        </button>
      </div>

      <div className="dtr-range-line">
        <span className="dtr-range-line__label">С:</span>
        <span className="dtr-range-line__value">{formatHuman(startDate)}</span>
        <span className="dtr-range-line__sep">·</span>
        <span className="dtr-range-line__label">До:</span>
        <span className="dtr-range-line__value">{formatHuman(endDate)}</span>
      </div>

      {mode === "wheel" ? (
        <WheelEditor
          value={activeValue}
          onChange={setActiveDate}
          stepMinutes={stepMinutes}
        />
      ) : (
        <KeyboardEditor value={activeValue} onChange={setActiveDate} />
      )}

      {!validation.ok && (
        <div className="dtr__error" role="alert">{validation.error}</div>
      )}
    </div>
  );
}

// ---------- wheel ----------

interface WheelEditorProps {
  value: Date;
  onChange: (d: Date) => void;
  stepMinutes: 15;
}

function WheelEditor({ value, onChange, stepMinutes }: WheelEditorProps) {
  const year = value.getFullYear();
  const month = value.getMonth() + 1;
  const day = value.getDate();
  const hour = value.getHours();
  const minute = value.getMinutes();

  const maxDay = daysInMonth(year, month);

  const setDay = (newDay: number) => {
    const d = new Date(value);
    d.setDate(Math.min(Math.max(1, newDay), daysInMonth(d.getFullYear(), d.getMonth() + 1)));
    d.setSeconds(0, 0);
    onChange(d);
  };

  const setMonth = (newMonth: number) => {
    const d = new Date(value);
    const prevMonth = d.getMonth() + 1;
    let yearShift = 0;
    if (prevMonth === 12 && newMonth === 1) yearShift = +1;
    else if (prevMonth === 1 && newMonth === 12) yearShift = -1;
    d.setFullYear(d.getFullYear() + yearShift);
    d.setMonth(newMonth - 1);
    const max = daysInMonth(d.getFullYear(), d.getMonth() + 1);
    if (d.getDate() > max) d.setDate(max);
    d.setSeconds(0, 0);
    onChange(d);
  };

  const setHour = (newHour: number) => {
    const d = new Date(value);
    d.setHours(newHour);
    d.setSeconds(0, 0);
    onChange(d);
  };

  const setMinute = (newMin: number) => {
    const d = new Date(value);
    d.setMinutes(newMin);
    d.setSeconds(0, 0);
    if (stepMinutes === 15) d.setMinutes(Math.round(d.getMinutes() / 15) * 15);
    onChange(d);
  };

  const days = Array.from({ length: maxDay }, (_, i) => i + 1);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 / stepMinutes }, (_, i) => i * stepMinutes);
  const monthValues = MONTHS_FULL.map((_, i) => i + 1);

  return (
    <div className="picker-wrap" role="group" aria-label="Выбор даты и времени">
      <div className="picker__year" aria-live="polite">{year}</div>
      <div className="picker">
        <WheelColumn
          label="День"
          values={days}
          value={Math.min(day, maxDay)}
          onChange={setDay}
          format={(v) => pad2(v)}
        />
        <WheelColumn
          label="Месяц"
          values={monthValues}
          value={month}
          onChange={setMonth}
          format={(v) => MONTHS_FULL[v - 1]}
        />
        <WheelColumn
          label="Часы"
          values={hours}
          value={hour}
          onChange={setHour}
          format={(v) => pad2(v)}
        />
        <WheelColumn
          label="Минуты"
          values={minutes}
          value={minute}
          onChange={setMinute}
          format={(v) => pad2(v)}
        />
      </div>
    </div>
  );
}

// ---------- WheelColumn ----------

const ITEM_H = 40;
const VISIBLE_ROWS = 3;
const REPEAT = 3;
const CENTER_OFFSET = ((VISIBLE_ROWS - 1) / 2) * ITEM_H;
const SNAP_DEBOUNCE_MS = 90;

interface WheelColumnProps {
  label: string;
  values: number[];
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}

function WheelColumn({ label, values, value, onChange, format }: WheelColumnProps) {
  const len = values.length;
  const midStart = Math.floor(REPEAT / 2) * len;

  const ref = useRef<HTMLDivElement | null>(null);
  const initRef = useRef(false);
  const programmaticRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const lastIdxRef = useRef<number>(-1);

  const items = useMemo(() => {
    const arr: number[] = [];
    for (let r = 0; r < REPEAT; r++) arr.push(...values);
    return arr;
  }, [values]);

  const baseIdx = Math.max(0, values.indexOf(value));

  useEffect(() => {
    if (initRef.current) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = (midStart + baseIdx) * ITEM_H - CENTER_OFFSET;
    lastIdxRef.current = midStart + baseIdx;
    initRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cur = lastIdxRef.current;
    if (cur < 0) return;
    const curVal = items[((cur % len) + len) % len];
    if (curVal === value) return;
    programmaticRef.current = true;
    let best = cur;
    let bestDist = Infinity;
    for (const off of [-len, 0, len]) {
      const cand = cur + off + (values.indexOf(value) - curVal + len) % len;
      if (cand < 0 || cand >= items.length) continue;
      const dist = Math.abs(cand - cur);
      if (dist < bestDist) { bestDist = dist; best = cand; }
    }
    el.scrollTo({ top: best * ITEM_H - CENTER_OFFSET, behavior: "smooth" });
    lastIdxRef.current = best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const finalize = () => {
    const el = ref.current;
    if (!el) return;
    const idx = Math.round((el.scrollTop + CENTER_OFFSET) / ITEM_H);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    const newValue = values[((clamped % len) + len) % len];

    if (clamped !== lastIdxRef.current) {
      lastIdxRef.current = clamped;
      if (newValue !== value) onChange(newValue);
    }
    const lo = len;
    const hi = items.length - len;
    if (clamped < lo || clamped >= hi) {
      const middleIdx = midStart + ((clamped % len) + len) % len;
      programmaticRef.current = true;
      el.scrollTop = middleIdx * ITEM_H - CENTER_OFFSET;
      lastIdxRef.current = middleIdx;
    }
  };

  const onScroll = () => {
    if (programmaticRef.current) {
      programmaticRef.current = false;
      return;
    }
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(finalize, SNAP_DEBOUNCE_MS);
  };

  const goToIndex = (targetIdx: number, smooth: boolean) => {
    const el = ref.current;
    if (!el) return;
    programmaticRef.current = true;
    el.scrollTo({ top: targetIdx * ITEM_H - CENTER_OFFSET, behavior: smooth ? "smooth" : "auto" });
    lastIdxRef.current = targetIdx;
    const v = values[((targetIdx % len) + len) % len];
    if (v !== value) onChange(v);
  };

  const curIdx = lastIdxRef.current >= 0 ? lastIdxRef.current : midStart + baseIdx;
  const prevIdx = curIdx - 1;
  const nextIdx = curIdx + 1;

  return (
    <div className="picker__col">
      <div className="picker__label">{label}</div>
      <div
        className="picker__wheel"
        ref={ref}
        onScroll={onScroll}
        role="listbox"
        aria-label={label}
      >
        <div className="picker__spacer" />
        {items.map((v, i) => {
          const isSel = v === value;
          const isAdj = i === prevIdx || i === nextIdx;
          return (
            <button
              key={`${v}-${i}`}
              type="button"
              role="option"
              aria-selected={isSel}
              className={`picker__row${isSel ? " is-active" : ""}${isAdj ? " picker__row--adj" : ""}`}
              onClick={() => goToIndex(i, true)}
            >
              {format(v)}
            </button>
          );
        })}
        <div className="picker__spacer" />
        <button
          type="button"
          className="picker__hit picker__hit--top"
          aria-label="Предыдущее значение"
          onClick={() => goToIndex(prevIdx, true)}
        />
        <button
          type="button"
          className="picker__hit picker__hit--bottom"
          aria-label="Следующее значение"
          onClick={() => goToIndex(nextIdx, true)}
        />
      </div>
    </div>
  );
}

// ---------- keyboard ----------

interface KeyboardProps {
  value: Date;
  onChange: (d: Date) => void;
}

function KeyboardEditor({ value, onChange }: KeyboardProps) {
  const [dd, setDd] = useState(pad2(value.getDate()));
  const [mm, setMm] = useState(pad2(value.getMonth() + 1));
  const [yyyy, setYyyy] = useState(String(value.getFullYear()));
  const [hh, setHh] = useState(pad2(value.getHours()));
  const [mi, setMi] = useState(pad2(value.getMinutes()));

  useEffect(() => {
    setDd(pad2(value.getDate()));
    setMm(pad2(value.getMonth() + 1));
    setYyyy(String(value.getFullYear()));
    setHh(pad2(value.getHours()));
    setMi(pad2(value.getMinutes()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.getTime()]);

  const emit = (parts: { dd?: string; mm?: string; yyyy?: string; hh?: string; mi?: string }) => {
    const d = new Date(value);
    const ddV = Number(parts.dd ?? dd);
    const mmV = Number(parts.mm ?? mm);
    const yyyyV = Number(parts.yyyy ?? yyyy);
    const hhV = Number(parts.hh ?? hh);
    const miV = Number(parts.mi ?? mi);
    if (
      Number.isFinite(ddV) && ddV >= 1 && ddV <= 31 &&
      Number.isFinite(mmV) && mmV >= 1 && mmV <= 12 &&
      Number.isFinite(yyyyV) && yyyyV >= 2000 && yyyyV <= 2100 &&
      Number.isFinite(hhV) && hhV >= 0 && hhV <= 23 &&
      Number.isFinite(miV) && miV >= 0 && miV <= 59
    ) {
      d.setFullYear(yyyyV);
      d.setMonth(mmV - 1);
      d.setDate(ddV);
      d.setHours(hhV);
      d.setMinutes(Math.round(miV / 15) * 15);
      d.setSeconds(0, 0);
      onChange(d);
    }
  };

  return (
    <div className="dtr-kb">
      <div className="dtr-kb__row">
        <KbCell label="ДД" maxLen={2} value={dd} setValue={(v) => { setDd(v); emit({ dd: v }); }} />
        <span className="dtr-kb__sep">.</span>
        <KbCell label="ММ" maxLen={2} value={mm} setValue={(v) => { setMm(v); emit({ mm: v }); }} />
        <span className="dtr-kb__sep">.</span>
        <KbCell label="ГГГГ" maxLen={4} value={yyyy} setValue={(v) => { setYyyy(v); emit({ yyyy: v }); }} />
        <span className="dtr-kb__sep"> </span>
        <KbCell label="ЧЧ" maxLen={2} value={hh} setValue={(v) => { setHh(v); emit({ hh: v }); }} />
        <span className="dtr-kb__sep">:</span>
        <KbCell label="ММ" maxLen={2} value={mi} setValue={(v) => { setMi(v); emit({ mi: v }); }} />
      </div>
      <div className="dtr-kb__hint">Ввод с клавиатуры, шаг минут — 15</div>
    </div>
  );
}

interface KbCellProps {
  label: string;
  maxLen: number;
  value: string;
  setValue: (v: string) => void;
}

function KbCell({ label, maxLen, value, setValue }: KbCellProps) {
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, maxLen);
    setValue(digits);
    if (digits.length >= maxLen) {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".dtr-kb__input"));
      const i = inputs.indexOf(e.target);
      if (i >= 0 && i + 1 < inputs.length) {
        inputs[i + 1].focus();
        inputs[i + 1].select?.();
      }
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && value.length === 0) {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(".dtr-kb__input"));
      const i = inputs.indexOf(e.target as HTMLInputElement);
      if (i > 0) inputs[i - 1].focus();
    }
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };
  return (
    <label className="dtr-kb__cell">
      <input
        type="text"
        inputMode="numeric"
        className="dtr-kb__input"
        value={value}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.currentTarget.select()}
        maxLength={maxLen}
        aria-label={label}
      />
      <span className="dtr-kb__cell-label">{label}</span>
    </label>
  );
}
