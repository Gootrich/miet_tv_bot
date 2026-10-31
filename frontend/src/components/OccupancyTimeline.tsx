import { useMemo, useState } from "react";
import type { BookingOut } from "../api/catalog";
import { userHue } from "../utils/userColor";
import { Modal } from "./Modal";
import { formatDayMonth, weekdayShort } from "../utils/date";
import { cartSetRange } from "../state/cart";
import { HOURS, HOUR_START, HOUR_END } from "../utils/occupancyTime";

const HOUR_MS = 60 * 60 * 1000;
const HOUR_COUNT = HOUR_END - HOUR_START; // 13
const PRIORITY_CODES = ["studio", "cameras", "lenses"] as const;
const MAX_NAMES_IN_BAR = 3;

export interface OccupancyTimelineProps {
  day1: Date;
  day2: Date;
  bookings: BookingOut[];
  categoryCodeByName: Map<string, string>;
  shortNameByModelId?: Map<number, string>;
  viewMode?: "ribbon" | "chrono";
  onSelectEmpty: (day: Date, hour: number) => void;
  onNavigate: (tab: string) => void;
}

interface BookingGroup {
  groupId: number;
  userId: number;
  userName: string | null;
  startMs: number;
  endMs: number;
  status: string;
  items: BookingOut[];
}

interface DayRow {
  group: BookingGroup;
  startMs: number;
  endMs: number;
  hue: number;
  text: string;
  tooltip: string;
  continuesLeft: boolean;
  continuesRight: boolean;
}

function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatRange(startMs: number, endMs: number): string {
  const s = new Date(startMs);
  const e = new Date(endMs);
  const st = formatTime(startMs);
  const et = formatTime(endMs);
  if (s.toDateString() === e.toDateString()) return `${st}\u2013${et}`;
  return `${formatDayMonth(s)} ${st} → ${formatDayMonth(e)} ${et}`;
}

function groupByGroupId(bookings: BookingOut[]): BookingGroup[] {
  const map = new Map<number, BookingGroup>();
  for (const b of bookings) {
    const gid = b.group_id ?? b.id;
    const s = new Date(b.planned_start).getTime();
    const e = new Date(b.planned_end).getTime();
    const existing = map.get(gid);
    if (existing) {
      existing.items.push(b);
      if (s < existing.startMs) existing.startMs = s;
      if (e > existing.endMs) existing.endMs = e;
    } else {
      map.set(gid, {
        groupId: gid,
        userId: b.user_id,
        userName: b.user_name,
        startMs: s,
        endMs: e,
        status: b.status,
        items: [b],
      });
    }
  }
  return [...map.values()];
}

function shortModelName(b: BookingOut, map?: Map<number, string>): string {
  if (b.model_id != null && map) {
    const sn = map.get(b.model_id);
    if (sn && sn.trim()) return sn.trim();
  }
  const name = (b.model_name ?? "—").trim();
  const words = name.split(/\s+/);
  return words.slice(0, 2).join(" ");
}

function barText(
  group: BookingGroup,
  categoryCodeByName: Map<string, string>,
  shortNameMap?: Map<number, string>,
): string {
  const priorityRank = (b: BookingOut): number => {
    if (!b.category_name) return PRIORITY_CODES.length;
    const code = categoryCodeByName.get(b.category_name);
    if (!code) return PRIORITY_CODES.length;
    const idx = (PRIORITY_CODES as readonly string[]).indexOf(code);
    return idx >= 0 ? idx : PRIORITY_CODES.length;
  };
  const ordered = [...group.items].sort((a, b) => priorityRank(a) - priorityRank(b));
  const labels = ordered.map((it) => {
    const sn = shortModelName(it, shortNameMap);
    return it.quantity > 1 ? `${sn} ×${it.quantity}` : sn;
  });
  if (labels.length <= MAX_NAMES_IN_BAR) return labels.join(" · ");
  return `${labels.slice(0, MAX_NAMES_IN_BAR).join(" · ")} +${labels.length - MAX_NAMES_IN_BAR}`;
}

