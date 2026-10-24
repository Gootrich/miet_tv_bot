import type { MockEquipment } from "../mocks/equipment";

const ICON: Record<MockEquipment["icon"], string> = {
  camera: "📷",
  light: "💡",
  mic: "🎙",
};

export function EquipmentCard({ item }: { item: MockEquipment }) {
  const isAvailable = item.status.kind === "available";
  const statusLabel =
    item.status.kind === "available" ? "Доступно" : `Занято до ${item.status.until}`;

  return (
    <article className="card">
      <div className="card__thumb" aria-hidden="true">
        <span>{ICON[item.icon]}</span>
      </div>
      <div className="card__body">
        <div className="card__heading">
          <h2 className="card__title">{item.title}</h2>
          <span
            className={`badge${isAvailable ? " badge--ok" : " badge--busy"}`}
          >
            {statusLabel}
          </span>
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
