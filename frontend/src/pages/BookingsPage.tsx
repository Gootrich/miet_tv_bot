import { useEffect, useState } from "react";
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

export function BookingsPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [actionError, setActionError] = useState<string | null>(null);

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

  return (
    <div className="page">
      <TopBar />
      <main className="page__content">
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          Мои бронирования
        </h1>

        {actionError && (
          <div style={{ color: "red", marginBottom: "1rem", fontSize: "0.875rem" }}>
            {actionError}
          </div>
        )}

        {state.kind === "loading" && <p>Загрузка бронирований...</p>}
        {state.kind === "error" && <p style={{ color: "red" }}>Ошибка: {state.message}</p>}

        {state.kind === "ready" && state.bookings.length === 0 && (
          <div className="empty">
            <p className="empty__text">У вас пока нет бронирований</p>
          </div>
        )}

        {state.kind === "ready" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {state.bookings.map((b) => (
              <div
                key={b.id}
                style={{
                  background: "#fff",
                  border: "1px solid #e0e0e0",
                  borderRadius: "12px",
                  padding: "1rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <strong>Бронь #{b.id}</strong>
                  <span style={{ fontWeight: 500, color: b.status === "completed" ? "green" : "orange" }}>
                    {b.status}
                  </span>
                </div>
                <p style={{ fontSize: "0.875rem", color: "#666", margin: "0.25rem 0" }}>
                  Модель ID: {b.model_id} {b.item_id ? `| Экземпляр ID: ${b.item_id}` : `| Количество: ${b.quantity}`}
                </p>
                <p style={{ fontSize: "0.875rem", color: "#666", margin: "0.25rem 0" }}>
                  С: {new Date(b.planned_start).toLocaleString()}
                </p>
                <p style={{ fontSize: "0.875rem", color: "#666", margin: "0.25rem 0" }}>
                  По: {new Date(b.planned_end).toLocaleString()}
                </p>

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                  {!b.actual_checkout && b.status !== "cancelled" && b.status !== "completed" && (
                    <button
                      type="button"
                      onClick={() => handleCheckout(b.id)}
                      style={{
                        padding: "0.5rem 1rem",
                        background: "#007aff",
                        color: "#fff",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                      }}
                    >
                      Получить
                    </button>
                  )}
                  {b.actual_checkout && !b.actual_return && (
                    <button
                      type="button"
                      onClick={() => handleReturn(b.id)}
                      style={{
                        padding: "0.5rem 1rem",
                        background: "#34c759",
                        color: "#fff",
                        border: "none",
                        borderRadius: "8px",
                        cursor: "pointer",
                      }}
                    >
                      Вернуть
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <BottomNav active="bookings" onSelect={onNavigate} />
    </div>
  );
}
