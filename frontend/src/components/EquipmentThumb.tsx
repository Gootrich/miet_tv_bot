import { useEffect, useState, type ComponentType } from "react";
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
  const [state, setState] = useState<"loading" | "ok" | "error">(src ? "loading" : "error");
  useEffect(() => { setState(src ? "loading" : "error"); }, [src]);

  if (src && state !== "error") {
    return (
      <div className={`thumb${state === "loading" ? " thumb--loading" : ""}`}>
        <img
          src={src}
          alt={title}
          loading="lazy"
          decoding="async"
          className="thumb__img"
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
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
