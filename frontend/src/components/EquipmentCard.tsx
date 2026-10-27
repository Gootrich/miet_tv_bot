import { useState } from "react";
import { createBooking, type CatalogItem } from "../api/catalog";
import { DateTimeRangePicker, type DTRange } from "./DateTimeRangePicker";
import { QuantityStepper } from "./QuantityStepper";
import { EquipmentThumb } from "./EquipmentThumb";

function formatFreeUntil(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `до ${time}`;
  const date = d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return `до ${date}, ${time}`;
}

function availabilityLabel(item: CatalogItem): { text: string; kind: "ok" | "busy" | "off" } {
  const available = item.availableNow;
  const total = item.totalQuantity;
  if (total === 0) return { text: "Нет в наличии", kind: "off" };
  if (available <= 0) {
    return {
      text: item.freeUntil ? `Занято, ${formatFreeUntil(item.freeUntil)}` : "Занято",
      kind: "busy",
    };
  }
  if (item.freeUntil) return { text: `Свободно ${formatFreeUntil(item.freeUntil)}`, kind: "ok" };
  return { text: `${available} из ${total}`, kind: "ok" };
}

function defaultRange(): DTRange {
  const s = new Date();
  s.setSeconds(0, 0);
  const total = s.getHours() * 60 + s.getMinutes();
  const up = Math.ceil((total + 1) / 15) * 15;
  s.setHours(0, 0, 0, 0);
  s.setMinutes(up);
  const e = new Date(s.getTime() + 60 * 60 * 1000);
  return { start: s.toISOString(), end: e.toISOString() };
}

export function EquipmentCard({
  item,
  showCategory = false,
  selected = false,
  onToggleSelect,
}: {
  item: CatalogItem;
  showCategory?: boolean;
  selected?: boolean;
  onToggleSelect?: (item: CatalogItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [dtRange, setDtRange] = useState<DTRange>({ start: null, end: null });
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleToggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setDtRange(defaultRange());
    setQuantity(1);
    setComment("");
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dtRange.start || !dtRange.end) {
      setError("Укажите время начала и окончания");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      await createBooking({
        model_id: item.modelId,
        quantity: Number(quantity),
        planned_start: dtRange.start,
        planned_end: dtRange.end,
        comment: comment ? comment : null,
      });
      setSuccess("Бронирование создано");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания брони");
    } finally {
      setLoading(false);
    }
  };

  const av = availabilityLabel(item);

  return (
    <article className={`card card--row${open ? " card--open" : ""}`}>
      <button
        type="button"
        className="row-head"
        onClick={handleToggleOpen}
        aria-expanded={open}
      >
        <EquipmentThumb categoryCode={item.categoryCode} title={item.title} />
        <div className="row-head__main">
          <span className="row-head__title">{item.title}</span>
          <span className="row-head__meta">
            {showCategory ? `${item.category} · ` : ""}
            {item.subtitle || "—"}
          </span>
          <span className={`row-head__status row-head__status--${av.kind}`}>
            <span className={`status-dot status-dot--${
              av.kind === "ok" ? "success" : av.kind === "busy" ? "warning" : "error"
            }`} />
            {av.text}
          </span>
        </div>
        {onToggleSelect && (
          <span
            role="button"
            tabIndex={0}
            className={`row-head__select${selected ? " is-selected" : ""}`}
            aria-label={selected ? "Убрать из выбора" : "Добавить в выбор"}
            aria-pressed={selected}
            title={selected ? "Убрать из выбора" : "Добавить в выбор"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(item);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onToggleSelect(item);
              }
            }}
          >
            {selected ? "✓" : "+"}
          </span>
        )}
        <span className="row-head__chevron" aria-hidden="true">›</span>
      </button>

      {success && <div className="status-chip status-chip--success">{success}</div>}

      {open && (
        <form className="booking-form" onSubmit={handleSubmit}>
          {error && <div className="status-chip status-chip--error">{error}</div>}

          <DateTimeRangePicker
            variant="inline"
            value={dtRange}
            onChange={(next: DTRange) => setDtRange(next)}
          />

          {item.categoryCode === "studio" && (
            <div className="studio-hint">
              Студия: Пн–Сб 09:00–22:00, Вс — выходной (по согласованию)
            </div>
          )}

          <div className="field">
            Количество:
            <QuantityStepper
              value={quantity}
              min={1}
              max={Math.max(1, item.totalQuantity)}
              onChange={setQuantity}
            />
          </div>

          <label className="field">
            Комментарий:
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Необязательно"
            />
          </label>

          <div className="row-actions row-actions--split">
            <button type="button" className="card__cta card__cta--secondary"
              onClick={() => setOpen(false)}>Отмена</button>
            <button type="submit" className="card__cta" disabled={loading}>
              {loading ? "Отправка…" : "Подтвердить"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
