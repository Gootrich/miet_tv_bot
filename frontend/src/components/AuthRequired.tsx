import type { ApiError } from "../api/client";

interface AuthRequiredProps {
  error: ApiError;
  onRetry?: () => void;
}

/**
 * Экран авторизации для 401 (нет initData / истёк) и 403 (нет доступа).
 *
 * Backend уже отдаёт человекочитаемый `detail` (например, «Заявка
 * на рассмотрении администратора.»), он попадает в `error.message`
 * благодаря client.apiFetch. Для 401 добавляем явную подсказку —
 * пользователь открыл Mini App вне Telegram или initData протух.
 *
 * Вызывается только с 401/403 (см. `isAuthError` в client.ts);
 * для прочих ошибок страницы используют свой error-state.
 */
export function AuthRequired({ error, onRetry }: AuthRequiredProps) {
  const is401 = error.status === 401;
  const message = is401
    ? "Откройте приложение через Telegram Mini App или перезапустите его."
    : error.message || "Действие недоступно для вашей учётной записи.";

  return (
    <div className="empty">
      <h2 className="card__title">
        {is401 ? "Нужен вход через Telegram" : "Доступ ограничен"}
      </h2>
      <p className="empty__text">{message}</p>
      {onRetry && (
        <button className="empty__action" type="button" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}
