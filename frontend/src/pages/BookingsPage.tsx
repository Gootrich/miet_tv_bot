import { useEffect, useMemo, useRef, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { TopBar } from "../components/TopBar";
import { Modal } from "../components/Modal";
import { ConfirmModal } from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import { ChipsRow, type ChipItem } from "../components/ChipsRow";
import { DateTimeRangePicker, type DTRange } from "../components/DateTimeRangePicker";
import {
  checkoutBooking,
  returnBooking,
  fetchJsonWithAuth,
  fetchCatalog,
  type BookingOut,
  type CatalogItem,
} from "../api/catalog";
import {
  addToBooking,
  cancelBooking,
  fetchAllHistory,
  fetchBookings,
  moveBooking,
  returnAllInGroup,
  returnPartialInGroup,
} from "../api/bookings";

type Tab = "mine" | "all" | "history";
type Club = "all" | "photographer" | "videographer";
type EventFilter = "all" | "created" | "checkout" | "return" | "cancelled" | "moved";

const PAGE_SIZE = 20;

const CLUB_CHIPS: ChipItem[] = [
  { code: "all", label: "Все" },
  { code: "photographer", label: "Фотоклуб" },
  { code: "videographer", label: "МИЭТ-ТВ" },
];

const HISTORY_CLUB_CHIPS: ChipItem[] = [
  { code: "all", label: "Все клубы" },
  { code: "photographer", label: "Фотоклуб" },
  { code: "videographer", label: "МИЭТ-ТВ" },
];

const EVENT_CHIPS: ChipItem[] = [
  { code: "all", label: "Все события" },
  { code: "created", label: "Создана" },
  { code: "checkout", label: "Выдано" },
  { code: "return", label: "Возврат" },
  { code: "moved", label: "Перенесена" },
  { code: "cancelled", label: "Отменена" },
];

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; bookings: BookingOut[] };

type HistoryState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; events: import("../api/catalog").BookingHistoryOut[] };

const EVENT_LABEL: Record<string, string> = {
  created: "Создана",
  checkout: "Выдано",
  return: "Возврат",
  cancelled: "Отменена",
  moved: "Перенесена",
};

