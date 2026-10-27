// Подробности выбранного дня.
// Две вкладки: «По категориям» (иерархия категория → модель → интервалы)
// и «Брони» (список групп с бейджем «Ожидает» для pending).
// Занятость считается только по confirmed; pending присутствует в списке броней, но не в %.

import { useMemo, useState } from "react";
import type { BookingOut, EquipmentModelOut } from "../api/catalog";
import {
  bookingsOnDay,
  computeOccupancy,
  effectiveRange,
  formatTimeRange,
  groupBookings,
  levelFor,
  modelIntervalsOnDay,
  percentLabel,
} from "../utils/occupancy";

export interface CategoryRef {
  id: number;
  name: string;
}

interface Props {
  day: Date;
  models: EquipmentModelOut[];
  categories: CategoryRef[];
  bookings: BookingOut[];
}

type Tab = "categories" | "bookings";

export function OccupancyDayDetails({ day, models, categories, bookings }: Props) {
  const [tab, setTab] = useState<Tab>("categories");
  const [expandedCat, setExpandedCat] = useState<number | null>(null);
  const [expandedModel, setExpandedModel] = useState<number | null>(null);

  const occ = useMemo(() => computeOccupancy(bookings, models, day), [bookings, models, day]);
  const dayBookings = useMemo(() => bookingsOnDay(bookings, day), [bookings, day]);
  const groups = useMemo(() => groupBookings(dayBookings), [dayBookings]);

  const catNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  const modelsByCategory = useMemo(() => {
    const map = new Map<number, EquipmentModelOut[]>();
    for (const m of models) {
      const arr = map.get(m.category_id) ?? [];
      arr.push(m);
      map.set(m.category_id, arr);
    }
    return map;
  }, [models]);

  return (
    <section className="occ-details" aria-label="Подробности дня">
      <div className="occ-details__summary">
        <div className="occ-details__stat">
          <span className="occ-details__stat-label">Занятость</span>
          <span className="occ-details__stat-value">{percentLabel(occ.totalUtil)}</span>
        </div>
        <div className="occ-details__stat">
          <span className="occ-details__stat-label">Пик занятости</span>
          <span className="occ-details__stat-value">
            {occ.totalPeakBooked}/{occ.totalUnits} ед
          </span>
        </div>
        <div className="occ-details__stat">
          <span className="occ-details__stat-label">Броней</span>
          <span className="occ-details__stat-value">{groups.length}</span>
        </div>
      </div>

      <div className="occ-details__tabs segmented" role="tablist" aria-label="Режим подробностей">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "categories"}
          className={`segmented__item${tab === "categories" ? " is-active" : ""}`}
          onClick={() => setTab("categories")}
        >
          По категориям
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bookings"}
          className={`segmented__item${tab === "bookings" ? " is-active" : ""}`}
          onClick={() => setTab("bookings")}
        >
          Брони
        </button>
      </div>

      {tab === "categories" && (
        <ul className="occ-details__list">
          {[...modelsByCategory.entries()].map(([catId, catModels]) => {
            let booked = 0;
            let capacity = 0;
            for (const m of catModels) {
              const o = occ.perModel.get(m.id);
              if (o) {
                booked += o.bookedHours;
                capacity += o.capacityHours;
              }
            }
            const util = capacity > 0 ? booked / capacity : 0;
            const lv = levelFor(util);
            const isOpen = expandedCat === catId;
            return (
              <li key={catId} className={`occ-details__row occ-details__row--l${lv}`}>
                <button
                  type="button"
                  className="occ-details__row-head"
                  onClick={() => setExpandedCat(isOpen ? null : catId)}
                  aria-expanded={isOpen}
                >
                  <span className="occ-details__row-name">
                    {catNameById.get(catId) ?? `Категория ${catId}`}
                  </span>
                  <span className="occ-details__row-meta">{percentLabel(util)}</span>
                  <span className="occ-details__bar" aria-hidden="true">
                    <span
                      className={`occ-details__bar-fill occ-details__bar-fill--l${lv}`}
                      style={{ width: `${Math.min(100, Math.round(util * 100))}%` }}
                    />
                  </span>
                </button>
                {isOpen && (
                  <ul className="occ-details__models">
                    {catModels.map((m) => {
                      const o = occ.perModel.get(m.id);
                      const u = o?.util ?? 0;
                      const mlv = levelFor(u);
                      const isModelOpen = expandedModel === m.id;
                      const intervals = isModelOpen
                        ? modelIntervalsOnDay(bookings, m.id, day)
                        : [];
                      return (
                        <li key={m.id} className="occ-details__model">
                          <button
                            type="button"
                            className="occ-details__model-head"
                            onClick={() => setExpandedModel(isModelOpen ? null : m.id)}
                            aria-expanded={isModelOpen}
                          >
                            <span className="occ-details__model-name">{m.name}</span>
                            <span className="occ-details__model-meta">
                              {o ? `${o.peakBooked}/${m.total_quantity} ед` : `—/${m.total_quantity} ед`}
                              {" · "}
                              {percentLabel(u)}
                            </span>
                            <span className="occ-details__bar occ-details__bar--sm" aria-hidden="true">
                              <span
                                className={`occ-details__bar-fill occ-details__bar-fill--l${mlv}`}
                                style={{ width: `${Math.min(100, Math.round(u * 100))}%` }}
                              />
                            </span>
                          </button>
                          {isModelOpen && (
                            <ul className="occ-details__intervals">
                              {intervals.length === 0 && (
                                <li className="occ-details__empty">Свободно весь день</li>
                              )}
                              {intervals.map((iv, idx) => {
                                const inv = [
                                  ...new Set(
                                    iv.bookings
                                      .map((b) => b.item_inventory_number)
                                      .filter((x): x is string => !!x),
                                  ),
                                ];
                                return (
                                  <li key={idx} className="occ-details__interval">
                                    <span className="occ-details__interval-time">
                                      {formatTimeRange(iv.startMs, iv.endMs)}
                                    </span>
                                    <span className="occ-details__interval-qty">
                                      {iv.qty} ед
                                    </span>
                                    {m.tracking_type === "individual" && inv.length > 0 && (
                                      <span className="occ-details__interval-inv">
                                        №{inv.join(", ")}
                                      </span>
                                    )}
                                    <span className="occ-details__interval-user">
                                      {iv.bookings
                                        .map(
                                          (b) =>
                                            b.user_name ?? `Пользователь ${b.user_id}`,
                                        )
                                        .join(", ")}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {tab === "bookings" && (
        <ul className="occ-details__bookings">
          {groups.length === 0 && (
            <li className="occ-details__empty">На этот день активных броней нет</li>
          )}
          {groups.map((group) => {
            const first = group[0];
            const eff = effectiveRange(first);
            const user = first.user_name ?? `Пользователь ${first.user_id}`;
            const modelsList = group
              .map((b) => {
                const inv = b.item_inventory_number ? ` №${b.item_inventory_number}` : "";
                return `${b.model_name ?? `Модель ${b.model_id}`}${inv} × ${b.quantity}`;
              })
              .join(", ");
            const hasPending = group.some((b) => b.status === "pending");
            return (
              <li
                key={`g-${first.group_id ?? `s-${first.id}`}`}
                className="occ-details__booking"
              >
                <div className="occ-details__booking-head">
                  <span className="occ-details__booking-user">{user}</span>
                  <span className="occ-details__booking-time">
                    {eff ? formatTimeRange(eff.startMs, eff.endMs) : "—"}
                  </span>
                  {hasPending && (
                    <span className="occ-details__badge occ-details__badge--pending">
                      Ожидает
                    </span>
                  )}
                </div>
                <div className="occ-details__booking-models">{modelsList}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
