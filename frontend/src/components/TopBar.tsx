import { useTheme } from "../theme/useTheme";
import type { ThemeChoice } from "../theme/ThemeProvider";

const LABEL: Record<ThemeChoice, string> = {
  auto: "Тема: авто",
  light: "Тема: светлая",
  dark: "Тема: тёмная",
};

export function TopBar() {
  const { choice, cycle } = useTheme();
  return (
    <header className="top-bar">
      <h1 className="top-bar__title">Каталог</h1>
      <button
        type="button"
        className="top-bar__icon"
        onClick={cycle}
        aria-label={LABEL[choice]}
        title={LABEL[choice]}
      >
        {choice === "auto" ? "◐" : choice === "light" ? "☀" : "☾"}
      </button>
    </header>
  );
}
