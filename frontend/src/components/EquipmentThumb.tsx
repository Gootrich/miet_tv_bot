interface Props {
  src?: string | null;
  categoryCode: string;
  title: string;
}

// Уникальный глиф на категорию — заглушка для случая без изображения.
// Не используем один эмодзи на всё.
const GLYPH: Record<string, string> = {
  cameras: "📷",
  lenses: "🔭",
  stabilizers: "🎯",
  lighting: "💡",
  audio: "🎙",
  stands: "🪜",
  power: "🔌",
  studio: "🎬",
};

export function EquipmentThumb({ src, categoryCode, title }: Props) {
  if (src) {
    return (
      <div className="thumb">
        <img
          src={src}
          alt={title}
          loading="lazy"
          className="thumb__img"
        />
      </div>
    );
  }
  return (
    <div className={`thumb thumb--${categoryCode}`} aria-hidden="true">
      {GLYPH[categoryCode] ?? "▦"}
    </div>
  );
}
