import { useState } from "react";
import type { UserOut } from "../api/admin";
import { UsersTab } from "./admin/UsersTab";
import { RequestsTab } from "./admin/RequestsTab";
import { EquipmentTab } from "./admin/EquipmentTab";

type Tab = "requests" | "users" | "equipment";

export function AdminSection({ me }: { me: UserOut }) {
  const canManageRequests =
    me.role_codes.includes("admin") ||
    me.role_codes.includes("miettv_head") ||
    me.role_codes.includes("infocus_head");
  const canManageUsers = me.role_codes.includes("admin");
  const canManageEquipment = me.role_codes.includes("admin");
  const tabCount = [canManageRequests, canManageUsers, canManageEquipment].filter(Boolean).length;

  const initialTab: Tab = canManageRequests
    ? "requests"
    : canManageUsers
    ? "users"
    : "equipment";

  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <section className="admin-section">
      <h2 className="section-title">Администрирование</h2>

      <div
        className="segmented"
        role="tablist"
        style={tabCount < 2 ? { display: "none" } : undefined}
      >
        {canManageRequests && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "requests"}
            className={`segmented__item${tab === "requests" ? " is-active" : ""}`}
            onClick={() => setTab("requests")}
          >
            Заявки
          </button>
        )}
        {canManageUsers && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "users"}
            className={`segmented__item${tab === "users" ? " is-active" : ""}`}
            onClick={() => setTab("users")}
          >
            Пользователи
          </button>
        )}
        {canManageEquipment && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "equipment"}
            className={`segmented__item${tab === "equipment" ? " is-active" : ""}`}
            onClick={() => setTab("equipment")}
          >
            Оборудование
          </button>
        )}
      </div>

      {tab === "requests" && canManageRequests && <RequestsTab />}
      {tab === "users" && canManageUsers && <UsersTab me={me} />}
      {tab === "equipment" && canManageEquipment && <EquipmentTab />}
    </section>
  );
}
