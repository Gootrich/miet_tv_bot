import type { ComponentType } from "react";
import {
  IconAudio,
  IconCamera,
  IconLens,
  IconLighting,
  IconPower,
  IconStabilizer,
  IconStand,
  IconStudio,
} from "./Icons";

interface Props {
  src?: string | null;
  categoryCode: string;
  title: string;
}

const GLYPH: Record<string, ComponentType<{ className?: string }>> = {
  cameras: IconCamera,
  lenses: IconLens,
  stabilizers: IconStabilizer,
  lighting: IconLighting,
  audio: IconAudio,
  stands: IconStand,
  power: IconPower,
  studio: IconStudio,
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

  const Icon = GLYPH[categoryCode];
  return (
    <div className={`thumb thumb--${categoryCode}`} aria-hidden="true">
      {Icon ? <Icon className="thumb__icon" /> : null}
    </div>
  );
}