function statusInfo(status: string) {
  switch (status) {
    case "pending":   return { label: "Ожидает",  cls: "status-chip--warning", dot: "status-dot--warning" };
    case "confirmed": return { label: "Выдано",   cls: "status-chip--success", dot: "status-dot--success" };
    case "completed": return { label: "Возврат",  cls: "status-chip",          dot: "status-dot--success" };
    case "cancelled": return { label: "Отменено", cls: "status-chip--error",   dot: "status-dot--error"   };
    default:          return { label: status,     cls: "status-chip",          dot: ""                    };
  }
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

function pluralPositions(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "позиция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "позиции";
  return "позиций";
}

export function BookingsPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("mine");
  const [meId, setMeId] = useState<number | null>(null);

  const [club, setClub] = useState<Club>("all");
  const [showCancelled, setShowCancelled] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const bookingsFetchingRef = useRef(false);

  const [history, setHistory] = useState<HistoryState>({ kind: "idle" });
  const [historyScope, setHistoryScope] = useState<"all" | "mine">("all");
  const [historyClub, setHistoryClub] = useState<Club>("all");
  const [historyEvent, setHistoryEvent] = useState<EventFilter>("all");
  const [historyBusy, setHistoryBusy] = useState(false);

  // Отмена (по одной брони)
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  // Отмена всей группы
  const [cancelGroupId, setCancelGroupId] = useState<number | null>(null);
  const [cancelGroupBusy, setCancelGroupBusy] = useState(false);

  // Групповая выдача
  const [checkoutGroupId, setCheckoutGroupId] = useState<number | null>(null);
  const [checkoutGroupBusy, setCheckoutGroupBusy] = useState(false);

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

  // Пакетные действия (группа)
  const [returnAllGroupId, setReturnAllGroupId] = useState<number | null>(null);
  const [returnAllBusy, setReturnAllBusy] = useState(false);

  const [partialGroup, setPartialGroup] = useState<BookingGroup | null>(null);
  const [partialSelected, setPartialSelected] = useState<Set<number>>(new Set());
  const [partialBusy, setPartialBusy] = useState(false);

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
        toast.error(
          e instanceof Error
            ? `Не удалось определить пользователя: ${e.message}`
            : "Не удалось определить пользователя",
        );
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBookings = async (mode: "replace" | "append" = "replace") => {
    if (bookingsFetchingRef.current) return;
    bookingsFetchingRef.current = true;
    if (mode === "replace") setState({ kind: "loading" });
    try {
      const beforeId =
        mode === "append" && state.kind === "ready" && state.bookings.length > 0
          ? state.bookings[state.bookings.length - 1].id
          : undefined;
      const data = await fetchBookings({
        scope: tab === "mine" ? "mine" : "all",
        club: club === "all" ? undefined : club,
        includeCancelled: showCancelled,
        beforeId,
        limit: PAGE_SIZE,
      });
      if (mode === "append" && state.kind === "ready") {
        setState({ kind: "ready", bookings: [...state.bookings, ...data] });
      } else {
        setState({ kind: "ready", bookings: data });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка загрузки броней";
      setState({ kind: "error", message: msg });
      toast.error(msg);
    } finally {
      bookingsFetchingRef.current = false;
    }
  };

  const loadHistory = async (mode: "replace" | "append" = "replace") => {
    if (historyBusy) return;
    setHistoryBusy(true);
    if (mode === "replace") setHistory({ kind: "loading" });
    try {
      const beforeId =
        mode === "append" && history.kind === "ready" && history.events.length > 0
          ? history.events[history.events.length - 1].id
          : undefined;
      const data = await fetchAllHistory({
        scope: historyScope,
        club: historyClub === "all" ? undefined : historyClub,
        eventType: historyEvent === "all" ? undefined : historyEvent,
        beforeId,
        limit: PAGE_SIZE,
      });
      if (mode === "append" && history.kind === "ready") {
        setHistory({ kind: "ready", events: [...history.events, ...data] });
      } else {
        setHistory({ kind: "ready", events: data });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка загрузки истории";
      setHistory({ kind: "error", message: msg });
      toast.error(msg);
    } finally {
      setHistoryBusy(false);
    }
  };

  useEffect(() => {
    if (tab !== "history") void loadBookings("replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, club, showCancelled]);

  useEffect(() => {
    if (tab === "history") void loadHistory("replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, historyScope, historyClub, historyEvent]);

  // Локальная фильтрация «Мои» (страховка)
  const visibleBookings = useMemo(() => {
    if (state.kind !== "ready") return [];
    if (tab === "mine") {
      return state.bookings.filter(
        (b) =>
          (meId == null || b.user_id === meId) &&
          (b.status === "pending" ||
            b.status === "confirmed" ||
            b.status === "completed" ||
            (showCancelled && b.status === "cancelled")),
      );
    }
    return state.bookings;
  }, [state, tab, meId, showCancelled]);

  // Группировка
  const groups = useMemo(() => groupBookings(visibleBookings), [visibleBookings]);

  const canLoadMore =
    state.kind === "ready" && state.bookings.length === PAGE_SIZE;

  // ---- Действия по одной брони ----
  const handleCheckout = async (b: BookingOut) => {
    if (meId == null) { toast.error("Не удалось определить пользователя"); return; }
    if (b.user_id !== meId) { toast.error("Выдать может только владелец брони"); return; }
    try {
      await checkoutBooking(b.id);
      toast.success("Оборудование выдано");
      await loadBookings("replace");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка выдачи");
    }
  };

  const handleReturn = async (b: BookingOut) => {
    if (meId == null) { toast.error("Не удалось определить пользователя"); return; }
    if (b.user_id !== meId) { toast.error("Вернуть может только владелец брони"); return; }
    try {
      await returnBooking(b.id);
      toast.success("Возврат оформлен");
      await loadBookings("replace");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка возврата");
    }
  };

  const doCancel = async () => {
    if (cancelId == null) return;
    setCancelBusy(true);
    try {
      await cancelBooking(cancelId);
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
    const toCancel = group.bookings.filter(
      (b) => b.status === "pending" && b.actual_checkout == null,
    );
    if (toCancel.length === 0) { setCancelGroupId(null); return; }
    setCancelGroupBusy(true);
    let done = 0;
    let firstError: string | null = null;
    try {
      for (const b of toCancel) {
        try {
          await cancelBooking(b.id);
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

  const doCheckoutGroup = async () => {
    if (checkoutGroupId == null) return;
    const group = groups.find((g) => g.group_id === checkoutGroupId);
    if (!group) { setCheckoutGroupId(null); return; }
    const toCheckout = group.bookings.filter(
      (b) => b.actual_checkout == null && (b.status === "pending" || b.status === "confirmed"),
    );
    if (toCheckout.length === 0) { setCheckoutGroupId(null); return; }
    setCheckoutGroupBusy(true);
    let done = 0;
    let firstError: string | null = null;
    try {
      for (const b of toCheckout) {
        try {
          await checkoutBooking(b.id);
          done++;
        } catch (e) {
          firstError = `#${b.id}: ${e instanceof Error ? e.message : "ошибка"}`;
          break;
        }
      }
      if (firstError) {
        toast.error(`Выдано ${done} из ${toCheckout.length}. Ошибка: ${firstError}`);
      } else {
        toast.success(`Выдано позиций: ${done}`);
      }
    } finally {
      setCheckoutGroupBusy(false);
      setCheckoutGroupId(null);
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
      toast.success(`Бронь #${moveTarget.id} перенесена`);
      setMoveTarget(null);
      await loadBookings("replace");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка переноса");
    } finally { setMoveBusy(false); }
  };

  // ---- Пакетные действия ----
  const doReturnAll = async () => {
    if (returnAllGroupId == null) return;
    setReturnAllBusy(true);
    try {
      const res = await returnAllInGroup(returnAllGroupId);
      toast.success(`Возвращено броней: ${res.length}`);
      setReturnAllGroupId(null);
      await loadBookings("replace");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка массового возврата");
    } finally { setReturnAllBusy(false); }
  };

  const openPartial = (g: BookingGroup) => {
    setPartialGroup(g);
    // предвыбираем всё, что выдано и не возвращено
    const pre = new Set(
      g.bookings
        .filter((b) => b.actual_checkout != null && b.actual_return == null)
        .map((b) => b.id),
    );
    setPartialSelected(pre);
  };

  const togglePartial = (id: number) => {
    setPartialSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const doPartial = async () => {
    if (!partialGroup) return;
    if (partialSelected.size === 0) {
      toast.error("Выберите хотя бы одну бронь"); return;
    }
    setPartialBusy(true);
    try {
      const res = await returnPartialInGroup(
        partialGroup.group_id,
        Array.from(partialSelected),
      );
      toast.success(`Возвращено броней: ${res.length}`);
      setPartialGroup(null);
      await loadBookings("replace");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка частичного возврата");
    } finally { setPartialBusy(false); }
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
      <TopBar />
      <main className="page__content">
        <h1 className="section-title">Бронирования</h1>

        <div className="segmented" role="tablist" aria-label="Разделы броней">
          <button type="button" role="tab"
            aria-selected={tab === "mine"}
            className={`segmented__item${tab === "mine" ? " is-active" : ""}`}
            onClick={() => setTab("mine")}>Мои</button>
          <button type="button" role="tab"
            aria-selected={tab === "all"}
            className={`segmented__item${tab === "all" ? " is-active" : ""}`}
            onClick={() => setTab("all")}>Все</button>
          <button type="button" role="tab"
            aria-selected={tab === "history"}
            className={`segmented__item${tab === "history" ? " is-active" : ""}`}
            onClick={() => setTab("history")}>История</button>
        </div>

        {tab !== "history" && (
          <ChipsRow
            items={CLUB_CHIPS}
            value={club}
            onChange={(code) => setClub(code as Club)}
            ariaLabel="Клуб"
          />
        )}

        {tab !== "history" && (
          <label className="card__subtitle" style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)} />
            Показывать отменённые
          </label>
        )}

        {tab !== "history" && state.kind === "loading" && (
          <p className="empty__text">Загрузка…</p>
        )}
        {tab !== "history" && state.kind === "error" && (
          <div className="empty">
            <p className="empty__text">Ошибка: {state.message}</p>
            <button className="empty__action" type="button" onClick={() => loadBookings("replace")}>Повторить</button>
          </div>
        )}
        {tab !== "history" && state.kind === "ready" && groups.length === 0 && (
          <div className="empty">
            <p className="empty__text">{tab === "mine" ? "Нет ваших броней" : "Нет броней"}</p>
          </div>
        )}

        {tab !== "history" && state.kind === "ready" && groups.length > 0 && (
          <div className="list">
            {groups.map((g) => {
              const mine = meId != null && g.primary.user_id === meId;
              const allBookings = g.bookings;
              const s = statusInfo(g.primary.status);
              const anyCheckedOut = allBookings.some((b) => b.actual_checkout != null && b.actual_return == null);
              const active = allBookings.some((b) => b.status === "pending" || b.status === "confirmed");
              void active; // активность используется неявно через individual-кнопки

              return (
                <div key={g.group_id} className="card">
                  <div className="card__heading">
                    <h2 className="card__title">
                      {allBookings.length === 1
                        ? (g.primary.model_name ?? `Модель #${g.primary.model_id ?? "—"}`)
                        : `Групповая бронь #${g.group_id} · ${allBookings.length} ${pluralPositions(allBookings.length)}`}
                    </h2>
                    <span className={`status-chip ${s.cls}`}>
                      <span className={`status-dot ${s.dot}`} />
                      {s.label}
                    </span>
                  </div>

                  {g.primary.user_name && (
                    <p className="card__subtitle">
                      {mine ? "Вы" : g.primary.user_name}
                      {mine && ` (id ${g.primary.user_id})`}
                    </p>
                  )}
                  <p className="card__subtitle">С: {fmt(g.primary.planned_start)}</p>
                  <p className="card__subtitle">По: {fmt(g.primary.planned_end)}</p>
                  {g.primary.comment && (
                    <p className="card__subtitle" style={{ opacity: 0.85 }}>
                      Комментарий: {g.primary.comment}
                    </p>
                  )}

                  {/* Управление группой: показать позиции + добавить к брони */}
                  {(allBookings.length > 1 ||
                    (mine && (g.primary.status === "pending" || g.primary.status === "confirmed") && g.primary.actual_checkout == null)) && (
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
                    {mine && (g.primary.status === "pending" || g.primary.status === "confirmed") && g.primary.actual_checkout == null && (
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
                  <div style={{ marginTop: 8, borderTop: "1px solid var(--md-sys-color-outline-variant)", paddingTop: 8 }}>
                    {allBookings.map((b) => {
                      const bs = statusInfo(b.status);
                      const bMine = meId != null && b.user_id === meId;
                      const canCheckout = bMine && b.actual_checkout == null && (b.status === "pending" || b.status === "confirmed");
                      const canReturn = bMine && b.actual_checkout != null && b.actual_return == null;
                      return (
                        <div key={b.id} style={{ marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                            <span className="card__subtitle">
                              {b.model_name ?? `Модель #${b.model_id}`}
                              {b.item_inventory_number ? ` · инв. №${b.item_inventory_number}` : ` · ×${b.quantity}`}
                            </span>
                            <span className={`status-chip ${bs.cls}`}>
                              <span className={`status-dot ${bs.dot}`} />
                              {bs.label}
                            </span>
                          </div>
                          {b.actual_checkout && (
                            <p className="card__subtitle">
                              Выдано: {fmt(b.actual_checkout)}
                              {b.actual_return ? ` · возврат: ${fmt(b.actual_return)}` : ""}
                            </p>
                          )}
                          <div className="row-actions">
                            {canCheckout && (
                              <button type="button" className="card__cta" onClick={() => handleCheckout(b)}>Получить</button>
                            )}
                            {canReturn && (
                              <button type="button" className="card__cta" onClick={() => handleReturn(b)}>Вернуть</button>
                            )}
                            {bMine && b.status === "pending" && b.actual_checkout == null && (
                              <button type="button" className="card__cta card__cta--secondary" onClick={() => openMove(b)}>Перенести</button>
                            )}
                            {bMine && b.status === "pending" && b.actual_checkout == null && (
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
                    <div className="row-actions" style={{ marginTop: 8, borderTop: "1px solid var(--md-sys-color-outline-variant)", paddingTop: 8 }}>
                      {allBookings.length > 1 &&
                        allBookings.every((b) => b.actual_checkout == null && (b.status === "pending" || b.status === "confirmed")) && (
                          <button type="button" className="card__cta"
                            disabled={checkoutGroupBusy}
                            onClick={() => setCheckoutGroupId(g.group_id)}>
                            Получить всё
                          </button>
                        )}
                      {allBookings.length > 1 &&
                        allBookings.every((b) => b.status === "pending" && b.actual_checkout == null) && (
                          <button type="button" className="card__cta card__cta--danger"
                            onClick={() => setCancelGroupId(g.group_id)}>
                            Отменить всю бронь
                          </button>
                        )}
                      {anyCheckedOut && (
                        <>
                          <button type="button" className="card__cta"
                            onClick={() => setReturnAllGroupId(g.group_id)}>
                            Вернуть всё
                          </button>
                          <button type="button" className="card__cta card__cta--secondary"
                            onClick={() => openPartial(g)}>
                            Вернуть частично
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab !== "history" && canLoadMore && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <button type="button" className="empty__action"
              onClick={() => loadBookings("append")}>Показать ещё</button>
          </div>
        )}

        {/* История (без изменений) */}
        {tab === "history" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div className="segmented" role="tablist" aria-label="Scope истории">
                <button type="button" role="tab" aria-selected={historyScope === "all"}
                  className={`segmented__item${historyScope === "all" ? " is-active" : ""}`}
                  onClick={() => setHistoryScope("all")}>Все</button>
                <button type="button" role="tab" aria-selected={historyScope === "mine"}
                  className={`segmented__item${historyScope === "mine" ? " is-active" : ""}`}
                  onClick={() => setHistoryScope("mine")}>Мои</button>
              </div>
              <button type="button" className="empty__action" disabled={historyBusy}
                onClick={() => loadHistory("replace")}>
                {historyBusy ? "…" : "Обновить"}
              </button>
            </div>
            <ChipsRow items={HISTORY_CLUB_CHIPS} value={historyClub}
              onChange={(code) => setHistoryClub(code as Club)} ariaLabel="Клуб истории" />
            <ChipsRow items={EVENT_CHIPS} value={historyEvent}
              onChange={(code) => setHistoryEvent(code as EventFilter)} ariaLabel="Тип события" />

            {history.kind === "loading" && <p className="empty__text">Загрузка истории…</p>}
            {history.kind === "error" && (
              <div className="empty">
                <p className="empty__text">Ошибка: {history.message}</p>
                <button className="empty__action" type="button" onClick={() => loadHistory("replace")}>Повторить</button>
              </div>
            )}
            {history.kind === "ready" && history.events.length === 0 && (
              <div className="empty"><p className="empty__text">Событий пока нет</p></div>
            )}
            {history.kind === "ready" && history.events.length > 0 && (
              <div className="list">
                {history.events.map((e) => (
                  <div key={e.id} className="card">
                    <div className="card__heading">
                      <h2 className="card__title">{EVENT_LABEL[e.event_type] ?? e.event_type}</h2>
                      <span className="card__subtitle">#{e.id}</span>
                    </div>
                    <p className="card__subtitle">Бронь #{e.booking_id}</p>
                    <p className="card__subtitle">
                      {fmt(e.created_at)}
                      {e.actor_user_id != null ? ` · актор: ${e.actor_user_id}` : ""}
                    </p>
                    {e.details && (
                      <p className="card__subtitle" style={{ opacity: 0.8 }}>{e.details}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {history.kind === "ready" && history.events.length === PAGE_SIZE && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <button type="button" className="empty__action" disabled={historyBusy}
                  onClick={() => loadHistory("append")}>{historyBusy ? "…" : "Показать ещё"}</button>
              </div>
            )}
          </>
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
              ? `Все позиции группы #${cancelGroupId} будут отменены.`
              : ""
          }
          confirmLabel="Отменить всё"
          cancelLabel="Не отменять"
          danger busy={cancelGroupBusy}
          onConfirm={doCancelGroup}
          onCancel={() => { if (!cancelGroupBusy) setCancelGroupId(null); }}
        />

        {/* Модалка: групповая выдача */}
        <ConfirmModal
          open={checkoutGroupId != null}
          title="Выдать всю бронь?"
          message={
            checkoutGroupId != null
              ? `Все позиции группы #${checkoutGroupId} будут помечены как выданные.`
              : ""
          }
          confirmLabel="Получить всё"
          cancelLabel="Отмена"
          busy={checkoutGroupBusy}
          onConfirm={doCheckoutGroup}
          onCancel={() => { if (!checkoutGroupBusy) setCheckoutGroupId(null); }}
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
                {moveTarget.model_name ?? `Модель #${moveTarget.model_id}`}
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

        {/* Модалка: вернуть всё */}
        <ConfirmModal
          open={returnAllGroupId != null}
          title="Вернуть всё?"
          message={
            returnAllGroupId != null
              ? `Все выданные брони группы #${returnAllGroupId} будут возвращены.`
              : ""
          }
          confirmLabel="Вернуть всё"
          cancelLabel="Не сейчас"
          busy={returnAllBusy}
          onConfirm={doReturnAll}
          onCancel={() => { if (!returnAllBusy) setReturnAllGroupId(null); }}
        />

        {/* Модалка: вернуть частично */}
        <Modal
          open={partialGroup != null}
          title={`Вернуть частично (группа #${partialGroup?.group_id ?? ""})`}
          onClose={partialBusy ? () => {} : () => setPartialGroup(null)}
          footer={
            <>
              <button type="button" className="card__cta card__cta--secondary" disabled={partialBusy}
                onClick={() => setPartialGroup(null)}>Отмена</button>
              <button type="button" className="card__cta" disabled={partialBusy}
                onClick={doPartial}>{partialBusy ? "…" : `Вернуть (${partialSelected.size})`}</button>
            </>
          }
        >
          {partialGroup && (
            <div>
              {partialGroup.bookings
                .filter((b) => b.actual_checkout != null && b.actual_return == null)
                .map((b) => (
                  <label key={b.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={partialSelected.has(b.id)}
                      onChange={() => togglePartial(b.id)}
                    />
                    <span className="card__subtitle">
                      {b.model_name ?? `Модель #${b.model_id}`}
                      {b.item_inventory_number ? ` · инв. №${b.item_inventory_number}` : ` · ×${b.quantity}`}
                    </span>
                  </label>
                ))}
              {partialGroup.bookings.filter((b) => b.actual_checkout != null && b.actual_return == null).length === 0 && (
                <p className="card__subtitle">Нет выданных и невозвращённых броней в группе.</p>
              )}
            </div>
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
                {addToBase.model_name ?? `Модель #${addToBase.model_id}`} · {fmt(addToBase.planned_start)} — {fmt(addToBase.planned_end)}
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
