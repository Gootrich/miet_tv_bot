interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true as const,
    focusable: "false" as const,
  };
}

export function IconCatalog({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconOccupancy({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 9.5h17" />
      <circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconBookings({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M15 4.5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h2" />
      <rect x="9" y="2.5" width="6" height="4" rx="1.2" />
      <path d="M8.5 11.5h7M8.5 15.5h5" />
    </svg>
  );
}

export function IconProfile({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function IconSun({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="3.75" />
      <path d="M12 2.5v2M12 19.5v2M4.4 4.4l1.4 1.4M18.2 18.2l1.4 1.4M2.5 12h2M19.5 12h2M4.4 19.6l1.4-1.4M18.2 5.8l1.4-1.4" />
    </svg>
  );
}

export function IconMoon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.5 6.5 0 0 0 9.7 9.7Z" />
    </svg>
  );
}

export function IconAuto({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSearch({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.8-3.8" />
    </svg>
  );
}

/* ---------- Category glyphs (EquipmentThumb) ---------- */

export function IconCamera({ size = 40, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2.5" />
      <path d="M8 7.5 9.2 5h5.6l1.2 2.5" />
      <circle cx="12" cy="13.7" r="3.2" />
    </svg>
  );
}

export function IconLens({ size = 40, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M12 3.5v1.5M12 19v1.5M3.5 12h1.5M19 12h1.5" />
    </svg>
  );
}

export function IconStabilizer({ size = 40, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="4" y="4" width="16" height="11" rx="2" />
      <path d="M9 15v3.5a2 2 0 0 1-2 2H6" />
      <circle cx="16" cy="18" r="2.2" />
    </svg>
  );
}

export function IconLighting({ size = 40, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3v2.5M5.6 5.6l1.8 1.8M18.4 5.6l-1.8 1.8M3 12h2.5M18.5 12H21" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M10.5 20.5h3M11 18h2" />
    </svg>
  );
}

export function IconAudio({ size = 40, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3M9 21h6" />
    </svg>
  );
}

export function IconStand({ size = 40, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="4.5" r="1.6" />
      <path d="M12 6.1v11M7 19l5-1.9 5 1.9M12 17v2" />
    </svg>
  );
}

export function IconPower({ size = 40, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4.5 9h13.5" />
      <rect x="4.5" y="6.5" width="13.5" height="9" rx="2.5" />
      <path d="M19.5 10.5v3" />
      <path d="M7.5 9v4M11 9v4" />
    </svg>
  );
}

export function IconStudio({ size = 40, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="6.5" width="18" height="14" rx="2" />
      <path d="M3 6.5 5 2.5h18l-2 4H3Z" />
      <path d="M8 2.5 7 6.5M13 2.5l-1 4M18 2.5l-1 4" />
    </svg>
  );
}

/* ---------- State glyphs (empty / error / auth) ---------- */

export function IconInbox({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 13.5 6 5.5h12l2 8" />
      <path d="M4 13.5h4.5l1 2h5l1-2H20" />
      <path d="M4 13.5v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

export function IconAlert({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconLock({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
