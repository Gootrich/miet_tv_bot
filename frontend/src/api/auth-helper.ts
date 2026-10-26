/**
 * Возвращает заголовки для API-запросов.
 * - В Telegram WebApp: x-telegram-init-data = реальный initData.
 * - В браузере при dev-режиме: x-telegram-init-data = "dev-mode"
 *   + x-dev-user = выбранная dev-роль (см. DevUserSwitcher).
 *
 * На проде (isDev=false) без initData возвращает пустые заголовки —
 * тогда backend отвечает 401, и UI показывает экран входа.
 */

export const DEV_USER_STORAGE_KEY = "miet.devUser";

export type DevUser =
  | "superadmin"
  | "miettv_head"
  | "infocus_head"
  | "photographer"
  | "videographer"
  | "both"
  | "pending"
  | "blocked";

const isDev = import.meta.env.DEV;

export function readDevUser(): DevUser {
  if (typeof localStorage === "undefined") return "superadmin";
  const v = localStorage.getItem(DEV_USER_STORAGE_KEY);
  const allowed: DevUser[] = [
    "superadmin", "miettv_head", "infocus_head",
    "photographer", "videographer", "both", "pending", "blocked",
  ];
  return (v && (allowed as string[]).includes(v)) ? (v as DevUser) : "superadmin";
}

export function writeDevUser(v: DevUser): void {
  try {
    localStorage.setItem(DEV_USER_STORAGE_KEY, v);
  } catch {
    /* ignore */
  }
}

export function getAuthHeaders(): Record<string, string> {
  if (typeof window !== "undefined") {
    const tgInit =
      (window as unknown as { Telegram?: { WebApp?: { initData?: string } } })
        .Telegram?.WebApp?.initData;
    if (tgInit) {
      return { "x-telegram-init-data": tgInit };
    }
  }
  if (isDev) {
    return {
      "x-telegram-init-data": "dev-mode",
      "x-dev-user": readDevUser(),
    };
  }
  return {};
}
