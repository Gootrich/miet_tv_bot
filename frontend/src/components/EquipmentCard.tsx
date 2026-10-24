import { useState } from "react";
import { createBooking, type CatalogItem } from "../api/catalog";

const ICON: Record<CatalogItem["icon"], string> = {
  camera: "📷",
  light: "💡",
  mic: "🎙",
};

export function EquipmentCard({ item }: { item: CatalogItem }) {
  const [showForm, setShowForm] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const setDurationHours = (hours: number) => {
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    const startStr = now.toISOString().slice(0, 16);
    
    const later = new Date(now.getTime() + hours * 60 * 60 * 1000);
    const endStr = later.toISOString().slice(0, 16);

    setStart(startStr);
    setEnd(endStr);
  };

  const handleOpenForm = () => {
    setDurationHours(2); // по умолчанию на 2 часа вперед
    setShowForm(true);
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
      setSuccess("Бронирование успешно создано!");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания брони");
    } finally {
      setLoading(false);
    }
  };

  return (
    <article className="card">
      <div className="card__thumb" aria-hidden="true">
        <span>{ICON[item.icon]}</span>
      </div>
      <div className="card__body">
        <div className="card__heading">
          <h2 className="card__title">{item.title}</h2>
        </div>
        <p className="card__subtitle">{item.subtitle}</p>
        <p className="card__category">{item.category}</p>

        {success && (
          <p style={{ color: "green", fontSize: "0.875rem", margin: "0.5rem 0" }}>
            {success}
          </p>
        )}

        {!showForm ? (
          <button
            type="button"
            className="card__cta"
            onClick={handleOpenForm}
            style={{ cursor: "pointer", background: "#007aff", color: "#fff", border: "none", borderRadius: "8px", padding: "0.5rem 1rem" }}
          >
            Забронировать
          </button>
        ) : (
          <form onSubmit={handleSubmit} style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {error && <p style={{ color: "red", fontSize: "0.75rem" }}>{error}</p>}
            
            <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.25rem" }}>
              <button type="button" onClick={() => setDurationHours(2)} style={{ fontSize: "0.7rem", padding: "0.2rem 0.4rem", background: "#f0f0f0", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}>+2 часа</button>
              <button type="button" onClick={() => setDurationHours(4)} style={{ fontSize: "0.7rem", padding: "0.2rem 0.4rem", background: "#f0f0f0", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}>+4 часа</button>
              <button type="button" onClick={() => setDurationHours(24)} style={{ fontSize: "0.7rem", padding: "0.2rem 0.4rem", background: "#f0f0f0", border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}>Сутки</button>
            </div>

            <label style={{ fontSize: "0.75rem", display: "flex", flexDirection: "column" }}>
              Начало:
              <input
                type="datetime-local"
                step="900"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                style={{ padding: "0.25rem", borderRadius: "4px", border: "1px solid #ccc" }}
                required
              />
            </label>

            <label style={{ fontSize: "0.75rem", display: "flex", flexDirection: "column" }}>
              Конец:
              <input
                type="datetime-local"
                step="900"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                style={{ padding: "0.25rem", borderRadius: "4px", border: "1px solid #ccc" }}
                required
              />
            </label>

            <label style={{ fontSize: "0.75rem", display: "flex", flexDirection: "column" }}>
              Количество:
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                style={{ padding: "0.25rem", borderRadius: "4px", border: "1px solid #ccc" }}
                required
              />
            </label>

            <label style={{ fontSize: "0.75rem", display: "flex", flexDirection: "column" }}>
              Комментарий:
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Необязательно"
                style={{ padding: "0.25rem", borderRadius: "4px", border: "1px solid #ccc" }}
              />
            </label>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button
                type="submit"
                disabled={loading}
                style={{ padding: "0.4rem 0.8rem", background: "#34c759", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.75rem" }}
              >
                {loading ? "Отправка..." : "Подтвердить"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                style={{ padding: "0.4rem 0.8rem", background: "#e0e0e0", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.75rem" }}
              >
                Отмена
              </button>
            </div>
          </form>
        )}
      </div>
    </article>
  );
}
