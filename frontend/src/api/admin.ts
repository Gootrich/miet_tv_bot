import { apiFetch } from "./client";

export interface UserOut {
  id: number;
  telegram_id: number;
  full_name: string;
  username: string | null;
  status: string;
  is_active: boolean;
  block_reason: string | null;
  blocked_until: string | null;
  role_codes: string[];
  created_at: string;
  approved_at: string | null;
}

export interface RegistrationRequestOut {
  id: number;
  user_id: number;
  club_code: "photographer" | "videographer";
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  decided_by_id: number | null;
  decision_reason: string | null;
}

export function fetchMe(): Promise<UserOut> {
  return apiFetch<UserOut>("/me");
}

export function fetchRegistrationRequests(params: {
  club?: "photographer" | "videographer";
  status?: string;
} = {}): Promise<RegistrationRequestOut[]> {
  const q = new URLSearchParams();
  if (params.club) q.set("club", params.club);
  if (params.status) q.set("status", params.status);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetch<RegistrationRequestOut[]>(`/admin/registration-requests${suffix}`);
}

export function approveRegistrationRequest(id: number): Promise<RegistrationRequestOut> {
  return apiFetch<RegistrationRequestOut>(
    `/admin/registration-requests/${id}/approve`,
    { method: "POST" },
  );
}

export function rejectRegistrationRequest(
  id: number,
  reason: string = "",
): Promise<RegistrationRequestOut> {
  return apiFetch<RegistrationRequestOut>(
    `/admin/registration-requests/${id}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    },
  );
}

export function fetchUsers(): Promise<UserOut[]> {
  return apiFetch<UserOut[]>("/admin/users");
}

export function blockUser(
  id: number,
  hours: number | null,
  reason: string,
): Promise<UserOut> {
  return apiFetch<UserOut>(`/admin/users/${id}/block`, {
    method: "POST",
    body: JSON.stringify({ hours, reason }),
  });
}

export function unblockUser(id: number): Promise<UserOut> {
  return apiFetch<UserOut>(`/admin/users/${id}/unblock`, { method: "POST" });
}

// Назначение/снятие роли главы — через новую админку, если появится.
// Пока назначение делает суперадмин вручную (см. подсказку в UI).


// ============================================================
// Roles (assign/remove)
// ============================================================

export interface RoleOut {
  id: number;
  code: string;
  name: string;
  scopes: string[];
}

export function fetchRoles(): Promise<RoleOut[]> {
  return apiFetch<RoleOut[]>("/admin/roles");
}

export function assignRole(userId: number, roleCode: string): Promise<UserOut> {
  return apiFetch<UserOut>(`/admin/users/${userId}/roles`, {
    method: "POST",
    body: JSON.stringify({ role_code: roleCode }),
  });
}

export function removeRole(userId: number, roleCode: string): Promise<UserOut> {
  return apiFetch<UserOut>(`/admin/users/${userId}/roles/${roleCode}`, {
    method: "DELETE",
  });
}

// ============================================================
// Equipment: categories
// ============================================================

export interface CategoryAdmin {
  id: number;
  code: string;
  name: string;
  description: string | null;
}

export function fetchAdminCategories(): Promise<CategoryAdmin[]> {
  return apiFetch<CategoryAdmin[]>("/admin/equipment/categories");
}

export function createCategory(payload: {
  code: string;
  name: string;
  description?: string | null;
}): Promise<CategoryAdmin> {
  return apiFetch<CategoryAdmin>("/admin/equipment/categories", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCategory(
  id: number,
  payload: { name?: string; description?: string | null },
): Promise<CategoryAdmin> {
  return apiFetch<CategoryAdmin>(`/admin/equipment/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCategory(id: number): Promise<{ status: string; id: number }> {
  return apiFetch(`/admin/equipment/categories/${id}`, { method: "DELETE" });
}

// ============================================================
// Equipment: models
// ============================================================

export type AccessPolicy = "all" | "photographer" | "videographer";
export type TrackingType = "individual" | "quantity";

export interface ModelAdmin {
  id: number;
  category_id: number;
  name: string;
  manufacturer: string | null;
  description: string | null;
  access_policy: AccessPolicy;
  tracking_type: TrackingType;
  total_quantity: number;
  image_url?: string | null;
}

export function fetchAdminModels(params: { category_id?: number } = {}): Promise<ModelAdmin[]> {
  const q = new URLSearchParams();
  if (params.category_id) q.set("category_id", String(params.category_id));
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetch<ModelAdmin[]>(`/admin/equipment/models${suffix}`);
}

export function createModel(payload: {
  category_id: number;
  name: string;
  manufacturer?: string | null;
  description?: string | null;
  access_policy?: AccessPolicy;
  tracking_type?: TrackingType;
  total_quantity?: number;
}): Promise<ModelAdmin> {
  return apiFetch<ModelAdmin>("/admin/equipment/models", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateModel(
  id: number,
  payload: Partial<Omit<ModelAdmin, "id">>,
): Promise<ModelAdmin> {
  return apiFetch<ModelAdmin>(`/admin/equipment/models/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function uploadModelImage(id: number, file: File): Promise<{ id: number; image_url: string }> {
  return apiFetch(`/admin/equipment/models/${id}/image`, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
}

export function deleteModelImage(id: number): Promise<{ id: number; image_url: null }> {
  return apiFetch(`/admin/equipment/models/${id}/image`, { method: "DELETE" });
}

export function deleteModel(id: number): Promise<{ status: string; id: number }> {
  return apiFetch(`/admin/equipment/models/${id}`, { method: "DELETE" });
}

// ============================================================
// Equipment: items
// ============================================================

export type ItemStatus = "active" | "maintenance" | "retired";

export interface ItemAdmin {
  id: number;
  model_id: number;
  inventory_number: string;
  serial_number: string | null;
  status: ItemStatus;
  notes: string | null;
}

export function fetchAdminItems(params: { model_id?: number } = {}): Promise<ItemAdmin[]> {
  const q = new URLSearchParams();
  if (params.model_id) q.set("model_id", String(params.model_id));
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetch<ItemAdmin[]>(`/admin/equipment/items${suffix}`);
}

export function createItem(payload: {
  model_id: number;
  inventory_number: string;
  serial_number?: string | null;
  status?: ItemStatus;
  notes?: string | null;
}): Promise<ItemAdmin> {
  return apiFetch<ItemAdmin>("/admin/equipment/items", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateItem(
  id: number,
  payload: { serial_number?: string | null; status?: ItemStatus; notes?: string | null },
): Promise<ItemAdmin> {
  return apiFetch<ItemAdmin>(`/admin/equipment/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteItem(id: number): Promise<{ status: string; id: number }> {
  return apiFetch(`/admin/equipment/items/${id}`, { method: "DELETE" });
}
