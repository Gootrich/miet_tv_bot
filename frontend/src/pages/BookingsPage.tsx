import { invalidate } from "../api/cache";
import { useEffect, useMemo, useRef, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { Modal } from "../components/Modal";
import { ConfirmModal } from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import { ChipsRow, type ChipItem } from "../components/ChipsRow";
import { IconAlert, IconInbox } from "../components/Icons";
import { DateTimeRangePicker, type DTRange } from "../components/DateTimeRangePicker";
import { AuthRequired } from "../components/AuthRequired";
import { isAuthError, type ApiError } from "../api/client";
import {
  fetchJsonWithAuth,
  fetchCatalog,
  type BookingOut,
  type CatalogItem,
} from "../api/catalog";
import {
  addToBooking,
  cancelBooking,
  fetchBookings,
  moveBooking,
} from "../api/bookings";

type Mode = "active" | "history";
type Scope = "mine" | "all";
type Club = "all" | "photographer" | "videographer";

const PAGE_SIZE = 20;

const CLUB_CHIPS: ChipItem[] = [
  { code: "all", label: "Все клубы" },
  { code: "photographer", label: "Фотоклуб" },
  { code: "videographer", label: "МИЭТ-ТВ" },
];

type LoadState =
  | { kind: "loading" }
  | { kind: "auth"; error: ApiError }
  | { kind: "error"; message: string }
  | { kind: "ready"; bookings: BookingOut[] };

function displayName(b: BookingOut): string {
  const sn = b.model_short_name;
  if (sn && sn.trim()) return sn.trim();
  return b.model_name ?? (b.model_id ? `Модель #${b.model_id}` : "—");
}

function statusInfo(status: string) {
  switch (status) {
    case "pending":   return { label: "Ожидает",  cls: "status-chip--warning", dot: "status-dot--warning" };
    case "confirmed": return { label: "Забронировано", cls: "status-chip--success", dot: "status-dot--success" };
    case "completed": return { label: "Завершено",     cls: "status-chip",          dot: "status-dot--success" };
    case "cancelled": return { label: "Отменено", cls: "status-chip--error",   dot: "status-dot--error"   };
    default:          return { label: status,     cls: "status-chip",          dot: ""                    };
  }
}

function fmtShort(dt: string | null | undefined): string {
  if (!dt) return "—";
  const d = new Date(dt);
  const date = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

function fmt(dt: string | null | undefined): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString();
}

/**
 * Группировка плоского списка BookingOut по group_id (с fallback = id для legacy).
 * Сортировка: по planned_start DESC (как на сервере).
 */
interface BookingGroup {
  group_id: number;
  bookings: BookingOut[];
  primary: BookingOut; // для общих полей (status, user, dates)
}
function groupBookings(bookings: BookingOut[]): BookingGroup[] {
  const map = new Map<number, BookingOut[]>();
  for (const b of bookings) {
    const gid = b.group_id ?? b.id;
    if (!map.has(gid)) map.set(gid, []);
    map.get(gid)!.push(b);
  }
  const groups: BookingGroup[] = [];
  for (const [gid, arr] of map.entries()) {
    const primary =
      arr.find((b) => b.status === "confirmed") ||
      arr.find((b) => b.status === "pending") ||
      arr[0];
    groups.push({ group_id: gid, bookings: arr, primary });
  }
  // DESC по planned_start primary
  groups.sort((a, b) =>
    a.primary.planned_start < b.primary.planned_start ? 1 : -1,
  );
  return groups;
}

function groupSummary(bookings: BookingOut[]): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const b of bookings) {
    const n = displayName(b);
    if (!seen.has(n)) {
      seen.add(n);
      names.push(n);
    }
  }
  const max = 2;
  const head = names.slice(0, max).join(", ");
  const rest = names.length > max ? ` +${names.length - max}` : "";
  return `${head}${rest} · ${bookings.length} ${pluralPositions(bookings.length)}`;
}

function pluralPositions(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "позиции";
  return "позиций";
}

