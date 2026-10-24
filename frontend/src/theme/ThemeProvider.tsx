import { createContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeChoice = "auto" | "light" | "dark" | "emerald";
export type ResolvedTheme = "light" | "dark" | "emerald";

const STORAGE_KEY = "miet.theme";

interface ThemeContextValue {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  cycle: () => void;
  setChoice: (choice: ThemeChoice) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function detectSystem(): ResolvedTheme {
  // Telegram WebApp имеет приоритет, если доступен.
  const tg = (window as unknown as { Telegram?: { WebApp?: { colorScheme?: string } } }).Telegram?.WebApp;
  const tgScheme = tg?.colorScheme;
  if (tgScheme === "light") return "light";
  if (tgScheme === "dark") return "dark"; // системная тёмная → нейтральный графит

  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function readStoredChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "auto" || raw === "light" || raw === "dark" || raw === "emerald") return raw;
  } catch {
    /* ignore */
  }
  return "auto";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice());
  const [system, setSystem] = useState<ResolvedTheme>(() => detectSystem());

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(detectSystem());
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const resolved: ResolvedTheme = choice === "auto" ? system : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setChoice = (next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const cycle = () => {
    const order: ThemeChoice[] = ["auto", "light", "dark", "emerald"];
    const idx = order.indexOf(choice);
    setChoice(order[(idx + 1) % order.length]);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, resolved, cycle, setChoice }),
    [choice, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
