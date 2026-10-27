import { useTheme } from "../theme/useTheme";
import type { ThemeChoice } from "../theme/ThemeProvider";

const LABEL: Record<ThemeChoice, string> = {
  auto: "Тема: авто",
  light: "Тема: светлая",
  dark: "Тема: тёмная (графит)",
  emerald: "Тема: изумрудная",
};

const ICON: Record<ThemeChoice, string> = {
  auto: "◐",
  light: "☀",
  dark: "☾",
  emerald: "◆",
};

export function TopBar({ title = "Каталог" }: { title?: string } = {}) {
  const { choice, cycle } = useTheme();
  return (
    <header className="top-bar">
      <h1 className="top-bar__title">{title}</h1>
      <button
        type="button"
        className="top-bar__icon"
        onClick={cycle}
        aria-label={LABEL[choice]}
        title={LABEL[choice]}
      >
        {ICON[choice]}
      </button>
    </header>
  );
}