export function BookingsPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("active");
  const [scope, setScope] = useState<Scope>("mine");
  const [meId, setMeId] = useState<number | null>(null);

  const [club, setClub] = useState<Club>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const bookingsFetchingRef = useRef(false);

  // Отмена (по одной брони)
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  // Отмена всей группы
  const [cancelGroupId, setCancelGroupId] = useState<number | null>(null);
  const [cancelGroupBusy, setCancelGroupBusy] = useState(false);

  // Развёрнутые группы (по умолчанию список позиций скрыт)
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set<number>());
  const toggleExpanded = (gid: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };

  // Перенос (по одной брони)
  const [moveTarget, setMoveTarget] = useState<BookingOut | null>(null);
  const [moveStartIso, setMoveStartIso] = useState<string | null>(null);
  const [moveEndIso, setMoveEndIso] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);

  const [addToBase, setAddToBase] = useState<BookingOut | null>(null);
  const [addModelId, setAddModelId] = useState<number | "">("");
  const [addQuantity, setAddQuantity] = useState(1);
  const [addBusy, setAddBusy] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);

  // meId через fetchJsonWithAuth (X-Dev-User прокидывается)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await fetchJsonWithAuth<{ id: number }>("/me");
        if (alive) setMeId(me.id);
      } catch (e) {
        // Auth-ошибка (/me вернёт 401/403) не засоряет toast: тот же
        // auth-экран покажет loadBookings. Toast — только для сетевых.
        if (!isAuthError(e)) {
          toast.error(
            e instanceof Error
              ? `Не удалось определить пользователя: ${e.message}`
              : "Не удалось определить пользователя",
          );
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBookings = async (loadKind: "replace" | "append" = "replace") => {
    if (bookingsFetchingRef.current) return;
    bookingsFetchingRef.current = true;
    if (loadKind === "replace") setState({ kind: "loading" });
    try {
      const beforeId =
        loadKind === "append" && state.kind === "ready" && state.bookings.length > 0
          ? state.bookings[state.bookings.length - 1].id
          : undefined;
      const data = await fetchBookings({
        scope,
        club: club === "all" ? undefined : club,
        status: mode === "active" ? "pending,confirmed" : "cancelled,completed",
        includeCancelled: mode === "history",
        beforeId,
        limit: PAGE_SIZE,
      });
      if (loadKind === "append" && state.kind === "ready") {
        setState({ kind: "ready", bookings: [...state.bookings, ...data] });
      } else {
        setState({ kind: "ready", bookings: data });
      }
    } catch (e) {
      if (isAuthError(e)) {
        setState({ kind: "auth", error: e });
      } else {
        const msg = e instanceof Error ? e.message : "Ошибка загрузки броней";
        setState({ kind: "error", message: msg });
        toast.error(msg);
      }
    } finally {
      bookingsFetchingRef.current = false;
    }
  };

  useEffect(() => {
    void loadBookings("replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scope, club]);

  const visibleBookings = state.kind === "ready" ? state.bookings : [];

  // Группировка
  const groups = useMemo(() => groupBookings(visibleBookings), [visibleBookings]);

  const canLoadMore =
    state.kind === "ready" && state.bookings.length === PAGE_SIZE;

  // ---- Действия по одной брони ----


  const doCancel = async () => {
    if (cancelId == null) return;
    setCancelBusy(true);
    try {
      await cancelBooking(cancelId);

      invalidate("occupancy");
      toast.success(`Бронь #${cancelId} отменена`);
      setCancelId(null);
      await loadBookings("replace");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка отмены");
    } finally { setCancelBusy(false); }
  };

  const doCancelGroup = async () => {
    if (cancelGroupId == null) return;
    const group = groups.find((g) => g.group_id === cancelGroupId);
    if (!group) { setCancelGroupId(null); return; }
    // Новая семантика: фактическая выдача/возврат не используются.
    // Групповая отмена — только для pending-позиций.
    const toCancel = group.bookings.filter(
      (b) => b.status === "pending" || b.status === "confirmed",
    );
    if (toCancel.length === 0) { setCancelGroupId(null); return; }
    setCancelGroupBusy(true);
    let done = 0;
    let firstError: string | null = null;
    try {
      for (const b of toCancel) {
        try {
          await cancelBooking(b.id);

          invalidate("occupancy");
          done++;
        } catch (e) {
          firstError = `#${b.id}: ${e instanceof Error ? e.message : "ошибка"}`;
          break;
        }
      }
      if (firstError) {
        toast.error(`Отменено ${done} из ${toCancel.length}. Ошибка: ${firstError}`);
      } else {
        toast.success(`Отменено позиций: ${done}`);
      }
    } finally {
      setCancelGroupBusy(false);
      setCancelGroupId(null);
      await loadBookings("replace");
    }
  };


  const openMove = (b: BookingOut) => {
    setMoveTarget(b);
    setMoveStartIso(b.planned_start);
    setMoveEndIso(b.planned_end);
  };

  const doMove = async () => {
    if (!moveTarget) return;
    if (!moveStartIso || !moveEndIso) { toast.error("Укажите начало и конец"); return; }
    const s = new Date(moveStartIso);
    const e = new Date(moveEndIso);
    if (s.getMinutes() % 15 !== 0 || e.getMinutes() % 15 !== 0) {
      toast.error("Время должно быть кратно 15 минутам"); return;
    }
    if (s >= e) { toast.error("Начало должно быть раньше окончания"); return; }
    setMoveBusy(true);
    try {
      await moveBooking(moveTarget.id, moveStartIso, moveEndIso);

      invalidate("occupancy");
      toast.success(`Бронь #${moveTarget.id} перенесена`);
      setMoveTarget(null);
      await loadBookings("replace");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка переноса");
    } finally { setMoveBusy(false); }
  };





  const openAdd = async (b: BookingOut) => {
    setAddToBase(b);
    setAddModelId("");
    setAddQuantity(1);
    if (catalog.length === 0) {
      try {
        const cats = await fetchCatalog();
        const items: CatalogItem[] = [];
        for (const c of cats) for (const m of c.models) {
          items.push({
            id: `model-${m.id}`,
            modelId: m.id,
            title: m.name,
            category: c.name,
            categoryCode: c.code,
            subtitle: m.manufacturer ?? "",
            icon: "camera",
            trackingType: m.tracking_type,
            totalQuantity: m.total_quantity,
            availableNow: m.available_now,
            freeUntil: m.free_until,
            nextBusyAt: m.next_busy_at,
          });
        }
        setCatalog(items);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось загрузить каталог");
      }
    }
  };

  const doAdd = async () => {
    if (!addToBase) return;
    if (addModelId === "" || addQuantity < 1) {
      toast.error("Выберите модель и количество"); return;
    }
    setAddBusy(true);
    try {
      await addToBooking(addToBase.id, {
        model_id: Number(addModelId),
        quantity: addQuantity,
      });
      toast.success("Добавлено к брони");
      setAddToBase(null);
      await loadBookings("replace");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка добавления");
    } finally { setAddBusy(false); }
  };

  return (
    <div className="page bookings-page">
      <main className="page__content">

        <div className="bookings-toolbar">
          <div className="segmented" role="tablist" aria-label="Активные или история">
            <button type="button" role="tab"
              aria-selected={mode === "active"}
              className={`segmented__item${mode === "active" ? " is-active" : ""}`}
              onClick={() => setMode("active")}>Активные</button>
            <button type="button" role="tab"
              aria-selected={mode === "history"}
              className={`segmented__item${mode === "history" ? " is-active" : ""}`}
              onClick={() => setMode("history")}>История</button>
          </div>
          <div className="bookings-scope" role="tablist" aria-label="Мои или все">
            <button type="button" role="tab"
              aria-selected={scope === "mine"}
              className={scope === "mine" ? "is-active" : ""}
              onClick={() => setScope("mine")}>Мои</button>
            <button type="button" role="tab"
              aria-selected={scope === "all"}
              className={scope === "all" ? "is-active" : ""}
              onClick={() => setScope("all")}>Все</button>
          </div>
          <button type="button"
            className={`bookings-filters-toggle${filtersOpen ? " is-active" : ""}${club !== "all" ? " has-value" : ""}`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}>Фильтры</button>
        </div>
        {filtersOpen && (
          <div className="bookings-filters">
            <ChipsRow
              items={CLUB_CHIPS}
              value={club}
              onChange={(code) => setClub(code as Club)}
              ariaLabel="Клуб"
            />
          </div>
        )}

        {state.kind === "auth" && (
          <AuthRequired
            error={state.error}
            onRetry={() => loadBookings("replace")}
          />
        )}
        {state.kind === "loading" && (
          <div className="empty"><span className="spinner" aria-hidden="true" /><p className="empty__text">Загрузка…</p></div>
        )}
        {state.kind === "error" && (
          <div className="empty">
            <span className="empty__icon" aria-hidden="true"><IconAlert size={22} /></span><p className="empty__text">Ошибка: {state.message}</p>
            <button className="empty__action" type="button" onClick={() => loadBookings("replace")}>Повторить</button>
          </div>
        )}
        {state.kind === "ready" && groups.length === 0 && (
          <div className="empty">
            <span className="empty__icon" aria-hidden="true"><IconInbox size={22} /></span><p className="empty__text">{mode === "history" ? (scope === "mine" ? "Ваша история пуста" : "История пуста") : (scope === "mine" ? "Нет ваших броней" : "Нет броней")}</p>
          </div>
        )}

        {state.kind === "ready" && groups.length > 0 && (
          <div className="list">
            {groups.map((g) => {
              const mine = meId != null && g.primary.user_id === meId;
              const allBookings = g.bookings;
              const s = statusInfo(g.primary.status);
              return (
                <div key={g.group_id} className={`card${mine ? " card--mine" : ""}`}>
                  <div className="card__heading">
                    <h2 className="card__title">
                      {allBookings.length === 1
                        ? displayName(g.primary)
                        : groupSummary(allBookings)}
                    </h2>
                    <div className="card__heading-badges">
                      {mine && <span className="badge badge--mine">Моя</span>}
                      <span className={`status-chip ${s.cls}`}>
                        <span className={`status-dot ${s.dot}`} />
                        {s.label}
                      </span>
                    </div>
                  </div>

                  {g.primary.user_name && (
                    <p className="card__subtitle bookings-meta">
                      <span className="bookings-meta__user">{mine ? "Вы" : g.primary.user_name}</span>
                      {g.primary.user_clubs?.includes("photographer") && (
                        <span className="badge badge--club">Фотоклуб</span>
                      )}
                      {g.primary.user_clubs?.includes("videographer") && (
                        <span className="badge badge--club">МИЭТ-ТВ</span>
                      )}
                    </p>
                  )}
                  <div className="booking-time">{fmtShort(g.primary.planned_start)} <span className="booking-time__sep">→</span> {fmtShort(g.primary.planned_end)}</div>
                  {g.primary.comment && (
                    <p className="card__subtitle" style={{ opacity: 0.85 }}>
                      Комментарий: {g.primary.comment}
                    </p>
                  )}

                  {/* Управление группой: показать позиции + добавить к брони */}
                  {(allBookings.length > 1 ||
                    (mine && (g.primary.status === "pending" || g.primary.status === "confirmed"))) && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    {allBookings.length > 1 && (
                      <button
                        type="button"
                        className="empty__action"
                        onClick={() => toggleExpanded(g.group_id)}
                        aria-expanded={expandedGroups.has(g.group_id)}
                      >
                        {expandedGroups.has(g.group_id)
                          ? "Скрыть позиции"
                          : `Показать ${allBookings.length} ${pluralPositions(allBookings.length)}`}
                      </button>
                    )}
                    {mine && (g.primary.status === "pending" || g.primary.status === "confirmed") && (
                      <button
                        type="button"
                        className="empty__action"
                        onClick={() => openAdd(g.primary)}
                      >
                        Добавить к брони
                      </button>
                    )}
                  </div>
                  )}

                  {(allBookings.length === 1 || expandedGroups.has(g.group_id)) && (
                  <div className="booking-positions">
                    {allBookings.map((b) => {
                      const bs = statusInfo(b.status);
                      const bMine = meId != null && b.user_id === meId;
                      return (
                        <div key={b.id} className="booking-positions__row">
                          {allBookings.length > 1 ? (
                            <div className="booking-positions__head">
                              <span className="booking-positions__name">
                                {displayName(b)}
                                {b.item_inventory_number ? ` · инв. №${b.item_inventory_number}` : ` · ×${b.quantity}`}
                              </span>
                              <span className={`status-chip ${bs.cls}`}>
                                <span className={`status-dot ${bs.dot}`} />
                                {bs.label}
                              </span>
                            </div>
                          ) : (
                            <p className="card__subtitle">
                              {b.item_inventory_number ? `Инв. №${b.item_inventory_number}` : `Количество: ${b.quantity}`}
                            </p>
                          )}
                          <div className="row-actions">
                            {bMine && (b.status === "pending" || b.status === "confirmed") && (
                              <button type="button" className="card__cta card__cta--secondary" onClick={() => openMove(b)}>Перенести</button>
                            )}
                            {bMine && (b.status === "pending" || b.status === "confirmed") && (
                              <button type="button" className="card__cta card__cta--danger" onClick={() => setCancelId(b.id)}>Отменить</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}

                  {/* Групповые действия */}
                  {mine && (
                    <div className="row-actions booking-group-actions">
                      {allBookings.length > 1 &&
                        allBookings.every((b) => b.status === "pending" || b.status === "confirmed") && (
                          <button type="button" className="card__cta card__cta--danger"
                            onClick={() => setCancelGroupId(g.group_id)}>
                            Отменить всю бронь
                          </button>
                        )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canLoadMore && (
          <div className="booking-loadmore">
            <button type="button" className="empty__action"
              onClick={() => loadBookings("append")}>Показать ещё</button>
          </div>
        )}

        {/* Модалка: отмена */}
        <ConfirmModal
          open={cancelId != null}
          title="Отменить бронь?"
          message={cancelId != null ? `Бронь #${cancelId} будет помечена как отменённая.` : ""}
          confirmLabel="Отменить бронь"
          cancelLabel="Не отменять"
          danger busy={cancelBusy}
          onConfirm={doCancel}
          onCancel={() => { if (!cancelBusy) setCancelId(null); }}
        />

        {/* Модалка: отмена всей группы */}
        <ConfirmModal
          open={cancelGroupId != null}
          title="Отменить всю бронь?"
          message={
            cancelGroupId != null
              ? `Все активные позиции группы #${cancelGroupId} будут отменены (ожидающие и подтверждённые).`
              : ""
          }
          confirmLabel="Отменить всё"
          cancelLabel="Не отменять"
          danger busy={cancelGroupBusy}
          onConfirm={doCancelGroup}
          onCancel={() => { if (!cancelGroupBusy) setCancelGroupId(null); }}
        />

        {/* Модалка: перенос */}
        <Modal
          open={moveTarget != null}
          title={`Перенести бронь #${moveTarget?.id ?? ""}`}
          onClose={moveBusy ? () => {} : () => setMoveTarget(null)}
          footer={
            <>
              <button type="button" className="card__cta card__cta--secondary" disabled={moveBusy}
                onClick={() => setMoveTarget(null)}>Отмена</button>
              <button type="button" className="card__cta" disabled={moveBusy}
                onClick={doMove}>{moveBusy ? "…" : "Перенести"}</button>
            </>
          }
        >
          {moveTarget && (
            <>
              <p className="modal__text">
                {displayName(moveTarget)}
              </p>
              <div style={{ marginTop: 8 }}>
                <DateTimeRangePicker
                  variant="modal"
                  value={{ start: moveStartIso, end: moveEndIso }}
                  onChange={(next: DTRange) => {
                    setMoveStartIso(next.start);
                    setMoveEndIso(next.end);
                  }}
                />
              </div>
            </>
          )}
        </Modal>

        {/* Модалка: добавить к брони */}
        <Modal
          open={addToBase != null}
          title={`Добавить к брони #${addToBase?.id ?? ""}`}
          onClose={addBusy ? () => {} : () => setAddToBase(null)}
          footer={
            <>
              <button type="button" className="card__cta card__cta--secondary" disabled={addBusy}
                onClick={() => setAddToBase(null)}>Отмена</button>
              <button type="button" className="card__cta" disabled={addBusy}
                onClick={doAdd}>{addBusy ? "…" : "Добавить"}</button>
            </>
          }
        >
          {addToBase && (
            <>
              <p className="modal__text">
                {displayName(addToBase)} · {fmt(addToBase.planned_start)} — {fmt(addToBase.planned_end)}
              </p>
              <label className="card__subtitle" style={{ display: "block", marginTop: 8 }}>
                Модель
                <select
                  className="field"
                  value={addModelId}
                  onChange={(e) => setAddModelId(e.target.value === "" ? "" : Number(e.target.value))}
                  style={{ width: "100%", marginTop: 4 }}
                >
                  <option value="">— выберите модель —</option>
                  {catalog.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.title} ({m.category})
                    </option>
                  ))}
                </select>
              </label>
              <label className="card__subtitle" style={{ display: "block", marginTop: 8 }}>
                Количество
                <input
                  type="number"
                  min={1}
                  value={addQuantity}
                  onChange={(e) => setAddQuantity(Math.max(1, Number(e.target.value) || 1))}
                  className="field"
                  style={{ width: "100%", marginTop: 4 }}
                />
              </label>
            </>
          )}
        </Modal>
      </main>
      <BottomNav active="bookings" onSelect={onNavigate} />
    </div>
  );
}
