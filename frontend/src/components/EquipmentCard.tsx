import { useState } from "react";
import { createBooking, type CatalogItem } from "../api/catalog";
import { DateTimeRangePicker, type DTRange } from "./DateTimeRangePicker";
import { QuantityStepper } from "./QuantityStepper";
import { EquipmentThumb } from "./EquipmentThumb";
import { Modal } from "./Modal";
import { useToast } from "./Toast";

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
  const toast = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [dtRange, setDtRange] = useState<DTRange>({ start: null, end: null });
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenModal = () => {
    setModalOpen(true);
    setDtRange(defaultRange());
    setQuantity(1);
    setComment("");
    setError(null);
  };

  const handleClose = () => {
    if (loading) return;
    setModalOpen(false);
  };

  const handleSubmit = async () => {
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
      setModalOpen(false);
      toast.success("Бронирование создано");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания брони");
    } finally {
      setLoading(false);
    }
  };

  const av = availabilityLabel(item);

  return (
    <>
      <article className="card card--row">
        <button
          type="button"
          className="row-head"
          onClick={handleOpenModal}
          aria-haspopup="dialog"
        >
          <EquipmentThumb src={item.imageUrl} categoryCode={item.categoryCode} title={item.title} />
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
      </article>

      <Modal
        open={modalOpen}
        title={item.title}
        onClose={handleClose}
        width={520}
        footer={
          <>
            <button
              type="button"
              className="card__cta card__cta--secondary"
              disabled={loading}
              onClick={handleClose}
            >
              Отмена
            </button>
            <button
              type="button"
              className="card__cta"
              disabled={loading}
              onClick={handleSubmit}
            >
              {loading ? "Отправка…" : "Забронировать"}
            </button>
          </>
        }
      >
        {error && <div className="status-chip status-chip--error">{error}</div>}

        <div className="qty-row">
          <div className="qty-row__text">
            <span className="qty-row__label">Количество</span>
            <span className="qty-row__hint">
              Всего: {Math.max(1, item.totalQuantity)}
            </span>
          </div>
          <QuantityStepper
            value={quantity}
            min={1}
            max={Math.max(1, item.totalQuantity)}
            onChange={setQuantity}
            ariaLabel="Количество"
          />
        </div>

        <DateTimeRangePicker
          variant="modal"
          value={dtRange}
          onChange={(next: DTRange) => setDtRange(next)}
        />

        {item.categoryCode === "studio" && (
          <div className="studio-hint">
            Студия: Пн–Сб 09:00–22:00, Вс — выходной (по согласованию)
          </div>
        )}

        <label className="field">
          Комментарий:
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Необязательно"
          />
        </label>
      </Modal>
    </>
  );
}
