import { load } from "../api/cache";
import { useEffect, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { TopBar } from "../components/TopBar";
import { AdminSection } from "../components/AdminSection";
import { AuthRequired } from "../components/AuthRequired";
import { fetchMe, type UserOut } from "../api/admin";
import { ApiError } from "../api/client";
import { useTheme } from "../theme/useTheme";
import type { ThemeChoice } from "../theme/ThemeProvider";

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
  | { kind: "auth"; error: ApiError }
  | { kind: "error"; message: string };

export function ProfilePage({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadMe() {
      try {
        const me = await load("me", fetchMe);
        if (cancelled) return;
        setState({ kind: "me", me });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403) {
          setState({
            kind: "blocked",
            reason: e.message || "Доступ ограничен.",
          });
        } else if (e instanceof ApiError && e.status === 401) {
          setState({ kind: "auth", error: e });
        } else if (e instanceof ApiError) {
          setState({ kind: "error", message: e.message });
        } else {
          setState({ kind: "error", message: "Неизвестная ошибка" });
        }
      }
    }
    void loadMe();
    return () => {
      cancelled = true;
    };
  }, [retryTick]);

  const isAdminScope =
    state.kind === "me" &&
    state.me.role_codes.some(
      (c) => c === "admin" || c === "miettv_head" || c === "infocus_head",
    );

  const { choice, resolved, setChoice } = useTheme();

  return (
    <div className="page">
      <TopBar title="Профиль" />
      <main className="page__content">

        <div className="card">
          <h2 className="card__title">Тема</h2>
          <p className="card__subtitle">
            {choice === "auto"
              ? `Системная (сейчас ${resolved === "dark" ? "тёмная" : "светлая"})`
              : "Применяется ко всем разделам и сохраняется между запусками."}
          </p>
          <div
            className="segmented"
            role="radiogroup"
            aria-label="Выбор темы"
            style={{ marginTop: 8 }}
          >
            {(["auto", "light", "dark"] as ThemeChoice[]).map((code) => {
              const label =
                code === "auto"
                  ? "Системная"
                  : code === "light"
                  ? "Светлая"
                  : "Тёмная";
              const active = choice === code;
              return (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`segmented__item${active ? " is-active" : ""}`}
                  onClick={() => setChoice(code)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {state.kind === "loading" && (<div className="empty"><span className="spinner" aria-hidden="true" /><p className="empty__text">Загрузка…</p></div>)}

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

        {state.kind === "auth" && (
          <AuthRequired
            error={state.error}
            onRetry={() => {
              setState({ kind: "loading" });
              setRetryTick((n) => n + 1);
            }}
          />
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
                По вопросам работы приложения —{" "}
                <a
                  className="link"
                  href="https://t.me/gootrich"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @gootrich
                </a>
              </p>
            </div>
          </>
        )}
      </main>
      <BottomNav active="profile" onSelect={onNavigate} />
    </div>
  );
}
