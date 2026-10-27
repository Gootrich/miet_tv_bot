const TABS = [
  { id: "catalog",   label: "Каталог",   icon: "▤" },
  { id: "occupancy", label: "Занятость", icon: "🗓" },
  { id: "bookings",  label: "Брони",     icon: "📅" },
  { id: "profile",   label: "Профиль",   icon: "◍" },
] as const;

export function BottomNav({
  active = "catalog",
  onSelect,
}: {
  active?: string;
  onSelect?: (tab: string) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            className={`bottom-nav__item${isActive ? " is-active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect?.(tab.id)}
          >
            <span className="bottom-nav__pill">
              <span className="bottom-nav__icon" aria-hidden="true">{tab.icon}</span>
            </span>
            <span className="bottom-nav__label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
