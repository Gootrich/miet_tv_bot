import { useEffect, useMemo, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { TopBar } from "../components/TopBar";
import {
  fetchBookings,
  checkoutBooking,
  returnBooking,
  type BookingOut,
} from "../api/catalog";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; bookings: BookingOut[] };

type Tab = "active" | "history";

function statusInfo(status: string): { label: string; cls: string; dot: string } {
  switch (status) {
    case "pending":   return { label: "Ожидает",  cls: "status-chip--warning", dot: "status-dot--warning" };
    case "confirmed": return { label: "Выдано",   cls: "status-chip--success", dot: "status-dot--success" };
    case "completed": return { label: "Возврат",  cls: "status-chip",          dot: "status-dot--success" };
    case "cancelled": return { label: "Отменено", cls: "status-chip--error",   dot: "status-dot--error"   };
    default:          return { label: status,     cls: "status-chip",          dot: ""                    };
  }
}

export function BookingsPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("active");

  const loadBookings = async () => {
    try {
      const data = await fetchBookings();
      setState({ kind: "ready", bookings: data });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Ошибка загрузки",
      });
    }
  };

  useEffect(() => {
    void loadBookings();
  }, []);

  const handleCheckout = async (id: number) => {
    try {
      setActionError(null);
      await checkoutBooking(id);
      await loadBookings();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Ошибка выдачи");
    }
  };

  const handleReturn = async (id: number) => {
    try {
      setActionError(null);
      await returnBooking(id);
      await loadBookings();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Ошибка возврата");
    }
  };

  const filtered = useMemo(() => {
    if (state.kind !== "ready") return [];
    return state.bookings.filter((b) => {
      if (tab === "active") return b.status === "pending" || b.status === "confirmed";
      return b.status === "completed" || b.status === "cancelled";
    });
  }, [state, tab]);

  return (
    <div className="page">
      <TopBar />
      <main className="page__content">
        <h1 className="section-title">Мои бронирования</h1>

        <div className="segmented" role="tablist" aria-label="Брони">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "active"}
            className={`segmented__item${tab === "active" ? " is-active" : ""}`}
            onClick={() => setTab("active")}
          >
            Активные
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            className={`segmented__item${tab === "history" ? " is-active" : ""}`}
            onClick={() => setTab("history")}
          >
            История
          </button>
        </div>

        {actionError && (
          <div className="status-chip status-chip--error" role="alert">
            {actionError}
          </div>
        )}

        {state.kind === "loading" && <p className="empty__text">Загрузка…</p>}
        {state.kind === "error" && (
          <div className="empty">
            <p className="empty__text">Ошибка: {state.message}</p>
            <button className="empty__action" type="button" onClick={loadBookings}>
              Повторить
            </button>
          </div>
        )}

        {state.kind === "ready" && filtered.length === 0 && (
          <div className="empty">
            <p className="empty__text">
              {tab === "active" ? "Нет активных броней" : "История пуста"}
            </p>
          </div>
        )}

        {state.kind === "ready" && filtered.length > 0 && (
          <div className="list">
            {filtered.map((b) => {
              const s = statusInfo(b.status);
              return (
                <div key={b.id} className="card">
                  <div className="card__heading">
                    <h2 className="card__title">Бронь #{b.id}</h2>
                    <span className={`status-chip ${s.cls}`}>
                      <span className={`status-dot ${s.dot}`} />
                      {s.label}
                    </span>
                  </div>

                  <p className="card__subtitle">
                    Модель #{b.model_id}
                    {b.item_id ? ` · Экземпляр #${b.item_id}` : ` · Кол-во: ${b.quantity}`}
                  </p>

                  <p className="card__subtitle">
                    С: {new Date(b.planned_start).toLocaleString()}
                  </p>
                  <p className="card__subtitle">
                    По: {new Date(b.planned_end).toLocaleString()}
                  </p>

                  <div className="row-actions">
                    {!b.actual_checkout && b.status !== "cancelled" && b.status !== "completed" && (
                      <button
                        type="button"
                        className="card__cta"
                        onClick={() => handleCheckout(b.id)}
                      >
                        Получить
                      </button>
                    )}
                    {b.actual_checkout && !b.actual_return && (
                      <button
                        type="button"
                        className="card__cta"
                        onClick={() => handleReturn(b.id)}
                      >
                        Вернуть
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      <BottomNav active="bookings" onSelect={onNavigate} />
    </div>
  );
}
