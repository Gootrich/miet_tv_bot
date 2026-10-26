import { useEffect, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { TopBar } from "../components/TopBar";
import { AdminSection } from "../components/AdminSection";
import { fetchMe, type UserOut } from "../api/admin";
import { ApiError } from "../api/client";

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  photographer: "InFocus (фотограф)",
  videographer: "МИЭТ-ТВ (видеограф)",
  miettv_head: "Глава МИЭТ-ТВ",
  infocus_head: "Глава InFocus",
};

function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code;
}

type State =
  | { kind: "loading" }
  | { kind: "me"; me: UserOut }
  | { kind: "blocked"; reason: string }
  | { kind: "error"; message: string };

export function ProfilePage({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await fetchMe();
        if (cancelled) return;
        setState({ kind: "me", me });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403) {
          setState({
            kind: "blocked",
            reason: e.message || "Доступ ограничен.",
          });
        } else if (e instanceof ApiError) {
          setState({ kind: "error", message: e.message });
        } else {
          setState({ kind: "error", message: "Неизвестная ошибка" });
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdminScope =
    state.kind === "me" &&
    state.me.role_codes.some(
      (c) => c === "admin" || c === "miettv_head" || c === "infocus_head",
    );

  return (
    <div className="page">
      <TopBar />
      <main className="page__content">
        <h1 className="section-title">Профиль</h1>

        {state.kind === "loading" && <p className="empty__text">Загрузка…</p>}

        {state.kind === "error" && (
          <div className="card">
            <h2 className="card__title">Ошибка</h2>
            <p className="card__subtitle">{state.message}</p>
          </div>
        )}

        {state.kind === "blocked" && (
          <div className="card">
            <h2 className="card__title">Доступ ограничен</h2>
            <p className="card__subtitle">{state.reason}</p>
          </div>
        )}

        {state.kind === "me" && (
          <>
            <div className="card">
              <h2 className="card__title">{state.me.full_name}</h2>
              <p className="card__subtitle">
                @{state.me.username ?? "—"} · TG {state.me.telegram_id}
              </p>
              <p className="card__subtitle">
                Статус: <b>{state.me.status}</b>
              </p>
              <p className="card__subtitle">
                Роли:{" "}
                {state.me.role_codes.length
                  ? state.me.role_codes.map(roleLabel).join(", ")
                  : "нет"}
              </p>
            </div>

            {isAdminScope && <AdminSection me={state.me} />}

            {!isAdminScope && (
              <div className="card">
                <h2 className="card__title">О клубе</h2>
                <p className="card__subtitle">
                  MIET TV Equipment Bot — единая система бронирования
                  оборудования медиаклуба.
                </p>
              </div>
            )}

            <div className="card">
              <h2 className="card__title">Связь с разработчиком</h2>
              <p className="card__subtitle">
                По вопросам работы приложения — обратитесь к администратору
                студии.
              </p>
            </div>
          </>
        )}
      </main>
      <BottomNav active="profile" onSelect={onNavigate} />
    </div>
  );
}
