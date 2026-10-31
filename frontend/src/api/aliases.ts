import { apiFetch } from "./client";

export interface AliasOut {
  id: number;
  model_id: number;
  value: string;
  created_by_user_id: number | null;
  created_at: string | null;
}

export function fetchAliases(modelId: number): Promise<AliasOut[]> {
  return apiFetch<AliasOut[]>(`/catalog/models/${modelId}/aliases`);
}

export function addAlias(modelId: number, value: string): Promise<AliasOut> {
  return apiFetch<AliasOut>(`/catalog/models/${modelId}/aliases`, {
    method: "POST",
    body: JSON.stringify({ value }),
  });
}

export function deleteAlias(modelId: number, aliasId: number): Promise<{ status: string; id: number }> {
  return apiFetch(`/catalog/models/${modelId}/aliases/${aliasId}`, {
    method: "DELETE",
  });
}
