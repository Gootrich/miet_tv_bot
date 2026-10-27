// Единая загрузка броней для страницы занятости с курсорной пагинацией и флагом capHit.
// maxPages снаружи — для месячного вида больше, для дневного меньше.

import { useEffect, useState } from "react";
import { fetchBookings } from "../api/bookings";
import type { BookingOut } from "../api/catalog";

export type BookingsState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; bookings: BookingOut[]; capHit: boolean };

const FETCH_LIMIT = 100;

export function useOccupancyBookings(
  fromMs: number,
  toMs: number,
  maxPages: number,
): BookingsState {
  const [state, setState] = useState<BookingsState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const collected: BookingOut[] = [];
        let beforeId: number | undefined;
        let capHit = false;
        for (let page = 0; page < maxPages; page++) {
          const chunk = await fetchBookings({
            scope: "all",
            status: "pending,confirmed",
            fromDt: new Date(fromMs).toISOString(),
            toDt: new Date(toMs).toISOString(),
            limit: FETCH_LIMIT,
            beforeId,
          });
          if (cancelled) return;
          collected.push(...chunk);
          if (chunk.length < FETCH_LIMIT) break;
          const minId = chunk.reduce((m, b) => (b.id < m ? b.id : m), chunk[0].id);
          beforeId = minId;
          if (page === maxPages - 1) capHit = true;
        }
        if (cancelled) return;
        setState({ kind: "ready", bookings: collected, capHit });
      } catch (e) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Ошибка загрузки занятости",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromMs, toMs, maxPages]);

  return state;
}
