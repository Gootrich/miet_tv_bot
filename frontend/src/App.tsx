import { useState } from "react";
import { CatalogPage } from "./pages/CatalogPage";
import { BookingsPage } from "./pages/BookingsPage";
import { ProfilePage } from "./pages/ProfilePage";

export default function App() {
  const [page, setPage] = useState<"catalog" | "bookings" | "favorites" | "profile">("catalog");

  if (page === "bookings") {
    return <BookingsPage onNavigate={(t) => setPage(t as any)} />;
  }

  if (page === "profile" || page === "favorites") {
    return <ProfilePage activeTab={page} onNavigate={(t) => setPage(t as any)} />;
  }

  return <CatalogPage onNavigate={(t) => setPage(t as any)} />;
}
