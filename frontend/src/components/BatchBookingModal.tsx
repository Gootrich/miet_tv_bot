import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { DateTimeRangePicker, type DTRange } from "./DateTimeRangePicker";
import { QuantityStepper } from "./QuantityStepper";
import { useToast } from "./Toast";
import { createBatchBooking } from "../api/bookings";
import type { CatalogItem } from "../api/catalog";
import { cartRemove, cartSetQty, cartSetRange, useCart } from "../state/cart";

interface Props {
  open: boolean;
  items: Array<{ item: CatalogItem; quantity: number }>;
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchBookingModal({ open, items, onClose, onSuccess }: Props) {
  const toast = useToast();
  const cart = useCart();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  // В модалке показываем только позиции, которые сейчас в корзине,
  // и сортируем по названию (ru, без учёта регистра).
  const visibleItems = useMemo(
    () =>
      items
        .filter(({ item }) => cart.items.has(item.modelId))
        .sort((a, b) =>
          a.item.title.localeCompare(b.item.title, "ru", { sensitivity: "base" }),
        ),
    [items, cart.items],
  );

  const doSubmit = async () => {
    if (!cart.range.start || !cart.range.end) {
      toast.error("Укажите начало и конец");
      return;
    }
    if (visibleItems.length === 0) {
      toast.error("Ничего не выбрано");
      return;
    }
    setBusy(true);
    try {
      const res = await createBatchBooking({
        items: visibleItems.map(({ item }) => ({
          model_id: item.modelId,
          quantity: cart.items.get(item.modelId) ?? 1,
        })),
        planned_start: cart.range.start,
        planned_end: cart.range.end,
        comment: comment ? comment : null,
      });
      toast.success(`Создано броней: ${res.length} (группа #${res[0]?.group_id ?? "?"})`);
      onSuccess();
    } catch (e) {
      let message = e instanceof Error ? e.message : "Ошибка пакетной брони";
      const body = (e as { body?: unknown } | null)?.body;
      if (body && typeof body === "object" && body !== null && "detail" in body) {
        const d = (body as { detail: unknown }).detail;
        if (typeof d === "string") message = d;
      }
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`Забронировать выбранное · ${visibleItems.length} поз.`}
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
      <div className="batch-list">
        {visibleItems.map(({ item }) => (
          <div key={item.modelId} className="batch-list__row">
            <div className="batch-list__info">
              <div className="batch-list__title">{item.title}</div>
              <div className="batch-list__meta">
                {item.category}
              </div>
              {item.availableInPeriod !== null &&
                item.availableInPeriod !== undefined &&
                item.availableInPeriod <
                  (cart.items.get(item.modelId) ?? 1) && (
                  <div className="batch-list__warn" role="alert">
                    Доступно на период: {item.availableInPeriod}
                  </div>
                )}
            </div>
            <div className="batch-list__qty">
              <QuantityStepper
                value={cart.items.get(item.modelId) ?? 1}
                min={0}
                max={Math.max(1, item.totalQuantity)}
                onChange={(v) => cartSetQty(item.modelId, v)}
                ariaLabel={`Количество: ${item.title}`}
              />
              <button
                type="button"
                className="batch-list__remove"
                onClick={() => cartRemove(item.modelId)}
                aria-label={`Удалить ${item.title}`}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      <DateTimeRangePicker
        variant="modal"
        value={cart.range}
        onChange={(next: DTRange) => cartSetRange(next)}
      />

      {visibleItems.some(({ item }) => item.categoryCode === "studio") && (
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
  );
}
