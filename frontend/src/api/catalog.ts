// Тонкий клиент к read-only API каталога.
// Типы повторяют Pydantic-схемы в app/api/schemas.py.

export interface EquipmentItemOut {
  id: number;
  inventory_number: string;
  serial_number: string | null;
  status: "active" | "maintenance" | "retired";
  notes: string | null;
}

export interface EquipmentModelOut {
  id: number;
  category_id: number;
  name: string;
  manufacturer: string | null;
  description: string | null;
  access_policy: "all" | "photographer" | "videographer";
}

export interface EquipmentModelDetailOut extends EquipmentModelOut {
  items: EquipmentItemOut[];
}

export interface CategoryWithModelsOut {
  id: number;
  name: string;
  description: string | null;
  models: EquipmentModelOut[];
}

export interface CatalogItem {
  id: string;                              // `model-<id>` для React key
  modelId: number;
  title: string;
  category: string;
  subtitle: string;
  icon: "camera" | "light" | "mic";
  status:
    | { kind: "available" }
    | { kind: "busy"; until: string }      // заполним на этапе доступности
    | { kind: "unknown" };
}

const API_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(
      response.status,
      `API ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
    );
  }
  return (await response.json()) as T;
}

export function fetchCatalog(): Promise<CategoryWithModelsOut[]> {
  return fetchJson<CategoryWithModelsOut[]>("/catalog");
}

export function fetchModel(id: number): Promise<EquipmentModelDetailOut> {
  return fetchJson<EquipmentModelDetailOut>(`/catalog/models/${id}`);
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
        subtitle: model.description ?? model.manufacturer ?? "",
        icon: iconForCategory(category.name),
        // Реальную доступность пока не знаем — этап бронирований впереди.
        status: { kind: "unknown" },
      });
    }
  }
  return result;
}

export function categoryNames(
  categories: CategoryWithModelsOut[],
): string[] {
  return ["Все", ...categories.map((category) => category.name)];
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
}

// Получение initData из Telegram WebApp (если доступно) или заглушка для разработки
function getInitDataHeader(): string {
  if (typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initData) {
    return (window as any).Telegram.WebApp.initData;
  }
  return ""; // В реальном Telegram Mini App здесь будет строка авторизации
}

async function fetchJsonWithAuth<T>(path: string, options: RequestInit = {}): Promise<T> {
  const initData = getInitDataHeader();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (initData) {
    headers["x-telegram-init-data"] = initData;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(
      response.status,
      `API ${response.status} ${response.statusText}: ${text.slice(0, 200)}`,
    );
  }
  return (await response.json()) as T;
}

export function createBooking(data: BookingRequest): Promise<BookingOut> {
  return fetchJsonWithAuth<BookingOut>("/bookings", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function checkoutBooking(bookingId: number): Promise<BookingOut> {
  return fetchJsonWithAuth<BookingOut>(`/bookings/${bookingId}/checkout`, {
    method: "POST",
  });
}

export function returnBooking(bookingId: number): Promise<BookingOut> {
  return fetchJsonWithAuth<BookingOut>(`/bookings/${bookingId}/return`, {
    method: "POST",
  });
}


export function fetchBookings(): Promise<BookingOut[]> {
  return fetchJsonWithAuth<BookingOut[]>("/bookings");
}
