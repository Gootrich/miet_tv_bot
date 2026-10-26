import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { DateTimeRangePicker, type DTRange } from "./DateTimeRangePicker";
import { QuantityStepper } from "./QuantityStepper";
import { useToast } from "./Toast";
import { createBatchBooking } from "../api/bookings";
import type { CatalogItem } from "../api/catalog";

interface Props {
  open: boolean;
  items: Array<{ item: CatalogItem; quantity: number }>;
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchBookingModal({ open, items, onClose, onSuccess }: Props) {
  const toast = useToast();
  const [dt, setDt] = useState<DTRange>({ start: null, end: null });
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  // локальные количества по modelId (изначально из items)
  const [qty, setQty] = useState<Record<number, number>>(() => {
    const m: Record<number, number> = {};
    for (const { item, quantity } of items) m[item.modelId] = quantity;
    return m;
  });

  // Отсортированный список по названию (по алфавиту)
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) =>
        a.item.title.localeCompare(b.item.title, "ru", { sensitivity: "base" }),
      ),
    [items],
  );

  const doSubmit = async () => {
    if (!dt.start || !dt.end) { toast.error("Укажите начало и конец"); return; }
    if (items.length === 0) { toast.error("Ничего не выбрано"); return; }
    setBusy(true);
    try {
      const res = await createBatchBooking({
        items: items.map(({ item }) => ({
          model_id: item.modelId,
          quantity: qty[item.modelId] ?? 1,
        })),
        planned_start: dt.start,
        planned_end: dt.end,
        comment: comment ? comment : null,
      });
      toast.success(`Создано броней: ${res.length} (группа #${res[0]?.group_id ?? "?"})`);
      onSuccess();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка пакетной брони");
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      title={`Забронировать выбранное · ${items.length} поз.`}
      onClose={busy ? () => {} : onClose}
      width={600}
      footer={
        <>
          <button type="button" className="card__cta card__cta--secondary"
            disabled={busy} onClick={onClose}>Отмена</button>
          <button type="button" className="card__cta"
            disabled={busy} onClick={doSubmit}>{busy ? "…" : "Забронировать"}</button>
        </>
      }
    >
      <DateTimeRangePicker
        variant="modal"
        value={dt}
        onChange={(next) => setDt(next)}
      />

      {items.some(({ item }) => item.categoryCode === "studio") && (
        <div className="studio-hint">
          Студия: Пн–Сб 09:00–22:00, Вс — выходной (по согласованию)
        </div>
      )}

      <div className="batch-list">
        {sortedItems.map(({ item }) => (
          <div key={item.modelId} className="batch-list__row">
            <div className="batch-list__info">
              <div className="batch-list__title">{item.title}</div>
              <div className="batch-list__meta">
                {item.category}{item.subtitle ? ` · ${item.subtitle}` : ""}
              </div>
            </div>
            <div className="batch-list__qty">
              <QuantityStepper
                value={qty[item.modelId] ?? 1}
                min={1}
                max={Math.max(1, item.totalQuantity)}
                onChange={(v) =>
                  setQty((prev) => ({ ...prev, [item.modelId]: v }))
                }
                ariaLabel={`Количество: ${item.title}`}
              />
            </div>
          </div>
        ))}
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
    </Modal>
  );
}
