import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme/tokens.css";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";

type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
};

const telegramWebApp = (
  window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }
).Telegram?.WebApp;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);

if (telegramWebApp) {
  telegramWebApp.expand?.();
  telegramWebApp.ready?.();
}
