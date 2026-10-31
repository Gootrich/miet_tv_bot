// Тонкий клиент к read-only API каталога.
// Типы повторяют Pydantic-схемы в app/api/schemas.py.

export interface EquipmentItemPublicOut {
  id: number;
  status: "active" | "maintenance" | "retired";
}

export interface EquipmentItemOut extends EquipmentItemPublicOut {
  inventory_number?: string;
  serial_number?: string | null;
  notes?: string | null;
}

export interface EquipmentModelOut {
  id: number;
  category_id: number;
  name: string;
  manufacturer: string | null;
  description: string | null;
  short_name?: string | null;
  aliases?: string[];
  access_policy: "all" | "photographer" | "videographer";
  tracking_type: "individual" | "quantity";
  total_quantity: number;
  available_now: number;
  free_until: string | null;
  next_busy_at: string | null;
  // Этап 2+: доступность на выбранный интервал (только при from_dt/to_dt).
  available_in_period?: number | null;
  image_url?: string | null;
}

export interface EquipmentModelDetailPublicOut extends EquipmentModelOut {
  view: "public";
  items: EquipmentItemPublicOut[];
}

export interface EquipmentModelDetailOut extends EquipmentModelOut {
  view: "admin";
  items: EquipmentItemOut[];
}

export type EquipmentModelDetailResponse =
  | EquipmentModelDetailPublicOut
  | EquipmentModelDetailOut;

export interface CategoryWithModelsOut {
  id: number;
  code: string;
  name: string;
  description: string | null;
  models: EquipmentModelOut[];
}

export interface CatalogItem {
  id: string;                              // `model-<id>` для React key
  modelId: number;
  title: string;
  category: string;
  categoryCode: string;
  subtitle: string;
  shortName?: string | null;
  aliases?: string[];
  icon: "camera" | "light" | "mic";
  trackingType: "individual" | "quantity";
  totalQuantity: number;
  availableNow: number;
  freeUntil: string | null;
  nextBusyAt: string | null;
  availableInPeriod?: number | null;       // доступно на выбранный период (undefined если нет данных)
  imageUrl?: string | null;
}

import { apiFetch, ApiError } from "./client";

export { ApiError };

/**
 * Каталог с моделями.
 * Без параметров — доступность «на сейчас».
 * С from_dt/to_dt — дополнительно available_in_period.
 */
export function fetchCatalog(
  fromIso?: string | null,
  toIso?: string | null,
): Promise<CategoryWithModelsOut[]> {
  const qs = new URLSearchParams();
  if (fromIso && toIso) {
    qs.set("from_dt", fromIso);
    qs.set("to_dt", toIso);
  }
  const q = qs.toString();
  return apiFetch<CategoryWithModelsOut[]>(`/catalog${q ? `?${q}` : ""}`);
}

export function fetchModel(id: number): Promise<EquipmentModelDetailResponse> {
  return apiFetch<EquipmentModelDetailResponse>(`/catalog/models/${id}`);
}

export interface ModelAvailability {
  model_id: number;
  available_in_period: number | null;
  next_available_start: string | null;
  next_available_end: string | null;
}

/** Доступность одной модели на интервал + ближайший подходящий слот. */
export function fetchModelAvailability(
  modelId: number,
  fromIso: string,
  toIso: string,
  quantity: number = 1,
): Promise<ModelAvailability> {
  const qs = new URLSearchParams();
  qs.set("from_dt", fromIso);
  qs.set("to_dt", toIso);
  qs.set("quantity", String(quantity));
  return apiFetch<ModelAvailability>(
    `/catalog/models/${modelId}/availability?${qs.toString()}`,
  );
}

// Пиктограмма по категории — временная эвристика до появления поля icon в БД.
function iconForCategory(categoryName: string): CatalogItem["icon"] {
  const normalized = categoryName.toLowerCase();
  if (normalized.includes("камер") || normalized.includes("camera")) {
    return "camera";
  }
  if (
    normalized.includes("свет") ||
    normalized.includes("light") ||
    normalized.includes("освещ")
  ) {
    return "light";
  }
  return "mic";
}

export function toCatalogItems(
  categories: CategoryWithModelsOut[],
): CatalogItem[] {
  const result: CatalogItem[] = [];
  for (const category of categories) {
    for (const model of category.models) {
      result.push({
        id: `model-${model.id}`,
        modelId: model.id,
        title: model.name,
        category: category.name,
        categoryCode: category.code,
        shortName: model.short_name ?? null,
        aliases: model.aliases ?? [],
        subtitle:
          model.manufacturer
            ? `${model.manufacturer}${model.description ? " · " + model.description : ""}`
            : (model.description ?? ""),
        icon: iconForCategory(category.code),
        trackingType: model.tracking_type,
        totalQuantity: model.total_quantity,
        availableNow: model.available_now,
        freeUntil: model.free_until,
        nextBusyAt: model.next_busy_at,
        availableInPeriod: model.available_in_period ?? null,
        imageUrl: model.image_url ?? null,
      });
    }
  }
  return result;
}

// Порядок отображения категорий (не по алфавиту — как в каталоге студии).
const CATEGORY_ORDER: string[] = [
  "cameras",
  "lenses",
  "stabilizers",
  "lighting",
  "audio",
  "stands",
  "power",
  "studio",
];

export function categoryNames(
  categories: CategoryWithModelsOut[],
): string[] {
  const sorted = [...categories].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a.code);
    const ib = CATEGORY_ORDER.indexOf(b.code);
    if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return ["Все", ...sorted.map((c) => c.name)];
}

// --- Типы и функции для бронирования ---

export interface BookingRequest {
  item_id?: number | null;
  model_id?: number | null;
  quantity?: number;
  planned_start: string; // ISO string
  planned_end: string;   // ISO string
  comment?: string | null;
}

export interface BookingOut {
  id: number;
  item_id: number | null;
  model_id: number | null;
  user_id: number;
  quantity: number;
  planned_start: string;
  planned_end: string;
  actual_checkout: string | null;
  actual_return: string | null;
  status: string;
  comment: string | null;
  created_at: string | null;
  group_id: number | null;
  user_name: string | null;
  model_name: string | null;
  model_short_name: string | null;
  category_name: string | null;
  item_inventory_number: string | null;
}

export interface BookingHistoryOut {
  id: number;
  booking_id: number;
  actor_user_id: number | null;
  actor_full_name?: string | null;
  actor_username?: string | null;
  event_type: "created" | "checkout" | "return" | "cancelled" | "moved" | string;
  details: string | null;
  created_at: string;
}

export function fetchJsonWithAuth<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, options);
}

export function createBooking(data: BookingRequest): Promise<BookingOut> {
  return fetchJsonWithAuth<BookingOut>("/bookings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function fetchBookings(): Promise<BookingOut[]> {
  return fetchJsonWithAuth<BookingOut[]>("/bookings");
}
