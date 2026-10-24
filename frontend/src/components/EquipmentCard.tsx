import { useState } from "react";
import { createBooking, type CatalogItem } from "../api/catalog";

const ICON: Record<CatalogItem["icon"], string> = {
  camera: "📷",
  light: "💡",
  mic: "🎙",
};

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
  if (item.freeUntil) {
    return { text: `Свободно ${formatFreeUntil(item.freeUntil)}`, kind: "ok" };
  }
  return { text: `${available} из ${total}`, kind: "ok" };
}

export function EquipmentCard({
  item,
  showCategory = false,
}: {
  item: CatalogItem;
  showCategory?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const toLocalInput = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  };

  const setDurationHours = (hours: number) => {
    const startDate = new Date();
    const totalMinutes = startDate.getHours() * 60 + startDate.getMinutes();
    const roundedUp = Math.ceil((totalMinutes + 1) / 15) * 15;
    startDate.setHours(0, 0, 0, 0);
    startDate.setMinutes(roundedUp);
    const endDate = new Date(startDate.getTime() + hours * 60 * 60 * 1000);
    setStart(toLocalInput(startDate));
    setEnd(toLocalInput(endDate));
  };

  const handleOpen = () => {
    setOpen(true);
    setDurationHours(2);
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!start || !end) {
      setError("Укажите время начала и окончания");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      await createBooking({
        model_id: item.modelId,
        quantity: Number(quantity),
        planned_start: new Date(start).toISOString(),
        planned_end: new Date(end).toISOString(),
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
        onClick={handleOpen}
        aria-expanded={open}
      >
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
        <span className="row-head__icon" aria-hidden="true">{ICON[item.icon]}</span>
        <span className="row-head__chevron" aria-hidden="true">›</span>
      </button>

      {success && <div className="status-chip status-chip--success">{success}</div>}

      {open && (
        <form className="booking-form" onSubmit={handleSubmit}>
          {error && <div className="status-chip status-chip--error">{error}</div>}

          <div className="preset-row">
            <button type="button" className="preset" onClick={() => setDurationHours(2)}>+2 часа</button>
            <button type="button" className="preset" onClick={() => setDurationHours(4)}>+4 часа</button>
            <button type="button" className="preset" onClick={() => setDurationHours(24)}>Сутки</button>
          </div>

          <label className="field">
            Начало:
            <input
              type="datetime-local"
              step="900"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </label>

          <label className="field">
            Конец:
            <input
              type="datetime-local"
              step="900"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </label>

          <label className="field">
            Количество:
            <input
              type="number"
              min="1"
              max={Math.max(1, item.totalQuantity)}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              required
            />
          </label>

          <label className="field">
            Комментарий:
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Необязательно"
            />
          </label>

          <div className="row-actions">
            <button type="submit" className="card__cta" disabled={loading}>
              {loading ? "Отправка…" : "Подтвердить"}
            </button>
            <button
              type="button"
              className="empty__action"
              onClick={() => setOpen(false)}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