function buildDayRows(
  day: Date,
  bookings: BookingOut[],
  categoryCodeByName: Map<string, string>,
  shortNameMap?: Map<number, string>,
): DayRow[] {
  const dayStart = startOfDayMs(day);
  const viewStart = dayStart + HOUR_START * HOUR_MS;
  const viewEnd = dayStart + HOUR_END * HOUR_MS;
  const filtered = bookings.filter((b) => {
    const s = new Date(b.planned_start).getTime();
    const e = new Date(b.planned_end).getTime();
    return s < viewEnd && e > viewStart;
  });
  const groups = groupByGroupId(filtered);
  const rows: DayRow[] = [];
  for (const g of groups) {
    const cs = Math.max(g.startMs, viewStart);
    const ce = Math.min(g.endMs, viewEnd);
    if (ce <= cs) continue;
    const text = barText(g, categoryCodeByName, shortNameMap);
    const tooltip = `${g.userName ?? "—"} · ${formatRange(g.startMs, g.endMs)} · ${text}`;
    rows.push({
      group: g,
      startMs: cs,
      endMs: ce,
      hue: userHue(g.userId),
      text,
      tooltip,
      continuesLeft: g.startMs < viewStart,
      continuesRight: g.endMs > viewEnd,
    });
  }
  rows.sort(
    (a, b) =>
      a.startMs - b.startMs ||
      (a.group.userName ?? "").localeCompare(b.group.userName ?? ""),
  );
  return rows;
}


/* ============================================================
   Ribbon: единый 2-дневный временной холст
   Каждый день — половина трека (13ч). Ночь между днями — «шов».
   ============================================================ */

interface RibbonSegment {
  startPct: number;
  widthPct: number;
  continuesLeft: boolean;
  continuesRight: boolean;
}

interface RibbonItem {
  group: BookingGroup;
  hue: number;
  text: string;
  tooltip: string;
  effStart: number;
  effEnd: number;
  segments: RibbonSegment[];
}

interface RibbonUserRow {
  userId: number;
  userName: string;
  hue: number;
  subrows: RibbonItem[][];
}

function buildRibbonUserRows(
  day1: Date,
  day2: Date,
  bookings: BookingOut[],
  categoryCodeByName: Map<string, string>,
  shortNameMap?: Map<number, string>,
): RibbonUserRow[] {
  const d1Start = startOfDayMs(day1);
  const d2Start = startOfDayMs(day2);
  const hourCount = HOUR_END - HOUR_START;
  const d1ViewStart = d1Start + HOUR_START * HOUR_MS;
  const d1ViewEnd = d1Start + HOUR_END * HOUR_MS;
  const d2ViewStart = d2Start + HOUR_START * HOUR_MS;
  const d2ViewEnd = d2Start + HOUR_END * HOUR_MS;
  const totalViewStart = d1ViewStart;
  const totalViewEnd = d2ViewEnd;

  const groups = groupByGroupId(bookings).filter(
    (g) => g.startMs < totalViewEnd && g.endMs > totalViewStart,
  );

  const items: RibbonItem[] = [];
  for (const g of groups) {
    const segs: RibbonSegment[] = [];

    const c1s = Math.max(g.startMs, d1ViewStart);
    const c1e = Math.min(g.endMs, d1ViewEnd);
    if (c1e > c1s) {
      const sPct = ((c1s - d1ViewStart) / (hourCount * HOUR_MS)) * 50;
      const ePct = ((c1e - d1ViewStart) / (hourCount * HOUR_MS)) * 50;
      segs.push({
        startPct: sPct,
        widthPct: ePct - sPct,
        continuesLeft: g.startMs < c1s,
        continuesRight: g.endMs > c1e,
      });
    }

    const c2s = Math.max(g.startMs, d2ViewStart);
    const c2e = Math.min(g.endMs, d2ViewEnd);
    if (c2e > c2s) {
      const sPct = ((c2s - d2ViewStart) / (hourCount * HOUR_MS)) * 50 + 50;
      const ePct = ((c2e - d2ViewStart) / (hourCount * HOUR_MS)) * 50 + 50;
      segs.push({
        startPct: sPct,
        widthPct: ePct - sPct,
        continuesLeft: g.startMs < c2s,
        continuesRight: g.endMs > c2e,
      });
    }

    if (segs.length === 0) continue;

    const efStart = segs[0].startPct;
    const efEnd = segs[segs.length - 1].startPct + segs[segs.length - 1].widthPct;
    const text = barText(g, categoryCodeByName, shortNameMap);
    const tooltip = `${g.userName ?? "—"} · ${formatRange(g.startMs, g.endMs)} · ${text}`;

    items.push({
      group: g,
      hue: userHue(g.userId),
      text,
      tooltip,
      effStart: efStart,
      effEnd: efEnd,
      segments: segs,
    });
  }

  const byUser = new Map<number, RibbonItem[]>();
  for (const it of items) {
    const key = it.group.userId;
    const arr = byUser.get(key) ?? [];
    arr.push(it);
    byUser.set(key, arr);
  }

  const rows: RibbonUserRow[] = [];
  for (const [userId, list] of byUser) {
    const sorted = [...list].sort((a, b) => a.effStart - b.effStart);
    const subrows: RibbonItem[][] = [];
    for (const it of sorted) {
      let placed = false;
      for (const row of subrows) {
        const last = row[row.length - 1];
        if (last.effEnd <= it.effStart) {
          row.push(it);
          placed = true;
          break;
        }
      }
      if (!placed) subrows.push([it]);
    }
    rows.push({
      userId,
      userName: list[0].group.userName ?? "—",
      hue: userHue(userId),
      subrows,
    });
  }

  rows.sort((a, b) => a.subrows[0][0].effStart - b.subrows[0][0].effStart);
  return rows;
}

