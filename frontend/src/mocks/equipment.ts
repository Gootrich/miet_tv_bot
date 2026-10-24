// MOCK data — not connected to backend. Replace on stage 6.

export interface MockEquipment {
  id: string;
  title: string;
  category: "Камеры" | "Свет" | "Звук";
  subtitle: string;
  status: { kind: "available" } | { kind: "busy"; until: string };
  icon: "camera" | "light" | "mic";
}

// MOCK
export const MOCK_EQUIPMENT: MockEquipment[] = [
  {
    id: "mock-sony-a7iii",
    title: "Sony A7 III",
    category: "Камеры",
    subtitle: "Полнокадровая беззеркальная камера",
    status: { kind: "available" },
    icon: "camera",
  },
  {
    id: "mock-godox-sl60w",
    title: "Godox SL-60W",
    category: "Свет",
    subtitle: "Светодиодный осветитель 60 Вт",
    status: { kind: "busy", until: "15:00" },
    icon: "light",
  },
  {
    id: "mock-rode-wireless",
    title: "Rode Wireless GO II",
    category: "Звук",
    subtitle: "Беспроводная петличная система",
    status: { kind: "available" },
    icon: "mic",
  },
];

// MOCK
export const MOCK_CATEGORIES = ["Все", "Камеры", "Свет", "Звук"] as const;
export type MockCategory = (typeof MOCK_CATEGORIES)[number];
