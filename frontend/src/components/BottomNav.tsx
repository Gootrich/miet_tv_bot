const TABS = [
  { id: "catalog", label: "Каталог", icon: "▤" },
  { id: "search", label: "Поиск", icon: "⌕" },
  { id: "favorites", label: "Избранное", icon: "♡" },
  { id: "profile", label: "Профиль", icon: "◍" },
] as const;

export function BottomNav({ active = "catalog" }: { active?: string }) {
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
            disabled={!isActive}
          >
            <span className="bottom-nav__icon" aria-hidden="true">{tab.icon}</span>
            <span className="bottom-nav__label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
