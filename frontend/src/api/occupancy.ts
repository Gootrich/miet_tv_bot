import { fetchBookings } from "./bookings";
import type { BookingOut } from "./catalog";

const FETCH_LIMIT = 100;
const DEFAULT_MAX_PAGES = 20;

/**
 * Полная выборка броней диапазона с курсорной пагинацией.
 * Ключ кэша — забота useCachedData (occupancy:<fromMs>:<toMs>).
 * Возвращает плоский список BookingOut в порядке убывания id.
 */
export async function fetchOccupancy(
  fromMs: number,
  toMs: number,
  maxPages: number = DEFAULT_MAX_PAGES,
): Promise<BookingOut[]> {
  const collected: BookingOut[] = [];
  let beforeId: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const chunk = await fetchBookings({
      scope: "all",
      status: "pending,confirmed",
      fromDt: new Date(fromMs).toISOString(),
      toDt: new Date(toMs).toISOString(),
      limit: FETCH_LIMIT,
      beforeId,
    });
    collected.push(...chunk);
    if (chunk.length < FETCH_LIMIT) return collected;
    const minId = chunk.reduce((m, b) => (b.id < m ? b.id : m), chunk[0].id);
    beforeId = minId;
  }
  return collected;
}
