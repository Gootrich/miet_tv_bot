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
import { APP_VERSION, APP_BUILD, APP_BUILD_DATE } from "../version";

type TgWebApp = { initDataUnsafe?: { user?: { id?: number; photo_url?: string } } };

function tgPhotoUrl(telegramId: number | string): string | null {
  const wa = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
  const u = wa?.initDataUnsafe?.user;
  if (!u?.photo_url || String(u.id) !== String(telegramId)) return null;
  return u.photo_url;
}

function ProfileAvatar({ telegramId, name }: { telegramId: number | string; name: string }) {
  const [failed, setFailed] = useState(false);
  const url = failed ? null : tgPhotoUrl(telegramId);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className="profile-avatar" aria-hidden="true">
      {url ? (
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        initial
      )}
    </span>
  );
}

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

// active — норма, отдельно не показываем
const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает подтверждения",
  blocked: "Заблокирован",
  rejected: "Заявка отклонена",
};

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

  const { choice, setChoice } = useTheme();

  const themeSwitch = (
    <div className="segmented" role="radiogroup" aria-label="Выбор темы">
      {(["auto", "light", "dark"] as ThemeChoice[]).map((code) => {
        const label = code === "auto" ? "Системная" : code === "light" ? "Светлая" : "Тёмная";
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
  );

  return (
    <div className="page">
      <TopBar title="Профиль" />
      <main className="page__content">
        {state.kind === "me" && (
          <section className="profile-head">
            <ProfileAvatar telegramId={state.me.telegram_id} name={state.me.full_name} />
            <div className="profile-head__body">
              <div className="profile-head__name">
                {state.me.username ? `@${state.me.username}` : state.me.full_name}
              </div>
              {state.me.username && (
                <div className="profile-head__sub">{state.me.full_name}</div>
              )}
              {state.me.role_codes.length > 0 && (
                <div className="profile-head__roles">
                  {state.me.role_codes.map((c) => (
                    <span key={c} className="role-chip">{roleLabel(c)}</span>
                  ))}
                </div>
              )}
              <div className="profile-head__meta">
                TG {state.me.telegram_id}
                {STATUS_LABELS[state.me.status] ? ` · ${STATUS_LABELS[state.me.status]}` : ""}
              </div>
            </div>
          </section>
        )}

        {state.kind === "loading" && (
          <div className="empty profile-loading" role="status"><span className="spinner" aria-hidden="true" /><p className="empty__text">Загрузка…</p></div>
        )}

        {state.kind === "error" && (
          <div className="card">
            <h2 className="card__title">Ошибка</h2>
            <p className="card__subtitle">{state.message}</p>
            <button
              type="button"
              className="card__cta card__cta--secondary"
              onClick={() => {
                setState({ kind: "loading" });
                setRetryTick((n) => n + 1);
              }}
            >
              Повторить
            </button>
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

        <section className="profile-section">
          <h2 className="section-title">Оформление</h2>
          {themeSwitch}
        </section>

        {state.kind === "me" && isAdminScope && <AdminSection me={state.me} />}

        <footer className="profile-footer">
          <p className="profile-footer__title">MediaHUB</p>
          <p className="profile-footer__text">
            Выбирай технику, планируй съёмки и управляй своими бронированиями в одном месте.
          </p>
          <p className="profile-footer__text">
            Разработчик:{" "}
            <a className="link" href="https://t.me/gootrich" target="_blank" rel="noopener noreferrer">
              @gootrich
            </a>
          </p>
          <p className="profile-footer__note">Приложение находится в разработке.</p>
          <p className="profile-footer__version">
            v{APP_VERSION} · build {APP_BUILD} · {APP_BUILD_DATE}
          </p>
        </footer>
      </main>
      <BottomNav active="profile" onSelect={onNavigate} />
    </div>
  );
}
