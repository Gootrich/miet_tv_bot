import type { CatalogItem } from "../api/catalog";

const ICON: Record<CatalogItem["icon"], string> = {
  camera: "📷",
  light: "💡",
  mic: "🎙",
};

function statusInfo(status: CatalogItem["status"]): {
  label: string;
  modifier: "ok" | "busy" | "unknown";
} {
  switch (status.kind) {
    case "available":
      return { label: "Доступно", modifier: "ok" };
    case "busy":
      return { label: `Занято до ${status.until}`, modifier: "busy" };
    case "unknown":
      return { label: "Доступность уточняется", modifier: "unknown" };
  }
}

export function EquipmentCard({ item }: { item: CatalogItem }) {
  const { label, modifier } = statusInfo(item.status);

  return (
    <article className="card">
      <div className="card__thumb" aria-hidden="true">
        <span>{ICON[item.icon]}</span>
      </div>
      <div className="card__body">
        <div className="card__heading">
          <h2 className="card__title">{item.title}</h2>
          <span className={`badge badge--${modifier}`}>{label}</span>
        </div>
        <p className="card__subtitle">{item.subtitle}</p>
        <p className="card__category">{item.category}</p>
        <button type="button" className="card__cta" disabled>
          Подробнее — скоро
        </button>
      </div>
    </article>
  );
}
