import { useEffect, useState } from "react";
import { CatalogPage } from "./pages/CatalogPage";
import { BookingsPage } from "./pages/BookingsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { DevUserSwitcher } from "./components/DevUserSwitcher";
import { ToastProvider } from "./components/Toast";

type Page = "catalog" | "bookings" | "profile";

const PAGE_STORAGE_KEY = "miet.page";
const ALLOWED: Page[] = ["catalog", "bookings", "profile"];

function readStoredPage(): Page {
  try {
    const raw = localStorage.getItem(PAGE_STORAGE_KEY);
    if (raw && (ALLOWED as string[]).includes(raw)) return raw as Page;
  } catch {
    /* ignore */
  }
  return "catalog";
}

export default function App() {
  const [page, setPage] = useState<Page>(() => readStoredPage());
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, page);
    } catch {
      /* ignore */
    }
  }, [page]);

  const navigate = (t: string) => setPage(t as Page);

  return (
    <ToastProvider>
      {isDev && <DevUserSwitcher />}
      {page === "bookings" && <BookingsPage onNavigate={navigate} />}
      {page === "profile" && <ProfilePage onNavigate={navigate} />}
      {page === "catalog" && <CatalogPage onNavigate={navigate} />}
    </ToastProvider>
  );
}
