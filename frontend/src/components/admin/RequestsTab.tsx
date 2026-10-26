import { useEffect, useState } from "react";
import {
  approveRegistrationRequest,
  fetchRegistrationRequests,
  fetchUsers,
  rejectRegistrationRequest,
  type RegistrationRequestOut,
  type UserOut,
} from "../../api/admin";
import { ApiError } from "../../api/client";
import { Modal } from "../Modal";
import { ConfirmModal } from "../ConfirmModal";
import { useToast } from "../Toast";

const CLUB_LABELS: Record<string, string> = {
  videographer: "МИЭТ-ТВ",
  photographer: "InFocus",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type ConfirmApprove = { request: RegistrationRequestOut } | null;
type RejectState = { request: RegistrationRequestOut; reason: string } | null;

export function RequestsTab() {
  const toast = useToast();
  const [requests, setRequests] = useState<RegistrationRequestOut[] | null>(null);
  const [users, setUsers] = useState<UserOut[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const [approve, setApprove] = useState<ConfirmApprove>(null);
  const [reject, setReject] = useState<RejectState>(null);

  const load = async () => {
    try {
        const [r, u] = await Promise.all([
        fetchRegistrationRequests({ status: "pending" }),
        fetchUsers(),
      ]);
      setRequests(r);
      setUsers(u);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Не удалось загрузить");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submitApprove = async () => {
    if (!approve) return;
    setBusy(approve.request.id);
    try {
      await approveRegistrationRequest(approve.request.id);
      setApprove(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Ошибка одобрения");
    } finally {
      setBusy(null);
    }
  };

  const submitReject = async () => {
    if (!reject) return;
    setBusy(reject.request.id);
    try {
      await rejectRegistrationRequest(reject.request.id, reject.reason);
      setReject(null);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Ошибка отклонения");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="list">
      {requests === null && <p className="empty__text">Загрузка…</p>}
      {requests !== null && requests.length === 0 && (
        <p className="empty__text">Нет активных заявок.</p>
      )}
      {requests?.map((r) => {
        const u = users?.find((x) => x.id === r.user_id);
        return (
          <div className="card" key={r.id}>
            <div className="card__heading">
              <h3 className="card__title">
                {CLUB_LABELS[r.club_code] ?? r.club_code}
              </h3>
              <span className="status-chip status-chip--warning">pending</span>
            </div>
            <p className="card__subtitle">
              {u
                ? `${u.full_name} (@${u.username ?? "—"})`
                : `user_id=${r.user_id}`}
            </p>
            <p className="card__subtitle">Создана: {fmtDate(r.created_at)}</p>
            <div className="row-actions">
              <button
                type="button"
                className="card__cta"
                disabled={busy === r.id}
                onClick={() => setApprove({ request: r })}
              >
                Одобрить
              </button>
              <button
                type="button"
                className="card__cta card__cta--secondary"
                disabled={busy === r.id}
                onClick={() => setReject({ request: r, reason: "" })}
              >
                Отклонить
              </button>
            </div>
          </div>
        );
      })}

      {/* --- Approve --- */}
      <ConfirmModal
        open={approve !== null}
        title="Одобрить заявку?"
        message={
          approve
            ? `Одобрить заявку в клуб «${CLUB_LABELS[approve.request.club_code] ?? approve.request.club_code}»?`
            : ""
        }
        confirmLabel="Одобрить"
        busy={busy !== null}
        onConfirm={submitApprove}
        onCancel={() => setApprove(null)}
      />

      {/* --- Reject --- */}
      <Modal
        open={reject !== null}
        title="Отклонить заявку"
        onClose={() => setReject(null)}
        footer={
          <>
            <button
              type="button"
              className="card__cta card__cta--secondary"
              onClick={() => setReject(null)}
            >
              Отмена
            </button>
            <button
              type="button"
              className="card__cta card__cta--danger"
              disabled={busy !== null}
              onClick={submitReject}
            >
              Отклонить
            </button>
          </>
        }
      >
        <label className="field">
          <span className="field__label">
            Причина отклонения (необязательно)
          </span>
          <textarea
            rows={3}
            value={reject?.reason ?? ""}
            onChange={(e) =>
              setReject(reject ? { ...reject, reason: e.target.value } : null)
            }
            placeholder="Например: недостаточно информации"
          />
        </label>
      </Modal>
    </div>
  );
}
