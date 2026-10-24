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

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
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
