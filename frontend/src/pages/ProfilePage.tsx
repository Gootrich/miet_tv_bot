import { BottomNav } from "../components/BottomNav";
import { TopBar } from "../components/TopBar";

export function ProfilePage({
  activeTab = "profile",
  onNavigate,
}: {
  activeTab?: "profile" | "favorites";
  onNavigate: (tab: string) => void;
}) {
  const isFavorites = activeTab === "favorites";

  return (
    <div className="page">
      <TopBar />
      <main className="page__content">
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          {isFavorites ? "Избранное" : "Профиль"}
        </h1>
        <div
          style={{
            background: "#fff",
            border: "1px solid #dadce0",
            borderRadius: "16px",
            padding: "1rem",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          {isFavorites ? (
            <p style={{ fontSize: "0.875rem", color: "#5f6368" }}>
              Здесь будет список избранного оборудования.
            </p>
          ) : (
            <>
              <p style={{ fontWeight: 500, marginBottom: "0.5rem" }}>MIET TV Equipment Bot</p>
              <p style={{ fontSize: "0.875rem", color: "#5f6368" }}>
                Режим разработчика / Telegram Mini App активен.
              </p>
            </>
          )}
        </div>
      </main>
      <BottomNav active={activeTab} onSelect={onNavigate} />
    </div>
  );
}
