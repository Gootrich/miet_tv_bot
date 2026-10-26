import { useEffect, useState } from "react";
import {
  assignRole,
  blockUser,
  fetchRoles,
  fetchUsers,
  removeRole,
  unblockUser,
  type RoleOut,
  type UserOut,
} from "../../api/admin";
import { ApiError } from "../../api/client";
import { Modal } from "../Modal";
import { ConfirmModal } from "../ConfirmModal";
import { useToast } from "../Toast";

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  photographer: "InFocus (фотограф)",
  videographer: "МИЭТ-ТВ (видеограф)",
  miettv_head: "Глава МИЭТ-ТВ",
  infocus_head: "Глава InFocus",
};

const ASSIGNABLE = ["miettv_head", "infocus_head", "admin"] as const;

function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code;
}

type AssignState = { user: UserOut; roleCode: string } | null;
type BlockState = { user: UserOut; hours: string; reason: string } | null;
type ConfirmState =
  | { kind: "unblock"; user: UserOut }
  | { kind: "remove"; user: UserOut; roleCode: string }
  | null;

export function UsersTab({ me }: { me: UserOut }) {
  const toast = useToast();
  const [users, setUsers] = useState<UserOut[] | null>(null);
  const [roles, setRoles] = useState<RoleOut[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const [assign, setAssign] = useState<AssignState>(null);
  const [block, setBlock] = useState<BlockState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const load = async () => {
    try {
        const [u, r] = await Promise.all([fetchUsers(), fetchRoles()]);
      setUsers(u);
      setRoles(r);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось загрузить");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const assignableRoles = (roles ?? []).filter((r) =>
    ASSIGNABLE.includes(r.code as typeof ASSIGNABLE[number]),
  );

  // --- actions ---
  const submitAssign = async () => {
    if (!assign) return;
    setBusy(assign.user.id);
    try {
      await assignRole(assign.user.id, assign.roleCode);
      setAssign(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Ошибка назначения");
    } finally {
      setBusy(null);
    }
  };

  const submitBlock = async () => {
    if (!block) return;
    const hours = Number(block.hours);
    if (Number.isNaN(hours) || hours < 0) {
      toast.error("Некорректное количество часов");
      return;
    }
    setBusy(block.user.id);
    try {
      await blockUser(block.user.id, hours === 0 ? null : hours, block.reason);
      setBlock(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Ошибка блокировки");
    } finally {
      setBusy(null);
    }
  };

  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(confirm.user.id);
    try {
      if (confirm.kind === "unblock") {
        await unblockUser(confirm.user.id);
      } else if (confirm.kind === "remove") {
        await removeRole(confirm.user.id, confirm.roleCode);
      }
      setConfirm(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="list">
      {users === null && <p className="empty__text">Загрузка…</p>}

      {users?.map((u) => {
        const availableToAssign = assignableRoles.filter(
          (r) => !u.role_codes.includes(r.code),
        );
        const isSelf = u.id === me.id;

        return (
          <div className="card" key={u.id}>
            <div className="card__heading">
              <h3 className="card__title">{u.full_name}</h3>
              <span
                className={`status-chip${
                  u.status === "active"
                    ? " status-chip--success"
                    : u.status === "blocked"
                    ? " status-chip--error"
                    : " status-chip--warning"
                }`}
              >
                {u.status}
              </span>
            </div>
            <p className="card__subtitle">
              @{u.username ?? "—"} · TG {u.telegram_id}
            </p>

            <div className="card__roles">
              {u.role_codes.length === 0 && (
                <span className="card__subtitle">Роли: —</span>
              )}
              {u.role_codes.map((code) => (
                <span key={code} className="role-chip">
                  {roleLabel(code)}
                  {!isSelf && code !== "photographer" && code !== "videographer" && (
                    <button
                      type="button"
                      className="role-chip__remove"
                      title="Снять роль"
                      disabled={busy === u.id}
                      onClick={() =>
                        setConfirm({ kind: "remove", user: u, roleCode: code })
                      }
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>

            <div className="row-actions">
              {availableToAssign.length > 0 && (
                <button
                  type="button"
                  className="card__cta"
                  disabled={busy === u.id}
                  onClick={() =>
                    setAssign({ user: u, roleCode: availableToAssign[0].code })
                  }
                >
                  Назначить роль
                </button>
              )}
              {u.status !== "blocked" && !isSelf && (
                <button
                  type="button"
                  className="card__cta card__cta--danger"
                  disabled={busy === u.id}
                  onClick={() =>
                    setBlock({ user: u, hours: "24", reason: "Нарушение правил" })
                  }
                >
                  Заблокировать
                </button>
              )}
              {u.status === "blocked" && (
                <button
                  type="button"
                  className="card__cta"
                  disabled={busy === u.id}
                  onClick={() => setConfirm({ kind: "unblock", user: u })}
                >
                  Разблокировать
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* --- Assign role --- */}
      <Modal
        open={assign !== null}
        title={`Назначить роль — ${assign?.user.full_name ?? ""}`}
        onClose={() => setAssign(null)}
        footer={
          <>
            <button
              type="button"
              className="card__cta card__cta--secondary"
              onClick={() => setAssign(null)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="card__cta"
              disabled={busy !== null}
              onClick={submitAssign}
            >
              Назначить
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field__label">Роль</span>
          <select
            value={assign?.roleCode ?? ""}
            onChange={(e) =>
              setAssign(assign ? { ...assign, roleCode: e.target.value } : null)
            }
          >
            {assignableRoles
              .filter((r) => !assign?.user.role_codes.includes(r.code))
              .map((r) => (
                <option key={r.code} value={r.code}>
                  {roleLabel(r.code)}
                </option>
              ))}
          </select>
        </label>
      </Modal>

      {/* --- Block user --- */}
      <Modal
        open={block !== null}
        title={`Заблокировать — ${block?.user.full_name ?? ""}`}
        onClose={() => setBlock(null)}
        footer={
          <>
            <button
              type="button"
              className="card__cta card__cta--secondary"
              onClick={() => setBlock(null)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="card__cta card__cta--danger"
              disabled={busy !== null}
              onClick={submitBlock}
            >
              Заблокировать
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field__label">
            На сколько часов (0 = бессрочно)
          </span>
          <input
            type="number"
            min={0}
            value={block?.hours ?? "24"}
            onChange={(e) =>
              setBlock(block ? { ...block, hours: e.target.value } : null)
            }
          />
        </label>
        <label className="field">
          <span className="field__label">Причина</span>
          <textarea
            rows={3}
            value={block?.reason ?? ""}
            onChange={(e) =>
              setBlock(block ? { ...block, reason: e.target.value } : null)
            }
          />
        </label>
      </Modal>

      {/* --- Confirm unblock / remove role --- */}
      <ConfirmModal
        open={confirm !== null}
        title={confirm?.kind === "unblock" ? "Разблокировать" : "Снять роль"}
        message={
          confirm?.kind === "unblock"
            ? `Разблокировать ${confirm.user.full_name}?`
            : confirm?.kind === "remove"
            ? `Снять роль «${roleLabel(confirm.roleCode)}» у ${confirm.user.full_name}?`
            : ""
        }
        confirmLabel={confirm?.kind === "unblock" ? "Разблокировать" : "Снять"}
        danger={confirm?.kind === "remove"}
        busy={busy !== null}
        onConfirm={doConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
