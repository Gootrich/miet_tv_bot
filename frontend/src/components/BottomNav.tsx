import {
  IconBookings,
  IconCatalog,
  IconOccupancy,
  IconProfile,
} from "./Icons";

const TABS = [
  { id: "catalog",   label: "Каталог",   Icon: IconCatalog },
  { id: "occupancy", label: "Занятость", Icon: IconOccupancy },
  { id: "bookings",  label: "Брони",     Icon: IconBookings },
  { id: "profile",   label: "Профиль",   Icon: IconProfile },
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
              <tab.Icon className="bottom-nav__icon" size={22} />
            </span>
            <span className="bottom-nav__label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
