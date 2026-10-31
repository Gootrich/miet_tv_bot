import { apiFetch } from "./client";

export function fetchFavorites(): Promise<number[]> {
  return apiFetch<number[]>("/me/favorites");
}

export function addFavorite(
  modelId: number,
): Promise<{ model_id: number; favorited: boolean }> {
  return apiFetch(`/catalog/models/${modelId}/favorite`, { method: "POST" });
}

export function removeFavorite(
  modelId: number,
): Promise<{ model_id: number; favorited: boolean }> {
  return apiFetch(`/catalog/models/${modelId}/favorite`, { method: "DELETE" });
}
