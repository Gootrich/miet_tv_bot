import { useState } from "react";
import { CatalogPage } from "./pages/CatalogPage";
import { BookingsPage } from "./pages/BookingsPage";
import { ProfilePage } from "./pages/ProfilePage";

type Page = "catalog" | "bookings" | "profile";

export default function App() {
  const [page, setPage] = useState<Page>("catalog");

  if (page === "bookings") {
    return <BookingsPage onNavigate={(t) => setPage(t as Page)} />;
  }

  if (page === "profile") {
    return <ProfilePage onNavigate={(t) => setPage(t as Page)} />;
  }

  return <CatalogPage onNavigate={(t) => setPage(t as Page)} />;
}
