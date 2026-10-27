import { useEffect, useState } from "react";
import { CatalogPage } from "./pages/CatalogPage";
import { OccupancyPage } from "./pages/OccupancyPage";
import { BookingsPage } from "./pages/BookingsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { DevUserSwitcher } from "./components/DevUserSwitcher";
import { ToastProvider } from "./components/Toast";
import { fetchCatalog } from "./api/catalog";
import { fetchBookings } from "./api/bookings";
import { fetchMe } from "./api/admin";
type Page = "catalog" | "occupancy" | "bookings" | "profile";
const PAGE_STORAGE_KEY = "miet.page";
const ALLOWED: Page[] = ["catalog", "occupancy", "bookings", "profile"];
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
  // Предзагрузка данных + снятие статического лоадера index.html.
  // Минимум 1200ms — чтобы анимация бренда успела прочитаться.
  useEffect(() => {
    const setStatus = (text: string) => {
      const el = document.getElementById("app-loader-status");
      if (el && el.textContent !== text) el.textContent = text;
    };
    let minTimePassed = false;
    let authDone = false;
    let catalogDone = false;
    let bookingsDone = false;
    let finished = false;
    const finish = () => {
      if (finished) return;
      if (!(minTimePassed && authDone && catalogDone && bookingsDone)) return;
      finished = true;
      window.dispatchEvent(new CustomEvent("app:ready"));
    };
    setStatus("Авторизация…");
    const minTimer = window.setTimeout(() => {
      minTimePassed = true;
      finish();
    }, 1200);
    Promise.all([
      fetchMe()
        .then(() => { authDone = true; setStatus("Загрузка каталога…"); })
        .catch(() => { authDone = true; setStatus("Загрузка каталога…"); })
        .then(() => finish()),
      fetchCatalog()
        .then(() => { catalogDone = true; setStatus("Загрузка броней…"); })
        .catch(() => { catalogDone = true; setStatus("Загрузка броней…"); })
        .then(() => finish()),
      fetchBookings({ scope: "mine", limit: 20 })
        .then(() => { bookingsDone = true; setStatus("Почти готово…"); })
        .catch(() => { bookingsDone = true; setStatus("Почти готово…"); })
        .then(() => finish()),
    ]).catch(() => {
      authDone = catalogDone = bookingsDone = true;
      finish();
    });
    return () => window.clearTimeout(minTimer);
  }, []);
  const navigate = (t: string) => setPage(t as Page);
  return (
    <ToastProvider>
      {isDev && <DevUserSwitcher />}
      {page === "catalog"   && <CatalogPage   onNavigate={navigate} />}
      {page === "occupancy" && <OccupancyPage onNavigate={navigate} />}
      {page === "bookings"  && <BookingsPage  onNavigate={navigate} />}
      {page === "profile"   && <ProfilePage   onNavigate={navigate} />}
    </ToastProvider>
  );
}
