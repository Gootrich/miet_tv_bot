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

function formatDuration(ms: number): string {
  const total = Math.round(ms / 60000);
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} д`);
  if (h) parts.push(`${h} ч`);
  if (m) parts.push(`${m} мин`);
  return parts.join(" ") || "0 мин";
}

interface DtrCardProps {
  label: string;
  date: Date | null;
  active: boolean;
  onClick: () => void;
}

function DtrCard({ label, date, active, onClick }: DtrCardProps) {
  const day = date
    ? `${WEEKDAYS_SHORT[date.getDay()]}, ${date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`
    : "—";
  const time = date
    ? date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : "--:--";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={`${label}: ${formatHuman(date)}`}
      className={`dtr-card${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      <span className="dtr-card__label">{label}</span>
      <span className="dtr-card__time">{time}</span>
      <span className="dtr-card__day">{day}</span>
    </button>
  );
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
      const minEnd = startDate ? new Date(startDate.getTime() + 15 * 60 * 1000) : d;
      onChange({ start: value.start, end: toIso(d < minEnd ? minEnd : d) });
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

  // Значения по умолчанию: ближайшие 15 минут сегодня, конец = начало + 1 час.
  useEffect(() => {
    if (startDate && endDate) return;
    const s0 = startDate ?? defaultStart();
    const e0 = endDate && endDate > s0 ? endDate : defaultEnd(s0);
    onChange({ start: toIso(s0), end: toIso(e0) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMode = () => {
    const next: Mode = mode === "wheel" ? "keyboard" : "wheel";
    setMode(next);
    writeLocalMode(next);
    onModeChange?.(next);
  };

  const activeValue =
    activeDate ??
    (tab === "start" ? defaultStart() : defaultEnd(startDate ?? defaultStart()));

  const shiftYear = (delta: number) => {
    const next = addMonths(activeValue, delta * 12);
    const y = next.getFullYear();
    if (y >= MIN_YEAR && y <= MAX_YEAR) setActiveDate(next);
  };

  return (
    <div className={`dtr dtr--${variant}`}>
      <div className="dtr-cards" role="tablist" aria-label="Часть интервала">
        <DtrCard
          label="Начало"
          date={startDate}
          active={tab === "start"}
          onClick={() => setTab("start")}
        />
        <DtrCard
          label="Конец"
          date={endDate}
          active={tab === "end"}
          onClick={() => setTab("end")}
        />
      </div>

      <div className="dtr__modebar">
        <div className="dtr__duration" aria-live="polite">
          {validation.ok && startDate && endDate ? formatDuration(endDate.getTime() - startDate.getTime()) : ""}
        </div>
        {mode === "wheel" ? (
          <div className="dtr__year" aria-label="Год">
            <button type="button" className="dtr__year-btn" aria-label="Предыдущий год"
              disabled={activeValue.getFullYear() <= MIN_YEAR} onClick={() => shiftYear(-1)}>‹</button>
            <span>{activeValue.getFullYear()}</span>
            <button type="button" className="dtr__year-btn" aria-label="Следующий год"
              disabled={activeValue.getFullYear() >= MAX_YEAR} onClick={() => shiftYear(1)}>›</button>
          </div>
        ) : <span />}
        <button
          type="button"
          className="dtr__mode-btn"
          onClick={toggleMode}
          aria-label={mode === "wheel" ? "Ввод с клавиатуры" : "Крутилки"}
          title={mode === "wheel" ? "Ввод с клавиатуры" : "Крутилки"}
        >
          {mode === "wheel" ? <KeyboardIcon /> : <WheelIcon />}
        </button>
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

const MONTHS_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function withYMD(base: Date, y: number, m: number, dd: number): Date {
  const d = new Date(base);
  d.setDate(1);
  d.setFullYear(y);
  d.setMonth(m - 1);
  d.setDate(Math.min(dd, daysInMonth(y, m)));
  d.setSeconds(0, 0);
  return d;
}

function addMonths(d: Date, n: number): Date {
  const day = d.getDate();
  const r = new Date(d);
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  r.setDate(Math.min(day, daysInMonth(r.getFullYear(), r.getMonth() + 1)));
  return r;
}

function KeyboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="3" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </svg>
  );
}

function WheelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

interface WheelEditorProps {
  value: Date;
  onChange: (d: Date) => void;
  stepMinutes: 15;
}

function WheelEditor({ value, onChange, stepMinutes }: WheelEditorProps) {
  const year = value.getFullYear();
  const stepMs = stepMinutes * 60000;

  const commit = (d: Date) => {
    d.setSeconds(0, 0);
    const y = d.getFullYear();
    if (y < MIN_YEAR || y > MAX_YEAR) return;
    onChange(d);
  };

  const stepDay = (n: number) => { const d = new Date(value); d.setDate(d.getDate() + n); commit(d); };
  const stepMonth = (n: number) => commit(addMonths(value, n));
  const stepHour = (n: number) => commit(new Date(value.getTime() + n * 3600000));
  const stepMinute = (n: number) => commit(new Date(value.getTime() + n * stepMs));

  const dayLabel = (k: number) => pad2(new Date(year, value.getMonth(), value.getDate() + k).getDate());
  const monthLabel = (k: number) => MONTHS_SHORT[addMonths(value, k).getMonth()];
  const hourLabel = (k: number) => pad2(new Date(value.getTime() + k * 3600000).getHours());
  const minuteLabel = (k: number) => pad2(new Date(value.getTime() + k * stepMs).getMinutes());

  return (
    <div className="picker-wrap" role="group" aria-label="Выбор даты и времени" data-no-swipe>
      <div
        className="picker"
        style={{ "--picker-item-h": `${ITEM_H}px`, "--picker-visible": VISIBLE_ROWS } as React.CSSProperties}
      >
        <WheelColumn label="День" render={dayLabel} onStep={stepDay} />
        <WheelColumn label="Месяц" render={monthLabel} onStep={stepMonth} />
        <WheelColumn label="Часы" render={hourLabel} onStep={stepHour} />
        <WheelColumn label="Минуты" render={minuteLabel} onStep={stepMinute} />
      </div>
    </div>
  );
}

// ---------- WheelColumn (бесконечное колесо, жесты через Pointer Events) ----------

const ITEM_H = 32;
const VISIBLE_ROWS = 5;
const ROW_OFFSETS = [-3, -2, -1, 0, 1, 2, 3];
const MAX_V = 3; // px/ms

interface WheelColumnProps {
  label: string;
  render: (k: number) => string;
  onStep: (delta: number) => void;
}

function WheelColumn({ label, render, onStep }: WheelColumnProps) {
  const [offset, setOffset] = useState(0);
  const [animate, setAnimate] = useState(false);
  const offRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const viewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ y: number; t: number; v: number; moved: number } | null>(null);
  const wheelAcc = useRef(0);
  const wheelLast = useRef(0);

  const setOff = (n: number, anim: boolean) => {
    offRef.current = n;
    setAnimate(anim);
    setOffset(n);
  };

  const stopInertia = () => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  };

  const easeToZero = () =>
    requestAnimationFrame(() => requestAnimationFrame(() => setOff(0, true)));

  // Сдвиг в пикселях: целые строки превращаются в шаги значения.
  const applyMove = (dy: number) => {
    let o = offRef.current + dy;
    const s = Math.trunc(o / ITEM_H);
    if (s !== 0) { o -= s * ITEM_H; stepRef.current(-s); }
    setOff(o, false);
  };

  const settle = () => {
    let o = offRef.current;
    const s = Math.round(o / ITEM_H);
    if (s !== 0) { o -= s * ITEM_H; stepRef.current(-s); }
    setOff(o, false);
    easeToZero();
  };

  // Плавный переход на delta строк (тап, колесо мыши, клавиши).
  const glide = (delta: number) => {
    stopInertia();
    stepRef.current(delta);
    setOff(delta * ITEM_H, false);
    easeToZero();
  };

  const coast = (v0: number) => {
    let v = Math.max(-MAX_V, Math.min(MAX_V, v0));
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      applyMove(v * dt);
      v *= Math.pow(0.94, dt / 16);
      if (Math.abs(v) < 0.03) { rafRef.current = null; settle(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelAcc.current += e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      const now = performance.now();
      if (Math.abs(wheelAcc.current) < 40 || now - wheelLast.current < 40) return;
      const dir = wheelAcc.current > 0 ? 1 : -1;
      wheelAcc.current = 0;
      wheelLast.current = now;
      glide(dir);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      stopInertia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stopInertia();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { y: e.clientY, t: performance.now(), v: 0, moved: 0 };
    setOff(offRef.current, false);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const now = performance.now();
    const dy = e.clientY - d.y;
    const dt = Math.max(1, now - d.t);
    d.v = 0.7 * d.v + 0.3 * (dy / dt);
    d.y = e.clientY;
    d.t = now;
    d.moved += Math.abs(dy);
    if (dy !== 0) applyMove(dy);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved < 5) {
      const rect = viewRef.current?.getBoundingClientRect();
      if (rect) {
        const k = Math.floor((e.clientY - rect.top) / ITEM_H) - (VISIBLE_ROWS - 1) / 2;
        if (k !== 0) { glide(k); return; }
      }
      settle();
      return;
    }
    if (Math.abs(d.v) > 0.15) coast(d.v);
    else settle();
  };

  const onPointerCancel = () => {
    if (dragRef.current) { dragRef.current = null; settle(); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp") { e.preventDefault(); glide(-1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); glide(1); }
  };

  return (
    <div className="picker__col">
      <div className="picker__label">{label}</div>
      <div
        className="picker__viewport"
        ref={viewRef}
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuetext={render(0)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div className="picker__band" aria-hidden="true" />
        <div
          className={`picker__track${animate ? " is-anim" : ""}`}
          style={{ transform: `translateY(${offset}px)` }}
        >
          {ROW_OFFSETS.map((k) => (
            <div key={k} className="picker__row" data-k={Math.abs(k)} aria-hidden={k !== 0}>
              {render(k)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- keyboard ----------

interface KeyboardProps {
  value: Date;
  onChange: (d: Date) => void;
}

interface KbFields { dd: string; mm: string; yyyy: string; hh: string; mi: string; }

function toFields(d: Date): KbFields {
  return {
    dd: pad2(d.getDate()),
    mm: pad2(d.getMonth() + 1),
    yyyy: String(d.getFullYear()),
    hh: pad2(d.getHours()),
    mi: pad2(d.getMinutes()),
  };
}

function KeyboardEditor({ value, onChange }: KeyboardProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [f, setF] = useState<KbFields>(() => toFields(value));

  // Не перезаписываем поля, пока пользователь печатает внутри редактора.
  useEffect(() => {
    const root = rootRef.current;
    if (root && root.contains(document.activeElement)) return;
    setF(toFields(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.getTime()]);

  const commit = (fields: KbFields): boolean => {
    if (Object.values(fields).some((s) => s === "")) return false;
    const dd = Number(fields.dd), mm = Number(fields.mm), yy = Number(fields.yyyy);
    const hh = Number(fields.hh), mi = Number(fields.mi);
    if (
      fields.yyyy.length !== 4 || yy < MIN_YEAR || yy > MAX_YEAR ||
      mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59
    ) return false;
    const d = withYMD(value, yy, mm, dd);
    d.setHours(hh, Math.round(mi / 15) * 15, 0, 0);
    if (d.getTime() !== value.getTime()) onChange(d);
    return true;
  };

  const type = (key: keyof KbFields, v: string, complete: boolean) => {
    const next = { ...f, [key]: v };
    setF(next);
    if (complete) commit(next);
  };

  const onBlur = () => {
    if (commit(f)) {
      setF((p) => ({
        ...p,
        dd: p.dd.padStart(2, "0"), mm: p.mm.padStart(2, "0"),
        hh: p.hh.padStart(2, "0"), mi: p.mi.padStart(2, "0"),
      }));
    } else {
      setF(toFields(value));
    }
  };

  return (
    <div className="dtr-kb" ref={rootRef} data-no-swipe>
      <div className="dtr-kb__row">
        <KbCell label="ДД" maxLen={2} value={f.dd} onType={(v, c) => type("dd", v, c)} onBlur={onBlur} />
        <span className="dtr-kb__sep">.</span>
        <KbCell label="ММ" maxLen={2} value={f.mm} onType={(v, c) => type("mm", v, c)} onBlur={onBlur} />
        <span className="dtr-kb__sep">.</span>
        <KbCell label="ГГГГ" maxLen={4} value={f.yyyy} onType={(v, c) => type("yyyy", v, c)} onBlur={onBlur} />
        <span className="dtr-kb__sep"> </span>
        <KbCell label="ЧЧ" maxLen={2} value={f.hh} onType={(v, c) => type("hh", v, c)} onBlur={onBlur} />
        <span className="dtr-kb__sep">:</span>
        <KbCell label="ММ" maxLen={2} value={f.mi} onType={(v, c) => type("mi", v, c)} onBlur={onBlur} />
      </div>
      <div className="dtr-kb__hint">Нажмите на поле и вводите цифры · шаг минут — 15</div>
    </div>
  );
}

interface KbCellProps {
  label: string;
  maxLen: number;
  value: string;
  onType: (v: string, complete: boolean) => void;
  onBlur: () => void;
}

function KbCell({ label, maxLen, value, onType, onBlur }: KbCellProps) {
  // После фокуса первая введённая цифра заменяет всё значение поля (без выделения и контекстного меню).
  const fresh = useRef(false);

  const inputs = (el: HTMLInputElement) =>
    Array.from(el.closest(".dtr-kb")?.querySelectorAll<HTMLInputElement>(".dtr-kb__input") ?? []);

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    let digits = el.value.replace(/\D/g, "");
    const typed = (e.nativeEvent as InputEvent).data;
    if (fresh.current && typed && /^\d+$/.test(typed)) digits = typed;
    fresh.current = false;
    digits = digits.slice(0, maxLen);
    const complete = digits.length >= maxLen;
    onType(digits, complete);
    if (complete) {
      const list = inputs(el);
      const i = list.indexOf(el);
      if (i >= 0 && i + 1 < list.length) list[i + 1].focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" || e.key === "Delete") {
      fresh.current = false;
      if (e.key === "Backspace" && value.length === 0) {
        const list = inputs(e.currentTarget);
        const i = list.indexOf(e.currentTarget);
        if (i > 0) list[i - 1].focus();
      }
    }
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <label className="dtr-kb__cell">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        className="dtr-kb__input"
        value={value}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onFocus={() => { fresh.current = true; }}
        onBlur={onBlur}
        onContextMenu={(e) => e.preventDefault()}
        style={{ WebkitTouchCallout: "none" } as React.CSSProperties}
        maxLength={maxLen}
        aria-label={label}
      />
      <span className="dtr-kb__cell-label">{label}</span>
    </label>
  );
}