export function OccupancyTimeline({
  day1,
  day2,
  bookings,
  categoryCodeByName,
  shortNameByModelId,
  viewMode = "ribbon",
  onSelectEmpty,
  onNavigate,
}: OccupancyTimelineProps) {
  const [expanded, setExpanded] = useState<BookingGroup | null>(null);
  const days = useMemo(() => [day1, day2], [day1, day2]);

  const dayRows = useMemo(
    () =>
      days.map((d) =>
        buildDayRows(d, bookings, categoryCodeByName, shortNameByModelId),
      ),
    [days, bookings, categoryCodeByName, shortNameByModelId],
  );

  const chrono = useMemo(() => {
    const items: Array<{ day: Date; row: DayRow }> = [];
    days.forEach((d, i) => {
      for (const r of dayRows[i]) items.push({ day: d, row: r });
    });
    items.sort((a, b) => a.row.startMs - b.row.startMs);
    return items;
  }, [days, dayRows]);

  const userRows = useMemo(
    () => buildRibbonUserRows(day1, day2, bookings, categoryCodeByName, shortNameByModelId),
    [day1, day2, bookings, categoryCodeByName, shortNameByModelId],
  );

  const hourLabels = useMemo(() => HOURS.filter((h) => h % 2 === 1), []);

  return (
    <>
      {/* ============ Ribbon: единый 2-дневный холст ============ */}
      {viewMode === "ribbon" && (
      <div className="occ-ribbon">
        <div className="occ-ribbon__header">
          <div className="occ-ribbon__corner" aria-hidden />
          <div className="occ-ribbon__axis">
            {days.map((day) => (
              <div className="occ-ribbon__day-block" key={day.toISOString()}>
                <div className="occ-ribbon__day-title">
                  <span className="occ-ribbon__day-wd">{weekdayShort(day)}</span>
                  <span className="occ-ribbon__day-date">{formatDayMonth(day)}</span>
                </div>
                <div className="occ-ribbon__hours">
                  {hourLabels.map((h) => (
                    <span
                      key={`${day.toISOString()}-${h}`}
                      className="occ-ribbon__hour-label"
                      style={{ left: `${((h - HOUR_START) / HOUR_COUNT) * 100}%` }}
                    >
                      {String(h).padStart(2, "0")}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="occ-ribbon__body">
          {userRows.length === 0 && (
            <div className="occ-ribbon__empty">На выбранные дни броней нет</div>
          )}
          {userRows.map((ur) => (
            <div className="occ-ribbon__user-block" key={ur.userId}>
              <div className="occ-ribbon__user">
                <span
                  className="occ-ribbon__user-dot"
                  style={{ background: `hsl(${ur.hue}, 65%, 55%)` }}
                  aria-hidden
                />
                <span className="occ-ribbon__user-name">{ur.userName}</span>
              </div>
              <div className="occ-ribbon__tracks">
                {ur.subrows.map((subrow, si) => (
                  <div className="occ-ribbon__track" key={si}>
                    {days.map((day, di) =>
                      HOURS.map((h, i) => {
                        const cellIdx = di * HOURS.length + i;
                        const totalCells = HOURS.length * 2;
                        const leftPct = (cellIdx / totalCells) * 100;
                        const widthPct = 100 / totalCells;
                        return (
                          <button
                            type="button"
                            key={`${di}-${h}`}
                            className="occ-ribbon__hour-cell"
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            onClick={() => onSelectEmpty(day, h)}
                            aria-label={`Создать бронь ${formatDayMonth(day)} ${String(h).padStart(2, "0")}:00`}
                          />
                        );
                      }),
                    )}
                    <div className="occ-ribbon__midnight" aria-hidden />
                    {subrow.map((it) =>
                      it.segments.map((seg, segIdx) => (
                        <button
                          type="button"
                          key={`${it.group.groupId}-${segIdx}`}
                          className="occ-ribbon__bar"
                          style={{
                            left: `${Math.max(0, seg.startPct)}%`,
                            width: `${Math.max(0.4, seg.widthPct)}%`,
                            ["--user-h" as string]: String(it.hue),
                          } as React.CSSProperties}
                          title={it.tooltip}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpanded(it.group);
                          }}
                        >
                          {seg.continuesLeft && (
                            <span className="occ-ribbon__bar-arrow" aria-hidden>‹</span>
                          )}
                          <span className="occ-ribbon__bar-text">{it.text}</span>
                          {seg.continuesRight && (
                            <span className="occ-ribbon__bar-arrow" aria-hidden>›</span>
                          )}
                        </button>
                      )),
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* ============ Chrono list ============ */}
      {viewMode === "chrono" && (
      <div className="occ-chrono">
        {chrono.length === 0 && (
          <div className="occ-chrono__empty">На выбранные дни броней нет</div>
        )}
        {chrono.map(({ day, row }) => (
          <button
            type="button"
            key={`${day.toISOString()}-${row.group.groupId}`}
            className="occ-chrono__item"
            onClick={() => setExpanded(row.group)}
          >
            <span
              className="occ-chrono__color"
              style={{ background: `hsl(${row.hue}, 65%, 55%)` }}
              aria-hidden
            />
            <span className="occ-chrono__main">
              <span className="occ-chrono__time">
                {formatDayMonth(day)} · {formatRange(row.group.startMs, row.group.endMs)}
              </span>
              <span className="occ-chrono__user">{row.group.userName ?? "—"}</span>
              <span className="occ-chrono__text">{row.text}</span>
            </span>
          </button>
        ))}
      </div>
      )}

      {/* ============ Modal (unchanged semantics) ============ */}
      {expanded && (
        <Modal
          open={!!expanded}
          title={`Бронь #${expanded.groupId}`}
          onClose={() => setExpanded(null)}
          width={520}
        >
          <div className="occ-tl-details">
            <div className="occ-tl-details__row">
              <span className="occ-tl-details__label">Период</span>
              <span>
                {new Date(expanded.startMs).toLocaleString("ru-RU")} —{" "}
                {new Date(expanded.endMs).toLocaleString("ru-RU")}
              </span>
            </div>
            <div className="occ-tl-details__row">
              <span className="occ-tl-details__label">Владелец</span>
              <span>{expanded.userName ?? "—"}</span>
            </div>
            <div className="occ-tl-details__row">
              <span className="occ-tl-details__label">Статус</span>
              <span>
                {expanded.status === "pending" ? "Ожидает" : "Подтверждено"}
              </span>
            </div>
            <ul className="occ-tl-details__items">
              {expanded.items.map((it) => (
                <li key={it.id}>
                  {it.model_name ?? "—"}
                  {it.category_name && (
                    <span className="occ-tl-details__cat"> · {it.category_name}</span>
                  )}
                  {it.quantity > 1 && (
                    <span className="occ-tl-details__qty"> ×{it.quantity}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="occ-tl-details__actions">
              <button
                type="button"
                className="card__cta"
                onClick={() => {
                  cartSetRange({
                    start: new Date(expanded.startMs).toISOString(),
                    end: new Date(expanded.endMs).toISOString(),
                  });
                  setExpanded(null);
                  onNavigate("catalog");
                }}
              >
                Выбрать это время для новой брони
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
