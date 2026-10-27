import { useTheme } from "../theme/useTheme";
import type { ResolvedTheme, ThemeChoice } from "../theme/ThemeProvider";

const ICON: Record<ThemeChoice, string> = {
  auto: "◐",
  light: "☀",
  dark: "☾",
};

const RESOLVED_LABEL: Record<ResolvedTheme, string> = {
  light: "светлая",
  dark: "тёмная",
};

const LABEL: Record<ThemeChoice, string> = {
  auto: "Тема: системная",
  light: "Тема: светлая",
  dark: "Тема: тёмная",
};

export function TopBar({ title = "Каталог" }: { title?: string } = {}) {
  const { choice, resolved, cycle } = useTheme();
  const label =
    choice === "auto"
      ? `${LABEL.auto} (сейчас ${RESOLVED_LABEL[resolved]})`
      : LABEL[choice];
  return (
    <header className="top-bar">
      <h1 className="top-bar__title">{title}</h1>
      <button
        type="button"
        className="top-bar__icon"
        onClick={cycle}
        aria-label={label}
        title={label}
      >
        {ICON[choice]}
      </button>
    </header>
  );
}
